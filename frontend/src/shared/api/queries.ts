import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type {
  ApiBusiness,
  ApiCampaign,
  ApiCampaignReview,
  ApiCategory,
  ApiLocationDetail,
  ApiLocationPin,
  ApiOrder,
  ApiOwnerLocation,
  ApiSessionUser,
} from "@/entities/types";

export interface LocationFilters {
  bbox: string;
  category?: string;
  q?: string;
}

/** Cap for the viewport pins request. The UI shows a truncation hint when
 *  the API returns exactly this many — the visitor must know the map shows
 *  a subset, not everything. */
export const PINS_LIMIT = 200;

export interface ApiSearchAd {
  id: string;
  headline: string;
  business_name: string;
  banner_url: string;
}

export interface ApiSearchResult {
  locations: ApiLocationPin[];
  campaigns: ApiSearchAd[];
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api<ApiCategory[]>("/api/v1/public/categories"),
    staleTime: 5 * 60_000,
  });
}

export function useLocationPins(filters: LocationFilters | null) {
  return useQuery({
    queryKey: ["location-pins", filters],
    queryFn: () => {
      const params = new URLSearchParams({ bbox: filters!.bbox, limit: String(PINS_LIMIT) });
      if (filters!.category) params.set("category", filters!.category);
      if (filters!.q) params.set("q", filters!.q);
      return api<ApiLocationPin[]>(`/api/v1/public/locations?${params.toString()}`);
    },
    // Every pan is a new key: keep the current pins/list on screen until the
    // new viewport arrives instead of flashing skeletons and "0 locations".
    placeholderData: keepPreviousData,
    enabled: filters !== null && filters.bbox.split(",").length === 4,
  });
}

export function useLocationDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["location-detail", id],
    queryFn: () => api<ApiLocationDetail>(`/api/v1/public/locations/${id}`),
    enabled: !!id,
  });
}

export interface SearchFilters {
  q: string;
  category?: string;
  /** Optional origin for distance ordering (map center or user location). */
  lat?: number;
  lon?: number;
}

/** Global relevance search (not bbox-bound): lets visitors find a business
 *  anywhere in the city without navigating the map manually. */
