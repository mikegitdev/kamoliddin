/** Advertiser cabinet mutations (spec §12 owner endpoints). */
import { api } from "@/shared/api/client";
import type { ApiBusiness, ApiCampaign, ApiCheckout, ApiOrder, ApiOwnerLocation } from "@/entities/types";

export interface BusinessInput {
  name: string;
  category: string;
  description?: string;
  phone?: string;
  telegram?: string;
  whatsapp?: string;
  site?: string;
}

export function saveBusiness(input: BusinessInput, id?: string): Promise<ApiBusiness> {
  return id
    ? api(`/api/v1/businesses/${id}`, { method: "PATCH", json: input })
    : api("/api/v1/businesses", { method: "POST", json: input });
}

export interface LocationInput {
  name: string;
  address: string;
  city?: string;
  phone?: string;
  telegram?: string;
  whatsapp?: string;
  hours?: Record<string, [string, string] | undefined>;
  lon: number;
  lat: number;
}

export function createLocation(
  businessId: string,
  input: LocationInput,
): Promise<ApiOwnerLocation> {
  return api(`/api/v1/businesses/${businessId}/locations`, {
    method: "POST",
    json: input,
  });
}

/** Edit an own branch (owner endpoint, spec §12). Coordinates are optional:
 *  omitting lon/lat keeps the existing pin. */
export function updateLocation(id: string, input: Partial<LocationInput>): Promise<ApiOwnerLocation> {
  return api(`/api/v1/locations/${id}`, { method: "PATCH", json: input });
}

export interface CampaignInput {
  business: string;
  headline: string;
  body?: string;
  banner_key: string;
}

export function createCampaign(input: CampaignInput): Promise<ApiCampaign> {
  return api("/api/v1/campaigns", { method: "POST", json: input });
}

export function updateCampaign(id: string, input: Partial<CampaignInput>): Promise<ApiCampaign> {
  return api(`/api/v1/campaigns/${id}`, { method: "PATCH", json: input });
}

export function submitCampaign(id: string): Promise<ApiCampaign> {
  return api(`/api/v1/campaigns/${id}/submit`, { method: "POST", json: {} });
}

export interface QuoteInput {
  business_id: string;
  campaign_id: string;
  location_ids: string[];
  requested_start_at: string;
  requested_end_at: string;
}

export function requestQuote(input: QuoteInput): Promise<ApiOrder> {
  return api("/api/v1/orders/quote", { method: "POST", json: input });
}

export function checkoutOrder(id: string, returnUrl = ""): Promise<ApiCheckout> {
  return api(`/api/v1/orders/${id}/checkout`, {
    method: "POST",
    json: { return_url: returnUrl },
  });
}

/** Dev-only: simulate the provider's successful callback (fake gateway). */
export function completeFakePayment(redirectUrl: string) {
  return api<{ detail: string; order_state?: string }>(redirectUrl, { method: "POST", json: {} });
}

export function uploadMedia(file: File, purpose: "banners" | "logos" = "banners") {
  const form = new FormData();
  form.append("file", file);
  return api<{ key: string; url: string }>(
    `/api/v1/media/upload?purpose=${purpose}`,
    { method: "POST", body: form },
  );
}

// ---------- Refunds ----------

export function requestRefund(orderId: string, reason: string) {
  return api(`/api/v1/orders/${orderId}/refund-request`, {
    method: "POST",
    json: { reason },
  });
}
