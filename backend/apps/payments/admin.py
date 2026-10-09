from django.contrib import admin

from .models import PaymentAttempt, PaymentEvent


@admin.register(PaymentAttempt)
class PaymentAttemptAdmin(admin.ModelAdmin):
    list_display = ("provider", "provider_payment_id", "order", "amount", "status",
                    "created_at")
    list_filter = ("provider", "status")
    search_fields = ("provider_payment_id", "order__id")
    readonly_fields = [f.name for f in PaymentAttempt._meta.fields]  # append-only


@admin.register(PaymentEvent)
class PaymentEventAdmin(admin.ModelAdmin):
    list_display = ("provider", "event_id", "payment_attempt", "received_at")
    list_filter = ("provider",)
    search_fields = ("event_id",)
    readonly_fields = [f.name for f in PaymentEvent._meta.fields]
    actions = None
