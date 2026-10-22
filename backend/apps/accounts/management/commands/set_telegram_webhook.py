"""Register the Telegram bot webhook (Bot API setWebhook).

Usage (against prod settings, with TELEGRAM_BOT_TOKEN and
TELEGRAM_WEBHOOK_SECRET in the environment):

    python manage.py set_telegram_webhook https://ads.example.com

The webhook URL is always ``<base>/api/v1/auth/telegram/webhook`` and the
secret token is sent with the registration so Telegram echoes it in the
``X-Telegram-Bot-Api-Secret-Token`` header on every update (ADR-0006).
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.telegram import TelegramBotAdapter

WEBHOOK_PATH = "/api/v1/auth/telegram/webhook"


class Command(BaseCommand):
    help = "Register the Telegram bot webhook (setWebhook with secret_token)."

    def add_arguments(self, parser):
        parser.add_argument("public_base_url", help="Public https base URL of the deployment")

    def handle(self, *args, **options):
        if not settings.TELEGRAM_BOT_TOKEN:
            raise CommandError("TELEGRAM_BOT_TOKEN is not set")
        if not settings.TELEGRAM_WEBHOOK_SECRET:
            raise CommandError("TELEGRAM_WEBHOOK_SECRET is not set")
        url = options["public_base_url"].rstrip("/") + WEBHOOK_PATH
        adapter = TelegramBotAdapter()
        adapter.set_webhook(url=url, secret_token=settings.TELEGRAM_WEBHOOK_SECRET)
        self.stdout.write(self.style.SUCCESS(f"Webhook registered: {url}"))
