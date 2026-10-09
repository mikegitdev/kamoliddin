import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type {
  ApiBusiness,
  ApiCampaign,
  ApiCategory,
  ApiLocationDetail,
  ApiLocationPin,
  ApiOrder,
  ApiOwnerLocation,
  ApiRenewal,
  ApiSessionUser,
} from "@/entities/types";

export interface LocationFilters {
  bbox: string;
  category?: string;
  q?: string;
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
      const params = new URLSearchParams({ bbox: filters!.bbox, limit: "200" });
      if (filters!.category) params.set("category", filters!.category);
      if (filters!.q) params.set("q", filters!.q);
      return api<ApiLocationPin[]>(`/api/v1/public/locations?${params.toString()}`);
    },
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

export interface ApiGrantOptions {
  campaigns: { id: string; headline: string; business_name: string }[];
  locations: { id: string; name: string; business_name: string }[];
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
  business_name: string;
  owner_phone: string;
  banner_url: string;
  updated_at: string;
}

export function useAdminCampaigns(enabled: boolean, q: string, status: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const qs = params.toString();
  return useQuery({
    queryKey: ["staff", "campaigns", q, status],
    queryFn: () => api<ApiAdminCampaign[]>(`/api/v1/admin/campaigns${qs ? `?${qs}` : ""}`),
    enabled,
  });
}

export interface ApiAdminOrder {
  id: string;
  business_name: string;
  campaign_headline: string;
  amount_total: number;
  currency: string;
  state: string;
  created_at: string;
}

export function useAdminOrders(enabled: boolean) {
  return useQuery({
    queryKey: ["staff", "orders"],
    queryFn: () => api<ApiAdminOrder[]>("/api/v1/admin/orders"),
    enabled,
  });
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

export function useActivity(enabled: boolean) {
  return useQuery({
    queryKey: ["staff", "activity"],
    queryFn: () => api<ApiActivity[]>("/api/v1/admin/activity"),
    enabled,
  });
}

export interface ApiAdminOverview {
  queue_depth: number;
  open_reports: number;
  refunds_requested: number;
  campaigns: Record<string, number>;
  active_placements: number;
  revenue: { total: number; month: number };
  owners: number;
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
  next_renewal: {
    agreement_id: string;
    campaign_headline: string;
    next_run_at: string;
    locations_count: number;
    charge_days: number;
  } | null;
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

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["order", id],
    queryFn: () => api<ApiOrderDetail>(`/api/v1/orders/${id}`),
    enabled: !!id,
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

export function useRenewals() {
  return useQuery({
    queryKey: ["renewals"],
    queryFn: () => api<ApiRenewal[]>("/api/v1/renewals"),
  });
}
