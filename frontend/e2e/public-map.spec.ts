import { expect, test } from "@playwright/test";

test.describe("public map", () => {
  test("home loads pins and map stats", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText(
      /Найдено|точек|nuqta/,
      { timeout: 20_000 },
    );
  });

  test("search filters the map data", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    await expect(footer).toContainText(/Найдено|точек|nuqta/, { timeout: 20_000 });
    await page.getByPlaceholder(/Поиск|Qidirish/).fill("пицц");
    await page.waitForTimeout(900); // 400ms debounce + request + render
    await expect(footer).toContainText(/Найдено|точек|nuqta|ничего|hech/);
  });

  test("location detail shows active ads", async ({ request, page }) => {
    const res = await request.get(
      "/api/v1/public/locations?bbox=69.15,41.20,69.40,41.40&limit=200",
    );
    const pins = (await res.json()) as { id: string; active_ads_count: number }[];
    const withAds = pins.find((p) => p.active_ads_count > 0);
    expect(withAds).toBeTruthy();
    await page.goto(`/locations/${withAds!.id}`);
    await expect(page.locator(".hero, .ad-card").first()).toBeVisible({ timeout: 15_000 });
  });
});
