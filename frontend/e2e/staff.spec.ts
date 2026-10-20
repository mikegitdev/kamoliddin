import { expect, test } from "@playwright/test";
import { STAFF_PHONE, Session } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("staff moderation console", () => {
  let session: Session;

  test.beforeAll(async ({ browser }) => {
    session = new Session(browser, STAFF_PHONE); // one OTP for the whole file
  });

  test("login as staff shows all tabs with overview counters", async () => {
    const page = await session.open();
    await page.goto("/staff");
    await expect(page.locator(".staff-nav")).toContainText("Жалобы");
    await expect(page.locator(".stat-card").first()).toBeVisible({ timeout: 15_000 });
  });

  test("review queue lists submitted campaigns", async () => {
    const page = await session.open();
    await page.goto("/staff");
    await page.getByRole("button", { name: "Очередь" }).click();
    // demo data keeps at least one submitted campaign (english-house)
    await expect(page.locator(".review-card").first()).toBeVisible({ timeout: 15_000 });
  });

  test("reports tab renders the complaints queue", async () => {
    const page = await session.open();
    await page.goto("/staff");
    await page.getByRole("button", { name: "Жалобы" }).click();
    await expect(page.locator(".review-card").first()).toBeVisible({ timeout: 15_000 });
  });
});

test("non-staff cannot open the console", async ({ page }) => {
  await page.goto("/staff");
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  await expect(page.locator(".login-card")).toBeVisible();
});
