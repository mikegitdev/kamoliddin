from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve as serve_static
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.response import Response

from apps.core.health import health_view
from apps.core.media import MediaUploadView


def api_root_view(request):
    return Response({"name": "Local Advertising API", "version": "v1"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", health_view, name="health"),
    # Strict probes (k8s, uptime checkers) often don't follow the APPEND_SLASH 301.
    path("health", health_view),
    path("api/v1/", include([
        path("", api_root_view, name="api-root"),
        path("auth/", include("apps.accounts.urls")),
        path("public/", include("apps.discovery.urls")),
        path("payments/", include("apps.payments.urls")),
        path("", include("apps.businesses.urls")),
        path("", include("apps.locations.urls")),
        path("", include("apps.campaigns.urls")),
        path("", include("apps.billing.urls")),
        path("", include("apps.renewals.urls")),
        path("", include("apps.moderation.api_urls")),
    ])),
    path("api/v1/media/upload", MediaUploadView.as_view(), name="media-upload"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]

if settings.DEBUG:
    # Dev-only media serving (generated demo banners); prod goes through nginx.
    urlpatterns += [
        re_path(r"^media/(?P<path>.*)$", serve_static, {"document_root": settings.MEDIA_ROOT}),
    ]
