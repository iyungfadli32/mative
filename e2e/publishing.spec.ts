import { test, expect } from "@playwright/test";

/**
 * Spek penerimaan Phase 6 — Publishing Foundation (P6-10).
 * Alur A6.1: buat brand → channel → konten → tambah placement → pindah
 * stage idea → editing → tab Approval → tugaskan step ke diri sendiri →
 * submit v1 → setujui v1 → Jadwalkan publikasi (segera) → antrean
 * memproses otomatis saat dimuat (worker lokal) → job Needs manual
 * action → konfirmasi manual (URL + waktu) → Published + bukti terbit.
 *
 * URUTAN WAJIB — placement DULU, approval KEMUDIAN (ASUMSI-4.6):
 * 'channel' adalah field kritis — placement baru yang ditambahkan
 * SESUDAH approval membatalkan approval itu (trigger 0014
 * check_critical_change_on_placement → request jadi
 * reapproval_required), sehingga preflight menolak dengan
 * APPROVAL_REQUIRED. Urutan lama (approve → placement → jadwalkan)
 * gagal deterministik di keempat run pertama (Chromium + mobile,
 * A6.1 + A6.2) dengan pesan preflight "Konten ini belum disetujui
 * (versi terbaru v1 belum approved)". BUKAN cacat produk — trigger
 * dan preflight bekerja sesuai desain kanonis; speknya yang salah
 * urutan. Perbaikan: pindahkan addPlacement sebelum approveV1.
 *
 * Alur A6.2/A6.3/A6.5: job terjadwal masa depan → Scheduled locally (BUKAN
 * "Scheduled (provider)"), tanpa status Published/Uploaded palsu; buat
 * ulang waktu sama diblokir preflight (duplikat); batal sebelum kirim aman.
 *
 * BUTUH database live + migrasi 0020 diterapkan + akun uji
 * (E2E_TEST_EMAIL/PASSWORD). Tes ini di-SKIP otomatis bila akun uji
 * tidak diisi. Sampai migrasi diterapkan, spek ini BELUM TERBUKTI
 * live — lihat docs/phase-6-report.md §5/§9 (batas jujur).
 * Residu tes memakai pola org-p6-[slug]/ws-p6-[slug] (dibersihkan parent sesudah run).
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
    timeout: 15000,
  });
}

/**
 * Pindah production stage idea → editing (5 langkah, tab Overview).
 * WAJIB sebelum submit approval internal: RPC 0014 hanya menerima
 * submit dari 'editing'/'internal_review' (pola approval.spec.ts).
 */
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

