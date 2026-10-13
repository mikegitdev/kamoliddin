from django.db import connection
from django.http import JsonResponse
from drf_spectacular.utils import extend_schema
from rest_framework.views import APIView


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
            {"status": "ok" if db_ok else "degraded", "db": db_ok},
            status=200 if db_ok else 503,
        )


class HealthProbeView(HealthView):
    """Same probe on the no-slash path (strict probes); distinct operationId."""

    @extend_schema(operation_id="health_probe", responses={200: None, 503: None})
    def get(self, request):
        return super().get(request)


health_view = HealthView.as_view()
health_probe_view = HealthProbeView.as_view()
