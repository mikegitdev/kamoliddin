"""Server-mediated media upload (spec §11): UUID object keys, type/size/magic
validation via Pillow, stored through the default storage (MinIO when USE_S3).
Public references remain keyed; discovery only exposes URLs for eligible ads.
"""
import io
import uuid

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from PIL import Image
from rest_framework import permissions
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
ALLOWED_PURPOSES = {"banners", "logos"}


class MediaUploadView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser]

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

        # Magic-byte validation: Pillow must recognize the real format
        # (never trust the content type or original filename — spec §11).
        try:
            header = upload.read()
            image = Image.open(io.BytesIO(header))
            image_format = image.format
            if image_format not in ALLOWED_FORMATS:
                raise ValueError(image_format)
            image.verify()
        except Exception:
            return Response(
                {"error": {"code": "validation_error",
                           "message": "Only JPG, PNG or WEBP images are accepted",
                           "fields": {}}},
                status=400,
            )

        ext = ALLOWED_FORMATS[image_format]
        key = f"{purpose}/{uuid.uuid4().hex}.{ext}"
        saved_key = default_storage.save(key, ContentFile(header))
        return Response({"key": saved_key, "url": default_storage.url(saved_key)})
