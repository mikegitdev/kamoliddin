"""Delete orphaned media objects (ADR-0004): storage keys under banners/ and
logos/ no longer referenced by any campaign banner or business logo, older
than the grace period (default 7 days — a draft campaign may still swap its
banner before submission).

Run weekly via cron (docs/runbooks/deploy.md):
    docker compose -f infra/docker/docker-compose.prod.yml exec -T web \
        python manage.py prune_orphan_media
"""
from datetime import timedelta

from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = "Delete unreferenced media objects older than the grace period."

    def add_arguments(self, parser):
        parser.add_argument("--older-than-days", type=int, default=7)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        from apps.businesses.models import Business
        from apps.campaigns.models import Campaign

        cutoff = timezone.now() - timedelta(days=options["older_than_days"])
        referenced = set(
            Campaign.objects.exclude(banner_key="").values_list("banner_key", flat=True)
        )
        referenced |= set(
            Business.objects.exclude(logo_key="").values_list("logo_key", flat=True)
        )

        deleted = skipped = 0
        for prefix in ("banners/", "logos/"):
            try:
                _dirs, files = default_storage.listdir(prefix)
            except NotImplementedError:
                self.stderr.write(
                    f"prune_orphan_media: storage backend cannot list {prefix!r}; skipping"
                )
                continue
            except OSError:
                continue  # prefix does not exist yet
            for name in files:
                key = f"{prefix}{name}"
                if key in referenced:
                    continue
                try:
                    modified = default_storage.get_modified_time(key)
                except (NotImplementedError, OSError):
                    modified = None  # backend without mtime: rely on grace only
                if modified is not None and modified > cutoff:
                    skipped += 1
                    continue
                if options["dry_run"]:
                    self.stdout.write(f"[dry-run] would delete {key}")
                else:
                    default_storage.delete(key)
                deleted += 1

        verb = "would delete" if options["dry_run"] else "deleted"
        self.stdout.write(
            f"prune_orphan_media: {verb} {deleted} object(s); "
            f"{skipped} unreferenced-but-recent kept"
        )
