# Backend image: Django + GeoDjango (GDAL/GEOS/PROJ) + Gunicorn.
# Default build (no --target) = production image.
# `--target dev` = base + test deps, used by dev.sh so the suite is runnable
# inside the container even when the host lacks GDAL.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# GeoDjango system libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    binutils \
    libproj-dev \
    gdal-bin \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY . .

# Dev target: test dependencies (kept in sync with pyproject dev group).
FROM base AS dev
RUN pip install --no-cache-dir -r requirements-dev.txt

# Default (no --target): production image, unchanged behavior.
FROM base

EXPOSE 8000

# No automatic migrations on startup (spec §15): run `manage.py migrate`
# explicitly during deployment.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", \
     "--timeout", "60", "--access-logfile", "-", "--error-logfile", "-"]
