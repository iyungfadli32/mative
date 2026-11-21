import { test, expect } from "@playwright/test";

/**
 * Spek penerimaan perbaikan K-1 (audit 2026-11-21, Area (a)):
 * anggota organisasi biasa TIDAK BISA mengangkat dirinya sendiri jadi
 * OWNER workspace mana pun lewat PostgREST.
 *
 * Alur tes serangan: owner buat organisasi + workspace baru → undang akun
 * kedua (role default Creator, BUKAN owner/admin) → akun kedua terima
 * undangan lewat /undangan/<token> → akun kedua mencoba INSERT diri
 * sebagai owner ke workspace itu lewat PostgREST langsung (memakai token
 * sesi miliknya sendiri, seperti penyerang insider) → HARUS ditolak
 * 403/42501, dan role-nya tetap Creator sesudahnya.
 * Regresi: owner membuat workspace lewat UI dan menjadi owner (jalur RPC
 * create_workspace_with_owner, migrasi 0024).
 *
 * BUTUH database live + migrasi 0024 diterapkan + DUA akun uji:
 * - E2E_TEST_EMAIL / E2E_TEST_PASSWORD (owner)
 * - E2E_MEMBER2_EMAIL / E2E_MEMBER2_PASSWORD / E2E_MEMBER2_UID (anggota
 *   kedua — akun mative-e2e-2@example.com).
 * Plus URL + kunci publik Supabase untuk panggilan PostgREST/Auth langsung:
 * NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (atau
 * NEXT_PUBLIC_SUPABASE_ANON_KEY) — dibaca dari environment proses tes.
 * Tes di-SKIP otomatis bila ada yang tidak diisi. JANGAN pernah menulis
 * kredensial akun uji ke file ini. Residu memakai pola org-k1-... /
 * ws-k1-... (dibersihkan parent sesudah run).
 */
const hasOwnerAccount = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);
const hasMember2Account = Boolean(
  process.env.E2E_MEMBER2_EMAIL && process.env.E2E_MEMBER2_PASSWORD && process.env.E2E_MEMBER2_UID,
);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabasePublicKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";
const hasSupabaseRest = Boolean(supabaseUrl && supabasePublicKey);

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
  workspaceName: string,
): Promise<string | null> {
  const switcher = page.getByLabel("Pindah workspace");
  if ((await switcher.count()) === 0) return null;
  await switcher.selectOption({ label: `${workspaceName} (owner)` });
  await expect(page.getByText(`Workspace: ${workspaceName}`)).toBeVisible({
    timeout: 30000,
  });
  return await switcher.inputValue();
}

/**
 * Ambil access_token akun uji lewat Supabase Auth REST (password grant) —
 * token yang sama yang dipakai aplikasi lewat cookie sesi. Tanpa ini,
 * panggilan PostgREST tidak bisa memakai identitas akun kedua.
 */
async function getAccessToken(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const authRes = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: supabasePublicKey, "Content-Type": "application/json" },
    data: { email, password },
  });
  expect(authRes.ok()).toBeTruthy();
  const body = (await authRes.json()) as { access_token?: string };
  expect(body.access_token).toBeTruthy();
  return body.access_token as string;
}

