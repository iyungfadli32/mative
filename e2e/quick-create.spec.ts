import { test, expect } from "@playwright/test";

/**
 * Spek perbaikan D1/D2/D3 — umpan balik loading + org-first untuk pengguna baru.
 *
 * - D1: klik navigasi menampilkan loading UI INSTAN (loading.tsx segmen (app)).
 * - D2: pengguna tanpa workspace melihat CTA utama "Buat organisasi &
 *   workspace" di dashboard + kartu aksi di halaman PlanningShell.
 * - D3: keempat pilihan dialog "Buat cepat" bernavigasi ke tujuan yang benar.
 *   Akar penyebab (dibuktikan probe): BUKAN dialog yang membatalkan
 *   navigasi — keempat pilihan mendarat benar. Penyebabnya PREFETCH-WAIT:
 *   tautan dialog mulai di-prefetch saat dialog terbuka; klik yang datang
 *   ~100ms kemudian membuat router MENUNGGU prefetch selesai (~1 dtk)
 *   tanpa menampilkan loading UI. Perbaikan: prefetch={false} pada
 *   tautan dialog (Topbar + AppShell) sehingga klik langsung memulai
 *   navigasi + loading.tsx tampil instan.
 *
 * BUTUH database live + akun uji TANPA workspace (E2E_TEST_EMAIL/PASSWORD).
 * Tes di-SKIP otomatis bila akun uji tidak diisi. TIDAK membuat
 * org/workspace/user — hanya navigasi + asersi.
 *
 * Waktu klik → loading UI diukur dan dicatat (console.log), bukan
 * diasersi keras — angka <300ms dibuktikan probe Playwright terpisah,
 * bukan dari runner bersama.
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
  await settle(page);
}

/**
 * Tunggu halaman benar-benar settle sebelum klik: heading terlihat saja
 * belum cukup — stream RSC + hidrasi masih bisa berjalan, dan klik di
 * tengah stream mengukur latensi server (full load) bukan umpan balik
 * navigasi client-side yang dirasakan pengguna (klik sesudah halaman siap).
 */
