/** Telegram OTP enrollment (ADR-0006): link / status / unlink. */
import { api } from "@/shared/api/client";

export interface TelegramBindInfo {
  detail: string;
  link: string;
  bot_username: string;
}

export function telegramStatus(): Promise<{ bound: boolean }> {
  return api("/api/v1/auth/telegram/bind", { method: "GET" });
}

export function telegramBindLink(): Promise<TelegramBindInfo> {
  return api("/api/v1/auth/telegram/bind", { method: "POST" });
}

export function telegramUnbind(): Promise<void> {
  return api("/api/v1/auth/telegram/bind", { method: "DELETE" });
}
