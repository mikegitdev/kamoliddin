"""Structured logging (spec §15 [R]): a compact JSON formatter plus a
contextvar that carries the current request id onto every log record.

Docker/gunicorn stdout is the log destination; JSON lines make the request
id, level and logger greppable without a log platform. Dev keeps the
human-readable console format (settings select the formatter).
"""
import contextvars
import json
import logging
from datetime import UTC, datetime

# Set by RequestIDMiddleware per request; read by the filter below. A
# contextvar (not a thread-local) survives async handlers too.
_request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")


def set_request_id(value: str) -> None:
    _request_id.set(value)


def get_request_id() -> str:
    return _request_id.get()


class RequestIDLogFilter(logging.Filter):
    """Attach the current request id (if any) to the record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id.get() or "-"
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line: ts, level, logger, request_id, message."""

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created, tz=UTC).isoformat()
        payload = {
            "ts": ts,
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)
