import { test, expect } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { randomBytes } from "node:crypto";

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

// PNG besar yang BENAR-BENAR valid (bukan padding): signature + IHDR +
// IDAT berisi scanline acak terkompresi + IEND, dengan CRC32 benar.
// Dipakai tes regresi (c) K-1: file >1 MB yang dulu ditolak batas body
// Server Action Next.js, padahal UI menjanjikan 10 MB. 850x850 RGB acak
// ≈ 2,1 MB — di atas 1 MB, di bawah 10 MB. Aplikasi hanya memvalidasi
// magic bytes + IHDR + ukuran, jadi kompresi acak (tidak terkompresi
// baik) justru yang diinginkan: ukuran berkasnya besar.
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c);
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function largePng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0; // filter: none
    randomBytes(width * 3).copy(raw, y * (1 + width * 3) + 1);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

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
    await page.locator("main").getByRole("link", { name: "Pustaka Aset" }).click();
    await expect(page.getByRole("heading", { name: "Pustaka Aset" })).toBeVisible({
    timeout: 30000,
  });
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

  test("unggah aset ~2 MB lewat signed URL berhasil (regresi (c) K-1)", async ({ page }) => {
    // Alur signed URL: prepare → PUT langsung ke Storage → confirm.
    // File TIDAK PERNAH lewat Server Action, jadi batas body Next.js
    // 1 MB tidak berlaku; janji "maks 10 MB" di UI kini benar. Tes
    // file kecil (PNG 1x1) tetap ada di tes utama di atas.
    test.setTimeout(240000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `p3-2mb-${Date.now().toString(36)}`;

    // Setup mandiri: org + workspace baru (pola yang sama seperti tes
    // utama — akun uji baru belum punya workspace).
    await page.goto("/pengaturan/organisasi");
    await page.getByLabel("Nama organisasi").fill(`Organisasi P3 2MB ${slug}`);
    await page.getByLabel(/Slug \(huruf kecil/).fill(`org-p3-2mb-${slug}`);
    await page.getByRole("button", { name: "Buat organisasi" }).click();
    await expect(page.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
    await page.getByLabel("Nama workspace").fill(`Workspace P3 2MB ${slug}`);
    await page.getByLabel("Slug", { exact: true }).fill(`ws-p3-2mb-${slug}`);
    await page.getByRole("button", { name: "Buat workspace" }).click();
    await expect(page.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });

    // Sanity: berkas uji memang di atas 1 MB (batas lama) dan di bawah
    // 10 MB (batas janji). Bila generator berubah, tes ini gagal di
    // sini — bukan di aplikasi — supaya alasannya jelas.
    const bigPng = largePng(850, 850);
    expect(bigPng.length).toBeGreaterThan(1024 * 1024);
    expect(bigPng.length).toBeLessThanOrEqual(10 * 1024 * 1024);

    await page.goto("/pustaka");
    await expect(page.getByRole("heading", { name: "Pustaka Aset" })).toBeVisible({
    timeout: 30000,
  });
    await page.getByLabel(/Pilih file \(PNG, JPEG, WebP, MP4, WebM, PDF/).setInputFiles({
      name: `aset-2mb-${slug}.png`,
      mimeType: "image/png",
      buffer: bigPng,
    });
    await page.getByRole("button", { name: "Unggah aset" }).click();
    await expect(page.getByText("Aset diunggah.")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(`aset-2mb-${slug}.png`).first()).toBeVisible({ timeout: 30000 });

    // Reload: aset ~2 MB persist sebagai 'ready' (bukan 'uploading').
    await page.reload();
    await expect(page.getByText(`aset-2mb-${slug}.png`).first()).toBeVisible({ timeout: 30000 });
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
    // Mobile: sidebar disembunyikan < md SESUAI DESAIN (Dok 02 §2) — ketiga
    // tautan diperiksa di halaman /lainnya sebagai gantinya.
    if (test.info().project.name === "mobile") {
      await page.goto("/lainnya");
      // Nama aksesibel tautan /lainnya = label + deskripsi — tanpa exact,
      // dilingkupi ke <main> supaya tautan sidebar tersembunyi tidak ikut
      // tercocok.
      await expect(page.getByRole("main").getByRole("link", { name: /^Tugas Saya/ })).toBeVisible();
      await expect(
        page.getByRole("main").getByRole("link", { name: /^Pustaka Aset/ }),
      ).toBeVisible();
      await expect(
        page.getByRole("main").getByRole("link", { name: /^Template Brief/ }),
      ).toBeVisible();
      return;
    }
    await expect(page.getByRole("link", { name: "Tugas Saya", exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Pustaka Aset", exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Template Brief", exact: true }).first(),
    ).toBeVisible();
  });
});
