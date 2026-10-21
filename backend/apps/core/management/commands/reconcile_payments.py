import sys

from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = (
        "Payment reconciliation sweep (ADR-0005 note 8): settle "
        "succeeded-but-unsettled attempts; resolve stale PENDING attempts via "
        "one authoritative provider status query (never a blind retry). "
        "Exits non-zero when items need manual resolution."
    )

    def handle(self, *args, **options):
        from apps.payments.reconciliation import reconcile_payments

        result = reconcile_payments()
        lines = [
            f"== payment reconciliation {timezone.now():%Y-%m-%d %H:%M} UTC ==",
            f"settled orders: {result['settled']}",
            f"failed attempts (webhook lost): {result['failed_attempts']} "
            f"({result['orders_failed']} orders failed, reservations released)",
            f"still pending at provider: {result['still_pending']}",
            f"unresolved (manual queue): {result['unresolved']}",
        ]
        lines.extend(f"  - {detail}" for detail in result["unresolved_detail"])
        self.stdout.write("\n".join(lines))
        if result["unresolved"]:
            self.stdout.write(
                self.style.ERROR("\nUNRESOLVED items present — action required.")
            )
            sys.exit(1)
