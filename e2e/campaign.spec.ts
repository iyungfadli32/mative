/**
 * Spek penerimaan Phase 5 — Campaign & Visual Planning (A5.1 + A5.3 + A5.5).
 * Alur: buat campaign → tautkan konten → progres terhitung → transisi
 * status → simpan template (A5.1); visual planner: urutan diubah,
 * scheduled_at TIDAK BERUBAH (A5.3); ekspor CSV → impor kembali dengan
 * 1 baris valid + 1 baris tidak valid (A5.5).
 *
 * BUTUH database live + migrasi 0016 + 0017 diterapkan + akun uji
 * (E2E_TEST_EMAIL/PASSWORD). Tes ini di-SKIP otomatis bila akun uji tidak
 * diisi. Sampai migrasi diterapkan, spek ini BELUM TERBUKTI live — lihat
 * docs/phase-5-report.md §8/§9 (batas jujur).
 * Residue pembersihan: org-p5-* / ws-p5-* (lihat docs/phase-5-report.md §8).
 */
import fs from "node:fs";
import { test, expect } from "@playwright/test";

const hasTestAccount = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);

async function signIn(page: import("@playwright/test").Page) {
  const email = process.env.E2E_TEST_EMAIL as string;
  const password = process.env.E2E_TEST_PASSWORD as string;
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible({
    timeout: 15000,
  });
}

