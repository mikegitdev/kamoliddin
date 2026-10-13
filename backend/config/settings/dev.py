from typing import Any, cast

from .base import *  # noqa: F401,F403
from .base import REST_FRAMEWORK, env

DEBUG = True

SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-only-insecure-secret-key")

ALLOWED_HOSTS = ["*"]

# Dev/E2E convenience: production keeps the spec's 5/min (config/settings/base.py);
# local stacks may raise it so automated flows don't wait out throttle windows.
rates = cast(dict[str, Any], REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"])
rates["otp"] = env("OTP_THROTTLE_RATE", default="5/min")

# Dev/E2E convenience: echo the OTP code as `dev_code` in the otp/request
# 202 body so the Playwright suite reads it from the response instead of
# parsing container logs. Double-gated in apps.accounts.services on
# SMS_PROVIDER=fake; prod settings never define this flag (spec §9).
OTP_DEV_ECHO = env("OTP_DEV_ECHO", default=True)

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
