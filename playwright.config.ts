import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright — e2e Phase 1.
 * Critical flow penuh (sign up → buat workspace → undang anggota) BUTUH
 * database live + migrasi diterapkan (lihat docs/apply-migrations.md).
 * Bila Supabase belum terkonfigurasi / migrasi belum diterapkan, tes
 * berlabel @needs-db di-skip otomatis (lihat e2e/auth.spec.ts).
 * Tes smoke (halaman publik + health) selalu jalan.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        // Production server (butuh `npm run build` dulu) — jauh lebih cepat
        // dan lebih dekat dengan gate production build daripada dev server.
        command: "npm run start",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
