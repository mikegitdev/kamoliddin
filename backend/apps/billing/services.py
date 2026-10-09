"""Transactional billing services (spec §6, §12): quote creation with immutable
snapshots, idempotent checkout, and the paid-gate → entitlement activation.

Invariants:
- The frontend NEVER supplies an authoritative price; totals are server-computed
  from the current Tariff and snapshotted into OrderItems.
- Checkout is idempotent per order (deterministic idempotency key).
- A paid order activates entitlements exactly once.
"""
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.businesses.models import Business
from apps.campaigns.models import Campaign
from apps.locations.models import Location
from apps.moderation.models import ActivityEvent, PlatformSetting
from apps.payments.gateways import get_payment_gateway
from apps.payments.models import PaymentAttempt

from .models import Order, Refund, quote_order_lines

QUOTE_TTL = timedelta(hours=1)


class CheckoutError(Exception):
    pass


def _max_active_ads() -> int:
    setting = PlatformSetting.objects.filter(key="max_active_ads_per_location").first()
    if setting is None:
        return settings.MAX_ACTIVE_ADS_PER_LOCATION
    return int(setting.value_json)


def _owned_business(*, user, business_id) -> Business:
    business = Business.objects.select_related("owner").filter(pk=business_id).first()
    if business is None:
        raise ValidationError({"business_id": "Business not found"})
    if business.owner_id != user.id:
        raise PermissionDenied("Not your business")
    return business


@transaction.atomic
def create_quote(
    *,
    user,
    business_id,
    campaign_id,
    location_ids,
    requested_start_at,
    requested_end_at,
    auto_renew: bool = False,
) -> Order:
    from apps.placements.models import Placement

    business = _owned_business(user=user, business_id=business_id)
    campaign = Campaign.objects.filter(pk=campaign_id, business=business).first()
    if campaign is None:
        raise ValidationError({"campaign_id": "Campaign not found for this business"})
    if campaign.review_status not in (
        Campaign.ReviewStatus.SUBMITTED,
        Campaign.ReviewStatus.UNDER_REVIEW,
        Campaign.ReviewStatus.APPROVED,
    ):
        raise ValidationError(
            {"campaign_id": "Submit the campaign for review before requesting a quote"}
        )

    if requested_end_at <= requested_start_at:
        raise ValidationError({"requested_end_at": "End must be after start"})

    locations = list(
        Location.objects.filter(
            pk__in=location_ids, business=business, status=Location.Status.ACTIVE
        )
    )
    if len(locations) != len(set(location_ids)):
        raise ValidationError({"location_ids": "Some locations are missing or inactive"})

    # Prospective capacity check per location (spec §14: sixth ad cannot activate).
    max_ads = _max_active_ads()
    now = timezone.now()
    for location in locations:
        overlapping = Placement.objects.filter(
            location=location,
            state__in=[Placement.State.SCHEDULED, Placement.State.ACTIVE],
            start_at__lt=requested_end_at,
            end_at__gt=requested_start_at,
        ).count()
        if overlapping >= max_ads:
            raise ValidationError(
                {
                    "location_ids": (
                        f"Location {location.name!r} reached the limit of "
                        f"{max_ads} simultaneous active ads for this interval"
                    )
                }
            )

    items, total, tariff = quote_order_lines(
        campaign=campaign,
        locations=locations,
        start_at=requested_start_at,
        end_at=requested_end_at,
    )
    order = Order.objects.create(
        business=business,
        campaign=campaign,
        amount_total=total,
        state=Order.State.DRAFT_QUOTE,
        quote_expires_at=now + QUOTE_TTL,
        interval_start_at=requested_start_at,
        interval_end_at=requested_end_at,
        auto_renew=auto_renew,
    )
    for item in items:
        item.order = order
        item.save()
    return order


@transaction.atomic
def create_checkout(*, user, order_id, return_url: str = "") -> tuple[PaymentAttempt, str]:
    order = (
        Order.objects.select_for_update()
        .select_related("business", "campaign")
        .filter(pk=order_id)
        .first()
    )
    if order is None:
        raise ValidationError({"order_id": "Order not found"})
    if order.business.owner_id != user.id:
        raise PermissionDenied("Not your order")
    if order.state == Order.State.PAID:
        raise CheckoutError("Order is already paid")
    if order.state not in (Order.State.DRAFT_QUOTE, Order.State.AWAITING_PAYMENT):
        raise CheckoutError(f"Order cannot be checked out in state {order.state!r}")
    if order.quote_expires_at and order.quote_expires_at < timezone.now():
        order.state = Order.State.EXPIRED
        order.save(update_fields=["state", "updated_at"])
        raise CheckoutError("Quote expired; request a new quote")

    gateway = get_payment_gateway(settings.PAYMENT_PROVIDER)
    idempotency_key = str(uuid.uuid5(uuid.NAMESPACE_URL, f"checkout:{order.id}"))
    attempt, _created = PaymentAttempt.objects.get_or_create(
        order=order,
        provider=gateway.slug,
        idempotency_key=idempotency_key,
        defaults={"amount": order.amount_total, "status": PaymentAttempt.Status.PENDING},
    )
    result = gateway.create_checkout(order=order, idempotency_key=idempotency_key,
                                     return_url=return_url)
    attempt.provider_payment_id = result.provider_payment_id
    attempt.save(update_fields=["provider_payment_id", "updated_at"])

    if order.state == Order.State.DRAFT_QUOTE:
        order.state = Order.State.AWAITING_PAYMENT
        order.save(update_fields=["state", "updated_at"])
    return attempt, result.redirect_url


