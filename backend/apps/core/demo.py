"""Rich demo dataset (spec acceptance scenarios represented as data).

Everything goes through the real services — no fabricated state transitions.
Banner images are generated with Pillow into MEDIA_ROOT so /media/... URLs work.
"""
import hashlib
import uuid
from datetime import timedelta

from django.contrib.gis.geos import Point
from django.core.files.storage import default_storage
from django.utils import timezone

# (name, slug, category, [(lon, lat), ...], headline)
# Coordinates are spread across Tashkent; two pairs share coordinates to demo
# the coincident-pin selector (spec §14).
DEMO_BUSINESSES = [
    ("Osh Markazi", "osh-markazi", "restaurant", [(69.2610, 41.3111), (69.2410, 41.2950)],
     "Osh Markazi: бизнес-ланч от 25 000 сум"),
    ("Chaykhona N1", "chaykhona-n1", "cafe", [(69.2810, 41.3222)],
     "Chaykhona N1: живая музыка по вечерам"),
    ("Beauty Studio Zamira", "beauty-studio-zamira", "beauty",
     [(69.2401, 41.2995), (69.2401, 41.2995)],
     "Beauty Zamira: -20% на первое посещение"),
    ("FitZone Gym", "fitzone-gym", "fitness", [(69.2105, 41.2908)],
     "FitZone: годовой абонемент со скидкой 30%"),
    ("MedCheck Clinic", "medcheck-clinic", "medicine", [(69.2955, 41.3051)],
     "MedCheck: комплексный чекап за 1 день"),
    ("Kitob Olam", "kitob-olam", "retail", [(69.2290, 41.3160)],
     "Kitob Olam: недели узбекской литературы"),
    ("English House", "english-house", "education", [(69.2701, 41.2899)],
     "English House: бесплатный пробный урок"),
    ("Auto Service 24", "auto-service-24", "services", [(69.1950, 41.3250)],
     "Auto Service 24: диагностика бесплатно"),
    ("Lavash Point", "lavash-point", "restaurant", [(69.2750, 41.3200)],
     "Lavash Point: второй лаваш в подарок"),
    ("Coffeena", "coffeena", "cafe", [(69.2622, 41.3182), (69.2255, 41.2830)],
     "Coffeena: новая сезонная карта напитков"),
    ("Barber Bozor", "barber-bozor", "beauty", [(69.2325, 41.3025)],
     "Barber Bozor: стрижка + укладка = 80 000 сум"),
    ("Yoga Chill", "yoga-chill", "fitness", [(69.2870, 41.2970)],
     "Yoga Chill: 3 занятия для новичков"),
    ("Dent Plus", "dent-plus", "medicine", [(69.2150, 41.3130)],
     "Dent Plus: отбеливание -25% в октябре"),
    ("Techno Bazar", "techno-bazar", "retail", [(69.2480, 41.3260)],
     "Techno Bazar: рассрочка 0% на смартфоны"),
    ("Ilm Zone", "ilm-zone", "education", [(69.2530, 41.2900)],
     "Ilm Zone: курсы программирования, набор в группы"),
    ("Chistxona Express", "chistxona-express", "services", [(69.2680, 41.3300)],
     "Chistxona Express: химчистка двух вещей по цене одной"),
    ("Sushi Wok", "sushi-wok", "restaurant", [(69.2050, 41.2880)],
     "Sushi Wok: доставка 30 минут или ролл бесплатно"),
    ("Pecha Melka", "pecha-melka", "cafe", [(69.2900, 41.3150), (69.2600, 41.3350)],
     "Pecha Melka: завтраки весь день"),
    ("Nail Bar Luna", "nail-bar-luna", "beauty", [(69.2350, 41.3200)],
     "Nail Bar Luna: маникюр + педикюр комплектом"),
    ("Milliy Taomlar Uyi", "milliy-taomlar-uyi", "restaurant", [(69.3000, 41.2900)],
     "Milliy Taomlar: палаты для семейных праздников"),
]

# Campaign scenarios beyond the default approved+active ones.
# (slug, scenario) — scenario in {pending_payment, paid_pending_review, draft,
# submitted, rejected_refunded, auto_renew, grant}
SCENARIOS = {
    "kitob-olam": "draft",
    "english-house": "submitted",
    "auto-service-24": "rejected_refunded",
    "dent-plus": "paid_pending_review",
    "fitzone-gym": "auto_renew",
    "yoga-chill": "grant",
}


