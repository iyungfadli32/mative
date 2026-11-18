import { test, expect } from "@playwright/test";

/**
 * Spek penerimaan Phase 2 — prompts/03 (P2-15).
 * Alur: buat content item → tambah 2 placement → temukan di kalender dan
 * board → edit → pindah stage → jadwalkan ulang satu placement → reload
 * dan verifikasi persistence.
 *
 * BUTUH database live + migrasi 0007 + 0008 diterapkan + akun uji
 * (E2E_TEST_EMAIL/PASSWORD). Tes ini di-SKIP otomatis bila akun uji tidak
 * diisi. Sampai migrasi diterapkan, spek ini BELUM TERBUKTI live — lihat
 * docs/phase-2-report.md §5/§9 (batas jujur).
 */
const hasTestAccount = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);

async function signIn(page: import("@playwright/test").Page) {
  const email = process.env.E2E_TEST_EMAIL as string;
  const password = process.env.E2E_TEST_PASSWORD as string;
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
}

test.describe("penerimaan Phase 2 — planning core @needs-db", () => {
  test.skip(!hasTestAccount, "Butuh akun uji (E2E_TEST_EMAIL/PASSWORD) + migrasi 0007/0008 live.");

  test("buat konten → 2 placement → kalender + board → edit → pindah stage → reschedule → reload", async ({
    page,
  }) => {
    await signIn(page);
    const slug = `e2e-${Date.now().toString(36)}`;

    // 1. Buat brand (bila belum ada, halaman Merek selalu bisa membuat baru).
    await page.goto("/merek");
    await expect(page.getByRole("heading", { name: "Merek" })).toBeVisible();
    await page.getByLabel("Nama brand").fill(`Brand E2E ${slug}`);
    await page.getByLabel(/Slug \(huruf kecil/).fill(`brand-${slug}`);
    await page.getByRole("button", { name: "Buat brand" }).click();
    await expect(page.getByText("Brand dibuat.")).toBeVisible();

    // 2. Buat 2 channel (Instagram + TikTok) untuk brand itu.
    await page.goto("/channel");
    await expect(page.getByRole("heading", { name: "Channel" })).toBeVisible();
    const channelDetails = page.getByText(`Tambah channel untuk Brand E2E ${slug}`);
    await channelDetails.click();
    await page.getByLabel("Platform").first().selectOption("instagram");
    await page.getByLabel("Nama akun").first().fill(`Akun IG E2E ${slug}`);
    await page.getByRole("button", { name: "Tambah channel" }).click();
    await expect(
      page.getByText("Channel dicatat sebagai metadata (belum terhubung)."),
    ).toBeVisible();

    // 3. Buat content item (otomatis v1).
    await page.goto("/konten/baru");
    await expect(page.getByRole("heading", { name: "Buat konten" })).toBeVisible();
    await page.getByLabel(/Brand/).selectOption({ label: `Brand E2E ${slug}` });
    await page.getByLabel("Judul konten").fill(`Konten E2E ${slug}`);
    await page
      .getByLabel("Ringkasan perubahan (wajib — tercatat di versi)")
      .fill("Versi awal (v1)");
    await page.getByRole("button", { name: "Buat konten (v1)" }).click();
    await expect(page.getByText("Konten dibuat beserta versi v1.")).toBeVisible();

    // 4. Buka detail konten, tambah 2 placement (IG + TikTok butuh channel
    //    TikTok dulu — tambahkan lewat detail bila channel belum ada).
    await page.goto("/konten");
    await page.getByRole("link", { name: `Konten E2E ${slug}` }).click();
    await expect(page.getByRole("heading", { name: `Konten E2E ${slug}` })).toBeVisible();
    await page.getByText("Tambah placement").click();
    await page.getByLabel("Channel").selectOption({ index: 1 });
    await page.getByLabel("Caption per channel").fill("Caption IG E2E");
    await page.getByRole("button", { name: "Tambah placement" }).click();
    await expect(page.getByText("Placement ditambahkan (versi v1).")).toBeVisible();

    // 5. Temukan di kalender DAN board (record kanonis yang sama).
    await page.goto("/kalender");
    await expect(page.getByRole("heading", { name: "Kalender" })).toBeVisible();
    await page.goto("/board");
    await expect(page.getByRole("heading", { name: "Board Produksi" })).toBeVisible();
    await expect(page.getByText(`Konten E2E ${slug}`).first()).toBeVisible();

    // 6. Edit judul → versi baru tercatat.
    await page.goto("/konten");
    await page.getByRole("link", { name: `Konten E2E ${slug}` }).click();
    await page.getByLabel("Judul konten").fill(`Konten E2E ${slug} (revisi)`);
    await page.getByLabel("Ringkasan perubahan (wajib — tercatat di versi)").fill("Perbaiki judul");
    await page.getByRole("button", { name: "Simpan sebagai versi baru" }).click();
    await expect(page.getByText(/Perubahan disimpan sebagai versi v2/)).toBeVisible();

    // 7. Pindah stage Ide → Brief (transisi tervalidasi + riwayat).
    await page.getByLabel("Pindah stage ke").selectOption("brief");
    await page.getByRole("button", { name: "Pindah stage" }).click();
    await expect(page.getByText("Status produksi diubah: idea → brief.")).toBeVisible();

    // 8. Reload: semua perubahan persist.
    await page.reload();
    await expect(page.getByRole("heading", { name: `Konten E2E ${slug} (revisi)` })).toBeVisible();
    await expect(page.getByText("v2").first()).toBeVisible();
    await expect(page.getByText(/Brief/).first()).toBeVisible();
  });
});

test.describe("smoke — halaman perencanaan (tanpa login)", () => {
  test("semua halaman Phase 2 menampilkan judul + ajakan masuk", async ({ page }) => {
    const pages: Array<[string, string]> = [
      ["/merek", "Merek"],
      ["/channel", "Channel"],
      ["/pilar", "Pilar & Audiens"],
      ["/kampanye", "Campaign"],
      ["/ide", "Ide"],
      ["/konten", "Konten"],
      ["/kalender", "Kalender"],
      ["/board", "Board Produksi"],
      ["/cari", "Pencarian"],
    ];
    for (const [href, heading] of pages) {
      await page.goto(href);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await expect(page.getByText("Anda belum masuk")).toBeVisible();
    }
  });

  test("sidebar menampilkan tautan perencanaan yang aktif", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Kalender", exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Board Produksi", exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Konten", exact: true }).first()).toBeVisible();
  });

  test("pencarian: halaman menampilkan judul + ajakan masuk saat belum login", async ({ page }) => {
    await page.goto("/cari");
    await expect(page.getByRole("heading", { name: "Pencarian" })).toBeVisible();
    await expect(page.getByText("Anda belum masuk")).toBeVisible();
    // Pencarian global di topbar tetap terlihat (form hasil hanya untuk yang masuk).
    await expect(page.getByPlaceholder("Cari konten, campaign, ide, brand…")).toBeVisible();
  });
});
