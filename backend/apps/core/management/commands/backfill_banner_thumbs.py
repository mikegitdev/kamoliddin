"""Backfill card-thumbnail variants for banners uploaded before the
thumbnail pipeline existed (spec §11 [R] "image variants").

Idempotent and resumable: banners whose derived ``<stem>_sm.jpg`` already
exists in storage are skipped. Run once after deploying the pipeline:

    python manage.py backfill_banner_thumbs [--dry-run]
"""
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand
from PIL import Image

from apps.core.media import THUMB_LONG_EDGE, THUMB_QUALITY, banner_thumb_key


class Command(BaseCommand):
    help = "Generate missing card-thumbnail variants for existing banners."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        from apps.campaigns.models import Campaign

        keys = sorted(
            set(
                Campaign.objects.exclude(banner_key="").values_list(
                    "banner_key", flat=True
                )
            )
        )
        made = skipped = failed = 0
        for key in keys:
            thumb_key = banner_thumb_key(key)
            if thumb_key is None:
                continue
            if default_storage.exists(thumb_key):
                skipped += 1
                continue
            try:
                with default_storage.open(key, "rb") as f:
                    image = Image.open(f)
                    image.load()
                card = image.copy()
                card.thumbnail((THUMB_LONG_EDGE, THUMB_LONG_EDGE), Image.Resampling.LANCZOS)
                if card.mode not in ("RGB", "L"):
                    card = card.convert("RGB")
                import io

                buf = io.BytesIO()
                card.save(buf, format="JPEG", quality=THUMB_QUALITY, optimize=True)
            except (OSError, ValueError):
                self.stderr.write(f"backfill_banner_thumbs: cannot process {key}")
                failed += 1
                continue
            if options["dry_run"]:
                self.stdout.write(f"[dry-run] would create {thumb_key}")
            else:
                default_storage.save(thumb_key, ContentFile(buf.getvalue()))
            made += 1
        self.stdout.write(
            f"backfill_banner_thumbs: {made} created, {skipped} already present, "
            f"{failed} failed of {len(keys)} banners"
        )
