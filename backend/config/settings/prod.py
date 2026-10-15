from .base import *  # noqa: F401,F403

DEBUG = False

# Fail fast if prod misconfigures.
if SECRET_KEY == "dev-only-insecure-secret-key":  # noqa: F405
    raise RuntimeError("DJANGO_SECRET_KEY must be set to a real secret in production")
# The fake gateways accept unsigned webhooks and log OTP codes — never in prod.
if PAYMENT_PROVIDER == "fake":  # noqa: F405
    raise RuntimeError("PAYMENT_PROVIDER=fake is dev/test only; set a real provider")
if SMS_PROVIDER == "fake":  # noqa: F405
    raise RuntimeError("SMS_PROVIDER=fake is dev/test only; set a real provider")

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
