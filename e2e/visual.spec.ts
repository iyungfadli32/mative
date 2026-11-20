import { test, expect } from "@playwright/test";

/**
 * Visual QA — Dok 11 §4. Screenshot shell di 3 viewport target:
 * desktop 1440×1000, tablet 1024×900, mobile 390×844.
 * Disimpan ke docs/visual-qa/ (di-commit sebagai bukti review visual).
 * Perbandingan dengan references/01 (Desktop Dashboard) dan 05 (Mobile
 * Dashboard) dilakukan manual oleh reviewer — lihat docs/phase-1-report.md.
 */
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 1000 },
  { name: "tablet-1024", width: 1024, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test(`visual — beranda @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Satu workspace/ })).toBeVisible();
    await page.screenshot({ path: `docs/visual-qa/landing-${vp.name}.png`, fullPage: true });
  });

  test(`visual — dashboard shell @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
    await page.screenshot({ path: `docs/visual-qa/dashboard-${vp.name}.png`, fullPage: true });
  });

  test(`visual — portal klien @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/portal");
    await expect(
      page.getByRole("heading", { name: "Konten yang dibagikan ke Anda" }),
    ).toBeVisible();
    await page.screenshot({ path: `docs/visual-qa/portal-${vp.name}.png`, fullPage: true });
  });

  test(`visual — kalender (belum masuk) @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/kalender");
    await expect(page.getByRole("heading", { name: "Kalender" })).toBeVisible();
    await page.screenshot({ path: `docs/visual-qa/kalender-${vp.name}.png`, fullPage: true });
  });

  test(`visual — board (belum masuk) @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/board");
    await expect(page.getByRole("heading", { name: "Board Produksi" })).toBeVisible();
    await page.screenshot({ path: `docs/visual-qa/board-${vp.name}.png`, fullPage: true });
  });

  test(`visual — konten (belum masuk) @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/konten");
    await expect(page.getByRole("heading", { name: "Konten" })).toBeVisible();
    await page.screenshot({ path: `docs/visual-qa/konten-${vp.name}.png`, fullPage: true });
  });

  test(`visual — approval center (belum masuk) @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/persetujuan");
    await expect(page.getByRole("heading", { name: "Approval Center" })).toBeVisible();
    await page.screenshot({ path: `docs/visual-qa/persetujuan-${vp.name}.png`, fullPage: true });
  });

  test(`visual — tugas (belum masuk) @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/tugas");
    await expect(page.getByRole("heading", { name: "Tugas Saya" })).toBeVisible();
    await page.screenshot({ path: `docs/visual-qa/tugas-${vp.name}.png`, fullPage: true });
  });

  test(`visual — pustaka (belum masuk) @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/pustaka");
    await expect(page.getByRole("heading", { name: "Pustaka Aset" })).toBeVisible();
    await page.screenshot({ path: `docs/visual-qa/pustaka-${vp.name}.png`, fullPage: true });
  });

  test(`visual — template brief (belum masuk) @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/template-brief");
    await expect(page.getByRole("heading", { name: "Template Brief" })).toBeVisible();
    await page.screenshot({ path: `docs/visual-qa/template-brief-${vp.name}.png`, fullPage: true });
  });

  test(`visual — asisten AI (belum masuk) @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/ai");
    await expect(page.getByRole("heading", { name: "Asisten AI" })).toBeVisible();
    await expect(page.getByText("Anda belum masuk")).toBeVisible();
    await page.screenshot({ path: `docs/visual-qa/ai-${vp.name}.png`, fullPage: true });
  });
}