def _banner_image(name: str, headline: str) -> str:
    """Generate a gradient banner PNG; return the storage key."""
    import colorsys
    import io

    from django.core.files.base import ContentFile
    from PIL import Image

    width, height = 1200, 400
    digest = hashlib.sha256(name.encode()).digest()
    hue_a = (digest[0] / 255 * 360, 60 + digest[1] % 25, 88)
    hue_b = ((digest[0] + 140) % 360, 55, 62)

    def hsv_rgb(h, s, v):
        r, g, b = colorsys.hsv_to_rgb(h / 360, s / 100, v / 100)
        return int(r * 255), int(g * 255), int(b * 255)

    img = Image.new("RGB", (width, height))
    px = img.load()
    ca, cb = hsv_rgb(*hue_a), hsv_rgb(*hue_b)
    for x in range(width):
        t = x / width
        color = tuple(int(a + (b - a) * t) for a, b in zip(ca, cb))
        for y in range(height):
            px[x, y] = color

    from PIL import ImageDraw, ImageFont

    draw = ImageDraw.Draw(img)
    try:
        font_big = ImageFont.load_default(88)
        font_small = ImageFont.load_default(44)
    except TypeError:  # older Pillow without sized default font
        font_big = font_small = ImageFont.load_default()

    initials = "".join(word[0] for word in name.split()[:2]).upper()
    draw.text((64, 120), initials, fill=(255, 255, 255), font=font_big)
    draw.text((64, 250), name[:32], fill=(245, 245, 245), font=font_small)
    draw.text((64, 40), "AD", fill=(255, 255, 255, 160), font=font_small)

    key = f"banners/demo-{uuid.uuid4().hex[:10]}.png"
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    default_storage.save(key, ContentFile(buffer.getvalue()))
    return key


