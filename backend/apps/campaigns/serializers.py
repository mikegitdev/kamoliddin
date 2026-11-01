from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.businesses.models import Business

from .models import Campaign, CampaignOutcome, CampaignReview


class CampaignReviewSerializer(serializers.ModelSerializer):
    """Read-only moderation decisions shown to the advertiser (spec §5):
    immutable rows, no reviewer identity exposed."""

    class Meta:
        model = CampaignReview
        fields = ("id", "decision", "reason", "content_version", "created_at")
        read_only_fields = fields

class CampaignSerializer(serializers.ModelSerializer):
    business = serializers.SlugRelatedField(
        slug_field="id",
        queryset=Business.objects.none(),
    )
    business_name = serializers.CharField(source="business.name", read_only=True)
    banner_url = serializers.SerializerMethodField()
    # Publication status must stay separate from review_status (spec §7):
    # an approved campaign is NOT necessarily live. Populated by a queryset
    # annotation; unannotated instances (create/submit responses) report 0.
    active_placements_count = serializers.SerializerMethodField()
    # Nearest upcoming/ongoing show window (annotation), for list cards.
    next_interval = serializers.SerializerMethodField()
    # Public engagement counters (annotation): ad opens and contact/directions
    # clicks. Counts only — no visitor data is stored (Joymee borrow #2).
    views_count = serializers.SerializerMethodField()
    contact_clicks_count = serializers.SerializerMethodField()
    # Outcome survey (Joymee borrow #8): the recorded answer (null until
    # answered) and whether the cabinet should ASK (campaign ran, fully
    # ended, not yet answered). Annotations keep lists N+1-free.
    outcome = serializers.SerializerMethodField()
    outcome_eligible = serializers.SerializerMethodField()

    class Meta:
        model = Campaign
        fields = (
            "id", "business", "business_name", "headline", "body", "banner_key",
            "banner_url", "review_status", "review_version", "active_placements_count",
            "next_interval", "views_count", "contact_clicks_count",
            "outcome", "outcome_eligible",
            "created_at", "updated_at",
        )
        read_only_fields = ("id", "review_status", "review_version",
                            "active_placements_count", "views_count", "contact_clicks_count",
                            "outcome", "outcome_eligible",
                            "created_at", "updated_at", "business_name")

    def __init__(self, *args: object, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated:
            business_field = self.fields["business"]
            assert isinstance(business_field, serializers.SlugRelatedField)
            business_field.queryset = Business.objects.filter(owner=request.user)

    def get_banner_url(self, obj) -> str:
        return f"/media/{obj.banner_key}" if obj.banner_key else ""

    def get_active_placements_count(self, obj) -> int:
        return getattr(obj, "active_placements_count", 0) or 0

    def get_views_count(self, obj) -> int:
        return getattr(obj, "views_count", 0) or 0

    def get_contact_clicks_count(self, obj) -> int:
        return getattr(obj, "contact_clicks_count", 0) or 0

    def get_outcome(self, obj):
        """{answer, comment, created_at} once recorded; null before that."""
        outcome = None
        if getattr(obj, "outcome_answer", None):
            outcome = obj.outcome          # annotation guarantees the row
        elif not hasattr(obj, "outcome_ever_ran"):
            outcome = getattr(obj, "outcome", None)  # unannotated: one query
        if outcome is None:
            return None
        return {
            "answer": outcome.answer,
            "comment": outcome.comment,
            "created_at": outcome.created_at,
        }

    def get_outcome_eligible(self, obj) -> bool:
        """Ask exactly once: the campaign ran, every placement has ended, and
        no answer is recorded yet (Joymee's post-sale survey trigger)."""
        if hasattr(obj, "outcome_ever_ran"):  # annotated list/detail path
            if getattr(obj, "outcome_answer", None):
                return False
            return bool(obj.outcome_ever_ran) and not bool(obj.outcome_still_running)
        # Unannotated instance (create/submit response): compute directly.
        from apps.placements.models import Placement

        if CampaignOutcome.objects.filter(campaign=obj).exists():
            return False
        return (
            Placement.objects.filter(campaign=obj).exists()
            and not Placement.objects.filter(
                campaign=obj,
                state__in=(Placement.State.PENDING, Placement.State.SCHEDULED,
                           Placement.State.ACTIVE),
            ).exists()
        )

    @extend_schema_field(
        {
            "type": "object",
            "properties": {
                "start_at": {"type": "string", "format": "date-time"},
                "end_at": {"type": "string", "format": "date-time"},
            },
            "nullable": True,
        }
    )
    def get_next_interval(self, obj):
        start = getattr(obj, "next_interval_start", None)
        end = getattr(obj, "next_interval_end", None)
        if start is None or end is None:
            return None
        return {"start_at": start, "end_at": end}

    def validate_headline(self, value: str) -> str:
        headline = value.strip()
        if len(headline) < 3:
            # Mirror the editor's rule (>2 trimmed chars) so API drafts cannot
            # be thinner than UI drafts (open-questions.md #11).
            raise serializers.ValidationError("Headline must be at least 3 characters")
        return headline

    def validate(self, attrs):
        # Business reassignment is blocked (spec §14): placements are keyed to
        # the original business's locations, and a moved campaign would keep its
        # approval without re-review. Create a new campaign instead.
        if self.instance is not None:
            new_business = attrs.get("business")
            if new_business is not None and new_business != self.instance.business:
                raise serializers.ValidationError(
                    {"business": "Campaign cannot move to another business after creation; "
                                 "create a new campaign instead."}
                )
            attrs.pop("business", None)  # same value — drop, never rewritten
        return attrs

    # Content edits after approval force a re-review (spec §7.1 [R]):
    # approved + meaningful change -> submitted with a bumped review_version.
    CONTENT_FIELDS = ("headline", "body", "banner_key")

    def update(self, instance, validated_data):
        locked = instance.review_status in (
            Campaign.ReviewStatus.SUBMITTED,
            Campaign.ReviewStatus.UNDER_REVIEW,
            Campaign.ReviewStatus.SUSPENDED,
        )
        if locked:
            raise serializers.ValidationError(
                {"review_status": "Campaign is locked while under review"}
            )
        content_changed = any(field in validated_data for field in self.CONTENT_FIELDS)
        if instance.review_status == Campaign.ReviewStatus.APPROVED and content_changed:
            validated_data["review_version"] = instance.review_version + 1
            validated_data["review_status"] = Campaign.ReviewStatus.SUBMITTED
        return super().update(instance, validated_data)
