/** Auth feature API: phone OTP challenge + verification (spec §9). */
import { api } from "@/shared/api/client";
import type { ApiSessionUser } from "@/entities/types";

/**
 * `channel=auto` (default) prefers the account's enrolled Telegram chat and
 * falls back to SMS; `channel=sms` always uses SMS (escape hatch when the
 * user cannot access Telegram) — ADR-0006.
 */
export function requestOtp(
  phone: string,
  channel: "auto" | "sms" = "auto",
): Promise<{ detail: string; dev_code?: string }> {
  return api("/api/v1/auth/otp/request", { method: "POST", json: { phone, channel } });
}

export function verifyOtp(phone: string, code: string): Promise<ApiSessionUser> {
  return api("/api/v1/auth/otp/verify", { method: "POST", json: { phone, code } });
}
