import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models

from .managers import UserManager


class User(AbstractBaseUser, PermissionsMixin):
    """Phone-identified account. No email, no username; OTP login for owners,
    password login only for staff using Django admin (spec §3, §9)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone_e164 = models.CharField("phone (E.164)", max_length=16, unique=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(
        null=True, blank=True, editable=False,
        help_text="Soft-delete time; phone anonymized when set (spec §14: retain accounting)",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "phone_e164"
    REQUIRED_FIELDS: list[str] = []

    def __str__(self) -> str:
        return self.phone_e164

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class OTPChallenge(models.Model):
    """Hashed, short-lived phone OTP challenge. No plaintext codes at rest (spec §9)."""

    class Purpose(models.TextChoices):
        LOGIN = "login", "Login"
        PHONE_CHANGE = "phone_change", "Phone change"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone_e164 = models.CharField(max_length=16, db_index=True)
    phone_hash = models.CharField(max_length=64, db_index=True)
    code_hash = models.CharField(max_length=64)
    purpose = models.CharField(max_length=20, choices=Purpose.choices, default=Purpose.LOGIN)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    resend_after = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["phone_hash", "purpose"]),
        ]

    def __str__(self) -> str:
        return f"OTP {self.phone_e164} ({self.purpose})"

    @property
    def is_consumed(self) -> bool:
        return self.consumed_at is not None


class PhoneChangeRecord(models.Model):
    """Audit + reclaim-block for phone changes and deletion anonymization.

    After a change (or deletion), the OLD phone cannot register a new account
    until `old_phone_blocked_until` — prevents recycled-SIM takeover of an
    abandoned number. Also the identity-verification trail for the account
    recovery runbook (docs/runbooks/account-recovery.md)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="phone_changes"
    )
    old_phone_e164 = models.CharField(max_length=16, db_index=True)
    new_phone_e164 = models.CharField(max_length=16)
    old_phone_blocked_until = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.old_phone_e164} -> {self.new_phone_e164} ({self.user_id})"
