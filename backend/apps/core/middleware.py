import uuid

from django.utils.deprecation import MiddlewareMixin

from .logging import set_request_id


class RequestIDMiddleware(MiddlewareMixin):
    """Attach a request id to every request and echo it in the X-Request-ID
    header; also publish it to the logging context so every log line emitted
    while handling the request carries it (spec §15 structured logs)."""

    def process_request(self, request):
        request.request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        set_request_id(request.request_id)

    def process_response(self, request, response):
        response["X-Request-ID"] = getattr(request, "request_id", uuid.uuid4().hex)
        return response
