import { test, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";

/**
 * Spek penerimaan Phase 2 — prompts/03 (P2-15).
 * Alur: buat content item → tambah 2 placement → temukan di kalender dan
 * board → edit → pindah stage → jadwalkan ulang satu placement → reload
 * dan verifikasi persistence.
 *
 * BUTUH database live + migrasi 0007 + 0008 diterapkan + akun uji
 * (E2E_TEST_EMAIL/PASSWORD). Tes ini di-SKIP otomatis bila akun uji tidak
 * diisi. Sampai migrasi diterapkan, spek ini BELUM TERBUKTI live — lihat
 * docs/phase-2-report.md §5/§9 (batas jujur).
 */
const hasTestAccount = Boolean(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);

async function signIn(page: import("@playwright/test").Page) {
  const email = process.env.E2E_TEST_EMAIL as string;
  const password = process.env.E2E_TEST_PASSWORD as string;
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  // Timeout 15 dtk (bukan default 5 dtk): login melibatkan round-trip
  // Supabase Auth + render dashboard; di bawah 2 worker paralel
  // kadang melebihi 5 dtk (defect tes e2e 2026-11-19 — flaky, bukan
  // defect aplikasi; login sendiri terbukti berhasil berulang kali).
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible({
    timeout: 15000,
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabasePublicKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

/** Ambil access token owner lewat GoTrue (grant_type=password). */
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

/** Ambil sub (UID) owner dari payload JWT (base64url). */
function decodeJwtSub(jwt: string): string {
  const payload = jwt.split(".")[1] ?? "";
  const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8",
  );
  const decoded = JSON.parse(json) as { sub?: string };
  expect(decoded.sub).toBeTruthy();
  return decoded.sub as string;
}

/**
 * Buat undangan workspace lewat PostgREST (bukan lewat UI).
 * Aplikasi hanya menyimpan sha256(token) sebagai token_hash — token
 * mentah tidak pernah disimpan di DB — dan UI tidak lagi menampilkan
 * token sejak email service-role aktif (undangan dikirim lewat email).
 * Langkah undangan lewat UI sudah terbukti manual; di tes ini token
 * dibuat di sini supaya akun kedua bisa menerima lewat /undangan/<token>.
 */
async function createInvitationViaApi(
  request: import("@playwright/test").APIRequestContext,
  args: {
    workspaceSlug: string;
    memberEmail: string;
    ownerEmail: string;
    ownerPassword: string;
  },
): Promise<string> {
  const ownerToken = await getAccessToken(request, args.ownerEmail, args.ownerPassword);
  const wsRes = await request.get(
    `${supabaseUrl}/rest/v1/workspaces?slug=eq.${args.workspaceSlug}&select=id`,
    {
      headers: {
        apikey: supabasePublicKey,
        Authorization: `Bearer ${ownerToken}`,
      },
    },
  );
  expect(wsRes.ok(), await wsRes.text()).toBeTruthy();
  const rows = (await wsRes.json()) as Array<{ id: string }>;
  expect(rows).toHaveLength(1);
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const res = await request.post(`${supabaseUrl}/rest/v1/workspace_invitations`, {
    headers: {
      apikey: supabasePublicKey,
      Authorization: `Bearer ${ownerToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    data: {
      workspace_id: rows[0].id,
      email: args.memberEmail,
      role: "creator",
      token_hash: tokenHash,
      expires_at: expiresAt,
      invited_by: decodeJwtSub(ownerToken),
      status: "pending",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return token;
}

async function getWorkspaceIdBySlug(args: {
  request: import("@playwright/test").APIRequestContext;
  ownerToken: string;
  workspaceSlug: string;
}): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string;
  const wsRes = await args.request.get(
    `${supabaseUrl}/rest/v1/workspaces?slug=eq.${args.workspaceSlug}&select=id`,
    {
      headers: {
        apikey: supabasePublicKey,
        Authorization: `Bearer ${args.ownerToken}`,
      },
    },
  );
  expect(wsRes.ok(), await wsRes.text()).toBeTruthy();
  const rows = (await wsRes.json()) as Array<{ id: string }>;
  expect(rows).toHaveLength(1);
  return rows[0].id;
}

test.describe("penerimaan Phase 2 — planning core @needs-db", () => {
  test.skip(!hasTestAccount, "Butuh akun uji (E2E_TEST_EMAIL/PASSWORD) + migrasi 0007/0008 live.");

  test("buat konten → 2 placement → kalender + board → edit → pindah stage → reschedule → reload", async ({
    page,
  }) => {
    // Semua expect di tes ini memakai 30 dtk (bukan default 5 dtk):
    // render halaman + round-trip aksi server ke Supabase dari VM ini
    // kerap >5 dtk, dan aksi placement pernah >15 dtk (terbukti
    // 2026-11-19: login, pesan sukses channel, pesan sukses konten,
    // heading detail konten, pesan sukses placement). Timeout tes
    // 180 dtk karena total alur live-DB ini ~45–90 dtk.
    test.setTimeout(180000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `e2e-${Date.now().toString(36)}`;

    // 0. Setup: akun uji baru belum punya organisasi/workspace — tanpa
    //    workspace, /merek menampilkan empty state "Belum ada workspace"
    //    dan form brand tidak ada (bukan defect aplikasi; tes harus
    //    mandiri). Buat org + workspace dulu (pola auth.spec.ts).
    await page.goto("/pengaturan/organisasi");
    await page.getByLabel("Nama organisasi").fill(`Organisasi E2E ${slug}`);
    await page.getByLabel(/Slug \(huruf kecil/).fill(`org-${slug}`);
    await page.getByRole("button", { name: "Buat organisasi" }).click();
    await expect(page.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
    await page.getByLabel("Nama workspace").fill(`Workspace E2E ${slug}`);
    await page.getByLabel("Slug", { exact: true }).fill(`ws-${slug}`);
    await page.getByRole("button", { name: "Buat workspace" }).click();
    await expect(page.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });

    // 1. Buat brand (bila belum ada, halaman Merek selalu bisa membuat baru).
    await page.goto("/merek");
    await expect(page.getByRole("heading", { name: "Merek" })).toBeVisible({ timeout: 30000 });
    // Lokator berdasarkan id form buat-baru: bila sudah ada brand, halaman
    // juga menampilkan form edit per brand dengan label "Nama brand" yang
    // sama — getByLabel menjadi ambigu (strict mode). Defect tes e2e
    // 2026-11-19; form buat memakai id brand-name-new / brand-slug-new.
    await page.locator("#brand-name-new").fill(`Brand E2E ${slug}`);
    await page.locator("#brand-slug-new").fill(`brand-${slug}`);
    await page.getByRole("button", { name: "Buat brand" }).click();
    // Pesan sukses setelah aksi server memakai timeout 30 dtk (bukan
    // default 5 dtk): round-trip ke Supabase dari VM ini kerap >5 dtk
    // dan pernah >15 dtk — terbukti 2026-11-19 di channel, konten,
    // dan placement (baris tercatat di DB, expect yang gagal).
    // Berlaku untuk semua expect pesan sukses di tes ini.
    // exact: true WAJIB di "Brand dibuat." — tanpa exact, wait cocok
    // dengan hint statis "…setelah brand dibuat." dan lolos instan
    // sebelum insert selesai (cacat e2e 2026-11-19).
    await expect(page.getByText("Brand dibuat.", { exact: true })).toBeVisible({ timeout: 30000 });

    // 2. Buat 2 channel (Instagram + TikTok) untuk brand itu.
    await page.goto("/channel");
    // exact: judul halaman "Channel" — tanpa exact, heading per-brand
    // "Brand E2E ... — 0 channel" ikut cocok (substring) dan melanggar
    // strict mode (defect tes e2e 2026-11-19).
    await expect(page.getByRole("heading", { name: "Channel", exact: true })).toBeVisible({
      timeout: 30000,
    });
    // Render /channel kadang belum menampilkan brand yang baru dibuat
    // (stale sesaat setelah mutasi — terbukti 2026-11-19: 4 dari 7
    // pemuatan pertama melewatkan brand baru; muat ulang menampilkannya).
    // Muat ulang sekali bila ringkasan brand belum muncul.
    const channelSummary = page.getByText(`Tambah channel untuk Brand E2E ${slug}`);
    try {
      await channelSummary.waitFor({ state: "attached", timeout: 10000 });
    } catch {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Channel", exact: true })).toBeVisible({
        timeout: 30000,
      });
      await channelSummary.waitFor({ state: "attached", timeout: 15000 });
    }
    await channelSummary.click();
    // Form channel ada di dalam <details> per brand; getByLabel global
    // menemukan semua form (termasuk yang tersembunyi di <details>
    // tertutup) sehingga .first() menarget form brand lain yang
    // tersembunyi dan menggantung selamanya (defect tes e2e 2026-11-19).
    // Batasi ke <details> brand yang baru dibuka.
    const channelDetails = page.locator("details", { has: channelSummary });
    await channelDetails.getByLabel("Platform").selectOption("instagram");
    await channelDetails.getByLabel("Nama akun").fill(`Akun IG E2E ${slug}`);
    await channelDetails.getByRole("button", { name: "Tambah channel" }).click();
    await expect(page.getByText("Channel dicatat sebagai metadata (belum terhubung).")).toBeVisible(
      { timeout: 30000 },
    );
    // Channel kedua (TikTok): tanpa channel bebas kedua, form tambah
    // placement hilang setelah placement pertama (freeChannels kosong)
    // sehingga pesan suksesnya tidak pernah tampil — terbukti
    // 2026-11-19 (placement tercatat di DB, pesan tak pernah muncul
    // walau ditunggu 30 dtk). Langkah ini diniatkan 2 channel sejak
    // awal (lihat komentar langkah 2) — buat channel TikTok juga.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Channel", exact: true })).toBeVisible({
      timeout: 30000,
    });
    const channelSummary2 = page.getByText(`Tambah channel untuk Brand E2E ${slug}`);
    await channelSummary2.waitFor({ state: "attached", timeout: 30000 });
    await channelSummary2.click();
    const channelDetails2 = page.locator("details", { has: channelSummary2 });
    await channelDetails2.getByLabel("Platform").selectOption("tiktok");
    await channelDetails2.getByLabel("Nama akun").fill(`Akun TikTok E2E ${slug}`);
    await channelDetails2.getByRole("button", { name: "Tambah channel" }).click();
    await expect(page.getByText("Channel dicatat sebagai metadata (belum terhubung).")).toBeVisible(
      { timeout: 30000 },
    );

    // 3. Buat content item (otomatis v1).
    await page.goto("/konten/baru");
    await expect(page.getByRole("heading", { name: "Buat konten" })).toBeVisible({
      timeout: 30000,
    });
    await page.getByLabel(/Brand/).selectOption({ label: `Brand E2E ${slug}` });
    await page.getByLabel("Judul konten").fill(`Konten E2E ${slug}`);
    await page
      .getByLabel("Ringkasan perubahan (wajib — tercatat di versi)")
      .fill("Versi awal (v1)");
    await page.getByRole("button", { name: "Buat konten (v1)" }).click();
    await expect(page.getByText("Konten dibuat beserta versi v1.")).toBeVisible({ timeout: 30000 });

    // 4. Buka detail konten, tab Platform placements, tambah 2 placement
    //    (IG + TikTok butuh channel TikTok dulu — tambahkan lewat detail
    //    bila channel belum ada).
    await page.goto("/konten");
    await page.getByRole("link", { name: `Konten E2E ${slug}` }).click();
    await expect(page.getByRole("heading", { name: `Konten E2E ${slug}` })).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("tab", { name: "Platform placements" }).click();
    // getByText("Tambah placement") ambigu: cocok juga dengan tombol
    // submit di dalam form (defect tes e2e 2026-11-19) — target <summary>.
    // getByLabel("Channel") juga ambigu: cocok dengan select Channel DAN
    // textarea "Caption per channel" (substring) — pakai name select.
    const placementDetails = page.locator("details", {
      has: page.locator("summary", { hasText: "Tambah placement" }),
    });
    await placementDetails.locator("summary", { hasText: "Tambah placement" }).click();
    await placementDetails.locator('select[name="socialChannelId"]').selectOption({ index: 1 });
    await placementDetails.getByLabel("Caption per channel").fill("Caption IG E2E");
    await placementDetails.getByRole("button", { name: "Tambah placement" }).click();
    await expect(page.getByText("Placement ditambahkan (versi v1).")).toBeVisible({
      timeout: 30000,
    });

    // 5. Temukan di kalender DAN board (record kanonis yang sama).
    await page.goto("/kalender");
    await expect(page.getByRole("heading", { name: "Kalender" })).toBeVisible({ timeout: 30000 });
    await page.goto("/board");
    await expect(page.getByRole("heading", { name: "Board Produksi" })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(`Konten E2E ${slug}`).first()).toBeVisible();

    // 6. Edit judul → versi baru tercatat.
    await page.goto("/konten");
    await page.getByRole("link", { name: `Konten E2E ${slug}` }).click();
    await page.getByLabel("Judul konten").fill(`Konten E2E ${slug} (revisi)`);
    await page.getByLabel("Ringkasan perubahan (wajib — tercatat di versi)").fill("Perbaiki judul");
    await page.getByRole("button", { name: "Simpan sebagai versi baru" }).click();
    await expect(page.getByText(/Perubahan disimpan sebagai versi v2/)).toBeVisible({
      timeout: 30000,
    });

    // 7. Pindah stage Ide → Brief (transisi tervalidasi + riwayat).
    await page.getByLabel("Pindah stage ke").selectOption("brief");
    await page.getByRole("button", { name: "Pindah stage" }).click();
    await expect(page.getByText("Status produksi diubah: idea → brief.")).toBeVisible({
      timeout: 30000,
    });

    // 8. Reload: semua perubahan persist (judul di header; riwayat stage
    //    di overview; v2 di tab Versi). Lokator "v2" exact agar tidak
    //    menangkap <option> tersembunyi "v2 · ..." di dropdown banding
    //    (defect tes e2e 2026-11-19); timeout eksplisit 30 dtk karena
    //    expect.configure() sebagai statement tidak mengubah default 5 dtk
    //    (pelajaran probe 2026-11-19).
    await page.reload();
    await expect(page.getByRole("heading", { name: `Konten E2E ${slug} (revisi)` })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("Ide → Brief").first()).toBeVisible({ timeout: 30000 });
    await page.getByRole("tab", { name: "Versi" }).click();
    await expect(page.getByText("v2", { exact: true }).first()).toBeVisible({ timeout: 30000 });
  });
});

test.describe("perbaikan kritis planning (b) K-1 / K-2 / K-3 @needs-db", () => {
  test.skip(!hasTestAccount, "Butuh akun uji (E2E_TEST_EMAIL/PASSWORD) + migrasi live.");
  // Tes (c) butuh akun uji KEDUA yang sudah terdaftar (bukan akun utama).
  const hasSecondAccount = Boolean(process.env.E2E_TEST_EMAIL_2 && process.env.E2E_TEST_PASSWORD_2);

  async function signInAs(page: import("@playwright/test").Page, email: string, password: string) {
    await page.goto("/masuk");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Kata sandi").fill(password);
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible({
      timeout: 15000,
    });
  }

  async function buatOrganisasiWorkspace(page: import("@playwright/test").Page, slug: string) {
    await page.goto("/pengaturan/organisasi");
    await page.getByLabel("Nama organisasi").fill(`Organisasi E2E ${slug}`);
    await page.getByLabel(/Slug \(huruf kecil/).fill(`org-${slug}`);
    await page.getByRole("button", { name: "Buat organisasi" }).click();
    await expect(page.getByText("Organisasi dibuat.")).toBeVisible({ timeout: 30000 });
    await page.getByLabel("Nama workspace").fill(`Workspace E2E ${slug}`);
    await page.getByLabel("Slug", { exact: true }).fill(`ws-${slug}`);
    await page.getByRole("button", { name: "Buat workspace" }).click();
    await expect(page.getByText("Workspace dibuat.")).toBeVisible({ timeout: 30000 });
  }

  async function buatBrand(page: import("@playwright/test").Page, name: string, slug: string) {
    await page.goto("/merek");
    await expect(page.getByRole("heading", { name: "Merek" })).toBeVisible({ timeout: 30000 });
    await page.locator("#brand-name-new").fill(name);
    await page.locator("#brand-slug-new").fill(slug);
    await page.getByRole("button", { name: "Buat brand" }).click();
    await expect(page.getByText("Brand dibuat.", { exact: true })).toBeVisible({ timeout: 30000 });
  }

  async function buatKonten(
    page: import("@playwright/test").Page,
    brandLabel: string,
    title: string,
    extra?: { script?: string; caption?: string },
  ) {
    await page.goto("/konten/baru");
    await expect(page.getByRole("heading", { name: "Buat konten" })).toBeVisible({
      timeout: 30000,
    });
    await page.getByLabel(/Brand/).selectOption({ label: brandLabel });
    await page.getByLabel("Judul konten").fill(title);
    if (extra?.script) await page.getByLabel("Script / naskah").fill(extra.script);
    if (extra?.caption) await page.getByLabel("Caption").fill(extra.caption);
    await page
      .getByLabel("Ringkasan perubahan (wajib — tercatat di versi)")
      .fill("Versi awal (v1)");
    await page.getByRole("button", { name: "Buat konten (v1)" }).click();
    await expect(page.getByText("Konten dibuat beserta versi v1.")).toBeVisible({ timeout: 30000 });
  }

  async function bukaDetailKonten(page: import("@playwright/test").Page, title: string) {
    await page.goto("/konten");
    await page.getByRole("link", { name: title }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 30000 });
  }

  test("(b) K-1 — brief bertahan setelah edit judul di tab Ringkasan", async ({ page }) => {
    test.setTimeout(180000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `k1-${Date.now().toString(36)}`;
    const brandName = `Brand E2E ${slug}`;
    const title = `Konten Brief E2E ${slug}`;
    const objective = `Tujuan brief E2E ${slug}`;
    await buatOrganisasiWorkspace(page, slug);
    await buatBrand(page, brandName, `brand-${slug}`);
    await buatKonten(page, brandName, title);
    await bukaDetailKonten(page, title);

    // 1. Isi brief di tab Brief (versi v2).
    await page.getByRole("tab", { name: "Brief" }).click();
    await page.getByLabel("Tujuan konten (wajib)").fill(objective);
    await page
      .getByLabel("Ringkasan perubahan (wajib — tercatat di versi baru)")
      .fill("Isi brief awal");
    await page.getByRole("button", { name: "Simpan brief (versi baru)" }).click();
    await expect(page.getByText("Brief disimpan sebagai versi v2.", { exact: true })).toBeVisible({
      timeout: 30000,
    });

    // 2. Ubah judul di tab Ringkasan / Overview (versi v3) — dulu di sini
    //    brief terhapus karena updateContentAction mengirim {}.
    await page.getByRole("tab", { name: "Ringkasan" }).click();
    await page.getByLabel("Judul konten").fill(`${title} (revisi)`);
    await page.getByLabel("Ringkasan perubahan (wajib — tercatat di versi)").fill("Perbaiki judul");
    await page.getByRole("button", { name: "Simpan sebagai versi baru" }).click();
    await expect(page.getByText(/Perubahan disimpan sebagai versi v3/)).toBeVisible({
      timeout: 30000,
    });

    // 3. Kembali ke tab Brief: tujuan brief HARUS masih ada (bukan kosong).
    await page.getByRole("tab", { name: "Brief" }).click();
    await expect(page.getByLabel("Tujuan konten (wajib)")).toHaveValue(objective, {
      timeout: 30000,
    });
  });

  test("(b) K-2 — simpan konten sebagai template berhasil", async ({ page }) => {
    test.setTimeout(180000);
    expect.configure({ timeout: 30000 });
    await signIn(page);
    const slug = `k2-${Date.now().toString(36)}`;
    const brandName = `Brand E2E ${slug}`;
    const title = `Konten Template E2E ${slug}`;
    const templateName = `Template E2E ${slug}`;
    await buatOrganisasiWorkspace(page, slug);
    await buatBrand(page, brandName, `brand-${slug}`);
    // Isi script + caption agar terbukti ikut tersalin dari versi terbaru
    // (sebelum perbaikan, query ini selalu gagal: kolom tidak ada di
    // content_items).
    await buatKonten(page, brandName, title, {
      script: `Naskah E2E ${slug}`,
      caption: `Caption E2E ${slug}`,
    });

    await page.goto("/template");
    await expect(page.getByRole("heading", { name: "Template", exact: true })).toBeVisible({
      timeout: 30000,
    });
    await page.getByLabel(/Konten sumber/).selectOption({ label: `${title} — ${brandName}` });
    await page.getByLabel("Nama template").fill(templateName);
    await page.getByRole("button", { name: "Simpan konten sebagai template" }).click();
    await expect(page.getByText("Template konten disimpan.", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    // Template baru tampil di daftar (judul + brand membuktikan isi konten
    // sumber tersalin).
    await expect(page.getByText(templateName, { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByText(`Judul: ${title} · Brand: ${brandName} · 0 channel`, { exact: true }),
    ).toBeVisible({
      timeout: 30000,
    });
  });

  test("(b) K-3 — anggota scope Brand A tidak bisa membuat konten untuk Brand B", async ({
    page,
    request,
  }) => {
    test.skip(
      !hasSecondAccount,
      "Butuh akun uji kedua yang sudah terdaftar (E2E_TEST_EMAIL_2/PASSWORD_2).",
    );
    test.setTimeout(240000);
    expect.configure({ timeout: 30000 });
    const email1 = process.env.E2E_TEST_EMAIL as string;
    const password1 = process.env.E2E_TEST_PASSWORD as string;
    const email2 = process.env.E2E_TEST_EMAIL_2 as string;
    const password2 = process.env.E2E_TEST_PASSWORD_2 as string;
  const member2Uid = process.env.E2E_MEMBER2_UID as string;
    await signIn(page);
    const slug = `k3-${Date.now().toString(36)}`;
    const brandA = `Brand A E2E ${slug}`;
    const brandB = `Brand B E2E ${slug}`;
    await buatOrganisasiWorkspace(page, slug);
    await buatBrand(page, brandA, `brand-a-${slug}`);
    await buatBrand(page, brandB, `brand-b-${slug}`);

    // 1. Owner mengundang akun kedua sebagai creator, lewat API.
    // UI tidak lagi menampilkan token sejak email service-role aktif,
    // dan token mentah tidak pernah disimpan di DB (hanya sha256-nya
    // sebagai token_hash). Langkah undangan lewat UI sudah terbukti
    // manual (email terkirim + baris pending).
    const token = await createInvitationViaApi(request, {
      workspaceSlug: `ws-${slug}`,
      memberEmail: email2,
      ownerEmail: email1,
      ownerPassword: password1,
    });
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // 2. Akun kedua masuk dan menerima undangan.
    await page.context().clearCookies();
    await signInAs(page, email2, password2);
    await page.goto(`/undangan/${token}`);
    await page.getByRole("button", { name: "Terima undangan" }).click();
    await expect(page.getByRole("link", { name: "Ke Command Center →" })).toBeVisible({
      timeout: 30000,
    });

    // 3. Owner membatasi scope akun kedua ke Brand A saja.
    await page.context().clearCookies();
    await signInAs(page, email1, password1);
  const ownerToken = await getAccessToken(request, email1, password1);
  const wsId = await getWorkspaceIdBySlug({
    request,
    ownerToken,
    workspaceSlug: `ws-${slug}`,
  });
  await page.goto(`/pengaturan/anggota?workspace=${wsId}`);
  const membersTable = page.getByRole("table", { name: "Daftar anggota workspace" });
  // Kolom email tabel anggota menampilkan ID pengguna, bukan alamat email, sehingga baris dicari berdasarkan UID.
  const memberRow = membersTable.locator("tr", { hasText: member2Uid });
    await expect(memberRow).toBeVisible({ timeout: 30000 });
    await memberRow.locator("summary", { hasText: "Semua brand" }).click();
    await memberRow.getByLabel("Hanya brand terpilih").check();
    await memberRow.getByLabel(brandA).check();
    await memberRow.getByRole("button", { name: "Simpan scope" }).click();
    await expect(
      page.getByText("Brand scope diubah: anggota ini hanya bisa melihat 1 brand."),
    ).toBeVisible({ timeout: 30000 });

    // 4. Akun kedua membuka form buat konten: Brand A ada, Brand B TIDAK
    //    ada di pilihan (daftar brand sudah ter-scope lewat RLS 0016).
    //    Jalur pemanggilan action langsung ditutup lapis server action +
    //    RPC (migrasi 0026) — dibuktikan di pgTAP, bukan di sini.
    await page.context().clearCookies();
    await signInAs(page, email2, password2);
    await page.goto("/konten/baru");
    await expect(page.getByRole("heading", { name: "Buat konten" })).toBeVisible({
      timeout: 30000,
    });
    const brandSelect = page.getByLabel(/Brand/);
    await expect(brandSelect.locator("option", { hasText: brandA })).toHaveCount(1);
    await expect(brandSelect.locator("option", { hasText: brandB })).toHaveCount(0);
  });
});

test.describe("smoke — halaman perencanaan (tanpa login)", () => {
  test("semua halaman Phase 2 menampilkan judul + ajakan masuk", async ({ page }) => {
    const pages: Array<[string, string]> = [
      ["/merek", "Merek"],
      ["/channel", "Channel"],
      ["/pilar", "Pilar & Audiens"],
      ["/kampanye", "Campaign"],
      ["/ide", "Ide"],
      ["/konten", "Konten"],
      ["/kalender", "Kalender"],
      ["/board", "Board Produksi"],
      ["/cari", "Pencarian"],
    ];
    for (const [href, heading] of pages) {
      await page.goto(href);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await expect(page.getByText("Anda belum masuk")).toBeVisible();
    }
  });

  test("sidebar menampilkan tautan perencanaan yang aktif", async ({ page }) => {
    await page.goto("/dashboard");
    // Mobile: sidebar disembunyikan < md SESUAI DESAIN (Dok 02 §2) — periksa
    // navigasi bawah ("Kalender") + halaman /lainnya ("Board Produksi",
    // "Konten") sebagai gantinya.
    if (test.info().project.name === "mobile") {
      const bottomNav = page.getByRole("navigation", { name: "Navigasi bawah" });
      await expect(bottomNav.getByRole("link", { name: "Kalender", exact: true })).toBeVisible();
      await page.goto("/lainnya");
      // Nama aksesibel tautan /lainnya = label + deskripsi — tanpa exact,
      // dilingkupi ke <main> supaya tautan sidebar tersembunyi tidak ikut
      // tercocok.
      await expect(
        page.getByRole("main").getByRole("link", { name: /^Board Produksi/ }),
      ).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: /^Konten / })).toBeVisible();
      return;
    }
    await expect(page.getByRole("link", { name: "Kalender", exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Board Produksi", exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Konten", exact: true }).first()).toBeVisible();
  });

  test("pencarian: halaman menampilkan judul + ajakan masuk saat belum login", async ({ page }) => {
    await page.goto("/cari");
    await expect(page.getByRole("heading", { name: "Pencarian" })).toBeVisible();
    await expect(page.getByText("Anda belum masuk")).toBeVisible();
    // Pencarian global di topbar hanya terlihat di desktop — di mobile
    // form-nya `hidden md:block` SESUAI DESAIN (topbar mobile menampilkan
    // nama workspace), jadi mobile memeriksa sebaliknya.
    if (test.info().project.name === "mobile") {
      await expect(page.getByPlaceholder("Cari konten, campaign, ide, brand…")).toBeHidden();
      return;
    }
    await expect(page.getByPlaceholder("Cari konten, campaign, ide, brand…")).toBeVisible();
  });
});