async function setupWorkspace(page: import("@playwright/test").Page, slug: string) {
  await page.goto("/pengaturan/organisasi");
  await page.getByLabel("Nama organisasi").fill(`Organisasi E2E ${slug}`);
  await page.getByLabel(/Slug \(huruf kecil/).fill(`org-p5-${slug}`);
  await page.getByRole("button", { name: "Buat organisasi" }).click();
  await expect(page.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
  await page.getByLabel("Nama workspace").fill(`Workspace E2E ${slug}`);
  await page.getByLabel("Slug", { exact: true }).fill(`ws-p5-${slug}`);
  await page.getByRole("button", { name: "Buat workspace" }).click();
  await expect(page.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });
}

async function createBrandAndChannel(page: import("@playwright/test").Page, slug: string) {
  await page.goto("/merek");
  await expect(page.getByRole("heading", { name: "Merek" })).toBeVisible();
  await page.locator("#brand-name-new").fill(`Brand E2E ${slug}`);
  await page.locator("#brand-slug-new").fill(`brand-${slug}`);
  await page.getByRole("button", { name: "Buat brand" }).click();
  await expect(page.getByText("Brand dibuat.", { exact: true })).toBeVisible({ timeout: 30000 });
  await page.goto("/channel");
  await expect(page.getByRole("heading", { name: "Channel", exact: true })).toBeVisible();
  const channelSummary = page.getByText(`Tambah channel untuk Brand E2E ${slug}`);
  try {
    await channelSummary.waitFor({ state: "attached", timeout: 10000 });
  } catch {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Channel", exact: true })).toBeVisible();
    await channelSummary.waitFor({ state: "attached", timeout: 15000 });
  }
  await channelSummary.click();
  const channelDetails = page.locator("details", { has: channelSummary });
  await channelDetails.getByLabel("Platform").selectOption("instagram");
  await channelDetails.getByLabel("Nama akun").fill(`Akun IG E2E ${slug}`);
  await channelDetails.getByRole("button", { name: "Tambah channel" }).click();
  await expect(page.getByText("Channel dicatat sebagai metadata (belum terhubung).")).toBeVisible({
    timeout: 30000,
  });
}

async function createCampaign(
  page: import("@playwright/test").Page,
  slug: string,
  campaignName: string,
) {
  await page.goto("/kampanye");
  await expect(page.getByRole("heading", { name: "Campaign" })).toBeVisible();
  await page.getByLabel("Nama campaign").fill(campaignName);
  await page.getByLabel("Tujuan (objective)").fill("Tujuan E2E Phase 5");
  await page.locator("#campaign-target-deliverables").fill("5");
  await page.locator("#campaign-target-date").fill("2026-12-31");
  await page.getByLabel("Catatan target").fill("Catatan target E2E");
  await page.getByLabel(`Brand E2E ${slug}`).check();
  await page.getByRole("button", { name: "Buat campaign" }).click();
  await expect(page.getByText("Campaign dibuat.", { exact: true })).toBeVisible({ timeout: 30000 });
}

async function createContent(
  page: import("@playwright/test").Page,
  slug: string,
  contentTitle: string,
) {
  await page.goto("/konten/baru");
  await expect(page.getByRole("heading", { name: "Buat konten" })).toBeVisible();
  await page.getByLabel(/Brand/).selectOption({ label: `Brand E2E ${slug}` });
  await page.getByLabel("Judul konten").fill(contentTitle);
  await page.getByLabel("Ringkasan perubahan (wajib — tercatat di versi)").fill("Versi awal (v1)");
  await page.getByRole("button", { name: "Buat konten (v1)" }).click();
  await expect(page.getByText("Konten dibuat beserta versi v1.")).toBeVisible({ timeout: 30000 });
}

test.describe("penerimaan Phase 5 — campaign & visual planning @needs-db", () => {
  test.skip(!hasTestAccount, "Butuh akun uji (E2E_TEST_EMAIL/PASSWORD) + migrasi 0016/0017 live.");

  test("A5.1 campaign → tautkan konten → progres → transisi → template", async ({ page }) => {
    test.setTimeout(240000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `p5a-${Date.now().toString(36)}`;
    const campaignName = `Campaign E2E ${slug}`;
    const contentTitle = `Konten E2E ${slug}`;
    await setupWorkspace(page, slug);
    await createBrandAndChannel(page, slug);
    await createCampaign(page, slug, campaignName);

    // Detail campaign: progres 0 dari 0, target 3 field tampil.
    await page.getByRole("link", { name: campaignName }).click();
    await expect(page.getByRole("heading", { name: campaignName })).toBeVisible();
    await expect(page.getByText("Siap tayang (approved): 0 dari 0 deliverable")).toBeVisible();
    await expect(page.getByText("Target: 5 deliverable")).toBeVisible();

    // Tautkan konten → deliverable muncul, progres 0 dari 1.
    await createContent(page, slug, contentTitle);
    await page.goto("/kampanye");
    await page.getByRole("link", { name: campaignName }).click();
    await page
      .getByLabel("Konten yang ditautkan")
      .selectOption({ label: `${contentTitle} — Brand E2E ${slug}` });
    await page.getByRole("button", { name: "Tautkan konten" }).click();
    await expect(page.getByText("Konten ditautkan ke campaign.")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Siap tayang (approved): 0 dari 1 deliverable")).toBeVisible();
    await expect(page.getByRole("link", { name: contentTitle })).toBeVisible();

    // Transisi draft → active (alasan tidak wajib untuk active).
    await page.getByLabel("Ubah status menjadi").selectOption("active");
    await page.getByRole("button", { name: "Ubah status" }).click();
    await expect(page.getByText("Status campaign diubah menjadi active.")).toBeVisible({
      timeout: 30000,
    });

    // Simpan sebagai template → tampil di /template.
    await page.getByLabel("Nama template").fill(`${campaignName} (template)`);
    await page.getByRole("button", { name: "Simpan sebagai template" }).click();
    await expect(page.getByText("Template campaign disimpan.")).toBeVisible({ timeout: 30000 });
    await page.goto("/template");
    await expect(page.getByRole("heading", { name: "Template" })).toBeVisible();
    await expect(page.getByText(`${campaignName} (template)`)).toBeVisible();
  });

  test("A5.3 visual planner: urutan diubah, scheduled_at TIDAK BERUBAH", async ({ page }) => {
    test.setTimeout(240000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `p5b-${Date.now().toString(36)}`;
    const campaignName = `Campaign E2E ${slug}`;
    const contentTitle = `Konten E2E ${slug}`;
    await setupWorkspace(page, slug);
    await createBrandAndChannel(page, slug);
    await createCampaign(page, slug, campaignName);
    await createContent(page, slug, contentTitle);

    // Placement dengan jadwal 10 Des 2026 10:00.
    await page.goto("/konten");
    await page.getByRole("link", { name: contentTitle }).click();
    await expect(page.getByRole("heading", { name: contentTitle })).toBeVisible();
    await page.getByRole("tab", { name: "Platform placements" }).click();
    const placementDetails = page.locator("details", {
      has: page.locator("summary", { hasText: "Tambah placement" }),
    });
    await placementDetails.locator("summary", { hasText: "Tambah placement" }).click();
    await placementDetails.locator('select[name="socialChannelId"]').selectOption({ index: 1 });
    await placementDetails
      .getByLabel("Jadwal tayang (opsional — kosong = backlog)")
      .fill("2026-12-10T10:00");
    await placementDetails.getByLabel("Caption per channel").fill("Caption IG E2E");
    await placementDetails.getByRole("button", { name: "Tambah placement" }).click();
    await expect(page.getByText("Placement ditambahkan (versi v1).")).toBeVisible({
      timeout: 30000,
    });

    // Tautkan konten ke campaign, lalu buka visual planner.
    await page.goto("/kampanye");
    await page.getByRole("link", { name: campaignName }).click();
    await page
      .getByLabel("Konten yang ditautkan")
      .selectOption({ label: `${contentTitle} — Brand E2E ${slug}` });
    await page.getByRole("button", { name: "Tautkan konten" }).click();
    await expect(page.getByText("Konten ditautkan ke campaign.")).toBeVisible({ timeout: 30000 });
    await page.getByRole("link", { name: `Akun IG E2E ${slug}` }).click();
    await expect(page.getByRole("heading", { name: "Visual Planner" })).toBeVisible();

    // Label "approximate" WAJIB terlihat (R5.3).
    await expect(
      page.getByText("Preview ini perkiraan tampilan feed — bukan tampilan persis platform."),
    ).toBeVisible();

    // Tambahkan placement ke urutan, catat teks barisnya (termasuk jadwal),
    // simpan, muat ulang — teks baris (dan jadwalnya) harus SAMA PERSIS.
    await page.getByRole("button", { name: "+ Tambah ke urutan" }).click();
    const row = page.locator("ol li", { hasText: contentTitle }).first();
    const beforeText = (await row.textContent()) ?? "";
    expect(beforeText).toContain("10");
    await page.getByRole("button", { name: "Simpan urutan" }).click();
    await expect(page.getByText("Jadwal (scheduled_at) tidak berubah")).toBeVisible({
      timeout: 30000,
    });
    await page.reload();
    const afterText =
      (await page.locator("ol li", { hasText: contentTitle }).first().textContent()) ?? "";
    expect(afterText).toBe(beforeText);
  });

  test("A5.5 ekspor CSV → impor kembali (1 valid + 1 tidak valid)", async ({ page }) => {
    test.setTimeout(240000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `p5c-${Date.now().toString(36)}`;
    const campaignName = `Campaign E2E ${slug}`;
    await setupWorkspace(page, slug);
    await createBrandAndChannel(page, slug);
    await createCampaign(page, slug, campaignName);

    // Ekspor: unduh file, periksa header + campaign ada di dalamnya.
    await page.goto("/kampanye");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Ekspor CSV" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const exported = fs.readFileSync(downloadPath as string, "utf8");
    expect(exported.split("\r\n")[0]).toBe(
      "name,objective,audience_name,start_at,end_at,status,owner_email,target_deliverables,target_date,notes,brands,deliverables",
    );
    expect(exported).toContain(campaignName);

    // Impor: 1 baris valid (CSV Impor) + 1 baris tidak valid (status live).
    const csvText =
      "name,objective,audience_name,start_at,end_at,status,owner_email,target_deliverables,target_date,notes,brands,deliverables\r\n" +
      `CSV Impor ${slug},Impor test,,,draft,,2,2026-12-31,catatan impor,Brand E2E ${slug},\r\n` +
      `CSV Rusak ${slug},Baris rusak,,,live,,1,,,,\r\n`;
    await page.setInputFiles('input[name="file"]', {
      name: "import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvText, "utf8"),
    });
    await page.getByRole("button", { name: "Impor CSV" }).click();
    await expect(page.getByText("Impor selesai: 1 campaign diimpor, 1 baris gagal")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(/status 'live' tidak dikenal/)).toBeVisible();
    await expect(page.getByRole("link", { name: `CSV Impor ${slug}` })).toBeVisible();
    await expect(page.getByRole("link", { name: `CSV Rusak ${slug}` })).toHaveCount(0);
  });
});

test.describe("smoke — halaman Phase 5 (tanpa login)", () => {
  test("halaman Template menampilkan judul + ajakan masuk", async ({ page }) => {
    await page.goto("/template");
    await expect(page.getByRole("heading", { name: "Template" })).toBeVisible();
    await expect(page.getByText("Anda belum masuk")).toBeVisible();
  });
});