export function usePublicSearch(filters: SearchFilters | null) {
  return useQuery({
    queryKey: ["public-search", filters],
    queryFn: () => {
      const params = new URLSearchParams({ q: filters!.q.trim() });
      if (filters!.category) params.set("category", filters!.category);
      if (filters!.lat !== undefined && filters!.lon !== undefined) {
        params.set("lat", String(filters!.lat));
        params.set("lon", String(filters!.lon));
      }
      return api<ApiSearchResult>(`/api/v1/public/search?${params.toString()}`);
    },
    enabled: !!filters && filters.q.trim().length >= 2,
    // Typing refines the query per keystroke: keep results instead of blanking.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/* ---------- Nearby ads feed (public list view, spec §10) ---------- */

export interface ApiNearbyAdBranch {
  id: string;
  name: string;
  address: string;
  lon: number;
  lat: number;
}

/** One card of the list: a CAMPAIGN pinned to its nearest currently eligible
 *  branch. `branches_count` = eligible branches city-wide. `promotion` is the
 *  paid visibility tier ("top" pins the card above organic, "raised" fills
 *  the second block, null = organic) — drives the badge. */
export interface ApiNearbyAd {
  id: string;
  headline: string;
  body: string;
  banner_url: string;
  business_name: string;
  /** Staff-awarded trust badge on the business (blue check). */
  business_verified: boolean;
  category: string;
  location: ApiNearbyAdBranch;
  distance_m: number | null;
  branches_count: number;
  promotion: "top" | "raised" | null;
}

export interface ApiNearbyAdsPage {
  results: ApiNearbyAd[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface NearbyAdsFilters {
  lat: number;
  lon: number;
  radius_m: number;
  category?: string;
  /** Free-text match; below 2 chars the feed returns nothing (mirrors search). */
  q?: string;
  /** "relevance" only has an effect together with q. */
  sort: "distance" | "relevance";
}

/** Featured strip (Joymee VIP-pool equivalent): campaigns whose TOP window
 *  is live right now. distance_m is null when no origin was given. */
export function useFeaturedAds(lat: number | undefined, lon: number | undefined) {
  const enabled = typeof lat === "number" && typeof lon === "number";
  return useQuery({
    queryKey: ["featured-ads", lat, lon],
    queryFn: () =>
      api<ApiNearbyAdsPage>(
        `/api/v1/public/featured?lat=${lat}&lon=${lon}`,
      ),
    enabled,
    staleTime: 60_000,
  });
}

export const NEARBY_ADS_PAGE = 20;

export const NEARBY_RADIUS_OPTIONS = [1000, 3000, 5000, 10000] as const;

/** Distance-ordered, cursor-paginated ad feed. Unlike the search hook, the
 *  origin is NOT rounded to ~1 km: a few hundred meters decide card order. */
export function useNearbyAds(filters: NearbyAdsFilters | null) {
  return useInfiniteQuery({
    queryKey: ["nearby-ads", filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        lat: String(filters!.lat),
        lon: String(filters!.lon),
        radius_m: String(filters!.radius_m),
        sort: filters!.sort,
        limit: String(NEARBY_ADS_PAGE),
      });
      if (filters!.category) params.set("category", filters!.category);
      const q = filters!.q?.trim();
      if (q) params.set("q", q);
      if (pageParam) params.set("cursor", pageParam);
      return api<ApiNearbyAdsPage>(`/api/v1/public/ads?${params.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: filters !== null,
    staleTime: 30_000,
  });
}

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => api<ApiSessionUser>("/api/v1/auth/me"),
    retry: false,
  });
}

// ---------- Staff moderation (spec §12 admin block) ----------

export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ["campaign", id],
    queryFn: () => api<ApiCampaign>(`/api/v1/campaigns/${id}`),
    enabled: !!id,
  });
}

export function useCampaignReviews(id: string | undefined) {
  return useQuery({
    queryKey: ["campaign-reviews", id],
    queryFn: () => api<ApiCampaignReview[]>(`/api/v1/campaigns/${id}/reviews`),
    enabled: !!id,
  });
}

export interface ApiPlacement {
  id: string;
  location: string;
  location_name: string;
  location_business: string;
  start_at: string;
  end_at: string;
  actual_start_at: string | null;
  actual_end_at: string | null;
  state: string;
  source_type: "paid" | "grant";
  /** Paid visibility add-on riding this placement ("top"/"raised"/null). */
  promotion_tier: "top" | "raised" | null;
  /** Post-hoc promotion window (present only for separately purchased boosts). */
  promotion_started_at: string | null;
  promotion_ends_at: string | null;
  charge_days: number;
  created_at: string;
}

export function useCampaignPlacements(id: string | undefined) {
  return useQuery({
    queryKey: ["campaign", id, "placements"],
    queryFn: () => api<ApiPlacement[]>(`/api/v1/campaigns/${id}/placements`),
    enabled: !!id,
  });
}

export interface ApiQueueCampaign {
  id: string;
  headline: string;
  body: string;
  banner_url: string;
  review_status: string;
  review_version: number;
  business_name: string;
  owner_phone: string;
  locations: string[];
  updated_at: string;
}

export interface ApiRefund {
  id: string;
  order: string;
  order_number: string;
  campaign_headline: string;
  business_name: string;
  amount: number;
  reason: string;
  state: string;
  provider_ref: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ApiGrantRow {
  id: string;
  campaign_headline: string;
  business_name: string;
  location_name: string;
  start_at: string;
  end_at: string;
  reason: string;
  admin_phone: string | null;
  created_at: string;
}

export interface ApiGrantOptions {
  campaigns: { id: string; headline: string; business_name: string }[];
  locations: { id: string; name: string; business_name: string }[];
  grants: ApiGrantRow[];
}

export function useReviewQueue(enabled: boolean) {
  return useQuery({
    queryKey: ["staff", "review-queue"],
    queryFn: () => api<ApiQueueCampaign[]>("/api/v1/admin/review-queue"),
    enabled,
  });
}

export function useRefunds(enabled: boolean) {
  return useQuery({
    queryKey: ["staff", "refunds"],
    queryFn: () => api<ApiRefund[]>("/api/v1/admin/refunds"),
    enabled,
  });
}

export function useGrantOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["staff", "grant-options"],
    queryFn: () => api<ApiGrantOptions>("/api/v1/admin/grants"),
    enabled,
  });
}

export function useAdLimit(enabled: boolean) {
  return useQuery({
    queryKey: ["staff", "ad-limit"],
    queryFn: () => api<{ key: string; value: number }>("/api/v1/admin/settings/ad-limit"),
    enabled,
  });
}

// ---------- Staff admin panel (oversight) ----------

export interface ApiReport {
  id: string;
  entity: string;
  entity_id: string;
  category: "spam" | "offensive" | "prohibited" | "outdated" | "other";
  reason: string;
  state: string;
  resolution_note: string;
  resolved_by_phone: string | null;
  created_at: string;
  resolved_at: string | null;
}

export function useReports(enabled: boolean) {
  return useQuery({
    queryKey: ["staff", "reports"],
    queryFn: () => api<ApiReport[]>("/api/v1/admin/reports"),
    enabled,
  });
}

export interface ApiAdminCampaign {
  id: string;
  headline: string;
  review_status: string;
  review_version: number;
  business_id: string;
  business_name: string;
  owner_phone: string;
  banner_url: string;
  updated_at: string;
}

export interface ApiAdminOrder {
  id: string;
  business_id: string;
  business_name: string;
  campaign_id: string;
  campaign_headline: string;
  amount_total: number;
  currency: string;
  state: string;
  attempts_count: number;
  created_at: string;
}

export interface ApiActivity {
  id: string;
  action: string;
  entity: string;
  entity_id: string;
  actor_phone: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---------- Staff control room (users, businesses, placements, logs) ----------

export interface Paged<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export const STAFF_PAGE_SIZE = 50;

/** Server-paginated staff list: `params` are the endpoint's filters (empty
 *  values dropped), `offset` the LimitOffset cursor. */
export function useStaffPage<T>(path: string, params: Record<string, string>, offset: number) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  search.set("limit", String(STAFF_PAGE_SIZE));
  search.set("offset", String(offset));
  const qs = search.toString();
  return useQuery({
    queryKey: ["staff", path, qs],
    queryFn: () => api<Paged<T>>(`/api/v1/admin/${path}?${qs}`),
    placeholderData: (prev) => prev,
  });
}

export interface ApiAdminUser {
  id: string;
  phone_e164: string;
  is_active: boolean;
  is_staff: boolean;
  is_deleted: boolean;
  businesses_count: number;
  last_login: string | null;
  created_at: string;
}

export interface ApiAdminUserDetail {
  user: ApiAdminUser;
  businesses: {
    id: string;
    name: string;
    status: string;
    locations_count: number;
    campaigns_count: number;
    created_at: string;
  }[];
  orders: {
    id: string;
    campaign_headline: string;
    amount_total: number;
    currency: string;
    state: string;
    created_at: string;
  }[];
  activity: ApiActivity[];
}

export function useAdminUser(id: string | null) {
  return useQuery({
    queryKey: ["staff", "users", id],
    queryFn: () => api<ApiAdminUserDetail>(`/api/v1/admin/users/${id}`),
    enabled: !!id,
  });
}

export interface ApiAdminBusiness {
  id: string;
  name: string;
  slug: string;
  status: string;
  is_verified: boolean;
  category_ru: string;
  category_uz: string;
  owner_id: string;
  owner_phone: string;
  owner_active: boolean;
  locations_count: number;
  campaigns_count: number;
  live_ads: number;
  created_at: string;
}

export interface ApiAdminLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  status: string;
  risk_flags: string[];
  business_id: string;
  business_name: string;
  business_status: string;
  lat: number;
  lng: number;
  live_ads: number;
  created_at: string;
}

export interface ApiAdminPlacement {
  id: string;
  state: string;
  source_type: "paid" | "grant";
  block_reason: string;
  start_at: string;
  end_at: string;
  charge_days: number;
  order_id: string | null;
  campaign_id: string;
  campaign_headline: string;
  campaign_status: string;
  banner_url: string;
  location_id: string;
  location_name: string;
  business_id: string;
  business_name: string;
  visible: boolean;
  created_at: string;
}

export interface ApiAdminPayment {
  id: string;
  order_id: string;
  order_state: string;
  provider: string;
  provider_payment_id: string;
  amount: number;
  status: string;
  business_name: string;
  campaign_headline: string;
  events_count: number;
  created_at: string;
  updated_at: string;
}

export interface ApiAdminPaymentEvent {
  id: string;
  provider: string;
  event_id: string;
  payment_attempt_id: string | null;
  payment_status: string | null;
  order_id: string | null;
  validated_payload_digest: string;
  received_at: string;
}

export interface ApiAdminOverview {
  queue_depth: number;
  open_reports: number;
  refunds_requested: number;
  campaigns: Record<string, number>;
  active_placements: number;
  revenue: { total: number; month: number };
  owners: number;
  attention: {
    capacity_blocked: number;
    staff_blocked: number;
    blocked_users: number;
    disabled_businesses: number;
    disabled_locations: number;
  };
}

export function useAdminOverview(enabled: boolean) {
  return useQuery({
    queryKey: ["staff", "overview"],
    queryFn: () => api<ApiAdminOverview>("/api/v1/admin/overview"),
    enabled,
  });
}

export interface MeSummary {
  campaigns: Record<string, number>;
  active_placements: number;
  expiring_soon: {
    id: string;
    campaign_id: string;
    headline: string;
    location: string;
    ends_at: string;
  }[];
  spend: { total: number; month: number; currency: string };
}

export function useMeSummary(enabled: boolean) {
  return useQuery({
    queryKey: ["me", "summary"],
    queryFn: () => api<MeSummary>("/api/v1/auth/me/summary"),
    enabled,
  });
}

export interface ApiOrderDetail extends ApiOrder {
  attempts: {
    id: string;
    provider: string;
    provider_payment_id: string;
    amount: number;
    status: string;
    created_at: string;
  }[];
  refund: { state: string; amount: number; reason: string; created_at: string } | null;
}

/** Checkout was started and the provider has not called back yet. The backend
 *  keeps such orders in awaiting_payment with a pending attempt;
 *  payment_processing is reserved for a future provider flow. */
export function isAwaitingProvider(order: ApiOrderDetail | undefined): boolean {
  if (!order) return false;
  if (order.state === "payment_processing") return true;
  return (
    order.state === "awaiting_payment" && order.attempts.some((a) => a.status === "pending")
  );
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["order", id],
    queryFn: () => api<ApiOrderDetail>(`/api/v1/orders/${id}`),
    enabled: !!id,
    // Payment status resolves asynchronously (provider webhook): poll while
    // the provider callback is outstanding so checkout resolves on its own.
    // Stops once the order is paid/failed/expired; hidden tabs don't poll.
    refetchInterval: (query) => (isAwaitingProvider(query.state.data) ? 3000 : false),
  });
}

/** Current ad tariff (minor units per location per 24h) for the editor's
 *  live estimate, plus the optional paid visibility add-ons (null = the tier
 *  is not offered in this tariff period). The quote endpoint remains the
 *  charged-amount source of truth — this is display-only. */
export interface PublicPricing {
  tariff: {
    currency: string;
    amount_per_24h: number;
    amount_top_per_24h: number | null;
    amount_raised_per_24h: number | null;
    valid_from: string;
  } | null;
}

export function usePublicPricing() {
  return useQuery({
    queryKey: ["public-pricing"],
    queryFn: () => api<PublicPricing>("/api/v1/public/pricing"),
    staleTime: 60_000,
  });
}

// ---------- Advertiser cabinet ----------

export function useBusinesses() {
  return useQuery({
    queryKey: ["businesses"],
    queryFn: () => api<ApiBusiness[]>("/api/v1/businesses"),
  });
}

export function useBusinessLocations(businessId: string | undefined) {
  return useQuery({
    queryKey: ["business-locations", businessId],
    queryFn: () =>
      api<ApiOwnerLocation[]>(`/api/v1/businesses/${businessId}/locations`),
    enabled: !!businessId,
  });
}

export function useCampaigns(businessId?: string) {
  return useQuery({
    queryKey: ["campaigns", businessId ?? "all"],
    queryFn: () =>
      api<ApiCampaign[]>(
        `/api/v1/campaigns${businessId ? `?business=${businessId}` : ""}`,
      ),
  });
}

export function useOrders() {
  return useQuery({
    queryKey: ["orders"],
    queryFn: () => api<ApiOrder[]>("/api/v1/orders"),
  });
}
