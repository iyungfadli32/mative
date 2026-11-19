import { test, expect } from "@playwright/test";

/**
 * Spek penerimaan Phase 3 — prompts/04 (P3-12).
 * Alur: ide → konversi jadi konten → brief terstruktur (versi baru) →
 * task ditugaskan → aset diunggah + dilampirkan → komentar di editor →
 * bandingkan + pulihkan versi → reload dan verifikasi persistence.
 *
 * BUTUH database live + migrasi 0009 + 0010 diterapkan + akun uji
 * (E2E_TEST_EMAIL/PASSWORD). Tes ini di-SKIP otomatis bila akun uji tidak
 * diisi. Sampai migrasi diterapkan, spek ini BELUM TERBUKTI live — lihat
 * docs/phase-3-report.md §5/§9 (batas jujur).
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
  test.skip(!hasTestAccount, "Butuh akun uji (E2E_TEST_EMAIL/PASSWORD) + migrasi 0009/0010 live.");

  test("ide → brief → task → aset → komentar → versi → reload", async ({ page }) => {
    // Semua expect di tes ini memakai 30 dtk (bukan default 5 dtk):
    // render halaman + round-trip aksi server ke Supabase dari VM ini
    // kerap >5 dtk (pola planning.spec.ts 2026-11-19). Timeout tes
    // 240 dtk karena total alur live-DB ini ~60–120 dtk.
    test.setTimeout(240000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `p3-${Date.now().toString(36)}`;

    // 1. Tangkap ide di inbox.
    await page.goto("/ide");
    await expect(page.getByRole("heading", { name: "Ide", exact: true })).toBeVisible();
    await page.getByLabel("Judul ide").fill(`Ide P3 ${slug}`);
    await page.getByRole("button", { name: "Tangkap ide" }).click();
    await expect(page.getByText(`Ide P3 ${slug}`).first()).toBeVisible({ timeout: 30000 });

    // 2. Konversi ide → konten (RPC 0008, satu transaksi).
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
    await expect(page.getByText("Task dibuat.")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(`Task P3 ${slug}`).first()).toBeVisible({ timeout: 30000 });

    // 5. Pindah status task todo → in_progress (mesin RPC 0010).
    await page.getByLabel("Pindah status ke").selectOption("in_progress");
    await page.getByRole("button", { name: "Pindah status" }).click();
    await expect(page.getByText("Status task diubah.")).toBeVisible({ timeout: 30000 });

    // 6. Tab Media: unggah aset PNG 1x1 → lampirkan ke konten.
    await page.getByRole("tab", { name: "Media" }).click();
    await page.getByLabel(/Pilih file \(PNG, JPEG, WebP, MP4, WebM, PDF/).setInputFiles({
      name: `aset-p3-${slug}.png`,
      mimeType: "image/png",
      buffer: ONE_BY_ONE_PNG,
    });
    await page.getByRole("button", { name: "Unggah aset" }).click();
    await expect(page.getByText("Aset diunggah.")).toBeVisible({ timeout: 30000 });
    await page.getByRole("link", { name: "Pustaka Aset" }).click();
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
    await page.goto("/tugas");
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
