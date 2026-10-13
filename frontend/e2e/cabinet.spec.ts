import { expect, test } from "@playwright/test";
import { OWNER_PHONE, Session } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("advertiser cabinet", () => {
  let session: Session;

  test.beforeAll(async ({ browser }) => {
    session = new Session(browser, OWNER_PHONE); // one OTP for the whole file
  });

  test("OTP login lands on overview with analytics", async () => {
    const page = await session.open();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator(".stat-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".app-nav")).toContainText(/Кампании/);
  });

  test("campaign detail shows placement timeline", async () => {
    const page = await session.open();
    await page.goto("/app/campaigns");
    const firstHeadline = page.locator(".campaign-card .cc-title").first();
    await expect(firstHeadline).toBeVisible({ timeout: 15_000 });
    await firstHeadline.click();
    await expect(page).toHaveURL(/\/app\/campaigns\/[0-9a-f-]+$/, { timeout: 15_000 });
    await expect(page.locator(".review-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("h2").filter({ hasText: /Где и когда/ })).toBeVisible();
  });

  test("new campaign draft can be saved", async () => {
    const page = await session.open();
    await page.goto("/app/campaigns/new");
    const stamp = Date.now().toString().slice(-6);
    await page.locator("input").first().fill(`E2E черновик ${stamp}`);
    await page
      .getByRole("button", { name: /Сохранить черновик|Qora nosxa/ })
      .click();
    await expect(page.getByText(/сохран|saqland/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
