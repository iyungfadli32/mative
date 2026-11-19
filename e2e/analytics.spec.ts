import { test, expect } from "@playwright/test";

/**
 * Spek penerimaan Phase 7 — First Official Integration + Analytics (P7-06).
 * Alur A7.1: workspace baru → /analitik menampilkan "Belum terhubung"
 * (belum ada snapshot impor). A7.2: impor CSV (reach 1000 + engagements
 * 120 untuk satu konten) → dashboard menampilkan reach 1.000,
 * engagements 120, engagement rate 12,00 %. A7.3: /analitik/laporan
 * menampilkan 5 laporan + ekspor CSV (download). A7.4: /integrasi
 * menampilkan adapter DISABLED + blocker (tanpa tombol hubungkan).
 * A7.5: viewer_client tidak melihat analytics — DILEWATI di e2e (butuh
 * akun kedua sebagai viewer_client); dibuktikan di pgTAP 07 TES 5
 * (6 asersi RLS) + permissions.test.ts (can(viewer_client,
 * view_analytics) === false) + gate can() di halaman.
 *
 * BUTUH database live + migrasi 0021 diterapkan + akun uji
 * (E2E_TEST_EMAIL/PASSWORD). Tes ini di-SKIP otomatis bila akun uji
 * tidak diisi. Sampai migrasi diterapkan, spek ini BELUM TERBUKTI
 * live — lihat docs/phase-7-report.md §5/§9 (batas jujur).
 * Residu tes memakai pola org-p7-[slug]/ws-p7-[slug] (dibersihkan parent sesudah run).
 *
 * CATATAN workspace: listMyWorkspaces mengurutkan created_at ASC —
 * workspace AKTIF default adalah yang TERLAMA, bukan yang baru dibuat.
 * Karena itu spek ini menangkap UUID workspace baru lewat
 * WorkspaceSwitcher lalu membawa ?workspace=<id> di semua navigasi.
 */
const hasTestAccount = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);

async function signIn(page: import("@playwright/test").Page, email?: string, password?: string) {
  const e = email ?? (process.env.E2E_TEST_EMAIL as string);
  const p = password ?? (process.env.E2E_TEST_PASSWORD as string);
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(e);
  await page.getByLabel("Kata sandi").fill(p);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible({
    timeout: 30000,
  });
}

/** Pindah ke workspace baru lewat switcher; mengembalikan UUID-nya (null bila hanya 1 workspace). */
async function switchToWorkspace(
  page: import("@playwright/test").Page,
  slug: string,
): Promise<string | null> {
  const switcher = page.getByLabel("Pindah workspace");
  if ((await switcher.count()) === 0) return null;
  await switcher.selectOption({ label: `Workspace P7 ${slug} (owner)` });
  await expect(page.getByText(`Workspace: Workspace P7 ${slug}`)).toBeVisible({
    timeout: 30000,
  });
  return await switcher.inputValue();
}

/** Navigasi dengan ?workspace= bila UUID diketahui. */
async function gotoWs(
  page: import("@playwright/test").Page,
  path: string,
  wsId: string | null,
) {
  const url = wsId
    ? `${path}${path.includes("?") ? "&" : "?"}workspace=${wsId}`
    : path;
  await page.goto(url);
}

