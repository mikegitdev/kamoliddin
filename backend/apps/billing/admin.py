from django.contrib import admin

from .models import Order, OrderItem, Refund, Tariff


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = [f.name for f in OrderItem._meta.fields]


@admin.register(Tariff)
class TariffAdmin(admin.ModelAdmin):
    list_display = ("amount_per_24h", "currency", "valid_from", "valid_until")
    readonly_fields = ("created_at", "updated_at")


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("id", "business", "campaign", "amount_total", "currency", "state",
                    "created_at")
    list_filter = ("state",)
    search_fields = ("id", "business__name")
    inlines = [OrderItemInline]
    readonly_fields = ("amount_total", "currency", "created_at", "updated_at")


@admin.register(Refund)
class RefundAdmin(admin.ModelAdmin):
    list_display = ("order", "amount", "state", "operator", "completed_at", "created_at")
    list_filter = ("state",)
    readonly_fields = ("created_at",)
