import uuid

from django.utils.deprecation import MiddlewareMixin


class RequestIDMiddleware(MiddlewareMixin):
    """Attach a request id to every request and echo it in the X-Request-ID header."""

    def process_request(self, request):
        request.request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex

    def process_response(self, request, response):
        response["X-Request-ID"] = getattr(request, "request_id", uuid.uuid4().hex)
        return response