# ---------------------------------------------------------------------------
# Refunds (spec §7.2): rejected/suspended paid campaign -> advertiser requests
# -> admin review -> provider refund. Payment records are never erased.
# ---------------------------------------------------------------------------


class RefundError(Exception):
    pass


@transaction.atomic
def request_refund(*, user, order_id: str, reason: str) -> Refund:
    order = (
        Order.objects.select_for_update()
        .select_related("campaign", "business")
        .filter(pk=order_id)
        .first()
    )
    if order is None:
        raise RefundError("Order not found")
    if order.business.owner_id != user.id:
        raise PermissionDenied("Not your order")
    if order.state != Order.State.PAID:
        raise RefundError("Only paid orders can be refunded")
    if order.campaign.review_status not in (
        Campaign.ReviewStatus.REJECTED,
        Campaign.ReviewStatus.SUSPENDED,
    ):
        raise RefundError("Refund is available for rejected or suspended campaigns")
    if order.refunds.filter(
        state__in=[
            Refund.State.REFUND_REQUESTED,
            Refund.State.ADMIN_REVIEW,
            Refund.State.PROVIDER_REFUND_PROCESSING,
        ]
    ).exists():
        raise RefundError("A refund request already exists for this order")

    refund = Refund.objects.create(
        order=order, amount=order.amount_total, reason=reason,
        state=Refund.State.REFUND_REQUESTED,
    )
    ActivityEvent.objects.create(
        action="refund.requested",
        entity="order",
        entity_id=str(order.id),
        metadata={"refund": str(refund.id), "amount": order.amount_total},
    )
    return refund


@transaction.atomic
def process_refund(
    *,
    staff,
    refund_id: str,
    decision: str,
    provider_ref: str = "",
    amount: int | None = None,
) -> Refund:
    """Admin decision: 'approve' -> provider processing -> refunded (fake
    provider settles instantly); 'reject' -> refund_failed."""
    refund = (
        Refund.objects.select_for_update()
        .select_related("order", "order__campaign", "order__business")
        .filter(pk=refund_id)
        .first()
    )
    if refund is None:
        raise RefundError("Refund not found")
    if refund.state not in (
        Refund.State.REFUND_REQUESTED,
        Refund.State.ADMIN_REVIEW,
    ):
        raise RefundError(f"Cannot process refund in state {refund.state!r}")
    if decision not in ("approve", "reject"):
        raise RefundError("decision must be approve or reject")

    refund.operator = staff
    if amount is not None:
        refund.amount = amount

    if decision == "reject":
        refund.state = Refund.State.REFUND_FAILED
        refund.save(update_fields=["state", "operator", "amount", "completed_at"])
        ActivityEvent.objects.create(
            actor=staff, action="refund.rejected", entity="order",
            entity_id=str(refund.order_id), metadata={"refund": str(refund.id)},
        )
        return refund

    refund.state = Refund.State.PROVIDER_REFUND_PROCESSING
    refund.save(update_fields=["state", "operator", "amount"])

    # Fake provider settles instantly; a real adapter performs the provider call
    # here and records its reference (never fabricate a CLICK outcome).
    gateway = get_payment_gateway(settings.PAYMENT_PROVIDER)
    refund.provider_ref = provider_ref or f"{gateway.slug}-refund-{refund.id}"
    refund.state = Refund.State.REFUNDED
    refund.completed_at = timezone.now()
    refund.save(update_fields=["provider_ref", "state", "completed_at"])

    # Refunded entitlements stop displaying; accounting rows remain intact.
    from apps.placements.models import Placement

    order = refund.order
    Placement.objects.filter(
        campaign=order.campaign,
        start_at=order.interval_start_at,
        source_type=Placement.SourceType.PAID,
    ).update(state=Placement.State.CANCELLED)

    # Refunded order no longer renews.
    from apps.renewals.models import RenewalAgreement

    RenewalAgreement.objects.filter(campaign=order.campaign).update(
        status=RenewalAgreement.Status.DISABLED
    )

    ActivityEvent.objects.create(
        actor=staff, action="refund.completed", entity="order",
        entity_id=str(order.id),
        metadata={"refund": str(refund.id), "amount": refund.amount},
    )
    return refund
