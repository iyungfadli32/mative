import { test, expect } from "@playwright/test";

/**
 * Smoke test — selalu jalan (tidak butuh DB live).
 * Memverifikasi halaman publik + health + shell dashboard tampil.
 */
test.describe("smoke — halaman publik", () => {
  test("beranda menampilkan judul MaTive + tautan masuk/daftar/portal", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Satu workspace untuk merencanakan/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Masuk" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Daftar akun" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Portal Klien/ })).toBeVisible();
  });

  test("health endpoint mengembalikan status ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.product).toBe("mative");
    expect(body.supabaseConfigured).toBe(true);
  });

  test("halaman masuk menampilkan form email + kata sandi", async ({ page }) => {
    await page.goto("/masuk");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Kata sandi")).toBeVisible();
    await expect(page.getByRole("button", { name: "Masuk" })).toBeVisible();
  });

  test("halaman daftar menampilkan form nama + email + kata sandi", async ({ page }) => {
    await page.goto("/daftar");
    await expect(page.getByLabel("Nama tampilan")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buat akun" })).toBeVisible();
  });

  test("portal klien menampilkan judul + status belum masuk", async ({ page }) => {
    await page.goto("/portal");
    await expect(
      page.getByRole("heading", { name: "Konten yang dibagikan ke Anda" }),
    ).toBeVisible();
    await expect(page.getByText("Masuk untuk melihat portal")).toBeVisible();
  });
});

test.describe("smoke — dashboard shell (belum masuk)", () => {
  test("dashboard tampil dengan KPI 0 + empty state (tanpa data karangan)", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
    await expect(page.getByText("Direncanakan")).toBeVisible();
    await expect(
      page.getByText("Belum ada data — angka dihitung dari record nyata.").first(),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Anda belum masuk" })).toBeVisible();
  });

  test("tombol modul fase berikut disabled dengan alasan; modul Phase 2 aktif", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    // Kalender/Board/Ide/Konten kini aktif (Phase 2) — bukan lagi disabled.
    // Mobile: sidebar disembunyikan < md SESUAI DESAIN (Dok 02 §2 — navigasi
    // mobile = bottom nav + halaman /lainnya), jadi asersi sidebar hanya
    // untuk desktop; mobile memeriksa navigasi bawah + /lainnya.
    if (test.info().project.name === "mobile") {
      const bottomNav = page.getByRole("navigation", { name: "Navigasi bawah" });
      await expect(bottomNav.getByRole("link", { name: "Kalender", exact: true })).toBeVisible();
      await page.goto("/lainnya");
      // Nama aksesibel tautan /lainnya = label + deskripsi ("Board Produksi
      // Kanban stage produksi.") — tanpa exact, dilingkupi ke <main> supaya
      // tautan sidebar tersembunyi tidak ikut tercocok.
      await expect(
        page.getByRole("main").getByRole("link", { name: /^Board Produksi/ }),
      ).toBeVisible();
      return;
    }
    await expect(page.getByRole("link", { name: "Kalender", exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Board Produksi", exact: true }).first(),
    ).toBeVisible();
  });

  test("buat cepat menampilkan aksi yang tersedia (bukan tombol mati)", async ({ page }) => {
    await page.goto("/dashboard");
    // Dulu (Phase 1): dialog "Buat cepat" menampilkan aksi fase berikut
    // sebagai tombol disabled dengan alasan. Sejak semua fase selesai,
    // dialog menampilkan aksi yang benar-benar tersedia — sama di desktop
    // (dialog Topbar) maupun mobile (dialog bottom nav).
    const quickCreate =
      test.info().project.name === "mobile"
        ? page
            .getByRole("navigation", { name: "Navigasi bawah" })
            .getByRole("button", { name: /Buat cepat/ })
        : page.getByRole("button", { name: /Buat cepat/ });
    await quickCreate.click();
    const dialog = page.getByRole("dialog", { name: "Buat cepat" });
  // Aksi dirender lewat <Button href=...> yang merender <Link> (<a>), jadi
  // peran yang terekspos di pohon aksesibilitas adalah link - asersi lewat
  // link + href tautannya.
    await expect(dialog.getByRole("link", { name: /Buat konten/ })).toBeVisible();
    await expect(dialog.getByRole("link", { name: /Tangkap ide/ })).toBeVisible();
    await expect(dialog.getByRole("link", { name: /Unggah aset/ })).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: /Buat organisasi \/ workspace/ }),
    ).toBeVisible();
    await expect(dialog.locator("a[href='/konten/baru']")).toHaveCount(1);
    await expect(dialog.locator("a[href='/ide']")).toHaveCount(1);
    await expect(dialog.locator("a[href='/pustaka']")).toHaveCount(1);
    await expect(dialog.locator("a[href='/pengaturan/organisasi']")).toHaveCount(1);
    // Tidak ada lagi tombol disabled "belum tersedia di fase ini".
    await expect(dialog.getByText(/belum tersedia di fase ini/)).toHaveCount(0);
  });
});
