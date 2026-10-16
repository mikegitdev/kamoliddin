"""API conventions (spec §12): machine-readable errors + request IDs.

Error envelope:
    { "error": { "code": "...", "message": "...", "fields": {...} }, "request_id": "..." }
"""
import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler
from rest_framework.views import set_rollback

logger = logging.getLogger(__name__)


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


def _first_message(detail) -> str:
    """First human-readable string inside a DRF detail (str | list | dict),
    so `message` is never a Python repr like "{'field': [ErrorDetail(...)]}"."""
    if isinstance(detail, dict):
        for value in detail.values():
            message = _first_message(value)
            if message:
                return message
        return ""
    if isinstance(detail, list):
        for value in detail:
            message = _first_message(value)
            if message:
                return message
        return ""
    return str(detail) if detail is not None else ""


def api_exception_handler(exc, context):
    request = context.get("request")
    request_id = getattr(request, "request_id", None) if request else None

    response = drf_exception_handler(exc, context)
    if response is None:
        # Unhandled error: log the traceback, but still answer API clients
        # with the JSON envelope (never Django's HTML 500 page).
        logger.exception("Unhandled API error (request_id=%s)", request_id)
        set_rollback()
        return Response(
            {
                "error": {
                    "code": "server_error",
                    "message": "Internal server error",
                    "fields": {},
                },
                "request_id": request_id,
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    detail = getattr(exc, "detail", None)
    fields = detail if isinstance(detail, dict) else None

    response.data = {
        "error": {
            "code": _error_code(exc),
            "message": _first_message(detail) or "Request failed",
            "fields": fields or {},
        },
        "request_id": request_id,
    }
    return response
