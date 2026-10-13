"""Phone OTP service (spec §9): E.164 normalization, hashed codes, throttling,
anti-enumeration (identical responses whether or not the phone is known).
Account lifecycle: phone change with new-phone OTP proof, soft delete that
anonymizes PII while retaining financial records (spec §14)."""
import hashlib
import hmac
import logging
import re
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from .models import OTPChallenge, PhoneChangeRecord, User

logger = logging.getLogger(__name__)

UZBEK_PHONE_RE = re.compile(r"^998\d{9}$")

DAILY_CODE_QUOTA = 20  # per phone+purpose per 24h


class OTPError(Exception):
    """Raised on throttling/policy violations; never reveals phone existence."""


class PhoneTakenError(Exception):
    """Phone change target already belongs to another active account."""


def normalize_phone(raw: str) -> str:
    """Normalize Uzbek numbers to E.164 (+998XXXXXXXXX).

    Accepts: +998901234567, 998901234567, 901234567, +998 90 123 45 67.
    """
    digits = "".join(ch for ch in raw if ch.isdigit())
    if digits.startswith("8") and len(digits) == 9:  # local form without operator zero
        digits = "998" + digits
    if len(digits) == 9:
        digits = "998" + digits
    if not UZBEK_PHONE_RE.match(digits):
        raise ValueError("Invalid Uzbek phone number")
    return "+" + digits


def _hash(value: str) -> str:
    key = settings.SECRET_KEY.encode()
    return hmac.new(key, value.encode(), hashlib.sha256).hexdigest()


def _sms_adapter():
    from .sms import get_sms_adapter

    return get_sms_adapter()


def _old_phone_block(phone: str) -> PhoneChangeRecord | None:
    """Active reclaim-block record for a phone, if any."""
    return PhoneChangeRecord.objects.filter(
        old_phone_e164=phone, old_phone_blocked_until__gt=timezone.now()
    ).first()


def _issue_challenge(phone: str, purpose: str) -> OTPChallenge:
    """Create+send an OTP challenge, enforcing quota/resend throttling."""
    now = timezone.now()
    recent = OTPChallenge.objects.filter(
        Q(phone_hash=_hash(phone), purpose=purpose),
        created_at__gte=now - timedelta(hours=24),
    )
    if recent.count() >= DAILY_CODE_QUOTA:  # daily per-phone quota
        raise OTPError("Too many codes requested today. Try again later.")
    last = recent.order_by("-created_at").first()
    if last and last.resend_after > now:
        raise OTPError("The previous code was sent recently. Please wait.")

    code = f"{secrets.randbelow(10 ** settings.OTP_CODE_LENGTH):0{settings.OTP_CODE_LENGTH}d}"
    challenge = OTPChallenge.objects.create(
        phone_e164=phone,
        phone_hash=_hash(phone),
        code_hash=_hash(f"{phone}:{code}"),
        purpose=purpose,
        expires_at=now + timedelta(seconds=settings.OTP_CODE_TTL_SECONDS),
        resend_after=now + timedelta(seconds=settings.OTP_RESEND_AFTER_SECONDS),
    )
    # Dev-only echo for the E2E suite (spec §9): stashed on the in-memory
    # instance only — the DB keeps hashes, never plaintext. Double-gated:
    # OTP_DEV_ECHO is defined solely in dev settings, and the provider must
    # be the fake adapter. Prod can never satisfy either gate.
    if settings.SMS_PROVIDER == "fake" and getattr(settings, "OTP_DEV_ECHO", False):
        challenge.dev_code = code  # type: ignore[attr-defined]
    adapter = _sms_adapter()
    adapter.send_otp(
        phone_e164=phone,
        message=f"Your login code: {code}. Valid {settings.OTP_CODE_TTL_SECONDS // 60} minutes.",
        request_id=challenge.id,
    )
    return challenge


def request_otp(raw_phone: str) -> OTPChallenge:
    """Create a login OTP challenge for a phone, enforcing throttling.

    IP-level throttling is applied by the DRF scoped anon throttle on the
    view (5/min per IP); phone-level throttling and quotas live here."""
    phone = normalize_phone(raw_phone)
    if _old_phone_block(phone):
        # Recently abandoned via phone change/deletion: no send, no new account.
        raise OTPError("Invalid or expired code.")
    return _issue_challenge(phone, OTPChallenge.Purpose.LOGIN)


