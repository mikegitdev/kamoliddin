/* Card payment methods offered at checkout: Click, Payme, Octobank.
 *
 * On stacks running the fake gateway (dev / investor demo) each method opens
 * a mock of that provider's hosted card page (pages/DemoPayPage), which
 * settles through the fake adapter's callback — the same webhook path a real
 * provider takes. A real provider redirects to its own hosted page instead.
 * Card data typed into the mock stays in the browser (AGENTS.md rule 6). */

export type PayMethod = "click" | "payme" | "octo";
export type CardNetwork = "uzcard" | "humo" | "visa" | "mastercard";

export const PAY_METHODS: PayMethod[] = ["click", "payme", "octo"];

export const PROVIDER_NAME: Record<PayMethod, string> = {
  click: "Click",
  payme: "Payme",
  octo: "Octobank",
};

/** Networks each hosted page accepts: local cards everywhere, international
 *  (Visa/Mastercard, confirmed by 3-D Secure) through Octobank only. */
export const ACCEPTED_NETWORKS: Record<PayMethod, CardNetwork[]> = {
  click: ["uzcard", "humo"],
  payme: ["uzcard", "humo"],
  octo: ["uzcard", "humo", "visa", "mastercard"],
};

export const NETWORK_LABEL: Record<CardNetwork, string> = {
  uzcard: "UZCARD",
  humo: "HUMO",
  visa: "VISA",
  mastercard: "Mastercard",
};

/** Demo-only card per provider, so each one shows a different network. */
export const TEST_CARDS: Record<PayMethod, { number: string; expiry: string; cvv: string }> = {
  click: { number: "8600123456789012", expiry: "1229", cvv: "" },
  payme: { number: "9860123456789012", expiry: "1129", cvv: "" },
  octo: { number: "4111111111111111", expiry: "1029", cvv: "123" },
};

export function isPayMethod(value: string | undefined): value is PayMethod {
  return value === "click" || value === "payme" || value === "octo";
}

export function isInternational(network: CardNetwork | null): boolean {
  return network === "visa" || network === "mastercard";
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Network by BIN prefix: Uzcard 8600/5614, Humo 9860, then Visa/Mastercard. */
export function detectNetwork(digits: string): CardNetwork | null {
  if (digits.startsWith("8600") || digits.startsWith("5614")) return "uzcard";
  if (digits.startsWith("9860")) return "humo";
  if (digits.startsWith("4")) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "mastercard";
  return null;
}

/** "8600123456" -> "8600 1234 56" */
export function formatCardNumber(digits: string): string {
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** "1229" -> "12/29" */
export function formatExpiry(digits: string): string {
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

/** MMYY not yet past (a card is valid through the end of its month). */
export function expiryValid(digits: string, now = new Date()): boolean {
  if (digits.length !== 4) return false;
  const month = Number(digits.slice(0, 2));
  const year = 2000 + Number(digits.slice(2));
  if (month < 1 || month > 12) return false;
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}

/** "8600123456789012" -> "8600 •••• •••• 9012" */
export function maskCard(digits: string): string {
  return `${digits.slice(0, 4)} •••• •••• ${digits.slice(-4)}`;
}

/** Text wordmarks in each provider's colors — placeholders until the
 *  official logo files from the merchant agreements are dropped in. */
export function ProviderWordmark({ method }: { method: PayMethod }) {
  switch (method) {
    case "click":
      return (
        <span className="wordmark wm-click">
          <span className="wm-click-dot" aria-hidden="true" />
          click
        </span>
      );
    case "payme":
      return (
        <span className="wordmark wm-payme">
          pay<b>me</b>
        </span>
      );
    case "octo":
      return (
        <span className="wordmark wm-octo">
          <b>octo</b>bank
        </span>
      );
  }
}
