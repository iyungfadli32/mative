import { test, expect } from "@playwright/test";

/**
 * Smoke test — selalu jalan (tidak butuh DB live).
 * Memverifikasi halaman publik + health + route guard (anon ke /masuk).
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

test.describe("smoke — route guard (belum masuk)", () => {
  test("dashboard mengarahkan anon ke /masuk", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/masuk/);
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Kata sandi")).toBeVisible();
    await expect(page.getByRole("button", { name: "Masuk" })).toBeVisible();
  });

  test("halaman app lain (pengaturan) juga mengarahkan anon ke /masuk", async ({
    page,
  }) => {
    await page.goto("/pengaturan");
    await expect(page).toHaveURL(/\/masuk/);
    await expect(page.getByLabel("Email")).toBeVisible();
  });
});
