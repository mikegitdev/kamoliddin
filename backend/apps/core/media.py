"""Server-mediated media upload (spec §11): UUID object keys, type/size/magic
validation via Pillow, lossless-clean re-encode that strips ALL metadata
(including GPS EXIF), stored through the default storage (Garage when USE_S3).
Public references remain keyed; discovery only exposes URLs for eligible ads.
"""
import io
import mimetypes
import uuid
from pathlib import Path

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.http import FileResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from PIL import Image, ImageOps
from rest_framework import permissions, serializers
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_INPUT_PIXELS = 40_000_000
ALLOWED_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
ALLOWED_PURPOSES = {"banners", "logos"}
ALLOWED_SERVE_PREFIXES = ("banners/", "logos/")
ALLOWED_SERVE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

# Dimension policy (ADR-0004): re-encode caps the long edge (aspect kept);
# minimums keep banners legible on the map card. [O] product may tighten.
MAX_DIMENSION = {"banners": 2048, "logos": 512}
MIN_DIMENSION = {"banners": (600, 300), "logos": (128, 128)}


def _reencode(data: bytes, purpose: str) -> tuple[str, bytes]:
    """Validate by magic bytes, strip metadata, enforce dimensions.

    Returns (format, cleaned_bytes). The re-save through Pillow drops EXIF
    (incl. GPS), ICC, XMP and any trailing payloads — the stored object is a
    fresh encode of the pixel data, never the original bytes (spec §11).
    Raises ValueError with a user-facing message on policy violation."""
    try:
        image: Image.Image = Image.open(io.BytesIO(data))
    except OSError as exc:  # includes PIL.UnidentifiedImageError
        raise ValueError("Not a recognizable image") from exc
    if image.format not in ALLOWED_FORMATS:
        raise ValueError(f"Unsupported image format {image.format!r}")
    if image.width * image.height > MAX_INPUT_PIXELS:
        raise ValueError("Image dimensions exceed the processing limit")
    fmt = image.format
    image.load()
    # Honor EXIF orientation before the EXIF is discarded.
    image = ImageOps.exif_transpose(image)

    min_w, min_h = MIN_DIMENSION[purpose]
    if image.width < min_w or image.height < min_h:
        raise ValueError(
            f"{purpose[:-1].capitalize()} must be at least {min_w}x{min_h} pixels "
            f"(got {image.width}x{image.height})"
        )
    long_edge = MAX_DIMENSION[purpose]
    if max(image.size) > long_edge:
        image.thumbnail((long_edge, long_edge), Image.Resampling.LANCZOS)

    if fmt == "JPEG" and image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    buf = io.BytesIO()
    save_kwargs: dict[str, bool | int] = {"optimize": True}
    if fmt in ("JPEG", "WEBP"):
        save_kwargs["quality"] = 88
    image.save(buf, format=fmt, **save_kwargs)
    return fmt, buf.getvalue()


class MediaUploadView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser]

    @extend_schema(
        tags=["Media"],
        summary="Upload a banner/logo (validated, re-encoded, metadata stripped)",
        parameters=[OpenApiParameter("purpose", OpenApiTypes.STR, enum=sorted(ALLOWED_PURPOSES),
                                     default="banners")],
        request={"multipart/form-data": {
            "type": "object",
            "properties": {"file": {"type": "string", "format": "binary"}},
            "required": ["file"],
        }},
        responses=inline_serializer("MediaUploadResult", fields={
            "key": serializers.CharField(),
            "url": serializers.CharField(),
        }),
    )
    def post(self, request):
        purpose = request.query_params.get("purpose", "banners")
        if purpose not in ALLOWED_PURPOSES:
            return Response(
                {"error": {"code": "validation_error",
                           "message": "purpose must be one of banners, logos",
                           "fields": {}}},
                status=400,
            )
        upload = request.FILES.get("file")
        if upload is None:
            return Response(
                {"error": {"code": "validation_error", "message": "file is required",
                           "fields": {}}},
                status=400,
            )
        if upload.size > MAX_UPLOAD_BYTES:
            return Response(
                {"error": {"code": "validation_error", "message": "Max size is 5 MB",
                           "fields": {}}},
                status=400,
            )

        # Magic-byte validation + metadata-stripping re-encode (never trust
        # the content type or original filename — spec §11, ADR-0004).
        raw = upload.read()
        try:
            fmt, cleaned = _reencode(raw, purpose)
        except (ValueError, OSError):
            return Response(
                {"error": {"code": "validation_error",
                           "message": "Only valid JPG, PNG or WEBP images are accepted",
                           "fields": {}}},
                status=400,
            )

        ext = ALLOWED_FORMATS[fmt]
        key = f"{purpose}/{uuid.uuid4().hex}.{ext}"
        saved_key = default_storage.save(key, ContentFile(cleaned))
        return Response({"key": saved_key, "url": default_storage.url(saved_key)})


class MediaServeView(APIView):
    """Serve media objects through Django from default_storage (spec §11).

    Production storage is Garage on the internal compose network (never
    publicly exposed); object keys are unguessable UUIDs and are the public
    reference. Dev storage is the local filesystem — same code path. This
    view is what nginx `/media/` proxies to in production."""

    permission_classes = []
    authentication_classes = []

    @extend_schema(exclude=True)
    def get(self, request, path: str):
        if (
            not path.startswith(ALLOWED_SERVE_PREFIXES)
            or Path(path).suffix.lower() not in ALLOWED_SERVE_EXTENSIONS
            or ".." in path.split("/")
        ):
            return Response(
                {"error": {"code": "not_found", "message": "Not found", "fields": {}}},
                status=404,
            )
        if not default_storage.exists(path):
            return Response(
                {"error": {"code": "not_found", "message": "Not found", "fields": {}}},
                status=404,
            )
        file = default_storage.open(path, "rb")
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        response = FileResponse(file, content_type=content_type)
        response["Cache-Control"] = "public, max-age=86400"
        return response
