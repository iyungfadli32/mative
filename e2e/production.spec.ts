import { test, expect } from "@playwright/test";

/**
 * Spek penerimaan Phase 3 — prompts/04 (P3-12).
 * Alur: buat brand → ide → konversi jadi konten (pilih brand di form
 * konversi) → brief terstruktur (versi baru) → task ditugaskan → aset
 * diunggah + dilampirkan → komentar di editor → bandingkan + pulihkan
 * versi → reload dan verifikasi persistence.
 *
 * BUTUH database live + migrasi 0009 + 0010 + 0011 + 0012 diterapkan +
 * akun uji (E2E_TEST_EMAIL/PASSWORD). Tes ini di-SKIP otomatis bila akun
 * uji tidak diisi. Sampai migrasi diterapkan, spek ini BELUM TERBUKTI
 * live — lihat docs/phase-3-report.md §5/§9 (batas jujur).
 *
 * CATATAN 0012 (2026-11-19): content_items.brand_id NOT NULL (0007 DDL,
 * Dok 05 §3, ERD §5) — ide tanpa brand TIDAK BISA dikonversi sebelum
 * brand dipilih. Karena itu alur ini membuat brand dulu, menangkap ide
 * TANPA brand, lalu memilih brand di form konversi ("Brand (wajib untuk
 * konversi)") sebelum klik "Konversi menjadi konten".
 */
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

