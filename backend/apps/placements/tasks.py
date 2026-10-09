from celery import shared_task


@shared_task(name="apps.placements.tasks.refresh_states_task")
def refresh_states_task() -> dict:
    from .services import refresh_states

    return refresh_states()
