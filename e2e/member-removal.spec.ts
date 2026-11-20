import { test, expect } from "@playwright/test";

/**
 * Spek penerimaan Phase 9 — bukti hapus anggota end-to-end (Dok 06 §8
 * butir 5: member yang dicabut kehilangan akses seketika).
 *
 * Alur: owner buat workspace baru → undang akun kedua lewat UI (tautan
 * undangan manual tampil sekali karena service-role belum dikonfigurasi
 * — perilaku yang didokumentasikan di inviteMemberAction) → akun kedua
 * terima undangan lewat /undangan/<token> → owner hapus anggota itu
 * lewat tombol Hapus di Tim & Peran → akun kedua kehilangan akses
 * (workspace tidak lagi tampil di dashboard-nya).
 *
 * BUTUH database live + DUA akun uji:
 * - E2E_TEST_EMAIL / E2E_TEST_PASSWORD (owner)
 * - E2E_MEMBER2_EMAIL / E2E_MEMBER2_PASSWORD / E2E_MEMBER2_UID (anggota
 *   kedua — akun mative-e2e-2@example.com).
 * Tes di-SKIP otomatis bila ada yang tidak diisi. JANGAN pernah menulis
 * kredensial akun uji ke file ini. Residu memakai pola org-p9-mr-... /
 * ws-p9-mr-... (dibersihkan parent sesudah run).
 */
const hasOwnerAccount = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);
const hasMember2Account = Boolean(
  process.env.E2E_MEMBER2_EMAIL && process.env.E2E_MEMBER2_PASSWORD && process.env.E2E_MEMBER2_UID,
);

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible({
    timeout: 15000,
  });
}

/** Pindah ke workspace baru lewat switcher; mengembalikan UUID-nya. */
async function switchToWorkspace(
  page: import("@playwright/test").Page,
  slug: string,
): Promise<string | null> {
  const switcher = page.getByLabel("Pindah workspace");
  if ((await switcher.count()) === 0) return null;
  await switcher.selectOption({ label: `Workspace P9 ${slug} (owner)` });
  await expect(page.getByText(`Workspace: Workspace P9 ${slug}`)).toBeVisible({
    timeout: 30000,
  });
  return await switcher.inputValue();
}

test.describe("hapus anggota — owner mencabut akses anggota @needs-db", () => {
  test.skip(!hasOwnerAccount || !hasMember2Account, "butuh akun owner + akun anggota kedua.");

  test("undang → terima → hapus → anggota kehilangan akses", async ({ browser }) => {
    test.setTimeout(300000);
    expect.configure({ timeout: 30000 });
    const ownerEmail = process.env.E2E_TEST_EMAIL as string;
    const ownerPassword = process.env.E2E_TEST_PASSWORD as string;
    const member2Email = process.env.E2E_MEMBER2_EMAIL as string;
    const member2Password = process.env.E2E_MEMBER2_PASSWORD as string;
    const member2Uid = process.env.E2E_MEMBER2_UID as string;

    const ownerCtx = await browser.newContext();
    const memberCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    const memberPage = await memberCtx.newPage();
    try {
      const slug = `mr-${Date.now().toString(36)}`;

      // 1. Owner: masuk + buat organisasi + workspace baru.
      await signIn(ownerPage, ownerEmail, ownerPassword);
      await ownerPage.goto("/pengaturan/organisasi");
      await ownerPage.getByLabel("Nama organisasi").fill(`Organisasi P9 ${slug}`);
      await ownerPage.getByLabel(/Slug \(huruf kecil/).fill(`org-p9-${slug}`);
      await ownerPage.getByRole("button", { name: "Buat organisasi" }).click();
      await expect(ownerPage.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
      await ownerPage.getByLabel("Nama workspace").fill(`Workspace P9 ${slug}`);
      await ownerPage.getByLabel("Slug", { exact: true }).fill(`ws-p9-${slug}`);
      await ownerPage.getByRole("button", { name: "Buat workspace" }).click();
      await expect(ownerPage.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });

      // 2. Ambil UUID workspace baru lewat switcher (untuk ?workspace=).
      await ownerPage.goto("/merek");
      await expect(ownerPage.getByRole("heading", { name: "Merek" })).toBeVisible();
      const wsId = await switchToWorkspace(ownerPage, slug);
      expect(wsId).toBeTruthy();

      // 3. Owner: undang akun kedua. Tanpa service-role, tautan undangan
      //    manual tampil sekali di halaman — ambil tokennya dari sana.
      await ownerPage.goto(`/pengaturan/anggota?workspace=${wsId}`);
      await expect(
        ownerPage.getByRole("heading", { name: `Undang anggota — Workspace P9 ${slug}` }),
      ).toBeVisible();
      await ownerPage.getByLabel("Email yang diundang").fill(member2Email);
      await ownerPage.getByRole("button", { name: "Kirim undangan" }).click();
      await expect(ownerPage.getByText("Tautan undangan")).toBeVisible({ timeout: 30000 });
      const codeText = await ownerPage
        .locator("form", { hasText: "Kirim undangan" })
        .locator("code")
        .textContent();
      const token = (codeText ?? "").replace("/undangan/", "").trim();
      expect(token).toMatch(/^[0-9a-f]{64}$/);

      // 4. Akun kedua: masuk + terima undangan lewat tautan itu.
      await signIn(memberPage, member2Email, member2Password);
      await memberPage.goto(`/undangan/${token}`);
      await expect(
        memberPage.getByRole("heading", { name: "Terima undangan workspace" }),
      ).toBeVisible();
      await memberPage.getByRole("button", { name: "Terima undangan" }).click();
      await expect(memberPage.getByText("Undangan diterima.")).toBeVisible({ timeout: 30000 });

      // 5. Akun kedua: workspace baru tampil di dashboard-nya (bukti jadi anggota).
      await memberPage.goto("/dashboard");
      const memberWsSection = memberPage
        .getByRole("heading", { name: "Workspace Anda" })
        .locator("..");
      await expect(memberWsSection.getByText(`Workspace P9 ${slug}`).first()).toBeVisible({
        timeout: 30000,
      });

      // 6. Owner: hapus akun kedua dari Tim & Peran. Workspace baru hanya
      //    punya 2 anggota (owner + akun kedua) dan hanya akun kedua yang
      //    punya tombol Hapus — jadi tepat 1 tombol Hapus. Kolom Email
      //    menampilkan UID mentah (akun dibuat via API tanpa baris profil).
      await ownerPage.goto(`/pengaturan/anggota?workspace=${wsId}`);
      await expect(ownerPage.getByText(member2Uid)).toBeVisible({ timeout: 30000 });
      const removeButton = ownerPage.getByRole("button", { name: "Hapus" });
      await expect(removeButton).toHaveCount(1);
      await removeButton.click();
      await expect(
        ownerPage.getByText("Anggota dihapus — aksesnya ke workspace ini tercabut seketika."),
      ).toBeVisible({ timeout: 30000 });
      await expect(ownerPage.getByText(member2Uid)).toHaveCount(0);
      await expect(ownerPage.getByRole("button", { name: "Hapus" })).toHaveCount(0);

      // 7. Akun kedua: workspace hilang dari dashboard — akses tercabut.
      await memberPage.goto("/dashboard");
      await expect(memberPage.getByText(`Workspace P9 ${slug}`)).toHaveCount(0);
      await expect(memberPage.getByText("Belum ada workspace yang bisa Anda akses.")).toBeVisible({
        timeout: 30000,
      });
    } finally {
      await ownerCtx.close();
      await memberCtx.close();
    }
  });
});
