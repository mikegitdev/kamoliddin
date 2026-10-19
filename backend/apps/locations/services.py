"""Owner-side branch writes: action log + duplicate-claim detection (spec §3
[R] collision detection and action logs; §14 duplicate claim -> flag review).

Branches go live immediately ([C] no pre-approval), and that includes edits.
These are staff review signals only: a flag never hides ads by itself — two
shops in one mall legitimately share coordinates — staff disable a branch
whose claim turns out bogus."""
from django.contrib.gis.measure import D

from apps.moderation.models import ActivityEvent
from apps.placements.models import Placement, eligible_now_q

from .models import Location

DUPLICATE_CLAIM_FLAG = "duplicate_claim"
DUPLICATE_CLAIM_RADIUS = D(m=25)

# Fields whose change alters what the public map shows for the branch.
_LOGGED_FIELDS = ("name", "address", "lon", "lat")


def snapshot(location: Location) -> dict:
    return {
        "name": location.name,
        "address": location.address,
        "lon": location.point.x,
        "lat": location.point.y,
    }


def _duplicate_claim_nearby(location: Location) -> bool:
    """Another business's (not disabled) branch within the claim radius."""
    return (
        Location.objects.filter(point__dwithin=(location.point, DUPLICATE_CLAIM_RADIUS))
        .exclude(business_id=location.business_id)
        .exclude(status=Location.Status.DISABLED)
        .exists()
    )


def _sync_duplicate_claim_flag(location: Location) -> bool:
    """Re-evaluate the flag at the branch's current point; True if flagged."""
    flagged = _duplicate_claim_nearby(location)
    flags = [f for f in location.risk_flags if f != DUPLICATE_CLAIM_FLAG]
    if flagged:
        flags.append(DUPLICATE_CLAIM_FLAG)
    if flags != location.risk_flags:
        location.risk_flags = flags
        location.save(update_fields=["risk_flags", "updated_at"])
    return flagged


def after_owner_write(*, user, location: Location, before: dict | None) -> None:
    """Log a branch create/edit for staff and refresh its duplicate-claim flag.

    `before` is the pre-edit snapshot (None on create). Edits that leave name,
    address and point untouched (hours, contacts) are not logged."""
    after = snapshot(location)
    changed = [f for f in _LOGGED_FIELDS if before is None or before[f] != after[f]]
    if not changed:
        return
    moved = before is None or "lon" in changed or "lat" in changed
    flagged = (
        _sync_duplicate_claim_flag(location) if moved
        else DUPLICATE_CLAIM_FLAG in location.risk_flags
    )
    metadata: dict = {"to": after, "duplicate_claim": flagged}
    if before is not None:
        metadata["from"] = {f: before[f] for f in changed}
        metadata["changed"] = changed
        # A live branch edited in place changes what paying ads point at.
        metadata["live_ads"] = Placement.objects.filter(
            eligible_now_q(), location=location
        ).count()
    ActivityEvent.objects.create(
        actor=user,
        action="location.created" if before is None else "location.updated",
        entity="location",
        entity_id=str(location.id),
        metadata=metadata,
    )
