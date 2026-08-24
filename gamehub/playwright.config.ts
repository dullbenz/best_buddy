import { defineConfig, devices } from "@playwright/test";

/**
 * Two tiers of end-to-end test.
 *
 * `local` runs against the Vite dev server with the Firebase emulators behind
 * it — hermetic, fast, and what CI gates every push on.
 *
 * `staging` runs the same specs against the deployed devnet hub over its basic
 * auth gate, with real Cloud Functions, real Firestore and real on-chain stake
 * reads. That is the tier that proves a deploy actually works, and it is the
 * one the launch runbook waits on.
 */
const stagingUrl = process.env.E2E_BASE_URL || "https://gamehub-staging.mybestbuddy.fun";

export default defineConfig({
  testDir: "./e2e",
  // Games have animations and cooldowns; these are not instant assertions.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // A retry masks a flaky test locally; in CI one retry absorbs cold starts.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  projects: [
    {
      name: "local",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5173",
      },
    },
    {
      name: "staging",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: stagingUrl,
        // Playwright answers the gate's 401 challenge itself.
        httpCredentials:
          process.env.E2E_BASIC_USER && process.env.E2E_BASIC_PASSWORD
            ? {
                username: process.env.E2E_BASIC_USER,
                password: process.env.E2E_BASIC_PASSWORD,
              }
            : undefined,
      },
    },
  ],

  webServer:
    process.env.E2E_BASE_URL || process.env.E2E_NO_SERVER
      ? undefined
      : {
          command: "npm run dev -- --port 5173 --strictPort",
          url: "http://127.0.0.1:5173",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
});
