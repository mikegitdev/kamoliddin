"""Public contact fields (phone / telegram / whatsapp) shared by Business and
Location. Owners type them freely; store one canonical form so the public
call / messaging buttons always resolve to a working link."""
import re

from rest_framework import serializers

from apps.accounts.services import normalize_phone

_TG_LINK_RE = re.compile(r"^(https?://)?(www\.)?(t|telegram)\.me/", re.IGNORECASE)
_TG_HANDLE_RE = re.compile(r"^[A-Za-z0-9_]{5,32}$")
_TG_INVITE_RE = re.compile(r"^(\+|joinchat/)[A-Za-z0-9_-]+$")
_PHONE_LIKE_RE = re.compile(r"^\+?[\d\s()-]{9,}$")
_WA_LINK_RE = re.compile(r"^(https?://)?(api\.)?(wa\.me|whatsapp\.com)/", re.IGNORECASE)


def _phone_or_error(value: str) -> str:
    try:
        return normalize_phone(value)
    except ValueError:
        raise serializers.ValidationError(
            "Enter an Uzbek phone number, e.g. +998 90 123 45 67"
        ) from None


def clean_phone(value: str) -> str:
    value = value.strip()
    return _phone_or_error(value) if value else ""


def clean_whatsapp(value: str) -> str:
    """Stored as +998XXXXXXXXX; a pasted wa.me link is reduced to its number."""
    value = _WA_LINK_RE.sub("", value.strip())
    value = value.split("?", 1)[0].removeprefix("send/")
    return _phone_or_error(value) if value else ""


def clean_telegram(value: str) -> str:
    """Stored as a bare handle ("shop_uz") or a +998 phone number."""
    value = value.strip()
    if not value:
        return ""
    if _PHONE_LIKE_RE.match(value):
        return _phone_or_error(value)
    handle = _TG_LINK_RE.sub("", value).lstrip("@").strip("/")
    handle = handle.split("?", 1)[0]
    if re.fullmatch(r"\+\d+", handle):  # t.me/+998... phone link
        return _phone_or_error(handle)
    if _TG_INVITE_RE.match(handle):  # private group/channel invite
        return handle
    if not _TG_HANDLE_RE.match(handle):
        raise serializers.ValidationError(
            "Enter a Telegram username (@name or t.me/name) or phone number"
        )
    return handle


class ContactFieldsMixin:
    """validate_<field> hooks for serializers exposing the contact fields."""

    def validate_phone(self, value: str) -> str:
        return clean_phone(value)

    def validate_telegram(self, value: str) -> str:
        return clean_telegram(value)

    def validate_whatsapp(self, value: str) -> str:
        return clean_whatsapp(value)
