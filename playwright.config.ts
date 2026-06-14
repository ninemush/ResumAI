import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const targetHost = new URL(baseURL).hostname;
const shouldStartLocalServer =
  targetHost === "localhost" || targetHost === "127.0.0.1" || targetHost === "::1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "firefox-desktop",
      use: {
        ...devices["Desktop Firefox"],
      },
    },
    {
      name: "webkit-desktop",
      use: {
        ...devices["Desktop Safari"],
      },
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
  webServer: shouldStartLocalServer
    ? {
        command: "npm run dev",
        reuseExistingServer: true,
        timeout: 120_000,
        url: baseURL,
      }
    : undefined,
});
