/** Auth feature API: phone OTP challenge + verification (spec §9). */
import { api } from "@/shared/api/client";
import type { ApiSessionUser } from "@/entities/types";

export function requestOtp(phone: string): Promise<{ detail: string }> {
  return api("/api/v1/auth/otp/request", { method: "POST", json: { phone } });
}

export function verifyOtp(phone: string, code: string): Promise<ApiSessionUser> {
  return api("/api/v1/auth/otp/verify", { method: "POST", json: { phone, code } });
}
