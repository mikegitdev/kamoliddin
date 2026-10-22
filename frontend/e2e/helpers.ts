import { execSync } from "node:child_process";
import type { Browser, Page } from "@playwright/test";

export const OWNER_PHONE = "+998901234567";
export const STAFF_PHONE = "+998901110000";

/** Backend container the suite shells into for the OTP-quota purge below:
 *  the dev-stack backend that dev.sh runs. Override with
 *  E2E_BACKEND_CONTAINER if your container is named differently. */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER || "localads-backend-dev";

/**
 * The dev stack runs the fake SMS adapter with OTP_DEV_ECHO (dev settings
 * only, spec §9): the otp/request 202 body carries `dev_code`, so the suite
 * reads codes from responses — no container-log coupling.
 *
 * The suite's phones are fixed (their users own the demo data) and carry a
 * 20-codes/24h quota; repeated runs exhaust it and every request silently
 * 202s with no code. Purging their challenges keeps runs deterministic.
 */
function purgeOtpQuota(phone: string) {
  // 1) Challenges: kill the 60s resend window + per-phone code quota.
  execSync(`docker exec -i ${BACKEND_CONTAINER} python manage.py shell`, {
    stdio: "pipe",
    input:
      "from apps.accounts.models import OTPChallenge\n" +
      `OTPChallenge.objects.filter(phone_e164="${phone}").delete()`,
  });
  // 2) Scoped throttle counters (shared Redis, per-IP): back-to-back runs
  // would otherwise 429 on otp/verify from the same proxy IP.
  execSync(`docker exec -i ${BACKEND_CONTAINER} python manage.py shell`, {
    stdio: "pipe",
    input:
      "import os, redis\n" +
      "r = redis.Redis.from_url(os.environ.get('REDIS_URL', 'redis://localhost:6379/1'))\n" +
      "keys = list(r.scan_iter('*throttle_otp_*'))\n" +
      "keys and r.delete(*keys)",
  });
}

/** Submit the phone form and resolve the dev_code echoed by the API. */
async function requestOtpCode(page: Page, phone: string): Promise<string> {
  const responseP = page.waitForResponse(
    (r) =>
      r.url().includes("/api/v1/auth/otp/request") &&
      r.request().method() === "POST",
  );
  await page.locator("#phone").fill(phone);
  await page
    .getByRole("button", { name: /Отправить код|Kod yuborish/ })
    .first()
    .click();
  const response = await responseP;
  const body = (await response.json().catch(() => ({}))) as { dev_code?: string };
  if (!body.dev_code) {
    throw new Error(
      `otp/request returned ${response.status()} without dev_code — ` +
        "the dev stack must run with SMS_PROVIDER=fake and OTP_DEV_ECHO (dev settings).",
    );
  }
  return body.dev_code;
}

/** Log in through the UI using the echoed OTP. One retry rides out the
 * 60s resend window / scoped throttle if a manual request just fired. */
export async function loginViaOtp(page: Page, phone: string) {
  purgeOtpQuota(phone);
  await page.goto("/login");

  let code: string;
  try {
    code = await requestOtpCode(page, phone);
  } catch {
    await page.waitForTimeout(61_000);
    await page.goto("/login");
    code = await requestOtpCode(page, phone);
  }

  // Segmented OTP boxes: typing into the first box auto-advances focus.
  await page.locator(".login-code-row input").first().pressSequentially(code, {
    delay: 40,
  });
  // Auto-verify fires ~600ms after the sixth digit; the explicit button is
  // the fallback path (and may already be busy by the time we reach it).
  await page
    .locator(".btn.primary")
    .filter({ hasText: /Подтвердить|Tasdiqlash/ })
    .first()
    .click({ timeout: 2_000 })
    .catch(() => {});
  await page.waitForURL(/\/app|\/staff/, { timeout: 15_000 });
}

/**
 * OTP endpoints are throttled (spec §9), so a suite must not log in per test.
 * Creates ONE long-lived context per role and hands out pages.
 */
export class Session {
  private page: Page | null = null;

  constructor(
    private browser: Browser,
    private phone: string,
  ) {}

  /** Reuse a single logged-in page across serial tests in a file. */
  async open(): Promise<Page> {
    if (!this.page) {
      const context = await this.browser.newContext({ baseURL: "http://localhost:5173" });
      this.page = await context.newPage();
      await loginViaOtp(this.page, this.phone);
    }
    return this.page;
  }
}