/** Setup org + workspace + brand + channel + konten (v1) — dipakai kedua tes. */
async function setupContent(page: import("@playwright/test").Page, slug: string) {
  await page.goto("/pengaturan/organisasi");
  await page.getByLabel("Nama organisasi").fill(`Organisasi P6 ${slug}`);
  await page.getByLabel(/Slug \(huruf kecil/).fill(`org-p6-${slug}`);
  await page.getByRole("button", { name: "Buat organisasi" }).click();
  await expect(page.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
  await page.getByLabel("Nama workspace").fill(`Workspace P6 ${slug}`);
  await page.getByLabel("Slug", { exact: true }).fill(`ws-p6-${slug}`);
  await page.getByRole("button", { name: "Buat workspace" }).click();
  await expect(page.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });

  await page.goto("/merek");
  await expect(page.getByRole("heading", { name: "Merek" })).toBeVisible();
  await page.locator("#brand-name-new").fill(`Brand P6 ${slug}`);
  await page.locator("#brand-slug-new").fill(`brand-p6-${slug}`);
  await page.getByRole("button", { name: "Buat brand" }).click();
  await expect(page.getByText("Brand dibuat.", { exact: true })).toBeVisible({ timeout: 30000 });

  await page.goto("/channel");
  await expect(page.getByRole("heading", { name: "Channel", exact: true })).toBeVisible();
  const channelSummary = page.getByText(`Tambah channel untuk Brand P6 ${slug}`);
  await channelSummary.waitFor({ state: "attached", timeout: 30000 });
  await channelSummary.click();
  const channelDetails = page.locator("details", { has: channelSummary });
  await channelDetails.getByLabel("Platform").selectOption("instagram");
  await channelDetails.getByLabel("Nama akun").fill(`Akun IG P6 ${slug}`);
  await channelDetails.getByRole("button", { name: "Tambah channel" }).click();
  await expect(page.getByText("Channel dicatat sebagai metadata (belum terhubung).")).toBeVisible({
    timeout: 30000,
  });

  await page.goto("/konten/baru");
  await expect(page.getByRole("heading", { name: "Buat konten" })).toBeVisible();
  await page.getByLabel(/Brand/).selectOption({ label: `Brand P6 ${slug}` });
  await page.getByLabel("Judul konten").fill(`Konten P6 ${slug}`);
  await page.getByLabel("Ringkasan perubahan (wajib — tercatat di versi)").fill("Versi awal (v1)");
  await page.getByRole("button", { name: "Buat konten (v1)" }).click();
  await expect(page.getByText("Konten dibuat beserta versi v1.")).toBeVisible({ timeout: 30000 });
}

/** Buka halaman detail konten dari daftar /konten. */
async function openContentDetail(page: import("@playwright/test").Page, slug: string) {
  await page.goto("/konten");
  await page.getByRole("link", { name: `Konten P6 ${slug}` }).click();
  await expect(page.getByRole("heading", { name: `Konten P6 ${slug}` })).toBeVisible();
}

/** Setujui v1: walk ke editing → tugaskan step ke diri sendiri → submit → setujui. */
async function approveV1(page: import("@playwright/test").Page, slug: string) {
  await openContentDetail(page, slug);
  await walkToEditing(page);
  await page.getByRole("tab", { name: "Approval" }).click();
  await expect(page.getByText("Belum ada request approval aktif")).toBeVisible({
    timeout: 30000,
  });
  // Workspace baru hanya punya 1 member (owner): opsi index 0 =
  // "— Tidak ditugaskan —", index 1 = owner (pola approval.spec.ts).
  const assignForm = page.locator("form", { has: page.getByText("Simpan penugasan") });
  await assignForm.locator('select[name="assigneeUserId"]').selectOption({ index: 1 });
  await assignForm.getByRole("button", { name: "Simpan penugasan" }).click();
  await expect(page.getByText("Penugasan step workflow disimpan.")).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Ajukan v1 untuk approval" }).click();
  await expect(page.getByText("Konten diajukan untuk approval")).toBeVisible({ timeout: 30000 });
  const decisionForm = page.locator("form", { has: page.getByText("Keputusan Anda") });
  await expect(decisionForm.getByLabel("Minta revisi", { exact: true })).toBeVisible();
  // Keputusan default = setujui (tanpa memilih "Minta revisi").
  await decisionForm.getByRole("button", { name: "Kirim keputusan" }).click();
  await expect(page.getByText("Disetujui • review internal")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Status produksi: approved")).toBeVisible({ timeout: 30000 });
}

/** Tambah placement Instagram di tab Platform placements. */
async function addPlacement(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: "Platform placements" }).click();
  const placementDetails = page.locator("details", {
    has: page.locator("summary", { hasText: "Tambah placement" }),
  });
  await placementDetails.locator("summary", { hasText: "Tambah placement" }).click();
  await placementDetails.locator('select[name="socialChannelId"]').selectOption({ index: 1 });
  await placementDetails.getByLabel("Caption per channel").fill("Caption IG P6");
  await placementDetails.getByRole("button", { name: "Tambah placement" }).click();
  await expect(page.getByText("Placement ditambahkan (versi v1).")).toBeVisible({
    timeout: 30000,
  });
}

