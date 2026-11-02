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
from datetime import UTC

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

        # Celery queue backlog (spec §15): jobs piling up = worker wedged or
        # down (heartbeat above may still pass on a slow death).
        backlog = self._celery_backlog()
        if backlog is None:
            lines.append("celery queue backlog: unavailable (broker unreachable)")
        else:
            lines.append(f"celery queue backlog: {backlog} jobs")
            critical |= backlog > 100

        # OTP health (spec §15): challenges whose codes were tried and failed
        # vs. ones consumed by a login, last 24h. A high failure count with
        # zero successes smells like an SMS provider outage, not guessing.
        from datetime import timedelta

        from apps.accounts.models import OTPChallenge

        since = now - timedelta(hours=24)
        otp_failed = OTPChallenge.objects.filter(
            created_at__gte=since, consumed_at__isnull=True, attempts__gt=0
        ).count()
        otp_ok = OTPChallenge.objects.filter(consumed_at__gte=since).count()
        lines.append(f"otp last 24h: {otp_ok} logins, {otp_failed} failed challenges")
        critical |= otp_failed >= 20 and otp_ok == 0

        # TLS expiry (spec §15): days left on the public certificate.
        tls_days = self._tls_expiry_days()
        if tls_days is None:
            lines.append("tls expiry: not checkable (no public host configured)")
        else:
            lines.append(f"tls expiry: {tls_days} days")
            critical |= tls_days <= 14

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

    def _celery_backlog(self) -> int | None:
        """Jobs waiting in the (Redis) default queue; None if unreachable."""
        try:
            import redis
            from django.conf import settings

            client = redis.Redis.from_url(settings.CELERY_BROKER_URL, socket_timeout=2)
            return int(client.llen("default"))
        except Exception:
            return None

    def _tls_expiry_days(self) -> int | None:
        """Days left on the public TLS cert; None when no real host is set."""
        try:
            import socket
            import ssl
            from datetime import datetime

            from django.conf import settings

            host = (settings.ALLOWED_HOSTS or [""])[0]
            if not host or host == "*" or host.startswith(("localhost", "127.")):
                return None
            ctx = ssl.create_default_context()
            with socket.create_connection((host, 443), timeout=5) as sock:
                with ctx.wrap_socket(sock, server_hostname=host) as tls:
                    not_after = tls.getpeercert()["notAfter"]  # e.g. "Nov 21 12:34:56 2026 GMT"
            expires = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(
                tzinfo=UTC
            )
            return (expires - datetime.now(UTC)).days
        except (OSError, ssl.SSLError, KeyError, ValueError):
            return None

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