def seed_demo(*, reset: bool = False, log=print) -> None:
    from apps.accounts.models import User
    from apps.billing.models import Order, OrderItem, Refund, Tariff
    from apps.billing.services import create_checkout, create_quote, process_refund, request_refund
    from apps.businesses.models import Business, BusinessCategory
    from apps.campaigns.models import Campaign
    from apps.locations.models import Location
    from apps.moderation.services import approve_campaign, reject_campaign, submit_for_review
    from apps.payments.models import PaymentAttempt
    from apps.payments.settlement import settle_payment_attempt
    from apps.placements.models import Placement
    from apps.placements.services import issue_free_grant
    from apps.renewals.models import RenewalAgreement

    owner, _ = User.objects.get_or_create(phone_e164="+998901234567")
    staff, _ = User.objects.get_or_create(
        phone_e164="+998901110000", defaults={"is_staff": True, "is_superuser": True}
    )
    if staff.has_usable_password() is False or not staff.password:
        staff.set_password("admin12345")
        staff.save(update_fields=["password"])

    if reset:
        # PROTECT FKs everywhere — delete in dependency order, children first.
        from apps.billing.models import OrderItem, Refund
        from apps.campaigns.models import CampaignReview
        from apps.payments.models import PaymentAttempt, PaymentEvent
        from apps.placements.models import FreeGrant
        from apps.renewals.models import RenewalAgreement, RenewalAttempt

        RenewalAttempt.objects.all().delete()
        RenewalAgreement.objects.filter(business__owner=owner).delete()
        Placement.objects.filter(campaign__business__owner=owner).delete()
        FreeGrant.objects.filter(business__owner=owner).delete()
        CampaignReview.objects.filter(
            campaign__business__owner=owner
        ).delete()  # demo reset only; real reviews are append-only
        PaymentEvent.objects.all().delete()
        PaymentAttempt.objects.filter(order__business__owner=owner).delete()
        Refund.objects.filter(order__business__owner=owner).delete()
        OrderItem.objects.filter(order__business__owner=owner).delete()
        Order.objects.filter(business__owner=owner).delete()
        Campaign.objects.filter(business__owner=owner).delete()
        Location.objects.filter(business__owner=owner).delete()
        Business.objects.filter(owner=owner).delete()
        log("reset: demo data cleared")

    Tariff.objects.get_or_create(amount_per_24h=30_000_00)

    categories = {}
    for slug, ru, uz in [
        ("restaurant", "Рестораны", "Restoranlar"),
        ("cafe", "Кафе", "Kafelar"),
        ("beauty", "Красота и салон", "Go'zallik saloni"),
        ("fitness", "Фитнес", "Fitnes"),
        ("retail", "Магазины", "Do'konlar"),
        ("services", "Услуги", "Xizmatlar"),
        ("medicine", "Медицина", "Tibbiyot"),
        ("education", "Образование", "Ta'lim"),
    ]:
        categories[slug] = BusinessCategory.objects.get_or_create(
            slug=slug, defaults={"name_ru": ru, "name_uz": uz}
        )[0]

    now = timezone.now()

    def purchase(campaign, locations, days, *, auto_renew=False):
        submit_for_review(campaign=campaign)
        order = create_quote(
            user=owner,
            business_id=campaign.business_id,
            campaign_id=campaign.id,
            location_ids=[loc.id for loc in locations],
            requested_start_at=now - timedelta(minutes=30),
            requested_end_at=now + timedelta(days=days),
            auto_renew=auto_renew,
        )
        attempt, _ = create_checkout(user=owner, order_id=order.id)
        attempt.status = PaymentAttempt.Status.SUCCEEDED
        attempt.save(update_fields=["status", "updated_at"])
        settle_payment_attempt(attempt.id)
        return order

    stats = {"businesses": 0, "locations": 0, "campaigns": 0, "active_placements": 0}

    for name, slug, cat, coords, headline in DEMO_BUSINESSES:
        business, created = Business.objects.get_or_create(
            slug=slug,
            defaults={
                "owner": owner,
                "name": name,
                "category": categories[cat],
                "phone": "+998901234567",
                "description": f"{name} — демо-бизнес на карте Ташкента.",
            },
        )
        if created:
            stats["businesses"] += 1
        locations = []
        for i, (lon, lat) in enumerate(coords, start=1):
            location, loc_created = Location.objects.get_or_create(
                business=business,
                name=f"{name} — filial {i}",
                defaults={
                    "address": f"Ташкент, демо-улица {uuid.uuid4().hex[:4].upper()}",
                    "point": Point(lon, lat, srid=4326),
                    "phone": "+998901234567",
                },
            )
            if loc_created:
                stats["locations"] += 1
            locations.append(location)

        campaign, camp_created = Campaign.objects.get_or_create(
            business=business,
            headline=headline,
            defaults={
                "body": f"{name}: специальное предложение для гостей. Ждём вас каждый день!",
                "banner_key": _banner_image(name, headline),
            },
        )
        if camp_created:
            stats["campaigns"] += 1

        if not campaign.orders.exists():
            scenario = SCENARIOS.get(slug, "active")
            if scenario == "draft":
                campaign.review_status = Campaign.ReviewStatus.DRAFT
                campaign.save(update_fields=["review_status", "updated_at"])
            elif scenario == "submitted":
                submit_for_review(campaign=campaign)
            elif scenario == "paid_pending_review":
                purchase(campaign, locations[:1], days=5)  # paid, awaiting moderation
            elif scenario == "rejected_refunded":
                order = purchase(campaign, locations[:1], days=5)
                reject_campaign(campaign=campaign, reviewer=staff, reason="Некорректные контакты")
                refund = request_refund(user=owner, order_id=order.id, reason="Кампания отклонена")
                process_refund(staff=staff, refund_id=refund.id, decision="approve")
            elif scenario == "auto_renew":
                purchase(campaign, locations[:1], days=1, auto_renew=True)
                approve_campaign(campaign=campaign, reviewer=staff)
            elif scenario == "grant":
                submit_for_review(campaign=campaign)
                approve_campaign(campaign=campaign, reviewer=staff)
                issue_free_grant(
                    staff=staff, campaign=campaign, location=locations[0],
                    start_at=now - timedelta(hours=1),
                    end_at=now + timedelta(days=4),
                    reason="Пилотный партнёрский грант",
                )
            else:  # active
                purchase(campaign, locations, days=7)
                approve_campaign(campaign=campaign, reviewer=staff)

    stats["active_placements"] = Placement.objects.filter(
        state=Placement.State.ACTIVE, campaign__business__owner=owner
    ).count()
    stats["renewal_agreements"] = RenewalAgreement.objects.filter(business__owner=owner).count()
    log(
        f"demo ready: +{stats['businesses']} businesses, +{stats['locations']} locations, "
        f"+{stats['campaigns']} campaigns, {stats['active_placements']} active placements, "
        f"{stats['renewal_agreements']} renewal agreement(s)"
    )
