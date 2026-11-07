import { defineConfig, devices } from "@playwright/test";

/** E2E runs the real stack: Postgres (DATABASE_URL), the Rust API on :8080 and the Vite dev server. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "cargo run --manifest-path ../server/Cargo.toml",
      url: "http://127.0.0.1:8080/ready",
      reuseExistingServer: true,
      timeout: 240_000,
      env: {
        DATABASE_URL:
          process.env.DATABASE_URL ?? "postgres://meridian:meridian_local_only@localhost:5432/meridian",
      },
    },
    { command: "npm run dev", url: "http://127.0.0.1:5173", reuseExistingServer: true },
  ],
});