// PNG 1x1 transparan (buffer di memori — tanpa file di disk).
const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("penerimaan Phase 3 — production operations @needs-db", () => {
  test.skip(!hasTestAccount, "Butuh akun uji (E2E_TEST_EMAIL/PASSWORD) + migrasi 0009–0012 live.");

  test("ide → brief → task → aset → komentar → versi → reload", async ({ page }) => {
    // Semua expect di tes ini memakai 30 dtk (bukan default 5 dtk):
    // render halaman + round-trip aksi server ke Supabase dari VM ini
    // kerap >5 dtk (pola planning.spec.ts 2026-11-19). Timeout tes
    // 240 dtk karena total alur live-DB ini ~60–120 dtk.
    test.setTimeout(240000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `p3-${Date.now().toString(36)}`;

    // 0a. Setup: akun uji baru belum punya organisasi/workspace — tanpa
    //     workspace, /merek menampilkan empty state "Belum ada workspace"
    //     dan form brand tidak ada (bukan defect aplikasi; tes harus
    //     mandiri). Buat org + workspace dulu (pola auth.spec.ts).
    await page.goto("/pengaturan/organisasi");
    await page.getByLabel("Nama organisasi").fill(`Organisasi P3 ${slug}`);
    await page.getByLabel(/Slug \(huruf kecil/).fill(`org-p3-${slug}`);
    await page.getByRole("button", { name: "Buat organisasi" }).click();
    await expect(page.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
    await page.getByLabel("Nama workspace").fill(`Workspace P3 ${slug}`);
    await page.getByLabel("Slug", { exact: true }).fill(`ws-p3-${slug}`);
    await page.getByRole("button", { name: "Buat workspace" }).click();
    await expect(page.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });

    // 0b. Template default: dibuat LAZY saat /template-brief dibuka oleh
    //     owner (desain — bukan defect). Tanpa kunjungan ini, tab Brief
    //     menampilkan "Belum ada template brief default di workspace ini"
    //     dan alur berhenti. Kunjungan ini memakai workspace yang sama
    //     dengan halaman lain (workspace pertama akun), jadi tanpa
    //     switcher — switcher justru membuat template nyasar ke
    //     workspace baru.
    await page.goto("/template-brief");
    await expect(page.getByRole("heading", { name: "Template Brief" })).toBeVisible();
    await expect(page.getByText("Template Brief Standar").first()).toBeVisible({
      timeout: 30000,
    });

    // 0. Buat brand dulu — konversi wajib punya brand (0012).
    // Lokator form buat-baru sama seperti planning.spec.ts:
    // #brand-name-new / #brand-slug-new (getByLabel ambigu bila sudah
    // ada brand lain).
    await page.goto("/merek");
    await expect(page.getByRole("heading", { name: "Merek" })).toBeVisible();
    await page.locator("#brand-name-new").fill(`Brand P3 ${slug}`);
    await page.locator("#brand-slug-new").fill(`brand-p3-${slug}`);
    await page.getByRole("button", { name: "Buat brand" }).click();
    // WAJIB exact: true — getByText tanpa exact cocok dengan hint statis
    // "Slug tidak bisa diubah setelah brand dibuat." (BrandForm.tsx:44),
    // sehingga wait lolos instan SEBELUM insert selesai (cacat e2e 2026-11-19).
    await expect(page.getByText("Brand dibuat.", { exact: true })).toBeVisible({ timeout: 30000 });

    // 1. Tangkap ide di inbox (TANPA brand — menguji jalur 0012: brand
    // dipilih belakangan, di form konversi).
    await page.goto("/ide");
    await expect(page.getByRole("heading", { name: "Ide", exact: true })).toBeVisible();
    await page.getByLabel("Judul ide").fill(`Ide P3 ${slug}`);
    await page.getByRole("button", { name: "Tangkap ide" }).click();
    await expect(page.getByText(`Ide P3 ${slug}`).first()).toBeVisible({ timeout: 30000 });

    // 2. Konversi ide → konten (RPC 0012, satu transaksi): pilih brand di
    // form konversi dulu, baru klik konversi.
    // Brand baru kadang belum muncul di select konversi pada pemuatan
    // pertama (stale sesaat setelah mutasi — pola planning.spec.ts);
    // muat ulang sekali bila opsi belum ada.
    const convertSelect = page.getByLabel("Brand (wajib untuk konversi)").first();
    try {
      await convertSelect
        .locator(`option:has-text("Brand P3 ${slug}")`)
        .waitFor({ state: "attached", timeout: 10000 });
    } catch {
      await page.reload();
    }
    await convertSelect.selectOption({ label: `Brand P3 ${slug}` });
    await page.getByRole("button", { name: "Konversi menjadi konten" }).first().click();
    await expect(page.getByText("Ide dikonversi menjadi konten baru (v1).")).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("link", { name: "Lihat konten →" }).first().click();
    await expect(page.getByRole("heading", { name: `Ide P3 ${slug}` })).toBeVisible({
      timeout: 30000,
    });

    // 3. Tab Brief: isi brief terstruktur → versi baru (v2).
    await page.getByRole("tab", { name: "Brief" }).click();
    await expect(page.getByText("Template: Template Brief Standar")).toBeVisible({
      timeout: 30000,
    });
    await page.getByLabel("Tujuan konten (wajib)").fill(`Tujuan P3 ${slug}`);
    await page.getByLabel("Audiens").fill("Pemilik usaha kecil");
    await page.getByLabel("Sudut pandang").fill("Praktis dan jujur");
    await page
      .getByLabel("Ringkasan perubahan (wajib — tercatat di versi baru)")
      .fill("Brief awal");
    await page.getByRole("button", { name: "Simpan brief (versi baru)" }).click();
    await expect(page.getByText(/Brief disimpan sebagai versi v2/)).toBeVisible({
      timeout: 30000,
    });

    // 4. Tab Task: buat task (tanpa assignee — e2e user adalah owner,
    //    boleh menugaskan ke siapa pun; kosong = belum ditugaskan).
    await page.getByRole("tab", { name: "Task" }).click();
    await page.getByLabel("Judul task").fill(`Task P3 ${slug}`);
    await page.getByRole("button", { name: "Buat task" }).click();
    await expect(page.getByText("Task dibuat.", { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(`Task P3 ${slug}`).first()).toBeVisible({ timeout: 30000 });

    // 5. Pindah status task todo → in_progress (mesin RPC 0010).
    await page.getByLabel("Pindah status ke").selectOption("in_progress");
    await page.getByRole("button", { name: "Pindah status" }).click();
    await expect(page.getByText("Status task diubah.")).toBeVisible({ timeout: 30000 });

    // 6. Unggah aset PNG 1x1 lalu lampirkan ke konten. PERHATIAN: upload
    //    HANYA ada di /pustaka — tab Media hanya melampirkan (teksnya:
    //    "Unggah aset baru lewat Pustaka Aset"). Jadi: buka tab Media,
    //    ikuti tautan "Pustaka Aset" di tab itu (membawa ?workspace= yang
    //    benar), unggah di sana, kembali, lalu lampirkan di tab Media.
    await page.getByRole("tab", { name: "Media" }).click();
    await page
      .locator("main")
      .getByRole("link", { name: "Pustaka Aset" })
      .click();
    await expect(page.getByRole("heading", { name: "Pustaka Aset" })).toBeVisible();
    await page.getByLabel(/Pilih file \(PNG, JPEG, WebP, MP4, WebM, PDF/).setInputFiles({
      name: `aset-p3-${slug}.png`,
      mimeType: "image/png",
      buffer: ONE_BY_ONE_PNG,
    });
    await page.getByRole("button", { name: "Unggah aset" }).click();
    await expect(page.getByText("Aset diunggah.")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(`aset-p3-${slug}.png`).first()).toBeVisible({ timeout: 30000 });
    await page.goBack();
    await expect(page.getByRole("heading", { name: `Ide P3 ${slug}` })).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("tab", { name: "Media" }).click();
    await page.getByLabel("Aset").selectOption({ label: `aset-p3-${slug}.png (image/png)` });
    await page.getByRole("button", { name: "Lampirkan aset" }).click();
    await expect(page.getByText("Aset dilampirkan ke konten.")).toBeVisible({ timeout: 30000 });

    // 7. Tab Komentar: kirim komentar (tanpa mention — mention opsional).
    await page.getByRole("tab", { name: "Komentar" }).click();
    await page.getByPlaceholder("Tulis komentar…").fill(`Komentar P3 ${slug}`);
    await page.getByRole("button", { name: "Kirim komentar" }).click();
    await expect(page.getByText("Komentar dikirim.")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(`Komentar P3 ${slug}`).first()).toBeVisible({ timeout: 30000 });

    // 8. Tab Versi: bandingkan v2 vs v1, lalu pulihkan v1 → versi baru.
    await page.getByRole("tab", { name: "Versi" }).click();
    await expect(page.getByText("v2", { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "Pulihkan v1 sebagai versi baru" }).click();
    await expect(page.getByText(/Versi v1 dipulihkan sebagai versi v3/)).toBeVisible({
      timeout: 30000,
    });

    // 9. Reload: semua relasi persist.
    await page.reload();
    await expect(page.getByRole("heading", { name: `Ide P3 ${slug}` })).toBeVisible();
    await page.getByRole("tab", { name: "Task" }).click();
    await expect(page.getByText(`Task P3 ${slug}`).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Dikerjakan").first()).toBeVisible();
    await page.getByRole("tab", { name: "Media" }).click();
    await expect(page.getByText(`aset-p3-${slug}.png`).first()).toBeVisible({ timeout: 30000 });
    await page.getByRole("tab", { name: "Komentar" }).click();
    await expect(page.getByText(`Komentar P3 ${slug}`).first()).toBeVisible({ timeout: 30000 });

    // 10. Halaman Task Center + Pustaka + Template Brief menampilkan hasil.
    //     Task Center default di tab "Tugas Saya" — task tes TIDAK ditugaskan
    //     ke siapa pun saat dibuat (langkah 5), jadi ia hanya muncul di tab
    //     "Semua Task". Buka tab itu dulu sebelum memeriksa judulnya.
    await page.goto("/tugas");
    await page.getByRole("tab", { name: /Semua Task/ }).click();
    await expect(page.getByText(`Task P3 ${slug}`).first()).toBeVisible({ timeout: 30000 });
    await page.goto("/pustaka");
    await expect(page.getByText(`aset-p3-${slug}.png`).first()).toBeVisible({ timeout: 30000 });
    await page.goto("/template-brief");
    await expect(page.getByText("Template Brief Standar")).toBeVisible({ timeout: 30000 });
  });
});

test.describe("smoke — halaman Phase 3 (tanpa login)", () => {
  test("semua halaman Phase 3 menampilkan judul + ajakan masuk", async ({ page }) => {
    const pages: Array<[string, string]> = [
      ["/tugas", "Tugas Saya"],
      ["/pustaka", "Pustaka Aset"],
      ["/template-brief", "Template Brief"],
    ];
    for (const [href, heading] of pages) {
      await page.goto(href);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await expect(page.getByText("Anda belum masuk")).toBeVisible();
    }
  });

  test("sidebar menampilkan tautan produksi yang aktif", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Tugas Saya", exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Pustaka Aset", exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Template Brief", exact: true }).first(),
    ).toBeVisible();
  });
});
