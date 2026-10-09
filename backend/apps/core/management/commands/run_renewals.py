from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Run one renewal-worker pass (same logic as the Celery beat task)."

    def handle(self, *args, **options):
        from apps.renewals.services import run_due_renewals

        results = run_due_renewals()
        for r in results:
            self.stdout.write(self.style.SUCCESS(str(r)))
        if not results:
            self.stdout.write("no due agreements")
