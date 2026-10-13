"""Media pipeline (spec §11, ADR-0004): magic-byte validation, metadata
stripping (GPS/EXIF never reaches storage), dimension policy, serve guards.
"""
import io

import pytest
from PIL import Image
from rest_framework.test import APIClient

from apps.core.media import _reencode

pytestmark = pytest.mark.django_db


def _jpeg_bytes(size=(800, 400), with_marker=False) -> bytes:
    """JPEG bytes; with_marker=True embeds an EXIF payload (Software tag) to
    prove the re-encode strips ALL metadata incl. any GPS that would ride
    along in a real phone photo's EXIF."""
    img = Image.new("RGB", size, color=(120, 30, 30))
    buf = io.BytesIO()
    if with_marker:
        exif = Image.Exif()
        exif[0x0131] = "secret-upload-marker"  # Software
        img.save(buf, format="JPEG", exif=exif)
    else:
        img.save(buf, format="JPEG")
    return buf.getvalue()


def test_reencode_strips_gps_exif():
    raw = _jpeg_bytes(with_marker=True)
    assert b"secret-upload-marker" in raw  # sanity: EXIF really was embedded
    fmt, cleaned = _reencode(raw, purpose="banners")
    assert fmt == "JPEG"
    assert b"secret-upload-marker" not in cleaned
    img = Image.open(io.BytesIO(cleaned))
    assert not img.getexif()  # no EXIF payload survives the re-encode


def test_reencode_enforces_minimum_dimensions():
    with pytest.raises(ValueError):
        _reencode(_jpeg_bytes(size=(500, 200)), purpose="banners")


def test_reencode_caps_long_edge():
    fmt, cleaned = _reencode(_jpeg_bytes(size=(3000, 1500)), purpose="banners")
    img = Image.open(io.BytesIO(cleaned))
    assert max(img.size) <= 2048
    assert img.width >= 600  # aspect preserved, still above the minimum


def test_reencode_rejects_non_image():
    with pytest.raises(ValueError):
        _reencode(b"definitely not an image", purpose="banners")


def test_upload_api_strips_metadata_and_returns_key(owner):
    client = APIClient()
    client.force_authenticate(user=owner)
    upload = io.BytesIO(_jpeg_bytes(with_marker=True))
    upload.name = "banner.jpg"
    response = client.post(
        "/api/v1/media/upload?purpose=banners", {"file": upload}, format="multipart"
    )
    assert response.status_code == 200
    key = response.json()["key"]
    assert key.startswith("banners/") and key.endswith(".jpg")

    served = client.get(f"/media/{key}")
    assert served.status_code == 200
    assert b"secret-upload-marker" not in bytes(served.getvalue())


def test_upload_rejects_svg(owner):
    client = APIClient()
    client.force_authenticate(user=owner)
    upload = io.BytesIO(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>")
    upload.name = "evil.svg"
    response = client.post(
        "/api/v1/media/upload?purpose=banners", {"file": upload}, format="multipart"
    )
    assert response.status_code == 400


def test_serve_blocks_traversal():
    client = APIClient()
    response = client.get("/media/banners/../../etc/passwd")
    assert response.status_code == 404
