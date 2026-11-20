import { test, expect } from "@playwright/test";

/**
 * Critical flow — BUTUH database live + migrasi 0001–0005 diterapkan
 * + akun uji (lihat docs/apply-migrations.md).
 * Tes ini di-SKIP otomatis bila env E2E_TEST_EMAIL / E2E_TEST_PASSWORD
 * tidak diisi — JANGAN pernah menulis kredensial akun uji ke file ini.
 *
 * Alur: sign up → buat organisasi → buat workspace → undang anggota.
 * (Penerimaan undangan + RLS allow/deny diuji di pgTAP, bukan di sini.)
 */
const hasTestAccount = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);

test.describe("critical flow — auth + workspace @needs-db", () => {
  test.skip(!hasTestAccount, "Butuh akun uji (E2E_TEST_EMAIL/PASSWORD) + migrasi live.");

  test("sign in → buat organisasi → buat workspace", async ({ page }) => {
    const email = process.env.E2E_TEST_EMAIL as string;
    const password = process.env.E2E_TEST_PASSWORD as string;
    const slug = `e2e-${Date.now().toString(36)}`;

    await page.goto("/masuk");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Kata sandi").fill(password);
    await page.getByRole("button", { name: "Masuk" }).click();
    // Timeout 15 dtk (bukan default 5 dtk): login melibatkan round-trip
    // Supabase Auth + render dashboard; di mobile kerap >5 dtk (defect tes
    // e2e 2026-11-19 yang sama seperti di planning.spec.ts — flaky, bukan
    // defect aplikasi; terbukti 20 Nov 2026: tombol Masuk masih pending
    // saat expect 5 dtk habis, rerun Chromium lolos).
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible({
      timeout: 15000,
    });

    await page.goto("/pengaturan/organisasi");
    await page.getByLabel("Nama organisasi").fill(`Organisasi E2E ${slug}`);
    await page.getByLabel(/Slug \(huruf kecil/).fill(`org-${slug}`);
    await page.getByRole("button", { name: "Buat organisasi" }).click();
    await expect(page.getByText("Organisasi dibuat.")).toBeVisible();

    await page.getByLabel("Nama workspace").fill(`Workspace E2E ${slug}`);
    await page.getByLabel("Slug", { exact: true }).fill(`ws-${slug}`);
    await page.getByRole("button", { name: "Buat workspace" }).click();
    await expect(page.getByText("Workspace dibuat.")).toBeVisible();
  });

  test("halaman anggota menampilkan form undangan", async ({ page }) => {
    const email = process.env.E2E_TEST_EMAIL as string;
    const password = process.env.E2E_TEST_PASSWORD as string;
    await page.goto("/masuk");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Kata sandi").fill(password);
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible({
      timeout: 15000,
    });
    await page.goto("/pengaturan/anggota");
    await expect(page.getByRole("heading", { name: /Undang anggota/ })).toBeVisible();
    await expect(page.getByLabel("Email yang diundang")).toBeVisible();
    // Regresi Phase 9: daftar anggota SELALU kosong sejak Phase 1 karena
    // query memakai join embed `profiles(display_name)` tanpa FK di skema
    // (PostgREST PGRST200 → members = []). Pemilik workspace pertama
    // (akun uji ini) WAJIB tampil di tabel: empty state tersembunyi,
    // role Pemilik + status active terlihat.
    await expect(page.getByText("Belum ada anggota")).toBeHidden({ timeout: 30000 });
    await expect(page.getByRole("cell", { name: "Pemilik" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "active" })).toBeVisible();
  });
});
