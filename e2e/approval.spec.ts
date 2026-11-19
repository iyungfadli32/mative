import { test, expect } from "@playwright/test";

/**
 * Spek penerimaan Phase 4 — prompts/05 (P4-12).
 * Alur: buat brand → konten → pindah stage idea → Editing (5 langkah,
 * wajib — RPC 0014 hanya menerima submit dari editing/internal_review)
 * → tab Approval → tugaskan step ke diri sendiri (eksplisit,
 * pengecualian R4.3) → submit v1 → minta revisi v1 (selagi v1 terbaru;
 * RPC menolak SEMUA keputusan atas versi basi, jadi revisi atas v1
 * basi tidak mungkin) → buat v2 → submit v2 → buat v3 → approve v2
 * DITOLAK sebagai basi (R4.1) → submit v3 → setujui v3 → Disetujui +
 * produksi approved → antrean Approval Center.
 *
 * BUTUH database live + migrasi 0013 + 0014 diterapkan + akun uji
 * (E2E_TEST_EMAIL/PASSWORD). Tes ini di-SKIP otomatis bila akun uji
 * tidak diisi. Sampai migrasi diterapkan, spek ini BELUM TERBUKTI
 * live — lihat docs/phase-4-report.md §5/§9 (batas jujur).
 *
 * CATATAN PENUGASAN (2026-11-19): workflow default menugaskan role
 * 'approver'; owner/admin/manager HANYA boleh memutuskan bila ditugaskan
 * EKSPLISIT sebagai assignee_user_id (RPC 0014, R4.3). Karena itu tes
 * satu-akun ini menugaskan step ke pengguna sendiri lewat form
 * penugasan (select pengguna — workspace baru hanya punya 1 member,
 * jadi opsi index 1 = owner). Tanpa penugasan, form keputusan tidak
 * muncul dan teks "Anda tidak ditugaskan di step saat ini" yang tampil
 * (itu BUKAN defect — itu penegakan R4.3 di UI).
 *
 * Path dua-peran SEJATI (creator submit, approver lain memutuskan)
 * ada di tes "dua peran" di bawah — SKIP bila E2E_APPROVER_EMAIL /
 * E2E_APPROVER_PASSWORD tidak diisi (akun approver kedua harus sudah
 * dibuat sebelumnya, mis. lewat Dashboard Supabase).
 */
const hasTestAccount = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);
const hasApproverAccount = Boolean(
  process.env.E2E_APPROVER_EMAIL && process.env.E2E_APPROVER_PASSWORD,
);

async function signIn(page: import("@playwright/test").Page, email?: string, password?: string) {
  const e = email ?? (process.env.E2E_TEST_EMAIL as string);
  const p = password ?? (process.env.E2E_TEST_PASSWORD as string);
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(e);
  await page.getByLabel("Kata sandi").fill(p);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible({
    timeout: 15000,
  });
}

/**
 * Pindah production stage idea → editing (5 langkah, tab Overview).
 * WAJIB sebelum submit approval internal: RPC 0014 hanya menerima
 * submit dari 'editing'/'internal_review' — dari 'idea' langsung
 * ditolak server ("Pindahkan dulu ke Editing."). Jalur jujur lewat
 * pipeline (tanpa jalan pintas exception blocked → editing, yang
 * akan mencatat event status palsu).
 */
async function walkToEditing(page: import("@playwright/test").Page) {
  const pipeline: Array<[string, string]> = [
    ["idea", "brief"],
    ["brief", "scripting"],
    ["scripting", "ready_for_production"],
    ["ready_for_production", "in_production"],
    ["in_production", "editing"],
  ];
  for (const [from, to] of pipeline) {
    await page.getByLabel("Pindah stage ke").selectOption(to);
    await page.getByRole("button", { name: "Pindah stage" }).click();
    await expect(
      page.getByText(`Status produksi diubah: ${from} → ${to}.`, { exact: true }),
    ).toBeVisible({ timeout: 30000 });
  }
}

