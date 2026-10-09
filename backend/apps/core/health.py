from django.db import connection
from django.http import JsonResponse
from drf_spectacular.utils import extend_schema
from rest_framework.views import APIView


class HealthView(APIView):
    """Liveness/readiness probe: checks DB connectivity."""

    permission_classes = []
    authentication_classes = []

    @extend_schema(responses={200: object})
    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            db_ok = True
        except Exception:
            db_ok = False
        return JsonResponse({"status": "ok" if db_ok else "degraded", "db": db_ok})


health_view = HealthView.as_view()