test.describe("K-1 self-promotion — member tidak bisa jadi owner lewat PostgREST @needs-db", () => {
  test.skip(
    !hasOwnerAccount || !hasMember2Account || !hasSupabaseRest,
    "butuh akun owner + akun anggota kedua + URL/kunci publik Supabase.",
  );

  test("member (Creator) coba INSERT diri sebagai owner → ditolak 403/42501, role tetap Creator", async ({
    browser,
    request,
  }) => {
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
      const slug = `k1-${Date.now().toString(36)}`;

      // 1. Owner: masuk + buat organisasi + workspace baru (jalur RPC 0024).
      await signIn(ownerPage, ownerEmail, ownerPassword);
      await ownerPage.goto("/pengaturan/organisasi");
      await ownerPage.getByLabel("Nama organisasi").fill(`Organisasi K1 ${slug}`);
      await ownerPage.getByLabel(/Slug \(huruf kecil/).fill(`org-k1-${slug}`);
      await ownerPage.getByRole("button", { name: "Buat organisasi" }).click();
      await expect(ownerPage.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
      await ownerPage.getByLabel("Nama workspace").fill(`Workspace K1 ${slug}`);
      await ownerPage.getByLabel("Slug", { exact: true }).fill(`ws-k1-${slug}`);
      await ownerPage.getByRole("button", { name: "Buat workspace" }).click();
      await expect(ownerPage.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });

      // 2. Ambil UUID workspace baru lewat switcher (untuk ?workspace=).
      await ownerPage.goto("/merek");
      await expect(ownerPage.getByRole("heading", { name: "Merek" })).toBeVisible();
      const wsId = await switchToWorkspace(ownerPage, `Workspace K1 ${slug}`);
      expect(wsId).toBeTruthy();

      // 3. Owner: undang akun kedua (role default Creator — BUKAN owner/admin).
      await ownerPage.goto(`/pengaturan/anggota?workspace=${wsId}`);
      await expect(
        ownerPage.getByRole("heading", { name: `Undang anggota — Workspace K1 ${slug}` }),
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

      // 5. SERANGAN: akun kedua mencoba INSERT diri sebagai owner lewat
      //    PostgREST langsung, memakai token sesinya sendiri — vektor
      //    persis temuan K-1. Pola return=representation (yang dipakai
      //    supabase-js .insert().select()) HARUS ditolak 403/42501.
      const memberToken = await getAccessToken(request, member2Email, member2Password);
      const attackHeaders = {
        apikey: supabasePublicKey,
        Authorization: `Bearer ${memberToken}`,
        "Content-Type": "application/json",
      };
      const attackBody = {
        workspace_id: wsId,
        user_id: member2Uid,
        workspace_role: "owner",
        membership_status: "active",
      };
      const attackRes = await request.post(`${supabaseUrl}/rest/v1/workspace_members`, {
        headers: { ...attackHeaders, Prefer: "return=representation" },
        data: attackBody,
      });
      expect(attackRes.status()).toBe(403);
      const attackJson = (await attackRes.json()) as { code?: string; message?: string };
      expect(attackJson.code).toBe("42501");
      expect(attackJson.message ?? "").toContain("row-level security");

      // Varian kedua: tanpa RETURNING (return=minimal) juga harus ditolak
      // — membuktikan penolakannya di WITH CHECK, bukan artefak RETURNING.
      const attackMinimalRes = await request.post(`${supabaseUrl}/rest/v1/workspace_members`, {
        headers: { ...attackHeaders, Prefer: "return=minimal" },
        data: attackBody,
      });
      expect(attackMinimalRes.status()).toBe(403);

      // 6. BUKTI tidak ada baris owner yang tercipta: baca membership
      //    akun kedua lewat PostgREST (sebagai dirinya sendiri — ia boleh
      //    membaca barisnya sendiri) → tepat 1 baris, role tetap Creator.
      const checkRes = await request.get(
        `${supabaseUrl}/rest/v1/workspace_members?workspace_id=eq.${wsId}&user_id=eq.${member2Uid}&select=workspace_role`,
        { headers: attackHeaders },
      );
      expect(checkRes.ok()).toBeTruthy();
      const rows = (await checkRes.json()) as Array<{ workspace_role: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].workspace_role).toBe("creator");

      // 7. Bukti yang sama lewat UI owner: hanya ada 1 Pemilik (owner
      //    asli), dan akun kedua tampil sebagai Creator.
      await ownerPage.goto(`/pengaturan/anggota?workspace=${wsId}`);
      await expect(ownerPage.getByText(member2Uid)).toBeVisible({ timeout: 30000 });
      await expect(ownerPage.getByRole("cell", { name: "Pemilik" })).toHaveCount(1);
      await expect(ownerPage.getByRole("cell", { name: "Creator" })).toBeVisible();
    } finally {
      await ownerCtx.close();
      await memberCtx.close();
    }
  });

  test("regresi: owner membuat workspace lewat UI dan menjadi owner", async ({ browser }) => {
    test.setTimeout(300000);
    expect.configure({ timeout: 30000 });
    const ownerEmail = process.env.E2E_TEST_EMAIL as string;
    const ownerPassword = process.env.E2E_TEST_PASSWORD as string;

    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    try {
      const slug = `k1r-${Date.now().toString(36)}`;

      await signIn(ownerPage, ownerEmail, ownerPassword);
      await ownerPage.goto("/pengaturan/organisasi");
      await ownerPage.getByLabel("Nama organisasi").fill(`Organisasi K1R ${slug}`);
      await ownerPage.getByLabel(/Slug \(huruf kecil/).fill(`org-k1r-${slug}`);
      await ownerPage.getByRole("button", { name: "Buat organisasi" }).click();
      await expect(ownerPage.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
      await ownerPage.getByLabel("Nama workspace").fill(`Workspace K1R ${slug}`);
      await ownerPage.getByLabel("Slug", { exact: true }).fill(`ws-k1r-${slug}`);
      await ownerPage.getByRole("button", { name: "Buat workspace" }).click();
      await expect(ownerPage.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });

      // Pembuat workspace HARUS menjadi owner (jalur RPC 0024): di halaman
      // anggota, barisnya ber-role Pemilik dan workspace-nya terlihat.
      await ownerPage.goto("/merek");
      await expect(ownerPage.getByRole("heading", { name: "Merek" })).toBeVisible();
      const wsId = await switchToWorkspace(ownerPage, `Workspace K1R ${slug}`);
      expect(wsId).toBeTruthy();
      await ownerPage.goto(`/pengaturan/anggota?workspace=${wsId}`);
      await expect(
        ownerPage.getByRole("heading", { name: `Undang anggota — Workspace K1R ${slug}` }),
      ).toBeVisible();
      await expect(ownerPage.getByRole("cell", { name: "Pemilik" })).toBeVisible();
    } finally {
      await ownerCtx.close();
    }
  });
});
