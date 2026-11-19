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
    await expect(page.getByRole("link", { name: "Kalender", exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Board Produksi", exact: true }).first(),
    ).toBeVisible();
    // Modul Phase 3+ masih disabled dengan alasan. Tombolnya ada di dalam
    // dialog "Buat cepat" (Topbar) — Dialog hanya me-render isinya bila
    // dibuka, jadi buka dialog dulu (perbaikan 2026-11-19: tes lama
    // mengharapkan tombol tanpa membuka dialog, sehingga gagal
    // "element(s) not found" walau aplikasinya benar).
    await page.getByRole("button", { name: /Buat cepat/ }).click();
    const tugas = page.getByTitle("Belum tersedia di fase ini (Phase 3).");
    await expect(tugas.first()).toBeVisible();
  });
});
