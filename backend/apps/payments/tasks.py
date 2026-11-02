from celery import shared_task


@shared_task(
    name="apps.payments.tasks.reconcile_payments_task",
    # Idempotent beat-driven sweep: re-run on worker crash rather than lost
    # (settlement and terminal writes are row-locked and idempotent).
    acks_late=True,
    reject_on_worker_lost=True,
)
def reconcile_payments_task() -> dict:
    from .reconciliation import reconcile_payments

    return reconcile_payments()
