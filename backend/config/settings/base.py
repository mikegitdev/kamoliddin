"""Django settings — base module shared by dev/prod/test.

Environment-driven (django-environ). See backend/.env.example.
"""
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, []),
    CORS_ALLOWED_ORIGINS=(list, []),
    USE_S3=(bool, False),
    SMS_PROVIDER=(str, "fake"),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")

# --- Applications -----------------------------------------------------------

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "corsheaders",
    "storages",
]

LOCAL_APPS = [
    "apps.core",
    "apps.accounts",
    "apps.businesses",
    "apps.locations",
    "apps.campaigns",
    "apps.placements",
    "apps.billing",
    "apps.payments",
    "apps.renewals",
    "apps.discovery",
    "apps.moderation",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.core.middleware.RequestIDMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# --- Database (PostGIS required — no SQLite fallback for spatial work) ------

DATABASES = {
    "default": env.db_url("DATABASE_URL", default="postgis://localads:localads@localhost:5432/localads"),
}

# --- Cache / Celery ----------------------------------------------------------

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": env("REDIS_URL", default="redis://localhost:6379/1"),
    }
}

CELERY_BROKER_URL = env("CELERY_BROKER_URL", default="redis://localhost:6379/0")
CELERY_TASK_ALWAYS_EAGER = False
CELERY_TASK_DEFAULT_QUEUE = "default"
CELERY_BEAT_SCHEDULE = {
    "refresh-placement-states": {
        "task": "apps.placements.tasks.refresh_states_task",
        "schedule": 60.0,
    },
    "reconcile-payments": {
        "task": "apps.payments.tasks.reconcile_payments_task",
        "schedule": 300.0,
    },
}

# --- Logging ------------------------------------------------------------------------

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "console": {
            "format": "{levelname} {asctime} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "console",
        },
    },
    # Root catches apps.* loggers (exception handler tracebacks, webhook
    # warnings). Without this they only reached stderr via Python's
    # last-resort handler: WARNING+, no level name/timestamp formatting.
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,  # avoid double emission via root
        },
    },
}

# --- Auth (phone OTP -> session) ----------------------------------------------

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Staff/admin login uses passwords (createsuperuser); advertisers use OTP only.

# --- DRF ------------------------------------------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "300/min",  # map browsing fires a request per pan/search
        "user": "120/min",
        "otp": "5/min",  # scoped rate for OTP request/verify (spec §9)
        "report": "10/min",  # public complaint submissions
    },
    # Throttles key on the client IP. 0 = REMOTE_ADDR only: a client-sent
    # X-Forwarded-For must never pick the bucket. prod.py raises it to 1
    # (nginx). Unset, DRF keys on the raw header — trivially rotated.
    "NUM_PROXIES": 0,
    "EXCEPTION_HANDLER": "apps.core.exception_handler.api_exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Local Advertising Map Platform API",
    "DESCRIPTION": "Public map/advertising API v1. Money is integer minor units (tiyin, UZS).",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    # Several models reuse the field names state/status/decision; name each
    # choice set explicitly instead of letting spectacular emit hashed names.
    "ENUM_NAME_OVERRIDES": {
        "OrderStateEnum": "apps.billing.models.Order.State",
        "RefundStateEnum": "apps.billing.models.Refund.State",
        "PlacementStateEnum": "apps.placements.models.Placement.State",
        "ReportStateEnum": "apps.moderation.models.Report.State",
        "PaymentAttemptStatusEnum": "apps.payments.models.PaymentAttempt.Status",
        # Location.Status and Business.Status are the same choice set.
        "EntityStatusEnum": "apps.locations.models.Location.Status",
        "ReviewDecisionEnum": "apps.campaigns.models.CampaignReview.Decision",
        "ApproveRejectDecisionEnum": [("approve", "approve"), ("reject", "reject")],
        "ReportDecisionEnum": [("resolve", "resolve"), ("dismiss", "dismiss")],
    },
}

# --- i18n / tz -------------------------------------------------------------------

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Tashkent"  # display timezone; storage is UTC (spec §5)
USE_I18N = True
USE_TZ = True

# --- Static / media ----------------------------------------------------------------

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES: dict[str, dict[str, object]] = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

if env("USE_S3"):
    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "endpoint_url": env("S3_ENDPOINT_URL"),
            "access_key": env("S3_ACCESS_KEY"),
            "secret_key": env("S3_SECRET_KEY"),
            "bucket_name": env("S3_BUCKET_NAME"),
            # Garage validates the sigv4 credential region against s3_region
            # (region mismatch => 400 on every S3 call); default matches
            # infra/docker/garage.toml.
            "region_name": env("S3_REGION", default="garage"),
            # Storage is never publicly exposed: public media URLs point at
            # the server-mediated /media route (apps/core/media.py, spec §11).
            # e.g. "localhost:8000/media" in dev, "ads.example.uz/media" in prod.
            "custom_domain": env("S3_PUBLIC_DOMAIN", default=None),
            "url_protocol": env("S3_URL_PROTOCOL", default="https:"),
            "file_overwrite": False,  # UUID object keys anyway (spec §11)
        },
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Integrations -------------------------------------------------------------------

SMS_PROVIDER = env("SMS_PROVIDER")
# fake | click (click raises until merchant verification, spec §19 [E])
PAYMENT_PROVIDER = env("PAYMENT_PROVIDER", default="fake")

# Eskiz SMS gateway credentials (ADR-0006). Empty by default: selecting
# SMS_PROVIDER=eskiz without credentials fails fast in the adapter.
ESKIZ_EMAIL = env("ESKIZ_EMAIL", default="")
ESKIZ_PASSWORD = env("ESKIZ_PASSWORD", default="")
ESKIZ_FROM = env("ESKIZ_FROM", default="4546")
ESKIZ_BASE_URL = env("ESKIZ_BASE_URL", default="https://notify.eskiz.uz")

# Telegram OTP delivery channel (ADR-0006): enrollment-bound chat delivery
# with SMS fallback. Empty TELEGRAM_BOT_TOKEN selects the fake adapter
# (dev/test); production sets token + username + webhook secret.
TELEGRAM_BOT_TOKEN = env("TELEGRAM_BOT_TOKEN", default="")
TELEGRAM_BOT_USERNAME = env("TELEGRAM_BOT_USERNAME", default="")
TELEGRAM_WEBHOOK_SECRET = env("TELEGRAM_WEBHOOK_SECRET", default="")
TELEGRAM_API_BASE = env("TELEGRAM_API_BASE", default="https://api.telegram.org")
TELEGRAM_BIND_TOKEN_TTL_SECONDS = 600

CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS", default=[
    "http://localhost:5173",
    "http://127.0.0.1:5173",
])

# OTP policy (spec §9) — defaults, overridable via PlatformSetting later.
OTP_CODE_TTL_SECONDS = 300
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_AFTER_SECONDS = 60
OTP_CODE_LENGTH = 6

# After a phone change or account deletion, the abandoned number cannot
# register a new account for this many days (recycled-SIM takeover guard).
PHONE_RECLAIM_BLOCK_DAYS = 30

# Campaign/placement policy defaults; the admin-editable source of truth is
# PlatformSetting (spec §5), seeded with max_active_ads_per_location=5.
MAX_ACTIVE_ADS_PER_LOCATION = 5