/** Setup org + workspace + brand + konten (v1) — dipakai tes A7.1–A7.4. */
async function setupContent(page: import("@playwright/test").Page, slug: string) {
  await page.goto("/pengaturan/organisasi");
  await page.getByLabel("Nama organisasi").fill(`Organisasi P7 ${slug}`);
  await page.getByLabel(/Slug \(huruf kecil/).fill(`org-p7-${slug}`);
  await page.getByRole("button", { name: "Buat organisasi" }).click();
  await expect(page.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
  await page.getByLabel("Nama workspace").fill(`Workspace P7 ${slug}`);
  await page.getByLabel("Slug", { exact: true }).fill(`ws-p7-${slug}`);
  await page.getByRole("button", { name: "Buat workspace" }).click();
  await expect(page.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });

  await page.goto("/merek");
  await expect(page.getByRole("heading", { name: "Merek" })).toBeVisible();
  const wsId = await switchToWorkspace(page, slug);
  await page.locator("#brand-name-new").fill(`Brand P7 ${slug}`);
  await page.locator("#brand-slug-new").fill(`brand-p7-${slug}`);
  await page.getByRole("button", { name: "Buat brand" }).click();
  await expect(page.getByText("Brand dibuat.", { exact: true })).toBeVisible({ timeout: 30000 });

  await gotoWs(page, "/konten/baru", wsId);
  await expect(page.getByRole("heading", { name: "Buat konten" })).toBeVisible();
  await page.getByLabel(/Brand/).selectOption({ label: `Brand P7 ${slug}` });
  await page.getByLabel("Judul konten").fill(`Konten P7 ${slug}`);
  await page.getByLabel("Ringkasan perubahan (wajib — tercatat di versi)").fill("Versi awal (v1)");
  await page.getByRole("button", { name: "Buat konten (v1)" }).click();
  await expect(page.getByText("Konten dibuat beserta versi v1.")).toBeVisible({ timeout: 30000 });
  return wsId;
}

/** Ambil UUID content_item dari tabel referensi halaman impor. */
async function readContentItemId(
  page: import("@playwright/test").Page,
  slug: string,
): Promise<string> {
  const row = page.locator("tr", { hasText: `Konten P7 ${slug}` }).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  const id = (await row.locator("td").nth(3).innerText()).trim();
  expect(id).toMatch(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  );
  return id;
}

test.describe("analytics — dashboard, impor CSV, laporan, integrasi", () => {
  test.skip(!hasTestAccount, "butuh akun uji E2E_TEST_EMAIL/PASSWORD");

  test("A7.1 dashboard workspace baru menampilkan 'Belum terhubung'", async ({ page }) => {
    const slug = `a71-${Date.now().toString(36)}`;
    await signIn(page);
    const wsId = await setupContent(page, slug);
    await gotoWs(page, "/analitik", wsId);
    await expect(page.getByRole("heading", { name: "Analitik" })).toBeVisible();
    await expect(page.getByText("Belum terhubung")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Belum ada data analytics")).toBeVisible({ timeout: 30000 });
  });

  test("A7.2 impor CSV → dashboard menampilkan reach, engagements, engagement rate", async ({
    page,
  }) => {
    const slug = `a72-${Date.now().toString(36)}`;
    await signIn(page);
    const wsId = await setupContent(page, slug);

    await gotoWs(page, "/analitik/impor", wsId);
    await expect(page.getByRole("heading", { name: "Impor Data Analytics" })).toBeVisible();
    const itemId = await readContentItemId(page, slug);
    const periodStart = await page.locator("#imp-period-start").inputValue();
    const periodEnd = await page.locator("#imp-period-end").inputValue();
    expect(periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const csv = [
      "date,platform,account,subject_type,subject_ref,metric_key,value,unit,source_notes",
      `${periodStart},instagram,@akun-p7,content_item,${itemId},reach,1000,akun,laporan IG Nov`,
      `${periodStart},instagram,@akun-p7,content_item,${itemId},engagements,120,interaksi,`,
    ].join("\n");
    await page.locator("#imp-csv-text").fill(csv);
    await page.getByRole("button", { name: "Impor CSV" }).click();
    await expect(page.getByText(/Impor berhasil: 2 baris metrik/)).toBeVisible({
      timeout: 30000,
    });

    await gotoWs(page, "/analitik", wsId);
    await expect(page.getByText("Lengkap")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("1.000", { exact: true }).first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("12,00 %").first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("csv:impor.csv:2")).toBeVisible({ timeout: 30000 });
  });

  test("A7.3 laporan menampilkan 5 laporan + ekspor CSV", async ({ page }) => {
    const slug = `a73-${Date.now().toString(36)}`;
    await signIn(page);
    const wsId = await setupContent(page, slug);
    await gotoWs(page, "/analitik/laporan", wsId);
    await expect(page.getByRole("heading", { name: "Laporan Analitik" })).toBeVisible();
    for (const title of [
      "Ringkasan workspace",
      "Per brand & channel",
      "Laporan campaign",
      "Performa konten",
      "Volume publishing + kepatuhan jadwal",
    ]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 30000 });
    }
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Unduh CSV" }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("mative-analytics-workspace");
  });

  test("A7.4 integrasi menampilkan adapter DISABLED + blocker", async ({ page }) => {
    const slug = `a74-${Date.now().toString(36)}`;
    await signIn(page);
    const wsId = await setupContent(page, slug);
    await gotoWs(page, "/integrasi", wsId);
    await expect(page.getByRole("heading", { name: "Integrasi", exact: true })).toBeVisible();
    await expect(page.getByText("Adapter integrasi: DISABLED")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Instagram")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("DISABLED").first()).toBeVisible({ timeout: 30000 });
    // TIDAK ADA tombol hubungkan (P1-13 — dilarang tombol palsu).
    await expect(page.getByRole("button", { name: /Hubungkan|Connect/i })).toHaveCount(0);
  });

  test.skip("A7.5 viewer_client tidak melihat analytics", async () => {
    // Butuh akun kedua sebagai viewer_client di workspace yang sama.
    // Bukti: pgTAP 07 TES 5 (6 asersi — A sebagai viewer_client di WS-B7
    // melihat 0 snapshot/metrik/campaign/event) + permissions.test.ts
    // (can(viewer_client, view_analytics) === false) + gate can() di
    // halaman /analitik, /analitik/laporan, /analitik/impor, /integrasi.
  });
});

test.describe("smoke — halaman analytics (tanpa login)", () => {
  test("halaman analitik menampilkan ajakan masuk", async ({ page }) => {
    await page.goto("/analitik");
    await expect(page.getByText("Anda belum masuk")).toBeVisible();
  });

  test("halaman integrasi menampilkan ajakan masuk", async ({ page }) => {
    await page.goto("/integrasi");
    await expect(page.getByText("Anda belum masuk")).toBeVisible();
  });
});
