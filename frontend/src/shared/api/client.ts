/** Thin fetch client: same-origin /api via Vite proxy, session cookies,
 * CSRF header for authenticated mutations, spec §12 error envelope. */

export class ApiError extends Error {
  code: string;
  fields?: Record<string, string[]>;
  status: number;

  constructor(status: number, payload: { error?: { code?: string; message?: string; fields?: Record<string, string[]> } }) {
    super(payload?.error?.message ?? `HTTP ${status}`);
    this.status = status;
    this.code = payload?.error?.code ?? "error";
    this.fields = payload?.error?.fields;
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

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }
  return payload as T;
}
