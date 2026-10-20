"""Seed PlatformSetting defaults and a rich demo dataset (`--demo`).

The demo dataset is idempotent (keyed on business slug + campaign headline) and
`--reset` wipes previously-seeded demo data first. It exercises the REAL
pipeline: submit -> quote -> checkout -> fake payment -> settle -> approve,
plus a rejected+refunded campaign, a paid-but-pending one, a one-day
purchase and a free grant, so the cabinet and map have meaningful content.

Demo accounts (fake SMS prints codes to the server log):
  owner: +998901234567   staff: +998901110000 (password: admin12345)
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Seed PlatformSetting defaults and, with --demo, a rich demo dataset."

    def add_arguments(self, parser):
        parser.add_argument("--demo", action="store_true")
        parser.add_argument(
            "--reset", action="store_true",
            help="With --demo: delete previously seeded demo data first.",
        )

    def handle(self, *args, **options):
        from apps.moderation.models import DEFAULT_SETTINGS, PlatformSetting

        for key, value in DEFAULT_SETTINGS.items():
            _, created = PlatformSetting.objects.get_or_create(
                key=key, defaults={"value_json": value}
            )
            if created:
                self.stdout.write(self.style.SUCCESS(f"setting created: {key}={value}"))

        if options.get("demo"):
            from apps.core.demo import seed_demo

            seed_demo(reset=bool(options.get("reset")), log=self.stdout.write)
