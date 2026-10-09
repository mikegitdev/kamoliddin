from .base import *  # noqa: F401,F403
from .base import env

DEBUG = True

SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-only-insecure-secret-key")

ALLOWED_HOSTS = ["*"]

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
