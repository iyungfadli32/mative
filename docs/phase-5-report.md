# Laporan Fase 5 — Campaign & Visual Planning, P5-01 s.d. P5-09 (MaTive DRAF)

> Status: **LOLOS (Chromium) 20 Nov 2026 ~00:40 WIB** — migrasi 0016–0019
> live, pgTAP 05 v1.2 61/61, e2e Chromium 13 lolos + 1 skip (re-run
> sekuensial). Batas jujur eksplisit: tes mobile WebKit BELUM dijalankan
> (menunggu keputusan Tuan, B4). Detail lengkap di §11.

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

### 6.9 Defect produk — INSERT brand ditolak RLS untuk semua peran (ditemukan e2e live 2026-11-19)

e2e chromium: ketiga tes @needs-db (A5.1/A5.3/A5.5) gagal di langkah yang
sama, sebelum menyentuh fitur Phase 5 — "Buat brand" mengembalikan
`new row violates row-level security policy for table "brands"`,
padahal pemanggil owner workspace dengan `brand_scope` NULL. Akar
masalah di 0016: policy `brands_insert_owner_admin_manager` menuntut
`brand_in_scope(brands.id)`, padahal helper itu mencari brand di
`public.brands` — baris yang sedang di-INSERT belum ada di tabel, jadi
INSERT ditolak untuk SEMUA peran. Policy INSERT lain di 0016 tidak kena
(mereka memeriksa FK ke brand yang sudah ada / NULL). pgTAP 05 tidak
menangkap ini (hanya SELECT brand + INSERT sebagai postgres).
Perbaikan: **migrasi 0019** membuat ulang policy INSERT tanpa conjunct
itu (pembuatan tetap owner/admin/manager; scope tetap ditegakkan di
SELECT + UPDATE). pgTAP 05 naik ke **v1.2 (plan 61)** dengan TES 16
(T16a/T16b: INSERT brand sebagai authenticated + terlihat owner).
Batas jujur: anggota ber-scope terbatas yang membuat brand tidak
langsung melihat brand itu sampai owner menambahkannya ke scope-nya
(fail-safe di sisi baca). 0019 diterapkan live 23:01–23:02 WIB
19 Nov 2026 (terverifikasi via `pg_policies`: 1 baris INSERT,
WITH CHECK `is_ws_member(workspace_id,
ARRAY['owner','admin','manager'])`, tanpa `brand_in_scope`) dan
pgTAP 05 v1.2 dijalankan live 23:11 WIB — 61/61 (§11.2).

## 7. Batas jujur — yang BELUM terbukti (wajib dibaca parent)

1. **TERBUKTI 20 Nov 2026: migrasi 0016–0019 live; pgTAP 05 v1.2
   61/61 live; e2e Chromium hijau (re-run sekuensial 13 lolos + 1 skip).**
   Bukti RLS/RPC di bawah ini bukan lagi statis semata — lihat §11.
   (Satu pengecualian: tes mobile WebKit BELUM dijalankan, §11.6.1.)
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

1. Perbarui `docs/apply-migrations.md` (migrasi kini 0001–0019).
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

## 11. Deklarasi — LOLOS (Chromium) 20 Nov 2026 ~00:40 WIB

Phase 5 **DINYATAKAN LOLOS (Chromium)** oleh parent. Semua gerbang live
lolos; satu batas jujur eksplisit: tes mobile WebKit belum dijalankan
(menunggu keputusan Tuan, B4 — §11.6.1). Commit HEAD: `8e0e95d`.

### 11.1 Migrasi live (0001–0019)

| Migrasi | File | Live (WIB 19 Nov 2026) | Isi |
| ------- | ---- | ---------------------- | --- |
| 0016 | `0016_brand_scope.sql` | 21:13–21:15 | Brand scope: CHECK + `brand_in_scope` + 15 policy ditulis ulang |
| 0017 | `0017_visual_planner_templates.sql` | 21:40–21:42 | 5 tabel + RLS + 20 policy + RPC `set_visual_order` |
| 0018 | `0018_set_visual_order_fixes.sql` | 22:30–22:34 | RPC posisi 1-based + `INVALID_STATE_TRANSITION` |
| 0019 | `0019_brands_insert_scope_fix.sql` | 23:01–23:02 | Perbaikan cacat produk INSERT brand (§6.9 / §11.3) |

