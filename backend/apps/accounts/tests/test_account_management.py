"""Account lifecycle invariants (spec §9/§14): phone change requires OTP proof
of the NEW number and reclaim-blocks the abandoned one; deletion anonymizes
PII, stops future charges, and retains financial records."""

from datetime import timedelta

import pytest
from django.test import override_settings
from django.utils import timezone

from apps.accounts.models import PhoneChangeRecord
from apps.accounts.services import (
    OTPError,
    PhoneTakenError,
    complete_phone_change,
    delete_account,
    request_otp,
    request_phone_change,
)
from apps.billing.models import Order
from apps.businesses.models import Business
from apps.renewals.models import RenewalAgreement

pytestmark = pytest.mark.django_db

NEW_PHONE = "+998901234998"
OLD_PHONE = "+998901000001"  # conftest `owner` fixture


@override_settings(OTP_DEV_ECHO=True, SMS_PROVIDER="fake")
def test_phone_change_switches_phone_and_blocks_old(owner, other_owner):
    from apps.accounts.services import verify_otp

    with pytest.raises(OTPError):
        request_phone_change(owner, OLD_PHONE)  # equal to current
    with pytest.raises(OTPError):
        request_phone_change(owner, other_owner.phone_e164)  # taken

    issued = request_phone_change(owner, NEW_PHONE)
    code = issued.dev_code  # in-memory dev echo; DB stores hashes only
    with pytest.raises(OTPError):
        # a LOGIN-purpose verify must not consume a PHONE_CHANGE challenge
        verify_otp(NEW_PHONE, code)

    user = complete_phone_change(owner, NEW_PHONE, code)
    assert user.phone_e164 == NEW_PHONE
    record = PhoneChangeRecord.objects.get(user=owner)
    assert record.old_phone_e164 == OLD_PHONE
    assert record.old_phone_blocked_until > timezone.now()

    # abandoned phone cannot request a login code nor re-register
    with pytest.raises(OTPError):
        request_otp(OLD_PHONE)
    with pytest.raises(OTPError):
        verify_otp(OLD_PHONE, code)


@override_settings(OTP_DEV_ECHO=True, SMS_PROVIDER="fake")
def test_phone_change_rejects_late_taker(owner, db):
    from apps.accounts.models import User

    issued = request_phone_change(owner, NEW_PHONE)
    User.objects.create_user(phone_e164=NEW_PHONE)  # claimed after code was sent

    with pytest.raises(PhoneTakenError):
        complete_phone_change(owner, NEW_PHONE, issued.dev_code)
    owner.refresh_from_db()
    assert owner.phone_e164 == OLD_PHONE  # unchanged


def test_delete_account_anonymizes_stops_charges_retains_records(
    owner, business, campaign
):
    order = Order.objects.create(
        business=business,
        campaign=campaign,
        amount_total=100,
        state=Order.State.PAID,
        auto_renew=True,
    )
    agreement = RenewalAgreement.objects.create(
        business=business,
        campaign=campaign,
        locations_snapshot=[],
        duration_seconds=86_400,
        charge_days=1,
        content_version_hash="x" * 64,
        token_ref="tok",
        consent_at=timezone.now(),
        next_run_at=timezone.now() + timedelta(days=1),
    )

    delete_account(owner)

    owner.refresh_from_db(), business.refresh_from_db()
    order.refresh_from_db(), agreement.refresh_from_db()
    assert owner.deleted_at is not None and not owner.is_active
    assert owner.phone_e164 != OLD_PHONE and owner.phone_e164.startswith("+998000")
    assert business.status == Business.Status.DISABLED
    assert order.auto_renew is False  # no future charges...
    assert order.state == Order.State.PAID  # ...but records retained (spec §14)
    assert agreement.status == RenewalAgreement.Status.DISABLED
    with pytest.raises(OTPError):  # abandoned phone is reclaim-blocked
        request_otp(OLD_PHONE)
