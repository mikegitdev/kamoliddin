/** Thin fetch client: same-origin /api via Vite proxy, session cookies,
 * CSRF header for authenticated mutations, spec §12 error envelope. */
import { ru, type Dict } from "@/shared/i18n/ru";
import { uz } from "@/shared/i18n/uz";

/** Field values are a message list for serializer errors, or one message for
 *  errors raised in services; nested serializers nest further. */
type FieldValues = Record<string, unknown>;
type ErrorPayload = {
  error?: { code?: string; message?: string; fields?: FieldValues; field_codes?: FieldValues };
};

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

/** Backend `error.code` -> dictionary key. The envelope's `message` is English
 *  (logs, API clients); the UI only ever shows these translations. */
const CODE_MESSAGES: Record<string, keyof Dict> = {
  not_authenticated: "errNotAuthenticated",
  authentication_failed: "errNotAuthenticated",
  permission_denied: "errPermissionDenied",
  not_found: "errNotFound",
  invalid_otp: "errInvalidOtp",
  invalid_phone: "errInvalidPhone",
  phone_in_use: "phoneInUse",
  quote_expired: "errQuoteExpired",
  order_already_paid: "errOrderPaid",
  order_not_payable: "errOrderNotPayable",
  capacity_exhausted: "errCapacity",
  campaign_not_submitted: "errCampaignNotSubmitted",
  start_in_past: "errStartInPast",
  invalid_interval: "endAfterStart",
  locations_unavailable: "errLocationsUnavailable",
  quote_unavailable: "errQuoteUnavailable",
  refund_not_eligible: "errRefundNotEligible",
  refund_exists: "errRefundExists",
  already_refunded: "errAlreadyRefunded",
  invalid_refund_amount: "errRefundAmount",
  provider_ref_required: "errProviderRef",
  invalid_transition: "errInvalidTransition",
  file_required: "errFileRequired",
  file_too_large: "errFileTooLarge",
  invalid_image: "errInvalidImage",
  image_too_large: "errImageTooLarge",
  image_too_small: "errImageTooSmall",
  campaign_not_approved: "errCampaignNotApproved",
  location_mismatch: "errLocationMismatch",
  // Generic fallbacks for raise sites without a specific code
  validation_error: "errValidationError",
  checkout_error: "errCheckout",
};

/** Generic DRF field-validation codes -> short inline field messages. */
const FIELD_CODE_MESSAGES: Record<string, keyof Dict> = {
  required: "errFieldRequired",
  blank: "errFieldRequired",
  null: "errFieldRequired",
  empty: "errFieldRequired",
  max_length: "errFieldTooLong",
  max_string_length: "errFieldTooLong",
  min_length: "errFieldTooShort",
  max_value: "errFieldRange",
  min_value: "errFieldRange",
};

function codeMessage(code: string): string | undefined {
  const key = CODE_MESSAGES[code];
  return key ? dict()[key] : undefined;
}

/** First code of a field entry: "code" (service errors) or ["code", …]. */
function firstCode(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export class ApiError extends Error {
  code: string;
  fields?: FieldValues;
  fieldCodes?: FieldValues;
  status: number;

  /** status 0 = the request never got a response (network down, DNS, CORS). */
  constructor(status: number, payload: unknown) {
    // Non-envelope bodies (nginx 502 HTML, plain text) carry no usable message.
    const envelope = payload && typeof payload === "object" ? (payload as ErrorPayload).error : undefined;
    const code = envelope?.code ?? (status === 0 ? "network_error" : "error");
    const hasFields = Object.keys(envelope?.fields ?? {}).length > 0;
    super(
      transportMessage(status) ??
        codeMessage(code) ??
        (hasFields ? dict().errCheckFields : dict().errRequestFailed),
    );
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = envelope?.fields;
    this.fieldCodes = envelope?.field_codes;
  }

  /** Localized inline message per invalid field, for form error display. */
  fieldMessages(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const field of Object.keys(this.fields ?? {})) {
      const code = firstCode(this.fieldCodes?.[field]) ?? "invalid";
      const key = CODE_MESSAGES[code] ?? FIELD_CODE_MESSAGES[code] ?? "errFieldInvalid";
      out[field] = dict()[key];
    }
    return out;
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