**Saga 0017 (dicatat lengkap karena ada klaim yang sempat salah):**
Run pertama 0017 GAGAL 21:29–21:30 WIB — `42601: only WITH CHECK
expression allowed for INSERT` (policy INSERT `visual_orders`
memakai `using (false)`; pglast menerimanya sebagai 85 statement OK,
Postgres menolaknya — pelajaran: **pglast OK ≠ Postgres menerima**).
Perbaikan commit `f3f1e7a`: `using (false)` → `with check (false)` +
asersi regresi di `tests/migrations.test.ts`. Parent sempat berasumsi
bagian 1–5 sudah live dan meluncurkan query sisa-saja — query itu
gagal `42P01: relation "public.visual_orders" does not exist`, dan
query pemeriksaan membuktikan **0017 tidak diterapkan sama sekali**
(42601 = parse error, tidak ada statement yang dieksekusi). Klaim
"bagian 1–5 sudah live" dikoreksi eksplisit ke Tuan. File penuh yang
sudah diperbaiki diterapkan live 21:40–21:42 WIB, 0 galat;
terverifikasi: 5 tabel, `set_visual_order` ada, 20 policy, RLS aktif
×5. (Jumlah policy 20, bukan 15: 5 policy `no_*` pra-0016 dari 0007
ikut terhitung.)

### 11.2 pgTAP 05 live — 61/61

- **v1.0 Run 1:** gagal di cacat file tes — kolom `format` vs
  `platform_format` di `content_template_placements` (42703, sebelum
  asersi apa pun berjalan); diperbaiki commit `f93d8e3`.
- **v1.0 Run 2: 47/59** — 12 gagal. Diagnosis memakai tabel temp
  `_tap_out` (semua 59 asersi dibungkus `insert into _tap_out select …`,
  `select * from _tap_out` sebagai statement akhir) karena SQL Editor
  hanya menampilkan result set terakhir dan `finish()` hanya
  mengembalikan baris bila ada kegagalan. Run diagnosis pertama gagal
  42501 — temp table milik postgres, butuh
  `grant insert, select on _tap_out to authenticated;` sesudah
  `set local role authenticated`.
- **4 akar penyebab:** (a) RPC `set_visual_order` menulis posisi
  0-based (`v_pos int := 0`), desain 1-based — CACAT RPC; (b)
  penolakan placement-membership mengembalikan FORBIDDEN, pemetaan
  yang dirancang: INVALID_STATE_TRANSITION untuk kegagalan validasi,
  FORBIDDEN hanya peran/scope — CACAT RPC; (c) T11e: tes mengharapkan
  approver B bisa reorder — kanonis RBAC (kit Dok 06 §3 + `can()` +
  `features/visual-planner/actions.ts`) approver hanya view pada
  `manage_pillars_campaigns` — CACAT TES (peran B jadi `manager` di
  WS-A); (d) 7 pola `throws_ok` harus pesan galat LENGKAP termasuk
  nama constraint yang terpotong Postgres ke 63 byte
  (`..._place_key`, `..._posit_key`) — CACAT TES.
- **Perbaikan migrasi 0018 + v1.1: 59/59** live 22:44–22:46 WIB
  (687 baris editor, Run sekali, `finish()` 0 baris, asersi terakhir
  `ok 59 - T15c`).
- **v1.2 (tambah TES 16, T16a/T16b — regresi INSERT brand 0019):
  61/61** live 23:11 WIB (708 baris ditempel dalam 13 bagian,
  `finish()` 0 baris — tidak ada baris ringkasan kegagalan — asersi
  terakhir `ok 61 - T16b ALLOW: brand baru terlihat owner (scope NULL)
  sesudah INSERT`). File membersihkan dirinya sendiri (begin …
  rollback), residu 0.

### 11.3 Cacat 0019 (produk, ditemukan e2e live)

