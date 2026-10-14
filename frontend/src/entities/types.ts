/** API entity types mirroring backend serializers (apps/discovery, spec §12). */

export interface ApiCategory {
  id: string;
  slug: string;
  name_ru: string;
  name_uz: string;
}

export interface ApiLocationPin {
  id: string;
  name: string;
  lon: number;
  lat: number;
  category: string;
  business_name: string;
  /** Count of CURRENTLY active public ads — not historical (spec §10). */
  active_ads_count: number;
  /** Distance from the search origin in meters (search results only). */
  distance_m?: number;
}

export interface ApiActiveAd {
  id: string;
  headline: string;
  body: string;
  banner_url: string;
  business_name: string;
  starts_at: string;
  ends_at: string;
}

/** Branch context carried by the public ad detail endpoint: only locations
 *  where the campaign is CURRENTLY eligible (spec §14). Lets a shared
 *  /ads/:id link show address/hours/contacts without navigation state. */
export interface ApiAdLocation {
  id: string;
  name: string;
  address: string;
  lon: number;
  lat: number;
  hours: Record<string, [string, string] | undefined>;
  phone: string;
  telegram: string;
  whatsapp: string;
  business_site: string;
}

export interface ApiCampaignDetail extends ApiActiveAd {
  locations: ApiAdLocation[];
}

export interface ApiLocationDetail {
  id: string;
  name: string;
  address: string;
  lon: number;
  lat: number;
  hours: Record<string, [string, string] | undefined>;
  phone: string;
  telegram: string;
  whatsapp: string;
  business_name: string;
  business_site: string;
  category: string;
  active_ads: ApiActiveAd[];
}

export interface ApiSessionUser {
  id: string;
  phone_e164: string;
  is_staff: boolean;
}

export interface ApiBusiness {
  id: string;
  name: string;
  slug: string;
  category: string;
  owner_phone: string;
  logo_key: string;
  description: string;
  phone: string;
  telegram: string;
  whatsapp: string;
  site: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ApiOwnerLocation {
  id: string;
  business: string;
  business_name: string;
  name: string;
  address: string;
  city: string;
  lon: number;
  lat: number;
  phone: string;
  telegram: string;
  whatsapp: string;
  hours: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
}

export type CampaignStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "suspended";

export interface ApiCampaign {
  id: string;
  business: string;
  business_name: string;
  headline: string;
  body: string;
  banner_key: string;
  banner_url: string;
  review_status: CampaignStatus;
  review_version: number;
  /** PUBLICATION state, independent of review_status: count of placements
   *  currently eligible (live) — approved ≠ live (spec §7). */
  active_placements_count: number;
  /** Nearest upcoming/ongoing show window (list cards); null when none. */
  next_interval: { start_at: string; end_at: string } | null;
  created_at: string;
  updated_at: string;
}

/** Immutable moderation decision (spec §5); reviewer identity is private. */
export interface ApiCampaignReview {
  id: string;
  decision: "approved" | "rejected";
  reason: string;
  content_version: number;
  created_at: string;
}

export interface ApiOrderItem {
  location: string;
  location_name: string;
  unit_rate_snapshot: number;
  charge_days: number;
  line_total: number;
}

export type OrderState =
  | "draft_quote"
  | "awaiting_payment"
  | "payment_processing"
  | "paid"
  | "failed"
  | "expired";

export interface ApiOrder {
  id: string;
  business: string;
  business_name: string;
  campaign: string;
  campaign_headline: string;
  campaign_status: CampaignStatus;
  amount_total: number;
  currency: string;
  state: OrderState;
  quote_expires_at: string | null;
  interval_start_at: string | null;
  interval_end_at: string | null;
  auto_renew: boolean;
  items: ApiOrderItem[];
  created_at: string;
  updated_at: string;
}

// Generated API contract (spec §12): the OpenAPI schema is the source of
// truth — `npm run gen:api` regenerates schema.d.ts from backend/openapi
// (drift fails CI). SchemaOrder mirrors the hand-rolled ApiOrder above; new
// money DTOs should derive from the schema instead of hand-maintaining.
import type { components } from "@/shared/api/schema";
export type SchemaOrder = components["schemas"]["Order"];

export interface ApiCheckout {
  order_id: string;
  provider: string;
  provider_payment_id: string;
  amount_minor: number;
  currency: string;
  redirect_url: string;
  order_state: string;
}

export interface ApiRenewal {
  id: string;
  business: string;
  business_name: string;
  campaign: string;
  campaign_headline: string;
  locations_snapshot: string[];
  locations_count: number;
  charge_days: number;
  duration_seconds: number;
  status: "active" | "alert" | "disabled";
  price_policy: string;
  consent_at: string;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}

export interface ApiRefundRequestResult {
  id: string;
  state: string;
  amount: number;
}

export interface ApiErrorShape {
  error: { code: string; message: string; fields?: Record<string, string[]> };
  request_id?: string;
}
