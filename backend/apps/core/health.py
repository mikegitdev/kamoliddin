import functools
import os
import subprocess
from pathlib import Path

from django.db import connection
from django.http import JsonResponse
from drf_spectacular.utils import extend_schema
from rest_framework.views import APIView


@functools.cache
def release_info() -> dict[str, str]:
    """Which backend code is running: the last commit that touched backend/.

    Production images bake it in at build time (deploy.sh -> Dockerfile build
    args -> APP_GIT_* env); local dev falls back to asking git directly. A
    `-dirty` suffix means uncommitted backend edits were built in."""
    sha = os.environ.get("APP_GIT_SHA", "")
    if sha:
        return {
            "sha": sha,
            "date": os.environ.get("APP_GIT_DATE", ""),
            "built_at": os.environ.get("APP_BUILT_AT", ""),
        }
    backend_dir = Path(__file__).resolve().parents[2]
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%h %cI", "--", "."],
            cwd=backend_dir, capture_output=True, text=True, timeout=2, check=True,
        ).stdout.split()
        dirty = subprocess.run(
            ["git", "status", "--porcelain", "--", "."],
            cwd=backend_dir, capture_output=True, text=True, timeout=2, check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        out, dirty = [], ""
    if len(out) != 2:
        return {"sha": "unknown", "date": "", "built_at": ""}
    return {"sha": out[0] + ("-dirty" if dirty else ""), "date": out[1], "built_at": ""}


class HealthView(APIView):
    """Liveness/readiness probe: checks DB connectivity.

    Returns HTTP 503 (not 200) when the database is unreachable, so
    `curl -f` deploy gates and uptime monitors register the outage."""

    permission_classes = []
    authentication_classes = []

    @extend_schema(operation_id="health", responses={200: None, 503: None})
    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            db_ok = True
        except Exception:
            db_ok = False
        return JsonResponse(
            {"status": "ok" if db_ok else "degraded", "db": db_ok, "release": release_info()},
            status=200 if db_ok else 503,
        )


class HealthProbeView(HealthView):
    """Same probe on the no-slash path (strict probes); distinct operationId."""

    @extend_schema(operation_id="health_probe", responses={200: None, 503: None})
    def get(self, request):
        return super().get(request)


health_view = HealthView.as_view()
health_probe_view = HealthProbeView.as_view()
