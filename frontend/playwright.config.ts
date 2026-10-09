import { defineConfig } from "@playwright/test";

// E2E against the dev stack: Django in Docker on :8000 (localads-smoke),
// Vite dev server proxied on :5173. `npx playwright test` from frontend/.
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000, // self-healing OTP retry can wait out the 60s throttle window
  retries: 0,
  workers: 1, // flows share demo data and OTP logs; keep them serial
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    locale: "ru-RU",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
