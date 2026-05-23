import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chrome-desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
      },
    },
    {
      name: "chrome-mobile",
      use: {
        ...devices["Pixel 7"],
        channel: "chrome",
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    reuseExistingServer: true,
    timeout: 120_000,
    url: "http://localhost:3000",
  },
});