test.describe("penerimaan Phase 6 — publishing manual @needs-db", () => {
  test.skip(!hasTestAccount, "Butuh akun uji (E2E_TEST_EMAIL/PASSWORD) + migrasi 0020 live.");

  test("A6.1 jadwalkan segera → handoff manual → konfirmasi → Published + bukti", async ({
    page,
  }) => {
    test.setTimeout(300000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `p6-${Date.now().toString(36)}`;

    await setupContent(page, slug);
    // Placement SEBELUM approval (ASUMSI-4.6 — lihat header file).
    await openContentDetail(page, slug);
    await addPlacement(page);
    await approveV1(page, slug);

    // Buat job segera (jadwal dikosongkan → Ready) dari tautan placement
    // (tautan ada di kartu placement, tab Platform placements).
    await page.getByRole("tab", { name: "Platform placements" }).click();
    await page.getByRole("link", { name: "Jadwalkan publikasi" }).click();
    await expect(page.getByRole("heading", { name: "Buat job publikasi" })).toBeVisible();
    await expect(page.getByText("Preflight lolos — job bisa dibuat.")).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Buat job publikasi" }).click();
    await expect(page.getByText("Job publikasi dibuat — siap dipublikasikan manual.")).toBeVisible({
      timeout: 30000,
    });

    // Antrean memproses otomatis saat dimuat (worker lokal): job segera
    // jatuh tempo → diserahkan ke aksi manual.
    await page.goto("/publishing");
    await expect(page.getByRole("heading", { name: "Publishing" })).toBeVisible();
    await expect(page.getByText("Perlu perhatian")).toBeVisible();
    const card = page.locator("article", { hasText: `Konten P6 ${slug}` }).first();
    await expect(card.getByText("Needs manual action")).toBeVisible({ timeout: 30000 });

    // Detail job: riwayat handoff + konfirmasi manual.
    await card.getByRole("link", { name: `Konten P6 ${slug}` }).click();
    await expect(page.getByRole("heading", { name: "Detail job publikasi" })).toBeVisible();
    await expect(page.getByText("Riwayat pemrosesan (1)")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Diserahkan ke manual")).toBeVisible();
    await page.getByLabel("URL publikasi").fill("https://www.instagram.com/p/p6e2e123/");
    await page.getByRole("button", { name: "Konfirmasi sudah terbit" }).click();
    await expect(
      page.getByText(
        "Publikasi dikonfirmasi manual — status Published (konfirmasi pengguna, bukan provider).",
      ),
    ).toBeVisible({ timeout: 30000 });

    // Bukti terbit tampil + persist sesudah reload.
    await expect(page.getByText("Bukti terbit (konfirmasi manual)")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "https://www.instagram.com/p/p6e2e123/" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("Published").first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Bukti terbit (konfirmasi manual)")).toBeVisible();

    // Placement di halaman konten ikut menampilkan URL terbit.
    await page.goto("/konten");
    await page.getByRole("link", { name: `Konten P6 ${slug}` }).click();
    await page.getByRole("tab", { name: "Platform placements" }).click();
    await expect(page.getByText("Terbit:")).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole("link", { name: "https://www.instagram.com/p/p6e2e123/" }),
    ).toBeVisible();
  });

  test("A6.2/A6.3/A6.5 terjadwal → Scheduled locally, tanpa status palsu; duplikat diblokir; batal aman", async ({
    page,
  }) => {
    test.setTimeout(300000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `p6b-${Date.now().toString(36)}`;

    await setupContent(page, slug);
    // Placement SEBELUM approval (ASUMSI-4.6 — lihat header file).
    await openContentDetail(page, slug);
    await addPlacement(page);
    await approveV1(page, slug);

    // Buat job terjadwal 7 hari ke depan (wall-clock; dibaca sebagai WIB).
    // Tautan "Jadwalkan publikasi" ada di kartu placement, tab Platform placements.
    await page.getByRole("tab", { name: "Platform placements" }).click();
    await page.getByRole("link", { name: "Jadwalkan publikasi" }).click();
    await expect(page.getByRole("heading", { name: "Buat job publikasi" })).toBeVisible();
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const wall = future.toISOString().slice(0, 16);
    await page.locator("#pub-scheduled-at").fill(wall);
    await page.getByRole("button", { name: "Buat job publikasi" }).click();
    await expect(
      page.getByText("Job publikasi dibuat — dijadwalkan secara lokal (bukan jadwal provider)."),
    ).toBeVisible({ timeout: 30000 });
    const newJobUrl = page.url();

    // Antrean: Scheduled locally — dan TIDAK ADA status palsu.
    await page.goto("/publishing");
    await expect(page.getByRole("heading", { name: "Publishing" })).toBeVisible();
    const card = page.locator("article", { hasText: `Konten P6 ${slug}` }).first();
    await expect(card.getByText("Scheduled locally")).toBeVisible({ timeout: 30000 });
    await expect(card.getByText("Published")).toHaveCount(0);
    await expect(page.getByText("Scheduled (provider)")).toHaveCount(0);
    await expect(page.getByText("Uploaded / Draft created")).toHaveCount(0);

    // Buat ulang waktu sama diblokir preflight (duplikat) — tombol
    // dinonaktifkan + header checklist menjelaskan alasannya.
    await page.goto(newJobUrl);
    await expect(
      page.getByText(
        "Preflight gagal: Sudah ada job aktif untuk placement ini pada waktu yang sama — batalkan dulu job itu atau pilih waktu lain.",
        { exact: true },
      ),
    ).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByRole("button", { name: "Buat job publikasi" })).toBeDisabled();

    // Batal sebelum kirim: aman, tanpa efek — job jadi Cancelled.
    await page.goto("/publishing");
    await card.getByRole("link", { name: `Konten P6 ${slug}` }).click();
    await expect(page.getByRole("heading", { name: "Detail job publikasi" })).toBeVisible();
    await page
      .getByLabel("Alasan pembatalan (wajib)")
      .fill("Jadwal berubah — dibatalkan untuk tes.");
    await page.getByRole("button", { name: "Batalkan job" }).click();
    await expect(
      page.getByText("Job dibatalkan sebelum terkirim — tanpa efek samping."),
    ).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("Cancelled").first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("Cancelled").first()).toBeVisible({ timeout: 30000 });
  });
});

test.describe("smoke — halaman publishing (tanpa login)", () => {
  test("halaman publishing menampilkan ajakan masuk", async ({ page }) => {
    await page.goto("/publishing");
    await expect(page.getByText("Anda belum masuk")).toBeVisible();
  });
});
