from celery import shared_task


@shared_task(name="apps.renewals.tasks.run_due_renewals_task")
def run_due_renewals_task() -> list:
    from .services import run_due_renewals

    return run_due_renewals()