Ringkasan §6.9: policy INSERT brands 0016 menuntut
`brand_in_scope(brands.id)` — helper itu mencari baris di
`public.brands`, sedangkan baris yang sedang di-INSERT belum ada di
tabel, jadi INSERT ditolak untuk SEMUA peran termasuk owner scope
penuh. e2e chromium pertama gagal di langkah "Buat brand" sebelum
menyentuh fitur Phase 5. Perbaikan migrasi 0019 (commit `02f53f2`,
bersama pgTAP 05 v1.2 + `tests/migrations.test.ts` 19 migrasi +
regresi 0019 + §6.9 laporan ini): policy INSERT dibuat ulang dengan
WITH CHECK hanya `is_ws_member(workspace_id,
ARRAY['owner','admin','manager'])`. Batas jujur: anggota ber-scope
terbatas yang membuat brand tidak langsung melihat brand itu sampai
owner menambahkannya ke scope-nya (fail-safe di sisi baca, bukan
kebocoran). Pelajaran: **policy INSERT tidak boleh memeriksa baris
yang sedang di-INSERT di tabelnya sendiri** — baris itu belum ada
saat policy dievaluasi.

### 11.4 e2e live (Chromium)

- **Run pertama (koordinator #2):** 3 tes @needs-db gagal di "Buat
  brand" (cacat 0019, §11.3); 4 tes mobile gagal di
  `browserType.launch` — library sistem WebKit hilang (`libgtk-4-1`,
  `libgraphene-1.0-0`, `libmanette-0.2-0`, `libenchant-2-2`,
  `libsecret-1-0`, `libgles2`, `libevent-2.1-7t64`); kemungkinan besar
  VM diganti sejak Phase 2–4 (paket apt di luar `~` hilang; binari
  di `~/.cache/ms-playwright` selamat). Smoke `/template` lolos
  sesudah server Next.js basi (build pra-Phase-5, 20:07 WIB) dimatikan
  — `reuseExistingServer: true` sempat memakainya ulang.
- **Run ulang Chromium (koordinator #3):** campaign 4/4, planning 4/4,
  approval 2 lolos/1 skip, production 3/3.
- **Run paralel: 2 gagal** — approval timeout 300 dtk menunggu form
  "Simpan penugasan"; production "Template Brief Standar" tidak
  ditemukan. Keduanya berjalan di workspace residu lama
  (`ws-p5-p5b-mwnqbqmm`) dan AWALNYA didiagnosis sebagai
  transien/lingkungan (seed malas telat muncul saat pemuatan pertama).
  **Koreksi atas diagnosis awal:** run sekuensial (`--workers=1`)
  MEMBUKTIKAN keduanya cacat aplikasi nyata deterministik — sesudah
  seed malas dihapus di ws-p4, run solo approval gagal lagi di langkah
  yang sama persis. Akar penyebab: **Next.js me-memoize fetch GET yang
  sama dalam SATU render server** — pola baca → tulis (lazy-create) →
  baca ulang dengan URL GET identik mengembalikan hasil kosong dari
  baca pertama (sebelum tulis), tanpa pernah mengenai database;
  `cache: "no-store"` hanya menonaktifkan Data Cache, BUKAN memoize
  per-render. Perbaikan Phase 4 (`3c83a08`) tidak pernah benar-benar
  bekerja pada pemuatan pertama.
- **Perbaikan (commit terpisah, satu cacat = satu commit):**
  - `668293a` — approval: baca ulang workflow default berdasarkan
    `workflow_id` hasil RPC (URL berbeda → tidak kena memoize);
    fallback ke `getDefaultWorkflow` bila RPC tidak mengembalikan id.
  - `8e0e95d` — production: `ensureDefaultBriefTemplate` mengembalikan
    baris template-nya (dari pemeriksaan awal, dari `.select()` sesudah
    insert = POST, atau dari baca bentuk berbeda bila balapan 23505);
    halaman Template Brief + tab Brief konten memakai baris itu
    langsung, tanpa baca ulang URL sama.
  - `1da0023` — form tambah placement di-unmount saat berhasil: form
    hanya dirender bila `freeChannels.length > 0`, jadi sesudah
    placement pertama tercipta + revalidasi, form beserta pesan sukses
    `useActionState` hilang sebelum dibaca — pola yang sama dengan
    2 cacat Phase 3 + 3 cacat Phase 4; diperbaiki mengikuti `a869027`
    (form tetap dirender saat `canEdit`, disabled bila tidak ada
    channel bebas + penjelasan di bawahnya).
  - Perbaikan tes (bukan cacat aplikasi): `742d4ee` (locator heading
    ambigu, tambah `exact: true`), `ddc8ba4` (locator template A5.1 +
    koma CSV A5.5 — 2 baris CSV kekurangan 1 koma sehingga `status`
    jatuh di kolom `end_at`).
- **Re-run sekuensial penuh sesudah perbaikan: 13 lolos, 1 skip,
  0 gagal (9,1 mnt, exit 0)** — campaign 4/4, planning 4/4,
  approval 2 lolos/1 skip (dua-peran skip, Chromium saja, satu
  pengguna), production 3/3.
- **Verifikasi parent atas HEAD `8e0e95d`:** typecheck 0, lint 0,
  Vitest **167/167** (16 file), Prettier bersih pada file yang diubah,
  build **29/29** halaman. (Vitest naik dari 165/165 di §1/§5 karena
  uji migrasi diperbarui ke 19 migrasi + regresi 0019, commit
  `02f53f2`.) Working tree bersih.

### 11.5 Pembersihan residu (dua kali, sampai seed-only)

- **Run 1** (setelah e2e paralel): 17 organisasi + 17 workspace
  dihapus (pola `org-p5-*`/`ws-p5-*` + `org-p3-p3-*`/`org-p4-p4-*` +
  `org-e2e-*`); unset `is_default=false` dulu; seed-only
  terverifikasi (orgs 1, workspaces 1, org_members 1, ws_members 2,
  sisanya 0; `workspace_settings` 1 milik seed).
- **Run 2** (setelah re-run sekuensial): 15 organisasi + 15 workspace
  dihapus (pola sama + awalan ganda `ws-p5-p5a-*` dst.); seed-only
  terverifikasi dengan hitungan yang sama.
- Semua penghapusan berdasarkan slug tepat yang terdaftar dulu; seed
  (`contoh-studio-sample` / `workspace-contoh-sample`) dan pengguna
  Auth tidak disentuh. pgTAP 05 tidak meninggalkan residu (rollback).

### 11.6 Batas jujur yang tersisa (wajib dibaca)

1. **Tes mobile WebKit BELUM dijalankan** — 4 tes campaign di
   iPhone 13 (proyek WebKit) tidak pernah lolos/gagal karena
   `browserType.launch` gagal sebelum tes apa pun berjalan (library
   sistem hilang, §11.4). Menunggu keputusan Tuan (B4: install
   library WebKit via `npx playwright install-deps webkit` vs cukup
   Chromium saja). **JANGAN jalankan apt-get/install-deps tanpa izin
   eksplisit Tuan.**
   **Koreksi 20 Nov 2026 ~02:17 WIB: SUDAH dijalankan (proyek
   Playwright-nya bernama `mobile`, iPhone 13, bukan `webkit`) —
   lihat §11.8. Poin ini tertutup.**
2. **Approval dua-peran belum terbukti live** (skip, satu pengguna)
   — bawaan Phase 4, tidak berubah di Phase 5.
3. **Pola seed malas yang menelan galat diam-diam** sudah diperbaiki
   untuk 2 jalur yang terbukti cacat (workflow approval, brief
   template); pola yang sama di tempat lain belum diaudit menyeluruh
   — hardening "tampilkan galat query, bukan daftar kosong" dicatat
   untuk Phase 9.
4. Batas jujur §7.2–§7.10 tetap berlaku (CSV `owner_email` hanya
   email pemanggil; tautan brand di luar scope dipertahankan;
   template tanpa aksi hapus; halaman anggota gagal-bersih bila 0016
   belum live — kini tidak relevan karena 0016 live; QA visual login
   + mobile 390 px di browser nyata belum ada; peran "limited"
   mengikuti preseden planning; tiga file rencana detail masih teks
   pra-v2; framework Plan Management masih DRAF).

### 11.7 Keputusan

**Phase 5 LOLOS (Chromium).** Migrasi 0016–0019 live, pgTAP 05 v1.2
61/61, e2e Chromium 13 lolos + 1 skip, residu bersih seed-only,
verifikasi parent atas HEAD `8e0e95d` hijau penuh. Lanjut Phase 6
(Publishing Foundation). Tes mobile WebKit menyusul bila Tuan
menyetujui B4 — bukan gate yang menahan Phase 6.

### 11.8 Addendum — tes mobile + perbaikan cacat A5.1 (20 Nov 2026 ~02:17 WIB)

**Tes mobile (proyek Playwright `mobile`, iPhone 13) — SELESAI
01:53 WIB.** Run penuh pertama **2/4**: A5.5 (CSV) + Smoke lolos;
A5.1 gagal di `campaign.spec.ts:129` — pesan sukses "Konten
ditautkan ke campaign." tidak muncul dalam 30 detik; A5.3 gagal di
`:164` — heading timeout 5000 ms. Re-run solo A5.1 + A5.3 lolos →
**4/4 pada re-run**.

**Diagnosis (oleh koordinator e2e mobile):**

- **A5.1 = cacat aplikasi nyata** (pola Lesson 6): `LinkContentForm`
  / `LinkBrandForm` di `CampaignDetailForms.tsx` early-return saat
  daftar kosong, sehingga sesudah tautan berhasil + revalidasi, form
  beserta `ResultMessage` dari `useActionState` ikut ter-unmount dan
  pesan sukses menghilang. Di Chromium sempat tertangkap karena
  keberuntungan polling.
- **A5.3 = cacat tes saja** — `expect.configure` di dalam callback
  tes tidak berlaku, sehingga timeout default 5 detik dipakai untuk
  navigasi pertama yang berat.

**Perbaikan (atas perintah Tuan "Perbaiki sekarang", 01:56 WIB) —
commit `9544d36`** (2 file, +22/−7): cabang kosong kedua form kini
merender pesan kosong **+ `ResultMessage`** (state bertahan karena
parent tetap me-render komponen di posisi yang sama —
`page.tsx` baris 263/301); `campaign.spec.ts:164` diberi
`{ timeout: 30000 }` eksplisit. Tanpa perubahan perilaku lain.

**Verifikasi sesudah perbaikan (koordinator perbaikan, 02:05–
02:17 WIB):** typecheck 0, lint 0, Vitest **186/186** (17 file),
Auth HTTP 200, tidak ada server basi, Playwright Chromium **4/4**
dan mobile **4/4 pada run penuh PERTAMA sesudah perbaikan**
(masing-masing 3,7 menit, `--workers=1`) — tidak ada lagi pola
"lolos karena keberuntungan polling". **Tidak ada cacat baru
ditemukan.** Parent verifikasi langsung dari disk: HEAD `9544d36`
di atas `8dff127`, tree bersih, diff sesuai laporan.

**Catatan akun uji:** penyegaran akun e2e sempat GAGAL 02:00 WIB
("Failed to delete user: Database error deleting user", 2×) karena
akun lama masih memiliki 5 org `org-p5-*` (owner_user_id tanpa
ON DELETE = RESTRICT; pelajaran Phase 3 14:45 WIB). Urutan
diperbaiki: residu 5 org + 5 workspace dibersihkan dulu (unset
`is_default` → hapus `ws-p5-%` → hapus `org-p5-%`, verifikasi
seed-only lolos), baru akun lama dihapus dan akun baru dibuat
02:05 WIB — `mative-e2e@example.com`, UID
`a00f1843-cf39-4214-8f81-b13f7ea6e86a`, Confirmed 02:05 WIB, Auto
Confirm ON. Kata sandi baru TIDAK dicatat di mana pun (hanya di
brief koordinator perbaikan).

**Residu yang MASIH menunggu dibersihkan (parent):** kedua run
verifikasi perbaikan membuat 6 pasangan `org-p5-*`/`ws-p5-*` baru
(3 per proyek: A5.1, A5.3, A5.5) — prosedur yang sama (unset
`is_default` dulu, lalu hapus workspace + org, verifikasi
seed-only). Dibersihkan sesudah Run pgTAP 06 v1.1 selesai, agar
tidak mengganggu tempelan yang sedang berjalan.
