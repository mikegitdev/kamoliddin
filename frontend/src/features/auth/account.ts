/** Account lifecycle API: phone change + soft deletion (spec §9/§14). */
import { api } from "@/shared/api/client";
import type { ApiSessionUser } from "@/entities/types";

export function requestPhoneChange(
  newPhone: string,
): Promise<{ detail: string; dev_code?: string }> {
  return api("/api/v1/auth/phone/change/request", { method: "POST", json: { new_phone: newPhone } });
}

export function verifyPhoneChange(newPhone: string, code: string): Promise<ApiSessionUser> {
  return api("/api/v1/auth/phone/change/verify", {
    method: "POST",
    json: { new_phone: newPhone, code },
  });
}

export function deleteAccount(): Promise<void> {
  return api("/api/v1/auth/me", { method: "DELETE" });
}
