# Laporan Fase 5 — Campaign & Visual Planning, P5-01 s.d. P5-09 (MaTive DRAF)

> Status: **SELESAI DIKEMBANGKAN (lokal), BELUM DILOLOSKAN LIVE.**
> Migrasi 0016 + 0017 BELUM diterapkan ke database live. pgTAP 05 + e2e
> Phase 5 BELUM dijalankan live — menunggu parent (§8). Jangan klaim
> Phase 5 lolos sebelum §8 selesai dan §11 ditandatangani parent.

## 1. Ringkasan hasil

| Item                                             | Hasil (lokal, terverifikasi)                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Migrasi 0016 — brand scope (P1-A7, Keputusan #9) | 401 baris, 44 statement, pglast OK                                                                          |
| Migrasi 0017 — visual planner + template         | 552 baris, 85 statement, pglast OK                                                                          |
| ADR-0011                                         | 212 baris, 10 keputusan terkunci                                                                            |
| pgTAP 05                                         | `supabase/tests/05_rls_phase5.sql`, plan(59), 59 asersi                                                     |
| Verifier statis                                  | `supabase/tests/rls_verify_phase5.py`, **33/33 lolos**                                                      |
| Uji statis migrasi                               | `tests/migrations.test.ts` diperbarui ke 17 migrasi + uji 0016/0017                                         |
| Uji unit baru                                    | 4 file, 30 uji baru (progres, transisi, brand scope, CSV)                                                   |
| Vitest                                           | **165/165 lolos** (16 file)                                                                                 |
| ESLint                                           | 0 error                                                                                                     |
| Typecheck                                        | 0 error                                                                                                     |
| Build                                            | lolos, semua halaman termasuk `/kampanye/[id]`, `/kampanye/[id]/visual`, `/template`                        |
| Prettier                                         | 18 file Phase 5 bersih (2 file pra-Phase 5 dibiarkan, §6.5)                                                 |
| Spek e2e                                         | `e2e/campaign.spec.ts`: 3 tes @needs-db (A5.1, A5.3, A5.5) + 1 smoke = 4 tes × 2 proyek (chromium + mobile) |
| Commit Phase 5                                   | 7 (di atas HEAD Phase 4 `6dc1835`); laporan ini commit ke-8                                                 |

Milestone yang tercapai (v2 + detail §5.1–§5.7):

- **M5.1** — campaign bisa dibuat (objective, date range, audience, brands,
  channels, KPI targets, owner) + brand/konten/placement dihubungkan,
  deliverables tampil (halaman detail `/kampanye/[id]`).
- **M5.2** — progres dihitung dari linked content (rumus tunggal
  `features/campaign/progress.ts`); berubah bila status konten berubah,
  tanpa ketik persentase manual.
- **M5.3** — visual planner tampil (urutan feed, label "approximate") dan
  urutan bisa diubah (drag & drop dnd-kit + tombol naik/turun/lepas/tambah).
- **M5.4** — bukti pemisahan: ubah urutan visual → `scheduled_at` semua
  placement TIDAK BERUBAH (pgTAP T10e/T10f + uji statis badan RPC + e2e A5.3).
- **M5.5** — export/import CSV tervalidasi (export bisa diimpor kembali;
  import baris tidak valid ditolak per baris dengan pesan jelas + laporan).
- **M5.6** — mobile 390 px: planner memakai daftar vertikal + tombol
  (tanpa horizontal overflow; drag adalah tambahan, bukan satu-satunya jalan).

Acceptance A5.1–A5.7 tercakup: A5.1 (detail + tautan), A5.2 (progres),
A5.3 (pemisahan + label approximate), A5.4 (label approximate),
A5.5 (CSV), A5.6 (mobile), A5.7 (tenant scoping + permissions —
pgTAP T2–T8 + T13).

## 2. P5-01 — Keputusan dikunci (ADR-0011)

`docs/decisions/ADR-0011-campaign-visual-planning-phase5.md` (10 keputusan):

1. **Keputusan #4 selesai**: Visual Planner C-2 tidak perlu ditahan —
   persetujuan Tuan sudah ada; langkah 5.5 dibangun penuh sebagai modul lepas.
2. **Brand scope (P1-A7)**: NULL = semua brand; array UUID = hanya brand itu;
   `[]` = tidak ada brand. CHECK NULL-atau-array; helper `brand_in_scope`
   fail-closed untuk elemen bukan UUID.
3. **Penegakan 3 lapis**: RLS (0016) → server action (`getCallerBrandScope` +
   `brandInScope`) → UI editor scope di `/pengaturan/anggota` (owner/admin saja).
4. **Batas jujur scope**: tasks/checklist/assets/comments/notifications
   TIDAK di-scope per brand (hanya brands, pillars, ideas, items,
   campaign_brands yang di-scope; campaigns sendiri TIDAK di-scope).
5. **target_metrics (ASUMSI-5.3)**: bentuk minimal 3 field —
   `target_deliverables` (int ≥ 0, opsional), `target_date` (YYYY-MM-DD,
   opsional), `notes` (≤ 500 karakter, opsional); Zod `strict()`; field lain
   ditolak. Menggantikan peta kunci-metrik → angka bebas (ADR-0007 §5).
   CHECK database ditunda (preseden ADR-0008); pembacaan toleran terhadap
   baris lama (`parseTargetMetricsLenient`).
6. **Rumus progres (ASUMSI-5.2)**: satu tempat, `features/campaign/progress.ts` —
   ready = hanya `production_status='approved'`; persen = ready/total.
7. **Transisi status (ASUMSI-5.5)**: `draft → active → completed → archived`,
   `draft/active → cancelled` (alasan wajib, disimpan di `activity_logs`);
   archived/cancelled terminal.
8. **Urutan visual**: tabel `visual_orders` + RPC `set_visual_order` — TIDAK
   PERNAH menulis `scheduled_at` (R5.1).
9. **Template dasar (ASUMSI-5.4)**: campaign + konten, salinan saja, tanpa
   builder lanjutan.
10. **CSV (ASUMSI-5.6)**: format tetap 12 kolom; `brands` dipisah `;`;
    `deliverables` judul dipisah `;` (tak ditemukan/ambigu dilewati + dicatat);
    `owner_email` harus member aktif; nama duplikat ditolak; laporan
    `{total, imported, failed, errors, linkedDeliverables, skippedDeliverables}`
    - satu entri `activity_logs`.

**Yang TIDAK dibangun** (di luar rencana Phase 5): advanced campaign planning,
template builder lanjutan, analytics provider Phase 7, visual planner sebagai
editor desain, penutupan otomatis request basi (keputusan terbuka Phase 4),
hardening "tampilkan galat query" (Phase 9).

**Perbedaan v2 vs file detail pra-v2** (file detail
`Rencana-Detail-Phase-4-5-6-MaTive.md` masih berisi teks pra-v2; v2 kanonis):

- File detail masih menyebut gate per-fase; v2 menetapkan mode One-Shot
  otomatis penuh (gate otomatis tetap jalan, berhenti hanya pada
  Critical/High/blocker/pembayaran/bahaya).
- File detail langkah 5.5 masih menahan Visual Planner menunggu Keputusan #4;
  v2 sudah mengunci Keputusan #4 (modul lepas) — dibangun penuh.
- File detail masih merujuk `target_metrics` peta bebas (ADR-0007 §5);
  v2 ASUMSI-5.3 mengunci bentuk minimal 3 field.
- Tiga file rencana detail masih harus direvisi mengikuti v2 (item terbuka,
  bukan bagian Phase 5).

## 3. P5-02/P5-03 — Migrasi 0016 + 0017 + verifikasi statis

### 0016 — `supabase/migrations/0016_brand_scope.sql` (401 baris, 44 statement pglast OK)

- CHECK `workspace_members_brand_scope_check` (NULL atau array JSONB).
- Helper baru `brand_in_scope(p_brand_id uuid)` — SECURITY DEFINER,
  `search_path = public, pg_temp`, grant execute hanya ke authenticated.
- Tulis ulang `is_brand_member`, `is_content_item_member`,
  `can_read_placement`, `can_edit_placement` (+ `brand_in_scope`).
  `can_read/can_edit_content_item` ikut ter-scope secara transitif lewat
  `is_content_item_member` (tanpa diubah).
- 15 policy ditulis ulang (brands, content_pillars, ideas, content_items,
  campaign_brands — masing-masing select/insert/update, campaign_brands
  select/insert/delete). Cabang SHARED (`is_resource_shared_with_me`)
  sengaja TIDAK di-scope: berbagi eksplisit mengalahkan scope.
- Tanpa tabel baru; tanpa pelonggaran (`using(true)` = 0).

### 0017 — `supabase/migrations/0017_visual_planner_templates.sql` (552 baris, 85 statement pglast OK)

- 5 tabel baru + RLS aktif kelimanya: `visual_orders`,
  `campaign_templates`, `campaign_template_brands`, `content_templates`,
  `content_template_placements`.
- `visual_orders`: revoke all + grant select saja (tulis hanya via RPC —
  pola approval_requests 0013); policy insert/update/delete `using (false)`.
- Unik ganda: per placement DAN per posisi dalam satu
  (workspace, brand, channel).
- 5 trigger scope `validate_*_scope` (pola 0007) + 2 helper
  `is_campaign_template_member` / `is_content_template_member` (agar policy
  tabel anak tidak memindai tabel lain).
- RPC `set_visual_order(p_workspace_id, p_brand_id, p_channel_id,
p_placement_ids uuid[])` — SECURITY DEFINER, validasi 7 poin Dok 06 §4 +
  scope brand + tenant + duplikat + kepemilikan tiap placement, hapus +
  tulis ulang posisi dalam SATU transaksi, jejak audit ke `activity_logs`,
  daftar kosong = hapus semua urutan untuk scope itu, **TIDAK PERNAH
  menulis `scheduled_at`**.
- `content_template_placements` menyimpan channel + format SAJA (tanpa
  `scheduled_at` — template tidak membawa jadwal).

### pgTAP 05 — `supabase/tests/05_rls_phase5.sql` (685 baris, plan(59), 59 asersi)

| Tes | Isi                                                                                               | Asersi |
| --- | ------------------------------------------------------------------------------------------------- | ------ |
| T2  | `brand_in_scope` langsung (NULL/array/[]/anon)                                                    | 5      |
| T3  | RLS brands — member ber-scope hanya melihat brand-nya                                             | 4      |
| T4  | RLS content_items — item brand luar scope tersembunyi                                             | 4      |
| T5  | RLS content_placements — ikut ter-scope lewat item                                                | 3      |
| T6  | RLS campaign_brands — tautan brand luar scope tersembunyi                                         | 3      |
| T7  | Cabang SHARED tidak di-scope (item + placement dibagikan tetap terlihat)                          | 2      |
| T8  | Campaigns TIDAK di-scope per brand                                                                | 2      |
| T9  | visual_orders: tulis langsung 42501 (revoke all + grant select)                                   | 4      |
| T10 | RPC happy path + **M5.4** (`scheduled_at` TIDAK BERUBAH, 2 asersi) + jejak audit                  | 7      |
| T11 | RPC validasi: brand/channel/tenant/duplikat/scope (FORBIDDEN vs INVALID_STATE_TRANSITION) + clear | 11     |
| T12 | Trigger scope visual_orders (P0001)                                                               | 3      |
| T13 | Template RLS + trigger scope                                                                      | 5      |
| T14 | CHECK brand_scope (23514; elemen bukan UUID lolos CHECK, ditolak `brand_in_scope`)                | 3      |
| T15 | Unik ganda visual_orders (23505)                                                                  | 3      |

Setup memakai 2 pengguna auth uji (placeholder `:'user_a'` / `:'user_b'`,
diganti UUID nyata saat run live — sama seperti pgTAP 04). User B =
approver WS-A dengan `brand_scope=[Brand A]`, admin WS-B tanpa scope.
Cleanup di akhir file (begin … rollback) menghapus semua data uji.

### Verifier statis — `supabase/tests/rls_verify_phase5.py` (33/33 lolos)

Jalankan: `~/workspace/.venv-pglast/bin/python supabase/tests/rls_verify_phase5.py`
(python3 sistem tidak punya pglast; venv sama seperti Phase 4).
Memeriksa: pglast penuh 0016 (44 stmt) + 0017 (85 stmt) + tes 05 (141 stmt);
plan(59) == 59 asersi; throws_ok 10/10 bentuk 4 argumen; tidak ada UUID
uji nyata; CHECK + helper + 15 policy + shared tidak di-scope; 5 tabel +
RLS + revoke-all + 5 trigger + unik ganda; badan RPC tanpa `scheduled_at`;
forward-reference 0016/0017; graf RLS efektif 0001–0017: **0 siklus,
0 self-loop (164 policy efektif, 41 tabel)**.

### Uji statis migrasi — `tests/migrations.test.ts`

Diperbarui ke 17 migrasi (0001–0017) + uji khusus 0016 (CHECK + helper +
15 policy + shared tidak di-scope) dan 0017 (5 tabel + RLS + RPC —
**badan RPC diuji statis TIDAK menyentuh `scheduled_at` /
`content_placements`**, R5.1) + uji pgTAP 05 (plan(59) + T10e/T10f M5.4).

## 4. P5-04 s.d. P5-08 — Kode aplikasi

### Domain `features/campaign/` (7 file baru)

- `types.ts` — CampaignProgress, CampaignDeliverable (+ placement),
  PlannerPlacement, CampaignTemplate, ContentTemplate, CsvImportReport.
- `progress.ts` — `computeCampaignProgress` (rumus tunggal, ASUMSI-5.2).
- `transitions.ts` — graf `CAMPAIGN_TRANSITIONS` + `campaignTransitionRequiresReason`.
- `constants.ts` — label "approximate", kolom CSV tetap (ASUMSI-5.6),
  pesan tabel belum tersedia.
- `queries.ts` — `getCampaign`, `listCampaignBrands`,
  `listCampaignDeliverables`, `listVisualOrder`, `listPlannerPlacements`,
  `listCampaignTemplates`, `listContentTemplates` (pola `runQuery` Phase 4:
  gagal → `unavailable`, BUKAN `null`).
- `csv.ts` — `exportCampaignsCsv`, `parseCampaignCsv`,
  `validateCampaignCsvRow` (format saja; nomor baris ditambahkan pemanggil).
- `actions.ts` (1.018 baris) — `updateCampaignAction`,
  `transitionCampaignAction` (graf + alasan batal + `activity_logs`),
  `linkCampaignContentAction` / `unlinkCampaignContentAction`,
  `linkCampaignBrandAction`, `saveCampaignAsTemplateAction`,
  `createCampaignFromTemplateAction`, `saveContentAsTemplateAction`
  (isi dari konten sumber bila ada), `createContentFromTemplateAction`
  (via RPC `create_content_item_with_version` + placement TANPA jadwal),
  `exportCampaignsCsvAction` (capability `export_data`),
  `importCampaignsCsvAction` (per baris gagal tidak membatalkan baris lain),
  `setMemberBrandScopeAction` (hanya owner/admin).

### Domain `features/visual-planner/` (2 file baru)

- `actions.ts` — `setVisualOrderAction` (satu-satunya jalan tulis urutan:
  RPC `set_visual_order`).
- `components/VisualPlannerClient.tsx` — dnd-kit (drag + keyboard) +
  tombol naik/turun/lepas/tambah (alternatif sentuh/keyboard); perubahan
  disimpan eksplisit lewat "Simpan urutan"; label "approximate" selalu
  terlihat; `scheduled_at` ditampilkan read-only.

### `lib/` — baru + diubah

- `lib/csv.ts` (baru) — parser + serializer RFC 4180 tulis sendiri
  (tanpa dependensi baru).
- `lib/validation/schemas.ts` — `campaignTargetMetricsSchema` bentuk
  minimal 3 field (strict) + `parseTargetMetricsLenient` + skema
  `campaignUpdateSchema`, `campaignStatusTransitionSchema`,
  `visualOrderSchema`, `campaignTemplateSchema`,
  `createCampaignFromTemplateSchema`, `contentTemplateSchema`,
  `createContentFromTemplateSchema`, `brandScopeSchema`,
  `memberBrandScopeSchema`.
- `lib/permissions.ts` — header diperbarui (scope kini ditegakkan) +
  `brandInScope(scope, brandId)` + tipe `BrandScope`.
- `features/planning/context.ts` — `getCallerBrandScope(workspaceId, userId)`.
- `features/planning/actions.ts` — `createCampaignAction`: target 3 field
  (bukan JSON bebas) + cek scope brand saat membuat campaign.

### Halaman + wiring

- `app/(app)/kampanye/page.tsx` — nama campaign jadi tautan ke detail;
  target tampil lewat `parseTargetMetricsLenient`; seksi Impor/Ekspor CSV
  (`CampaignCsvForms.tsx`: tombol ekspor → unduh Blob; form impor → laporan).
- `app/(app)/kampanye/[id]/page.tsx` (baru) — header + progres (bar +
  hitungan kategori) + transisi status + deliverables (tautan + placement +
  lepas) + tautkan konten + brand (taut/lepas) + tautan Visual Planner per
  brand×channel + ubah campaign + simpan sebagai template.
- `app/(app)/kampanye/[id]/CampaignDetailForms.tsx` (baru) — 7 form klien
  (semua tetap mounted saat menampilkan pesan hasil — pelajaran Phase 3/4).
- `app/(app)/kampanye/[id]/visual/page.tsx` (baru) — pemilih brand +
  channel (tautan) + `VisualPlannerClient`.
- `app/(app)/template/page.tsx` (baru) + `TemplateForms.tsx` — daftar
  template campaign + konten, buat dari template, simpan konten sebagai
  template. BUKAN `/pustaka` (itu Pustaka Aset P3-07) dan BUKAN
  `/template-brief`. Nav "Template" ditambahkan di seksi Perencanaan
  (`AppSidebar.tsx`).
- `app/(app)/pengaturan/anggota/page.tsx` + `AnggotaClient.tsx` — kolom
  "Brand scope (P1-A7)" per anggota (details + radio Semua/Hanya terpilih +
  checkbox brand + simpan; hanya owner/admin).
- `app/(app)/kampanye/CampaignForm.tsx` — textarea JSON target diganti
  3 field (deliverables/date/notes).

### Tes unit

- `tests/campaign-progress.test.ts` — kategori status + persen + status
  tak dikenal (4 uji).
- `tests/campaign-transitions.test.ts` — graf + alasan batal (5 uji).
- `tests/brand-scope.test.ts` — `brandInScope` + `parseTargetMetricsLenient` (9 uji).
- `tests/campaign-csv.test.ts` — parser RFC 4180 + round-trip ekspor-impor
  - validasi baris (12 uji).
- `tests/planning-schemas.test.ts` — uji `target_metrics` lama diperbarui
  ke bentuk 3 field (peta bebas kini DITOLAK).

### e2e — `e2e/campaign.spec.ts` (261 baris; 3 tes @needs-db + 1 smoke)

- **A5.1** — campaign → tautkan konten → progres 0 dari 1 → transisi
  draft → active → simpan template → tampil di `/template`.
- **A5.3** — placement berjadwal 10 Des 2026 10:00 → tambah ke urutan →
  simpan → reload → teks baris (termasuk jadwal) SAMA PERSIS.
- **A5.5** — ekspor CSV (header 12 kolom + campaign ada) → impor 1 baris
  valid + 1 baris tidak valid (status `live`) → "1 campaign diimpor,
  1 baris gagal" + pesan galat + campaign rusak TIDAK muncul.
- **Smoke** (tanpa login) — `/template` menampilkan judul + ajakan masuk.
- Timeout per tes 240 dtk, expect 30 dtk (pola planning.spec.ts).
  Residue: `org-p5-*` / `ws-p5-*` (§8.1).

## 5. P5-09 — Gate lokal (perintah + output aktual)

| Gate      | Perintah                                                                  | Hasil                                                    |
| --------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| Vitest    | `npm test`                                                                | **165/165 lolos** (16 file)                              |
| ESLint    | `npx eslint .`                                                            | 0 error (1 error `set-state-in-effect` diperbaiki, §6.3) |
| Typecheck | `npx tsc --noEmit`                                                        | 0 error (2 putaran perbaikan, §6.1–§6.2)                 |
| Build     | `npm run build`                                                           | lolos (semua halaman, termasuk 3 rute baru)              |
| Verifier  | `~/workspace/.venv-pglast/bin/python supabase/tests/rls_verify_phase5.py` | **33/33 lolos**                                          |
| Prettier  | `npx prettier --check .` lalu `--write` 18 file Phase 5                   | 18 file bersih; 2 file pra-Phase 5 dibiarkan (§6.5)      |

## 6. Defect yang ditemukan & diperbaiki (tidak disembunyikan)

### 6.1 Defect aplikasi — capability `manage_campaigns` / `create_content` tidak ada

`features/campaign/actions.ts`, `features/visual-planner/actions.ts`, dan
`app/(app)/template/page.tsx` memakai nama capability yang tidak ada di
matriks Dok 06 §3 (`manage_campaigns`, `create_content`) — typecheck
menolak 14 lokasi. Diperbaiki ke nama kanonis: `manage_pillars_campaigns`
(campaign), `create_edit_content` (konten), `export_data` (ekspor CSV —
analyst ikut boleh). Pelajaran: nama capability TIDAK boleh ditebak dari
nama fitur; baca `lib/permissions.ts` dulu.

### 6.2 Defect aplikasi — `listCampaigns` mengembalikan QueryResult, bukan QueryOutcome

`exportCampaignsCsvAction` memeriksa `.ok` pada hasil `listCampaigns`
(pola `QueryOutcome`), padahal fungsi itu mengembalikan `QueryResult`
(`{data, unavailable}`). Diperbaiki ke `.unavailable` / `.data`.

### 6.3 Defect lint — `setState` di dalam effect (VisualPlannerClient)

Sinkronisasi `orderedIds` dari props memakai `useEffect` + `setState` —
ESLint `react-hooks/set-state-in-effect` menolak. Diperbaiki ke pola
"adjust state during render" (`prevItemsKey`).

### 6.4 Defect tes — uji `target_metrics` lama mengharapkan peta bebas

`tests/planning-schemas.test.ts` ("target_metrics harus pemetaan kunci →
angka") gagal setelah skema diganti ke bentuk 3 field. Ini perubahan
yang DISENGAJA (ASUMSI-5.3, ADR-0011 §3) — uji diperbarui: bentuk 3 field
lolos, peta lama + nilai tidak valid ditolak.

### 6.5 Prettier — 2 file pra-Phase 5 tidak bersih (dibiarkan, sengaja)

`docs/phase-3-report.md` + `docs/phase-4-report.md` tetap tidak
Prettier-clean (keputusan parent tertunda, sama seperti Phase 4 §6.5).
18 file Phase 5 sudah `--write` dan bersih.

### 6.6 Defect e2e — `selectOption({ label: RegExp })` tidak valid

Playwright `selectOption` hanya menerima label string. Dua pemakaian di
`e2e/campaign.spec.ts` diganti string eksak `"{judul} — Brand E2E {slug}"`.

### 6.7 Defect UI — prefix "Baris N:" ganda di laporan impor CSV

`validateCampaignCsvRow` mengembalikan galat berprefix "Baris N:" dan
UI juga menambahkan "Baris {row}:" — tampil ganda. Diperbaiki: pesan
galat (validasi + resolusi di `actions.ts`) tanpa prefix; nomor baris
hanya ditambahkan UI.

### 6.8 Temuan saat menulis pgTAP 05 (bukan defect — verifikasi desain)

- `can_read_placement` (0007, ditulis ulang 0016) TIDAK punya cabang
  shared — tetapi policy placements SELECT (0007) memakai
  `can_read_content_item(...) OR is_resource_shared_with_me(...)`,
  jadi placement item yang dibagikan TETAP terlihat (T7b). Desain 0016
  sudah benar; tidak ada perubahan migrasi.
- `is_content_item_member` 0016 memakai signature SAMA dengan 0007
  (`(uuid, text[])`) — tidak ada overload ganda. Semantik = keanggotaan
  - scope (bukan cabang owner/brand/kampanye terpisah).

## 7. Batas jujur — yang BELUM terbukti (wajib dibaca parent)

1. **Migrasi 0016 + 0017 BELUM live.** Semua bukti RLS/RPC di atas adalah
   statis (pglast + verifier) dan unit test. pgTAP 05 + e2e BELUM
   dijalankan di database live.
2. **Approval dua-peran belum terbukti live** (bawaan Phase 4) — tidak
   berubah di Phase 5.
3. **CSV `owner_email` hanya bisa diverifikasi bila sama dengan email
   pemanggil.** Email member lain tidak bisa dibaca dari klien aplikasi
   (auth.users hanya admin) — email lain ditolak per baris dengan pesan
   jelas. Ekspor mengisi `owner_email` hanya bila owner = pemanggil.
   Direktori email member adalah pekerjaan lanjutan (bukan Phase 5).
4. **Anggota ber-scope terbatas yang mengubah brand campaign tidak dapat
   melihat/menghapus tautan brand di luar scope-nya** — tautan itu
   DIPERTAHANKAN (fail-safe, bukan dihapus diam-diam). RLS
   melindunginya; lapis aplikasi tidak bisa mendeteksinya.
5. **Template tidak bisa dihapus dari UI** (tidak ada aksi hapus di rencana
   Phase 5). Daftar template hanya bertambah.
6. **Halaman anggota (`/pengaturan/anggota`) membaca kolom `brand_scope`.**
   Bila 0016 belum live, query itu gagal dan daftar anggota tampil kosong
   (bukan crash) — terapkan 0016 dulu (§8 Langkah 1).
7. **QA visual login + mobile 390 px di browser nyata belum ada** (batas
   jujur Phase 4, tetap berlaku). M5.6 dibuktikan lewat layout daftar
   vertikal + tombol (bukan render browser).
8. **Peran "limited" (strategist) untuk campaign** mengikuti preseden
   planning (`can()` mengembalikan true untuk "limited") — nuansa
   "hanya yang ditugaskan" untuk campaign tidak dimodelkan (tidak ada
   field penugasan campaign). Brand scope adalah pembatas tambahannya.
9. **Tiga file rencana detail masih berisi teks pra-v2** (harus direvisi
   mengikuti v2 — item terbuka, §2).
10. **Framework Plan Management masih DRAF** (tidak pernah disetujui
    eksplisit oleh user).

## 8. Instruksi penerapan ke live (untuk parent)

### Prasyarat

- Database live Supabase "mative" (`kwyqtlxglhlvtghfrnhr`) dalam keadaan
  Phase 4: migrasi 0001–0015 live, seed-only.
- Pengguna auth uji pgTAP: A `094e8752-eef4-4f0e-b6ae-2d5813445018`
  (mative-test-a@example.com), B `aabb1dab-77c1-4659-af0e-c703c9de279c`
  (mative-test-b@example.com) — JANGAN pakai UUID palsu 1111.../2222...
  di live (itu hanya placeholder file).
- Akun e2e `mative-e2e@example.com` (UID `ef1c74e3-4a55-4e56-8799-db8f9a194f09`)
  - kata sandi dari handoff internal (TIDAK ada di file ini).
- pgTAP aktif di proyek Supabase (Dashboard → Database → Extensions →
  pgtap) atau `create extension if not exists pgtap;`.
- JANGAN terapkan migrasi dari VM ini — parent yang menerapkan lewat
  SQL Editor (aturan tugas).

### Langkah 1 — Terapkan migrasi, URUTAN INI (lewat SQL Editor, per file per run)

1. **`0016_brand_scope.sql`** — tempel SELURUH isi file ke SQL Editor,
   Run sekali. Dialog yang mungkin muncul:
   - Dialog RLS (file menulis ulang policy): pilih "Run without RLS"
     (migrasi mengaktifkan/menulis ulang RLS sendiri).
   - Dialog destructive dari `drop policy if exists` yang terverifikasi
     sah: pilih "Run query".
   - Verifikasi: 0 galat; `select count(*) from pg_policies where
schemaname = 'public' and tablename in ('brands','content_pillars',
'ideas','content_items','campaign_brands')` = 15 policy baru
     (nama policy sama, definisi baru).
2. **`0017_visual_planner_templates.sql`** — tempel SELURUH isi file,
   Run sekali. Dialog yang mungkin muncul: sama seperti 0016 (policy
   baru + `drop policy if exists` untuk visual_orders no-write +
   `drop trigger if exists`).
   - Verifikasi: 0 galat; 5 tabel baru ada
     (`visual_orders`, `campaign_templates`, `campaign_template_brands`,
     `content_templates`, `content_template_placements`); fungsi
     `public.set_visual_order(uuid, uuid, uuid, uuid[])` ada.
3. **JANGAN ubah migrasi 0001–0015.** Bila ada galat, BERHENTI dan
   laporkan — jangan edit migrasi di live.

### Langkah 2 — Jalankan pgTAP 05 live

1. Di file `supabase/tests/05_rls_phase5.sql`, ganti placeholder:
   `:'user_a'` → `094e8752-eef4-4f0e-b6ae-2d5813445018`,
   `:'user_b'` → `aabb1dab-77c1-4659-af0e-c703c9de279c`
   (atau jalankan via psql dengan `-v user_a=... -v user_b=...`).
2. Tempel SELURUH file ke SQL Editor, Run SEKALI (satu transaksi
   begin … rollback; JANGAN run per bagian — tiap Run adalah sesi baru
   dan transaksi tidak dipertahankan).
3. Hasil yang diharapkan: **59/59 ok, 0 "not ok"**, `finish()` 0 baris,
   residu 0 (rollback membersihkan data uji).
4. Bila gagal: catat nomor tes (Txx) + kode galat (23514/23505/42501/
   P0001) + statement-nya; JANGAN tebak statement yang gagal dari
   pesan saja (pelajaran Phase 4: tebakan browser task tentang T2 vs
   T16 pernah salah) — baca konteks galat + kode aktual.

### Langkah 3 — Jalankan e2e Phase 5 live

```bash
cd ~/workspace/mative/app
E2E_TEST_EMAIL=mative-e2e@example.com E2E_TEST_PASSWORD='<dari handoff internal>' \
  npx playwright test e2e/campaign.spec.ts
```

Hasil yang diharapkan: 3 tes @needs-db + 1 smoke × 2 proyek
(chromium + mobile) = **8 lolos, 0 gagal**. (Regresi: jalankan juga
`e2e/planning.spec.ts` + `e2e/approval.spec.ts` + `e2e/production.spec.ts`
— perubahan `campaignSchema` + `createCampaignAction` menyentuh jalur
Phase 2/3/4.)

### Langkah 4 — Setelah lolos

1. Perbarui `docs/apply-migrations.md` (migrasi kini 0001–0017).
2. Isi §11 laporan ini (deklarasi parent) + perbarui `~/MEMORY.md`
   (buku rencana 7/11 = 64%) + catat satu baris completions
   `C<YYYYMMDDHHMM>-plan` di `~/workspace/monitor/completions.jsonl`.
3. Luncurkan koordinator Phase 6.

### 8.1 Data uji yang tertinggal di live + cara membersihkan

Pola slug residu spek e2e Phase 5: **`org-p5-*` / `ws-p5-*`**
(organisasi `Organisasi E2E p5a-…`, workspace `Workspace E2E p5a-…`,
brand `Brand E2E p5a-…`, dst.). pgTAP 05 membersihkan dirinya sendiri
(rollback) — tidak ada residu pgTAP bila Run sekali sampai selesai.

Pembersihan (sebagai postgres/service role, SETELAH e2e lolos dan
hasilnya dicatat — urutan hapus mengikuti FK, pola Phase 4 §8.1):

```sql
-- 1. Hapus org e2e (cascade ke workspace → brand → item → placement → campaign).
--    Periksa dulu apa yang ada:
select slug from public.organizations where slug like 'org-p5-%';
select slug from public.workspaces where slug like 'ws-p5-%';
-- 2. Hapus workspace + org e2e (unset is_default brief template bila ada):
update public.brief_templates set is_default = false
where workspace_id in (select id from public.workspaces where slug like 'ws-p5-%');
delete from public.workspaces where slug like 'ws-p5-%';
delete from public.organizations where slug like 'org-p5-%';
-- 3. Verifikasi akhir seed-only (harus sama seperti sebelum Phase 5):
--    orgs 1, workspaces 1, org_members 1, ws_members 2, sisanya 0.
--    Seed (contoh-studio-sample / workspace-contoh-sample) dan pengguna
--    Auth TIDAK BOLEH disentuh.
```

## 9. File yang diserahkan (P5-01 s.d. P5-09)

| File                                                                              | Isi                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------- |
| `docs/decisions/ADR-0011-campaign-visual-planning-phase5.md`                      | 10 keputusan Phase 5                      |
| `supabase/migrations/0016_brand_scope.sql`                                        | 401 baris, 44 stmt                        |
| `supabase/migrations/0017_visual_planner_templates.sql`                           | 552 baris, 85 stmt                        |
| `supabase/tests/05_rls_phase5.sql`                                                | plan(59), 59 asersi                       |
| `supabase/tests/rls_verify_phase5.py`                                             | verifier statis, 33/33                    |
| `tests/migrations.test.ts`                                                        | 17 migrasi + uji 0016/0017 + uji pgTAP 05 |
| `tests/campaign-progress.test.ts`                                                 | 4 uji rumus progres                       |
| `tests/campaign-transitions.test.ts`                                              | 5 uji graf transisi                       |
| `tests/brand-scope.test.ts`                                                       | 9 uji scope + target_metrics toleran      |
| `tests/campaign-csv.test.ts`                                                      | 12 uji CSV                                |
| `tests/planning-schemas.test.ts`                                                  | uji target_metrics diperbarui             |
| `features/campaign/{types,progress,transitions,constants,queries,csv,actions}.ts` | domain campaign                           |
| `features/visual-planner/actions.ts`                                              | RPC set_visual_order                      |
| `features/visual-planner/components/VisualPlannerClient.tsx`                      | planner dnd-kit                           |
| `lib/csv.ts`                                                                      | parser/serializer RFC 4180                |
| `lib/validation/schemas.ts`                                                       | skema Phase 5 + lenient reader            |
| `lib/permissions.ts`                                                              | `brandInScope`                            |
| `features/planning/context.ts`                                                    | `getCallerBrandScope`                     |
| `features/planning/actions.ts`                                                    | create campaign 3 field + scope           |
| `app/(app)/kampanye/page.tsx` + `CampaignForm.tsx` + `CampaignCsvForms.tsx`       | daftar + buat + CSV                       |
| `app/(app)/kampanye/[id]/page.tsx` + `CampaignDetailForms.tsx`                    | detail campaign                           |
| `app/(app)/kampanye/[id]/visual/page.tsx`                                         | visual planner                            |
| `app/(app)/template/page.tsx` + `TemplateForms.tsx`                               | template (rute baru)                      |
| `app/(app)/pengaturan/anggota/page.tsx` + `AnggotaClient.tsx`                     | editor brand scope                        |
| `components/layout/AppSidebar.tsx`                                                | nav "Template"                            |
| `e2e/campaign.spec.ts`                                                            | A5.1 + A5.3 + A5.5 + smoke                |
| `docs/phase-5-report.md`                                                          | laporan ini                               |

Dependensi baru: `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0`,
`@dnd-kit/utilities ^3.2.2` (commit `2ea413a`; stack kanonis untuk
drag/drop — tanpa dependensi lain).

## 10. Sub-keputusan terbuka yang diputuskan sendiri (default paling aman)

1. **CSV `owner_email`**: hanya email pemanggil yang bisa diverifikasi
   (email member lain tidak terbaca dari klien aplikasi) — email lain
   ditolak per baris dengan pesan jelas. (§7.3)
2. **Brand/audience CSV tak ditemukan/ambigu**: baris GAGAL dengan pesan
   yang menyebut nama (bukan dilewati diam-diam) — kecuali deliverables,
   yang mengikuti ADR-0011 §8 (dilewati + dicatat).
3. **Tautan brand campaign di luar scope saat update**: dipertahankan
   (fail-safe), bukan dihapus diam-diam. (§7.4)
4. **Ekspor CSV memakai capability `export_data`** (bukan
   `manage_pillars_campaigns`) — analyst ikut boleh mengekspor.
5. **Peran "limited" untuk campaign**: mengikuti preseden planning
   (`can()` true) — brand scope sebagai pembatas tambahan. (§7.8)
6. **Template tanpa aksi hapus**: tidak ada hapus template di UI (di luar
   rencana). (§7.5)
7. **Visual planner: simpan eksplisit** (tombol "Simpan urutan"), bukan
   auto-save tiap drag — satu RPC per penyimpanan, pesan sukses menyebut
   jadwal tidak berubah.
8. **Rute template = `/template`** (baru) — bukan `/pustaka` (Pustaka Aset
   P3-07) dan bukan `/template-brief`.

## 11. Deklarasi — BELUM DILOLOSKAN (menunggu parent)

Phase 5 **belum dinyatakan LULUS**. Yang sudah terbukti (lokal):

- Lint 0, typecheck 0, Vitest 165/165, build lolos, verifier 33/33,
  Prettier 18 file bersih.
- pgTAP 05 ditulis lengkap (59 asersi) — BELUM dijalankan live.
- e2e Phase 5 ditulis lengkap (A5.1 + A5.3 + A5.5 + smoke) — BELUM
  dijalankan live.

Parent yang menerapkan migrasi 0016 → 0017 lewat SQL Editor, menjalankan
pgTAP 05 + e2e live, mendeklarasikan Phase 5, membersihkan residu
(§8.1), lalu meluncurkan koordinator Phase 6. Jangan klaim lolos bila
ada gerbang yang gagal atau skip di luar yang dirancang.
