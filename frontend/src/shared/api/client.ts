/** Thin fetch client: same-origin /api via Vite proxy, session cookies,
 * CSRF header for authenticated mutations, spec §12 error envelope. */
import { ru } from "@/shared/i18n/ru";
import { uz } from "@/shared/i18n/uz";

type ErrorPayload = { error?: { code?: string; message?: string; fields?: Record<string, string[]> } };

/** Runs outside React context; the i18n provider keeps <html lang> in sync. */
const dict = () => (document.documentElement.lang === "uz" ? uz : ru);

/** Transport-level failures get a localized message instead of the server's
 *  (English, or an HTML proxy page): offline, throttled, or server down. */
function transportMessage(status: number): string | null {
  if (status === 0) return dict().networkError;
  if (status === 429) return dict().tooManyRequests;
  if (status >= 500) return dict().serverError;
  return null;
}

export class ApiError extends Error {
  code: string;
  fields?: Record<string, string[]>;
  status: number;

  /** status 0 = the request never got a response (network down, DNS, CORS). */
  constructor(status: number, payload: unknown) {
    // Non-envelope bodies (nginx 502 HTML, plain text) carry no usable message.
    const envelope = payload && typeof payload === "object" ? (payload as ErrorPayload).error : undefined;
    super(transportMessage(status) ?? envelope?.message ?? dict().error);
    this.name = "ApiError";
    this.status = status;
    this.code = envelope?.code ?? (status === 0 ? "network_error" : "error");
    this.fields = envelope?.fields;
  }
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match?.[1] ?? null;
}

export async function api<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const method = (options.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const token = csrfToken();
    if (token) headers.set("X-CSRFToken", token);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
      credentials: "include",
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
  } catch (e) {
    // Cancellation (React Query unmount/refetch) is not a failure — keep it as-is.
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, null);
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown;
  try {
    payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
  } catch {
    // Empty/truncated body or a dropped connection mid-read.
    if (!response.ok) throw new ApiError(response.status, null);
    throw new ApiError(0, null);
  }

  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }
  return payload as T;
}
