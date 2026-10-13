"""Test settings.

Per spec §17: financial/spatial tests MUST run against real PostgreSQL+PostGIS,
never SQLite. These settings point at the docker-compose `db` service.
Create the test DB once: `docker compose exec db createdb test_localads -U localads`
(or let pytest-django create it).

The cache is locmem: DRF throttling must work in tests/CI without a Redis
service (throttle counters being per-process is fine for the test suite).
"""
from .dev import *  # noqa: F401,F403

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "test",
    }
}