async function settle(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * Klik lalu ukur waktu sampai loading UI terlihat (ms).
 * Pengukuran dipisah: durasi click() sendiri + polling ketat isVisible
 * tiap 10ms. expect().toBeVisible() TIDAK dipakai untuk mengukur —
 * polling-nya bisa ter-starve di bawah beban VM bersama (angka yang
 * tercatat jadi waktu poll berhasil, bukan waktu UI muncul).
 */
async function clickAndMeasureLoading(
  page: import("@playwright/test").Page,
  target: import("@playwright/test").Locator,
): Promise<number> {
  const t0 = Date.now();
  await target.click();
  const clickMs = Date.now() - t0;
  const t1 = Date.now();
  let seen: number | null = null;
  while (Date.now() - t1 < 5000) {
    if (
      await page
        .getByText("Memuat halaman…")
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      seen = Date.now() - t1;
      break;
    }
    await page.waitForTimeout(10);
  }
  expect(seen).not.toBeNull();
  return clickMs + (seen ?? 0);
}

test.describe("quick-create + loading feedback (pengguna tanpa workspace)", () => {
  test.skip(!hasTestAccount, "butuh akun uji E2E_TEST_EMAIL/PASSWORD");

  test("dashboard menampilkan CTA utama org-first bila tanpa workspace", async ({ page }) => {
    await signIn(page);
    const cta = page.getByRole("link", { name: "＋ Buat organisasi & workspace" }).first();
    await expect(cta).toBeVisible({ timeout: 30000 });
    // CTA utama = varian primary (teal), bukan secondary.
    await expect(cta.locator("button")).toHaveClass(/bg-\[var\(--mt-teal-700\)\]/);
    // Tombol "+Buat konten" tetap ada sebagai aksi sekunder.
    await expect(page.getByRole("link", { name: "＋ Buat konten", exact: true })).toBeVisible();
    // Bagian "Workspace Anda" tetap memberi tahu keadaan sebenarnya.
    await expect(page.getByText("Belum ada workspace yang bisa Anda akses.")).toBeVisible();
  });

  test("klik +Buat konten menampilkan loading UI lalu kartu aksi org", async ({ page }) => {
    await signIn(page);
    const loadingMs = await clickAndMeasureLoading(
      page,
      page.getByRole("link", { name: "＋ Buat konten", exact: true }),
    );
    console.log(`D1 click-to-loading-ui: ${loadingMs}ms`);
    await expect(page).toHaveURL(/\/konten\/baru/, { timeout: 30000 });
    await expect(page.getByRole("heading", { name: "Buat konten" })).toBeVisible({
      timeout: 30000,
    });
    // Kartu aksi PlanningShell: judul + tombol utama ke organisasi.
    // Dilingkupi ke <main>: teks "Belum ada workspace" juga ada di sidebar
    // (tersembunyi di mobile) sehingga asersi global bisa salah sasaran.
    const main = page.getByRole("main");
    await expect(main.getByText("Belum ada workspace")).toBeVisible();
    await expect(main.getByRole("link", { name: "＋ Buat organisasi & workspace" })).toBeVisible();
  });

  test("Buat cepat: keempat pilihan bernavigasi ke tujuan yang benar", async ({ page }) => {
    test.setTimeout(180000);
    await signIn(page);
    const options: Array<{ name: RegExp; url: RegExp; marker: string }> = [
      { name: /Buat konten/, url: /\/konten\/baru/, marker: "Belum ada workspace" },
      { name: /Tangkap ide/, url: /\/ide/, marker: "Belum ada workspace" },
      { name: /Unggah aset/, url: /\/pustaka/, marker: "Belum ada workspace" },
      {
        name: /Buat organisasi/,
        url: /\/pengaturan\/organisasi/,
        marker: "Nama organisasi",
      },
    ];
    for (const opt of options) {
      await test.step(`pilihan ${opt.url}`, async () => {
        await page.goto("/dashboard");
        await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible({
          timeout: 30000,
        });
        await settle(page);
        const quickCreate =
          test.info().project.name === "mobile"
            ? page
                .getByRole("navigation", { name: "Navigasi bawah" })
                .getByRole("button", { name: /Buat cepat/ })
            : page.getByRole("button", { name: /Buat cepat/ });
        await quickCreate.click();
        const dialog = page.getByRole("dialog", { name: "Buat cepat" });
        await expect(dialog).toBeVisible({ timeout: 10000 });
        const loadingMs = await clickAndMeasureLoading(
          page,
          dialog.getByRole("link", { name: opt.name }),
        );
        console.log(`D3 ${opt.url} click-to-loading-ui: ${loadingMs}ms`);
        await expect(page).toHaveURL(opt.url, { timeout: 30000 });
        // Marker dilingkupi ke <main> (sidebar juga memuat teks serupa).
        await expect(page.getByRole("main").getByText(opt.marker).first()).toBeVisible({
          timeout: 30000,
        });
      });
    }
  });

  test("dialog Buat cepat buka/tutup normal", async ({ page }) => {
    await signIn(page);
    const quickCreate =
      test.info().project.name === "mobile"
        ? page
            .getByRole("navigation", { name: "Navigasi bawah" })
            .getByRole("button", { name: /Buat cepat/ })
        : page.getByRole("button", { name: /Buat cepat/ });
    await quickCreate.click();
    const dialog = page.getByRole("dialog", { name: "Buat cepat" });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByRole("link", { name: /Buat konten/ })).toBeVisible();
    await expect(dialog.getByRole("link", { name: /Tangkap ide/ })).toBeVisible();
    await expect(dialog.getByRole("link", { name: /Unggah aset/ })).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: /Buat organisasi \/ workspace/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await quickCreate.click();
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.getByRole("button", { name: "Tutup dialog" }).click();
    await expect(dialog).toHaveCount(0);
  });
});
