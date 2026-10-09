from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Run one placement/order state-transition pass (same logic as the Celery beat task)."

    def handle(self, *args, **options):
        from apps.placements.services import refresh_states

        result = refresh_states()
        self.stdout.write(self.style.SUCCESS(f"refresh: {result}"))