test.describe("penerimaan Phase 4 — review & approval @needs-db", () => {
  test.skip(!hasTestAccount, "Butuh akun uji (E2E_TEST_EMAIL/PASSWORD) + migrasi 0013–0014 live.");

  test("submit v1 → stale ditolak → minta revisi → v2 → setujui v2 → Disetujui", async ({
    page,
  }) => {
    // Semua expect di tes ini memakai 30 dtk (bukan default 5 dtk):
    // render halaman + round-trip aksi server ke Supabase dari VM ini
    // kerap >5 dtk (pola planning.spec.ts / production.spec.ts 2026-11-19).
    test.setTimeout(300000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `p4-${Date.now().toString(36)}`;

    // 0. Setup: akun uji baru belum punya organisasi/workspace — buat dulu.
    await page.goto("/pengaturan/organisasi");
    await page.getByLabel("Nama organisasi").fill(`Organisasi P4 ${slug}`);
    await page.getByLabel(/Slug \(huruf kecil/).fill(`org-p4-${slug}`);
    await page.getByRole("button", { name: "Buat organisasi" }).click();
    await expect(page.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
    await page.getByLabel("Nama workspace").fill(`Workspace P4 ${slug}`);
    await page.getByLabel("Slug", { exact: true }).fill(`ws-p4-${slug}`);
    await page.getByRole("button", { name: "Buat workspace" }).click();
    await expect(page.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });

    // 1. Buat brand.
    await page.goto("/merek");
    await expect(page.getByRole("heading", { name: "Merek" })).toBeVisible();
    await page.locator("#brand-name-new").fill(`Brand P4 ${slug}`);
    await page.locator("#brand-slug-new").fill(`brand-p4-${slug}`);
    await page.getByRole("button", { name: "Buat brand" }).click();
    // WAJIB exact: true — getByText tanpa exact cocok dengan hint statis
    // "Slug tidak bisa diubah setelah brand dibuat." (BrandForm.tsx:44),
    // sehingga wait lolos instan SEBELUM insert selesai dan /konten/baru
    // lalu (dengan benar) belum menampilkan brand baru (cacat e2e 2026-11-19).
    await expect(page.getByText("Brand dibuat.", { exact: true })).toBeVisible({ timeout: 30000 });

    // 2. Buat konten (otomatis v1).
    await page.goto("/konten/baru");
    await expect(page.getByRole("heading", { name: "Buat konten" })).toBeVisible();
    await page.getByLabel(/Brand/).selectOption({ label: `Brand P4 ${slug}` });
    await page.getByLabel("Judul konten").fill(`Konten P4 ${slug}`);
    await page
      .getByLabel("Ringkasan perubahan (wajib — tercatat di versi)")
      .fill("Versi awal (v1)");
    await page.getByRole("button", { name: "Buat konten (v1)" }).click();
    await expect(page.getByText("Konten dibuat beserta versi v1.")).toBeVisible({ timeout: 30000 });

    // 3. Buka tab Approval konten — tapi pindah stage dulu ke Editing
    //    (submit approval internal hanya dari editing, RPC 0014).
    await page.goto("/konten");
    await page.getByRole("link", { name: `Konten P4 ${slug}` }).click();
    await expect(page.getByRole("heading", { name: `Konten P4 ${slug}` })).toBeVisible();
    await walkToEditing(page);
    await page.getByRole("tab", { name: "Approval" }).click();
    await expect(page.getByText("Belum ada request approval aktif")).toBeVisible({
      timeout: 30000,
    });

    // 4. Tugaskan step default ke diri sendiri (eksplisit, R4.3).
    // Workspace baru hanya punya 1 member (owner): opsi index 0 =
    // "— Tidak ditugaskan —", index 1 = owner.
    const assignForm = page.locator("form", { has: page.getByText("Simpan penugasan") });
    await assignForm.locator('select[name="assigneeUserId"]').selectOption({ index: 1 });
    await assignForm.getByRole("button", { name: "Simpan penugasan" }).click();
    await expect(page.getByText("Penugasan step workflow disimpan.")).toBeVisible({
      timeout: 30000,
    });

    // 5. Submit v1 untuk approval.
    await page.getByRole("button", { name: "Ajukan v1 untuk approval" }).click();
    await expect(page.getByText("Konten diajukan untuk approval")).toBeVisible({
      timeout: 30000,
    });
    const decisionForm = page.locator("form", { has: page.getByText("Keputusan Anda") });
    await expect(decisionForm.getByLabel("Minta revisi", { exact: true })).toBeVisible();

    // 6. Minta revisi v1 (komentar wajib) SELAGI v1 masih terbaru →
    //    request changes_requested + produksi kembali ke editing.
    //    (Minta revisi atas versi BASI ditolak RPC — lihat langkah 9.)
    await decisionForm.getByLabel("Minta revisi", { exact: true }).click();
    await decisionForm.getByLabel(/Komentar/).fill("Caption perlu direvisi.");
    await decisionForm.getByRole("button", { name: "Kirim keputusan" }).click();
    await expect(page.getByText("dikembalikan untuk revisi")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Minta revisi").first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Status produksi: editing.")).toBeVisible({ timeout: 30000 });

    // 7. Buat v2 (edit script — revisi atas permintaan di atas).
    await page.getByRole("tab", { name: "Script" }).click();
    await page.locator('textarea[name="script"]').fill(`Skrip v2 P4 ${slug} — direvisi.`);
    await page
      .getByLabel("Ringkasan perubahan (wajib — tercatat di versi baru)")
      .fill("Revisi skrip (v2).");
    await page.getByRole("button", { name: "Simpan script (versi baru)" }).click();
    await expect(page.getByText(/versi v2/)).toBeVisible({ timeout: 30000 });

    // 8. Submit v2 untuk approval.
    await page.getByRole("tab", { name: "Approval" }).click();
    await page.getByRole("button", { name: "Ajukan v2 untuk approval" }).click();
    await expect(page.getByText("Konten diajukan untuk approval")).toBeVisible({
      timeout: 30000,
    });
    await expect(decisionForm.getByLabel("Minta revisi", { exact: true })).toBeVisible();

    // 9. Buat v3 → request v2 kini basi; approve v2 DITOLAK server (R4.1).
    await page.getByRole("tab", { name: "Script" }).click();
    await page.locator('textarea[name="script"]').fill(`Skrip v3 P4 ${slug} — direvisi lagi.`);
    await page
      .getByLabel("Ringkasan perubahan (wajib — tercatat di versi baru)")
      .fill("Revisi skrip (v3).");
    await page.getByRole("button", { name: "Simpan script (versi baru)" }).click();
    await expect(page.getByText(/versi v3/)).toBeVisible({ timeout: 30000 });
    await page.getByRole("tab", { name: "Approval" }).click();
    await expect(page.getByText("menunjuk versi lama")).toBeVisible({ timeout: 30000 });
    await decisionForm.getByRole("button", { name: "Kirim keputusan" }).click();
    await expect(decisionForm.getByText("sudah basi")).toBeVisible({ timeout: 30000 });

    // 10. Submit v3 untuk approval, lalu setujui v3.
    await page.getByRole("button", { name: "Ajukan v3 untuk approval" }).click();
    await expect(page.getByText("Konten diajukan untuk approval")).toBeVisible({
      timeout: 30000,
    });
    await expect(decisionForm.getByLabel("Minta revisi", { exact: true })).toBeVisible();
    await decisionForm.getByRole("button", { name: "Kirim keputusan" }).click();
    await expect(page.getByText("disetujui")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Status produksi: approved")).toBeVisible({ timeout: 30000 });

    // 11. Approval Center: antrean Disetujui memuat konten ini; antrean
    //     Menunggu saya kosong.
    await page.goto("/persetujuan?tab=disetujui");
    await expect(page.getByRole("heading", { name: "Approval Center" })).toBeVisible();
    await expect(page.getByRole("link", { name: `Konten P4 ${slug}` })).toBeVisible({
      timeout: 30000,
    });
    await page.goto("/persetujuan?tab=menunggu_saya");
    await expect(page.getByText("Tidak ada request di antrean menunggu saya")).toBeVisible({
      timeout: 30000,
    });

    // 12. Reload tab Approval: riwayat + status persist.
    await page.goto("/konten");
    await page.getByRole("link", { name: `Konten P4 ${slug}` }).click();
    await page.getByRole("tab", { name: "Approval" }).click();
    await expect(page.getByText("Disetujui").first()).toBeVisible({ timeout: 30000 });
  });

  test("dua peran: creator submit, approver lain memutuskan", async ({ browser }) => {
    test.skip(
      !hasApproverAccount,
      "Butuh akun approver kedua (E2E_APPROVER_EMAIL/PASSWORD) — akun harus sudah dibuat sebelumnya.",
    );
    test.setTimeout(300000);
    expect.configure({ timeout: 30000 });
    const slug = `p4-2r-${Date.now().toString(36)}`;
    const ownerPage = await browser.newPage();
    const approverPage = await browser.newPage();

    // A. Owner: buat org + workspace, undang approver (role approver).
    await signIn(ownerPage);
    await ownerPage.goto("/pengaturan/organisasi");
    await ownerPage.getByLabel("Nama organisasi").fill(`Organisasi P4 ${slug}`);
    await ownerPage.getByLabel(/Slug \(huruf kecil/).fill(`org-p4-${slug}`);
    await ownerPage.getByRole("button", { name: "Buat organisasi" }).click();
    await expect(ownerPage.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
    await ownerPage.getByLabel("Nama workspace").fill(`Workspace P4 ${slug}`);
    await ownerPage.getByLabel("Slug", { exact: true }).fill(`ws-p4-${slug}`);
    await ownerPage.getByRole("button", { name: "Buat workspace" }).click();
    await expect(ownerPage.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });
    await ownerPage.goto("/pengaturan/anggota");
    await ownerPage
      .getByLabel("Email yang diundang")
      .fill(process.env.E2E_APPROVER_EMAIL as string);
    await ownerPage.locator("#invite-role").selectOption("approver");
    await ownerPage.getByRole("button", { name: "Kirim undangan" }).click();
    // Token ditampilkan sekali di halaman bila email otomatis belum
    // dikonfigurasi; bila tidak tampil (email terkirim), tes ini tidak
    // bisa lanjut tanpa akses inbox — skip dengan jelas.
    const tokenCode = ownerPage.locator("code", { hasText: "/undangan/" }).first();
    let token: string | null = null;
    try {
      await tokenCode.waitFor({ state: "visible", timeout: 15000 });
      const text = (await tokenCode.textContent()) ?? "";
      token = text.replace("/undangan/", "").trim();
    } catch {
      test.skip(
        true,
        "Token undangan tidak tampil di halaman (email otomatis aktif?) — tidak bisa lanjut tanpa inbox.",
      );
    }
    expect(token).toBeTruthy();

    // B. Approver: masuk + terima undangan.
    await signIn(
      approverPage,
      process.env.E2E_APPROVER_EMAIL as string,
      process.env.E2E_APPROVER_PASSWORD as string,
    );
    await approverPage.goto(`/undangan/${token}`);
    await approverPage.getByRole("button", { name: "Terima undangan" }).click();
    await expect(approverPage.getByRole("link", { name: /Ke Command Center/ })).toBeVisible({
      timeout: 30000,
    });

    // C. Owner: brand + konten + submit v1 (step default sudah menugaskan
    //    role approver — approver baru cocok lewat role, tanpa penugasan
    //    eksplisit).
    await ownerPage.goto("/merek");
    await ownerPage.locator("#brand-name-new").fill(`Brand P4 ${slug}`);
    await ownerPage.locator("#brand-slug-new").fill(`brand-p4-${slug}`);
    await ownerPage.getByRole("button", { name: "Buat brand" }).click();
    await expect(ownerPage.getByText("Brand dibuat.", { exact: true })).toBeVisible({ timeout: 30000 });
    await ownerPage.goto("/konten/baru");
    await ownerPage.getByLabel(/Brand/).selectOption({ label: `Brand P4 ${slug}` });
    await ownerPage.getByLabel("Judul konten").fill(`Konten P4 ${slug}`);
    await ownerPage
      .getByLabel("Ringkasan perubahan (wajib — tercatat di versi)")
      .fill("Versi awal (v1)");
    await ownerPage.getByRole("button", { name: "Buat konten (v1)" }).click();
    await expect(ownerPage.getByText("Konten dibuat beserta versi v1.")).toBeVisible({
      timeout: 30000,
    });
    await ownerPage.goto("/konten");
    await ownerPage.getByRole("link", { name: `Konten P4 ${slug}` }).click();
    await expect(ownerPage.getByRole("heading", { name: `Konten P4 ${slug}` })).toBeVisible();
    // Pindah stage ke Editing dulu (submit hanya dari editing, RPC 0014).
    await walkToEditing(ownerPage);
    await ownerPage.getByRole("tab", { name: "Approval" }).click();
    await ownerPage.getByRole("button", { name: "Ajukan v1 untuk approval" }).click();
    await expect(ownerPage.getByText("Konten diajukan untuk approval")).toBeVisible({
      timeout: 30000,
    });

    // D. Approver: antrean Menunggu saya → buka konten → setujui.
    await approverPage.goto("/persetujuan?tab=menunggu_saya");
    await expect(approverPage.getByRole("link", { name: `Konten P4 ${slug}` })).toBeVisible({
      timeout: 30000,
    });
    await approverPage.getByRole("link", { name: `Konten P4 ${slug}` }).click();
    await approverPage.getByRole("tab", { name: "Approval" }).click();
    const decisionForm = approverPage.locator("form", {
      has: approverPage.getByText("Keputusan Anda"),
    });
    await expect(decisionForm.getByLabel("Minta revisi", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await decisionForm.getByRole("button", { name: "Kirim keputusan" }).click();
    await expect(approverPage.getByText("disetujui")).toBeVisible({ timeout: 30000 });
    await expect(approverPage.getByText("Status produksi: approved")).toBeVisible({
      timeout: 30000,
    });

    await ownerPage.close();
    await approverPage.close();
  });
});

test.describe("smoke — Approval Center (tanpa login)", () => {
  test("halaman persetujuan menampilkan ajakan masuk", async ({ page }) => {
    await page.goto("/persetujuan");
    await expect(page.getByText("Anda belum masuk")).toBeVisible();
  });
});
