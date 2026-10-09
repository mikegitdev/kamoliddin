"""Phone OTP service (spec §9): E.164 normalization, hashed codes, throttling,
anti-enumeration (identical responses whether or not the phone is known)."""
import hashlib
import hmac
import logging
import random
import re
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import OTPChallenge, User

logger = logging.getLogger(__name__)

UZBEK_PHONE_RE = re.compile(r"^998\d{9}$")


class OTPError(Exception):
    """Raised on throttling/policy violations; never reveals phone existence."""


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


def request_otp(raw_phone: str, *, ip: str = "") -> OTPChallenge:
    """Create an OTP challenge for a phone, enforcing resend/attempt throttling."""
    phone = normalize_phone(raw_phone)
    now = timezone.now()

    recent = OTPChallenge.objects.filter(
        Q(phone_hash=_hash(phone), purpose=OTPChallenge.Purpose.LOGIN),
        created_at__gte=now - timedelta(hours=24),
    )
    if recent.count() >= 20:  # daily per-phone quota
        raise OTPError("Too many codes requested today. Try again later.")
    last = recent.order_by("-created_at").first()
    if last and last.resend_after > now:
        raise OTPError("The previous code was sent recently. Please wait.")

    code = f"{random.randrange(10 ** settings.OTP_CODE_LENGTH):0{settings.OTP_CODE_LENGTH}d}"
    challenge = OTPChallenge.objects.create(
        phone_e164=phone,
        phone_hash=_hash(phone),
        code_hash=_hash(f"{phone}:{code}"),
        purpose=OTPChallenge.Purpose.LOGIN,
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


def verify_otp(raw_phone: str, code: str) -> User:
    """Verify a challenge and return the (created-or-existing) user session subject."""
    phone = normalize_phone(raw_phone)
    with transaction.atomic():
        return _verify_locked(phone, code)


def _verify_locked(phone: str, code: str) -> User:
    now = timezone.now()
    challenge = (
        OTPChallenge.objects.filter(
            phone_e164=phone,
            purpose=OTPChallenge.Purpose.LOGIN,
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
    user, _ = User.objects.get_or_create(phone_e164=phone, defaults={"is_active": True})
    if not user.is_active:
        raise OTPError("Account disabled.")
    return user
