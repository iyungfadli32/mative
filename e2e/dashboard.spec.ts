import { test, expect } from "@playwright/test";

/**
 * Spek regresi Phase 9 — dashboard / Command Center.
 * Regresi: dashboard MENGABAIKAN ?workspace= dan selalu menampilkan KPI
 * + nama workspace TERTUA (workspaces[0]) — terbukti 20 Nov 2026 lewat
 * probe Playwright (?workspace=ws-p7-a72 tetap menampilkan KPI 5/0/0/0/2
 * milik ws-p8-a81). Perbaikan: dashboard menyelesaikan workspace aktif
 * dari ?workspace= bila pemanggil member di sana (pola
 * getPlanningContext), fallback workspace pertama.
 *
 * BUTUH database live + akun uji (E2E_TEST_EMAIL/PASSWORD). Tes di-SKIP
 * otomatis bila akun uji tidak diisi. Residu memakai pola
 * org-p9-dash-... / ws-p9-dash-... (dibersihkan parent sesudah run).
 */
const hasTestAccount = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(process.env.E2E_TEST_EMAIL as string);
  await page.getByLabel("Kata sandi").fill(process.env.E2E_TEST_PASSWORD as string);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible({
    timeout: 30000,
  });
}

/** Pindah ke workspace baru lewat switcher; mengembalikan UUID-nya. */
async function switchToWorkspace(
  page: import("@playwright/test").Page,
  slug: string,
): Promise<string | null> {
  const switcher = page.getByLabel("Pindah workspace");
  if ((await switcher.count()) === 0) return null;
  await switcher.selectOption({ label: `Workspace P9 ${slug} (owner)` });
  await expect(page.getByText(`Workspace: Workspace P9 ${slug}`)).toBeVisible({
    timeout: 30000,
  });
  return await switcher.inputValue();
}

test.describe("dashboard — menghormati ?workspace=", () => {
  test.skip(!hasTestAccount, "butuh akun uji E2E_TEST_EMAIL/PASSWORD");

  test("dashboard ?workspace= baru menampilkan KPI + nama workspace itu", async ({ page }) => {
    test.setTimeout(180000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `dash-${Date.now().toString(36)}`;

    await page.goto("/pengaturan/organisasi");
    await page.getByLabel("Nama organisasi").fill(`Organisasi P9 ${slug}`);
    await page.getByLabel(/Slug \(huruf kecil/).fill(`org-p9-${slug}`);
    await page.getByRole("button", { name: "Buat organisasi" }).click();
    await expect(page.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
    await page.getByLabel("Nama workspace").fill(`Workspace P9 ${slug}`);
    await page.getByLabel("Slug", { exact: true }).fill(`ws-p9-${slug}`);
    await page.getByRole("button", { name: "Buat workspace" }).click();
    await expect(page.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });

    await page.goto("/merek");
    await expect(page.getByRole("heading", { name: "Merek" })).toBeVisible();
    const wsId = await switchToWorkspace(page, slug);
    await page.locator("#brand-name-new").fill(`Brand P9 ${slug}`);
    await page.locator("#brand-slug-new").fill(`brand-p9-${slug}`);
    await page.getByRole("button", { name: "Buat brand" }).click();
    await expect(page.getByText("Brand dibuat.", { exact: true })).toBeVisible({ timeout: 30000 });

    const createUrl = wsId ? `/konten/baru?workspace=${wsId}` : "/konten/baru";
    await page.goto(createUrl);
    await expect(page.getByRole("heading", { name: "Buat konten" })).toBeVisible();
    await page.getByLabel(/Brand/).selectOption({ label: `Brand P9 ${slug}` });
    await page.getByLabel("Judul konten").fill(`Konten P9 ${slug}`);
    await page
      .getByLabel("Ringkasan perubahan (wajib — tercatat di versi)")
      .fill("Versi awal (v1)");
    await page.getByRole("button", { name: "Buat konten (v1)" }).click();
    await expect(page.getByText("Konten dibuat beserta versi v1.")).toBeVisible({
      timeout: 30000,
    });

    // Workspace baru punya tepat 1 konten (tahap awal = Direncanakan 1).
    // Bila dashboard mengabaikan ?workspace=, KPI yang tampil adalah milik
    // workspace tertua (bukan 1) — itulah regresi yang ditangkap tes ini.
    const dashUrl = wsId ? `/dashboard?workspace=${wsId}` : "/dashboard";
    await page.goto(dashUrl);
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
    // Nama workspace di daftar "Workspace Anda" (terlihat di desktop + mobile;
    // nama di sidebar tersembunyi di mobile sehingga jangan asersi global).
    const wsSection = page.getByRole("heading", { name: "Workspace Anda" }).locator("..");
    await expect(wsSection.getByText(`Workspace P9 ${slug}`).first()).toBeVisible({
      timeout: 30000,
    });
    const kpis = page.locator('[aria-label="KPI operasional"]');
    await expect(kpis.getByText("Direncanakan")).toBeVisible();
    // Nilai KPI Direncanakan harus 1 (satu-satunya konten workspace baru).
    // Nilai memakai aria-label "Direncanakan: <angka>" (KPIStatCard).
    await expect(page.getByLabel("Direncanakan: 1")).toBeVisible({ timeout: 30000 });
  });
});
