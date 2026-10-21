"""Daily single-VPS operations report (spec §15 monitoring minimum).

Cron (docs/runbooks/deploy.md):
    docker compose -f infra/docker/docker-compose.prod.yml exec -T web \
        python manage.py ops_report

Prints a plain-text report to stdout (cron mail delivers it) and, when
OPS_TELEGRAM_BOT_TOKEN + OPS_TELEGRAM_CHAT_ID are set, sends the same text to
a Telegram chat. Exits non-zero when something needs human eyes: ambiguous
unsettled succeeded payments, pending attempts on expired orders (the
reconciliation manual queue), blocked placements, or a
stale backup stamp — so a simple `|| alert` wrapper also works.
"""
import os
import shutil
import sys

from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = "Daily ops report: payment health, disk, backup freshness, worker heartbeat."

    def handle(self, *args, **options):
        from apps.billing.models import Order
        from apps.payments.models import PaymentAttempt
        from apps.placements.models import Placement

        now = timezone.now()
        lines = [f"== LocalAds ops report {now:%Y-%m-%d %H:%M} UTC =="]
        critical = False

        # Succeeded provider money that never settled onto its order — the
        # crash window between webhook commit and settlement. The
        # reconcile_payments sweep (5-min beat task) should drive this to zero;
        # a persistent non-zero count still needs a human.
        unsettled = PaymentAttempt.objects.filter(
            status=PaymentAttempt.Status.SUCCEEDED
        ).exclude(order__state=Order.State.PAID).count()
        lines.append(f"succeeded-but-unsettled payment attempts: {unsettled}")
        critical |= unsettled > 0

        # Attempts still PENDING on orders that already expired: the webhook
        # never arrived and the reconciliation sweep could not resolve them
        # (unimplemented gateway, or provider status still unknown). This is
        # the manual queue the runbook's "reconciliation queue depth" means —
        # attempts pending on still-live orders are normal checkout traffic.
        recon_queue = PaymentAttempt.objects.filter(
            status=PaymentAttempt.Status.PENDING,
            order__state=Order.State.EXPIRED,
        ).count()
        lines.append(f"reconciliation queue (pending on expired orders): {recon_queue}")
        critical |= recon_queue > 0

        blocked = Placement.objects.filter(state=Placement.State.BLOCKED).count()
        lines.append(f"blocked placements (admin queue): {blocked}")
        critical |= blocked > 0

        # Failed payment attempts whose order never left awaiting/processing —
        # normally released by the webhook path; count as informational.
        stuck_failed = Order.objects.filter(
            state=Order.State.FAILED,
            attempts__status=PaymentAttempt.Status.FAILED,
        ).distinct().count()
        lines.append(f"failed orders (released reservations): {stuck_failed}")

        usage = shutil.disk_usage("/")
        pct = 100 - usage.free * 100 // usage.total
        lines.append(f"disk usage: {pct}% ({usage.free // (2**30)} GiB free)")
        critical |= pct >= 85

        stamp = os.environ.get("OPS_LAST_BACKUP_FILE", "")
        if stamp:
            try:
                age_h = (now.timestamp() - os.path.getmtime(stamp)) / 3600
                lines.append(f"last backup: {age_h:.1f}h ago ({stamp})")
                critical |= age_h > 26
            except OSError:
                lines.append(f"last backup: STAMP FILE MISSING ({stamp})")
                critical = True
        else:
            lines.append("last backup: OPS_LAST_BACKUP_FILE not configured")

        heartbeat = self._celery_heartbeat()
        lines.append(f"celery worker heartbeat: {heartbeat}")
        critical |= not heartbeat

        report = "\n".join(lines)
        self.stdout.write(report)
        self._notify(report)
        if critical:
            self.stdout.write(self.style.ERROR("\nCRITICAL items present — action required."))
            sys.exit(1)

    def _celery_heartbeat(self) -> bool:
        try:
            from config.celery import app as celery_app

            replies = celery_app.control.ping(timeout=2.0)
            return bool(replies)
        except Exception:
            return False

    def _notify(self, text: str) -> None:
        token = os.environ.get("OPS_TELEGRAM_BOT_TOKEN", "")
        chat = os.environ.get("OPS_TELEGRAM_CHAT_ID", "")
        if not token or not chat:
            return
        import urllib.parse
        import urllib.request

        data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage", data=data
        )
        try:
            urllib.request.urlopen(req, timeout=10)
        except OSError:
            self.stderr.write("ops_report: Telegram notification failed")
