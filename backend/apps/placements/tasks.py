from celery import shared_task


@shared_task(
    name="apps.placements.tasks.refresh_states_task",
    # Idempotent beat-driven sweep: a worker crash mid-run must re-queue it
    # (reservations/orders re-checked under row locks, so a rerun is safe).
    acks_late=True,
    reject_on_worker_lost=True,
)
def refresh_states_task() -> dict:
    from .services import refresh_states

    return refresh_states()
