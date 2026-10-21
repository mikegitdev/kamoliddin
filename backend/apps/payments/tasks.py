from celery import shared_task


@shared_task(name="apps.payments.tasks.reconcile_payments_task")
def reconcile_payments_task() -> dict:
    from .reconciliation import reconcile_payments

    return reconcile_payments()