def _consume_challenge(phone: str, code: str, purpose: str) -> OTPChallenge:
    """Lock, validate and consume the newest open challenge (raises OTPError)."""
    now = timezone.now()
    challenge = (
        OTPChallenge.objects.filter(
            phone_e164=phone,
            purpose=purpose,
            consumed_at__isnull=True,
        )
        .select_for_update()
        .order_by("-created_at")
        .first()
    )
    invalid = OTPError("Invalid or expired code.")
    if challenge is None or challenge.expires_at < now:
        raise invalid
    if challenge.attempts >= settings.OTP_MAX_ATTEMPTS:
        raise invalid
    challenge.attempts += 1
    if not hmac.compare_digest(challenge.code_hash, _hash(f"{phone}:{code.strip()}")):
        challenge.save(update_fields=["attempts"])
        raise invalid

    challenge.consumed_at = now
    challenge.save(update_fields=["attempts", "consumed_at"])
    return challenge


def verify_otp(raw_phone: str, code: str) -> User:
    """Verify a challenge and return the (created-or-existing) user session subject."""
    phone = normalize_phone(raw_phone)
    with transaction.atomic():
        _consume_challenge(phone, code, OTPChallenge.Purpose.LOGIN)
        if _old_phone_block(phone):
            raise OTPError("Invalid or expired code.")
        user, _ = User.objects.get_or_create(phone_e164=phone, defaults={"is_active": True})
        if not user.is_active or user.deleted_at:
            raise OTPError("Account disabled.")
        return user


# --- Phone change ------------------------------------------------------------


def request_phone_change(user: User, raw_new_phone: str) -> OTPChallenge:
    """Issue an OTP to the prospective NEW phone.

    Anti-enumeration (spec §9): the caller returns a uniform response; no
    challenge is created when the phone equals the current one, is taken by
    another active account, or is reclaim-blocked.
    """
    phone = normalize_phone(raw_new_phone)
    taken = (
        User.objects.filter(phone_e164=phone, deleted_at__isnull=True)
        .exclude(pk=user.pk)
        .exists()
    )
    if phone == user.phone_e164 or taken or _old_phone_block(phone):
        raise OTPError("No code sent.")
    return _issue_challenge(phone, OTPChallenge.Purpose.PHONE_CHANGE)


def complete_phone_change(user: User, raw_new_phone: str, code: str) -> User:
    """Consume the new-phone challenge and switch the account's phone.

    The old phone is reclaim-blocked (default 30 days) so a recycled SIM
    cannot immediately register over the abandoned number.
    """
    phone = normalize_phone(raw_new_phone)
    with transaction.atomic():
        _consume_challenge(phone, code, OTPChallenge.Purpose.PHONE_CHANGE)
        if _old_phone_block(phone):
            raise OTPError("Invalid or expired code.")
        old_phone = user.phone_e164
        try:
            with transaction.atomic():  # savepoint vs. concurrent same-phone verify
                user.phone_e164 = phone
                user.save(update_fields=["phone_e164"])
        except IntegrityError:
            raise PhoneTakenError("This phone number is already in use.")
        PhoneChangeRecord.objects.create(
            user=user,
            old_phone_e164=old_phone,
            new_phone_e164=phone,
            old_phone_blocked_until=timezone.now()
            + timedelta(days=settings.PHONE_RECLAIM_BLOCK_DAYS),
        )
        return user


# --- Account deletion ----------------------------------------------------------


def _anonymized_phone() -> str:
    """Unique placeholder in E.164 shape; operator code 000 is unassigned in UZ."""
    return f"+998000{uuid.uuid4().int % 1_000_000:06d}"


def delete_account(user: User) -> None:
    """Self-serve soft deletion: anonymize PII, stop future charges, disable
    owned businesses (their placements hide via eligible_now_q — spec §14),
    and retain all financial records. Refunds stay an admin workflow.

    Open policy [O]: already-paid placements keep their remaining term hidden
    with the business (no self-serve refund); disputes go through the
    account-recovery runbook.
    """
    from apps.billing.models import Order
    from apps.businesses.models import Business
    from apps.renewals.models import RenewalAgreement

    now = timezone.now()
    with transaction.atomic():
        RenewalAgreement.objects.filter(business__owner=user).exclude(
            status=RenewalAgreement.Status.DISABLED
        ).update(status=RenewalAgreement.Status.DISABLED)
        Order.objects.filter(business__owner=user, auto_renew=True).update(auto_renew=False)
        Business.objects.filter(owner=user).update(status=Business.Status.DISABLED)

        old_phone = user.phone_e164
        user.phone_e164 = _anonymized_phone()
        user.is_active = False
        user.deleted_at = now
        user.save(update_fields=["phone_e164", "is_active", "deleted_at"])
        # Block the abandoned phone like a phone change (recycled-SIM takeover).
        PhoneChangeRecord.objects.create(
            user=user,
            old_phone_e164=old_phone,
            new_phone_e164=user.phone_e164,
            old_phone_blocked_until=now + timedelta(days=settings.PHONE_RECLAIM_BLOCK_DAYS),
        )
