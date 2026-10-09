"""API conventions (spec §12): machine-readable errors + request IDs.

Error envelope:
    { "error": { "code": "...", "message": "...", "fields": {...} }, "request_id": "..." }
"""
from rest_framework import status
from rest_framework.views import exception_handler as drf_exception_handler


def _error_code(exc) -> str:
    """Map an exception to a stable machine-readable error code."""
    if getattr(exc, "default_code", None):
        return str(exc.default_code)
    status_code = getattr(exc, "status_code", None)
    if status_code == status.HTTP_401_UNAUTHORIZED:
        return "not_authenticated"
    if status_code == status.HTTP_403_FORBIDDEN:
        return "permission_denied"
    if status_code == status.HTTP_404_NOT_FOUND:
        return "not_found"
    return "error"


def api_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None  # non-API error -> plain 500, logged by Django

    request = context.get("request")
    request_id = getattr(request, "request_id", None) if request else None
    detail = getattr(exc, "detail", None)
    fields = detail if isinstance(detail, dict) else None
    message = detail if isinstance(detail, str) else str(detail)

    response.data = {
        "error": {
            "code": _error_code(exc),
            "message": message,
            "fields": fields or {},
        },
        "request_id": request_id,
    }
    return response
