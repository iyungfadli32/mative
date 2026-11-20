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
 *
 * Regresi panel (Phase 9): "Antrean persetujuan" dulu EmptyState hardcode
 * — selalu "Belum ada yang menunggu persetujuan" walau ada request
 * in_review. Perbaikan: panel menampilkan request in_review nyata
 * (judul + pemohon + umur + tautan ke /persetujuan); empty state hanya
 * bila benar-benar tidak ada.
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

/** Pindah production stage idea → editing (5 langkah, tab Overview) — pola
 * approval.spec.ts. WAJIB sebelum submit approval internal: RPC 0014 hanya
 * menerima submit dari 'editing'/'internal_review'. */
async function walkToEditing(page: import("@playwright/test").Page) {
  const pipeline: Array<[string, string]> = [
    ["idea", "brief"],
    ["brief", "scripting"],
    ["scripting", "ready_for_production"],
    ["ready_for_production", "in_production"],
    ["in_production", "editing"],
  ];
  for (const [from, to] of pipeline) {
    await page.getByLabel("Pindah stage ke").selectOption(to);
    await page.getByRole("button", { name: "Pindah stage" }).click();
    await expect(
      page.getByText(`Status produksi diubah: ${from} → ${to}.`, { exact: true }),
    ).toBeVisible({ timeout: 30000 });
  }
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
    // Regresi panel: workspace baru tanpa request approval → empty state
    // jujur, dan teks basi "Approval Center hadir di Phase 4" TIDAK muncul.
    const panel = page.getByRole("heading", { name: "Antrean persetujuan" }).locator("..");
    await expect(panel.getByText("Belum ada yang menunggu persetujuan")).toBeVisible();
    await expect(panel.getByText("Approval Center hadir di Phase 4")).toHaveCount(0);
  });

  test("panel Antrean persetujuan menampilkan request in_review nyata", async ({ page }) => {
    test.setTimeout(300000);
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

    // Pindah stage idea → editing (5 langkah) lalu submit v1 untuk
    // approval — pola approval.spec.ts (RPC 0014 hanya menerima submit
    // dari editing/internal_review).
    await page.goto("/konten");
    await page.getByRole("link", { name: `Konten P9 ${slug}` }).click();
    await expect(page.getByRole("heading", { name: `Konten P9 ${slug}` })).toBeVisible();
    await walkToEditing(page);
    await page.getByRole("tab", { name: "Approval" }).click();
    await expect(page.getByText("Belum ada request approval aktif")).toBeVisible({
      timeout: 30000,
    });
    const assignForm = page.locator("form", { has: page.getByText("Simpan penugasan") });
    await assignForm.locator('select[name="assigneeUserId"]').selectOption({ index: 1 });
    await assignForm.getByRole("button", { name: "Simpan penugasan" }).click();
    await expect(page.getByText("Penugasan step workflow disimpan.")).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Ajukan v1 untuk approval" }).click();
    await expect(page.getByText("Konten diajukan untuk approval")).toBeVisible({
      timeout: 30000,
    });

    // Dashboard workspace baru: KPI Menunggu persetujuan = 1 DAN panel
    // menampilkan judul konten yang diajukan (bukan empty state).
    const dashUrl = wsId ? `/dashboard?workspace=${wsId}` : "/dashboard";
    await page.goto(dashUrl);
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
    await expect(page.getByLabel("Menunggu persetujuan: 1")).toBeVisible({ timeout: 30000 });
    const panel = page.getByRole("heading", { name: "Antrean persetujuan" }).locator("..");
    await expect(panel.getByText(`Konten P9 ${slug}`)).toBeVisible({ timeout: 30000 });
    await expect(panel.getByText("Belum ada yang menunggu persetujuan")).toHaveCount(0);
    await expect(panel.getByText("Lihat semua di Approval Center →")).toBeVisible();
  });
});
