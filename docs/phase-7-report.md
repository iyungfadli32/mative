# Laporan Fase 7 — First Official Integration + Analytics, P7-01 s.d. P7-09 (MaTive DRAF)

## 1. Ringkasan hasil

Phase 7 selesai dibangun di 7 commit (5 kode + 2 dokumentasi laporan
ini), 33 file, 7.250 insertions, 3 deletions (termasuk baris
"20 migrasi" di `tests/migrations.test.ts`):

| Commit | Isi |
| ------ | --- |
| `730a573` | ADR-0013 (keputusan + asumsi 7B–7F) |
| `11799a4` | Migrasi 0021 + pgTAP 07 + verifier + uji migrasi |
| `cd4459e` | Kode aplikasi analytics + integrasi |
| `f11f3c7` | Spek e2e analytics (A7.1–A7.4 + smoke) |
| `7314633` | Perbaikan ASUMSI-7C (validasi CSV video_views/conversions) |
| `6d6aa4a` | Laporan Phase 7 — ringkasan, defect, batas jujur, §8 live, §11 kosong |
| `ff97c53` | Koreksi §5 — full suite 217/217 dijalankan sesudah fix 7314633 |

**Keputusan paling penting (v2 §7 + ADR-0013): integrasi pertama BELUM
dipilih dan TIDAK ADA akses ke platform apa pun — jadi Phase 7 TIDAK
membangun adapter ke platform nyata.** Yang dibangun: capability
registry + analytics ingestion dari record NYATA (manual + impor CSV
berlabel) + dashboard + 5 laporan awal, dengan adapter DISABLED dan
blocker yang didokumentasikan. Tidak ada platform yang dipilih, tidak
ada akun yang dibuat, tidak ada platform yang diklaim "didukung".

Gate lokal: typecheck 0, lint 0, Vitest **217/217** (18 file, naik dari
187 Phase 6: +27 analytics, +1 permissions, +2 migrations),
pglast migrasi 0021 97 statement OK, pgTAP 07 ternormalisasi 151
statement OK (v1.5), verifier statis **35/35**, build produksi exit 0
(5 route baru: `/analitik`, `/analitik/impor`, `/analitik/laporan`,
`/api/v1/analytics/export`, `/integrasi`).

**Yang BELUM terbukti live (baca §7 dulu sebelum deklarasi):** migrasi
0021 belum diterapkan ke live, pgTAP 07 belum dijalankan live, e2e
analytics belum dijalankan live — ketiganya menunggu parent (§8).
**Semuanya kini sudah terbukti live 20 Nov 2026 — lihat §11.0.**
A7.5 (viewer_client) di-skip di e2e (butuh akun kedua); dibuktikan
di pgTAP 07 TES 5 + permissions.test.ts + gate `can()` halaman.

## 2. P7-01 — Keputusan dikunci (ADR-0013)

`docs/decisions/ADR-0013-analytics-phase7.md` (249 baris, commit
`730a573`). Ringkasan keputusan:

1. **Adapter DISABLED (ASUMSI-7B).** Langkah 7.1 (platform dipilih)
   dan 7.3 (akses tersedia) tidak terpenuhi — tidak ada platform yang
   dipilih, tidak ada akses. Tidak dibangun adapter nyata; tidak ada
   klaim "didukung" (ASUMSI-7F).
2. **Capability registry** di `social_channels` (0007):
   `connection_status` diperluas `'disabled'`; kolom baru
   `capability_checked_at`; `capability_snapshot` jsonb berisi
   snapshot blocker (`status: 'disabled'`, `blocker`, `checked_at`,
   `source: 'manual-only'`, `docs_checked: null` — null karena tidak
   ada dokumen platform yang dicek ulang di fase ini; mengisinya
   adalah klaim palsu).
3. **14 kunci metrik, sumber 'manual' (ASUMSI-7C).** 12 bisa diimpor
   (reach, impressions, views, video_views, engagements, likes,
   comments, shares, saves, clicks, followers_net_change,
   conversions); 2 turunan DIHITUNG, bukan diimpor
   (engagement_rate = engagements/reach×100 bila reach > 0;
   publishing_adherence = published sesuai jadwal / planned eligible
   ×100, toleransi ±15 menit dari `scheduled_at`, dari
   `publishing_jobs` + `published_posts` nyata). video_views dan
   conversions hanya bermakna bila `source_notes` menyebut
   ambang/window attribution (ditegakkan di validasi CSV, §6.2).
4. **Agregasi latest-wins.** Impor ulang slice yang sama MENIMPA
   nilai lama (snapshot terbaru per subject + kunci + periode +
   sumber menang); duplikat DALAM satu file ditolak. Agregat campaign
   dihitung ulang tiap impor.
5. **Angka operasional (ASUMSI-7D):** retry maks 3 (transient saja),
   backoff 60 → 300 → 900 detik, lease 5 menit, TTL snapshot 24 jam,
   timeout provider 30 detik — konstanta + fungsi SQL saja di Phase 7
   (tidak ada worker/cron yang memakainya; batas jujur Phase 6 §7.3
   tetap berlaku).
6. **Template CSV (ASUMSI-7E):** `date, platform, account,
   subject_type, subject_ref, metric_key, value, unit, source_notes`.
   `platform`/`account` hanya label sumber, bukan klaim integrasi.
7. **Dashboard + 5 laporan.** Rentang default 30 hari terakhir
   (terlihat); terakhir diperbarui + sumber ditampilkan; status
   "belum terhubung" (0 snapshot) / "data sebagian" (sebagian
   placement punya metrik) / "lengkap"; TANPA periode pembanding
   (tidak ada jendela pembanding yang dijamin); chart = tabel berlabel
   + ringkasan teks + bar CSS sederhana (Recharts TIDAK terinstal —
   tanpa dependensi baru). Laporan: ringkasan workspace, per brand &
   channel, campaign, performa konten, volume publishing + kepatuhan
   jadwal. Ekspor CSV dulu, tanpa PDF.
8. **viewer_client TIDAK melihat analytics** (v2 §8) kecuali
   dibagikan eksplisit — dan pembagian itu TIDAK dibangun di Phase 7.
   RLS menutup data; halaman menolak tegas lewat `can()`.
9. **Route + nav.** `/analitik`, `/analitik/laporan`,
   `/analitik/impor`, `/integrasi`; seksi nav baru "Analisis";
   ringkasan kecil analytics di Command Center (disembunyikan untuk
   viewer_client).

## 3. P7-02/P7-03 — Migrasi 0021 + verifikasi statis

### 0021 — `supabase/migrations/0021_analytics_foundation.sql` (846 baris v1.1, 97 statement pglast OK)

6 tabel baru + RLS aktif keenamnya + revoke-all (grant select saja
untuk 5 tabel; `channel_credentials` TANPA grant apa pun):

| Tabel | Isi |
| ----- | --- |
| `metric_definitions` | Katalog global (workspace NULL), seed 14 kunci sumber 'manual' |
| `analytics_snapshots` | Satu baris per impor/batch; `brand_id` NULL = multi-brand |
| `content_metrics` | Nilai per subject (placement/content_item/published_post); `brand_id` NOT NULL (didenormalisasi dari subject saat impor); nilai ≥ 0; unik (snapshot, subject, kunci) |
| `campaign_metrics` | Agregat per campaign — dihitung ulang RPC tiap impor |
| `integration_events` | Append-only, pola `activity_logs` 0004 (INSERT hanya `actor_user_id = auth.uid()` + member) |
| `channel_credentials` | Server-only: RLS aktif TANPA policy + tanpa grant; `secret_reference` = referensi secret manager, BUKAN secret; kosong selama adapter DISABLED |

Fungsi: `import_analytics_snapshot(uuid, uuid, date, date, text,
jsonb)` (SECURITY DEFINER, mengembalikan jsonb — TIDAK PERNAH
melempar; kode: FORBIDDEN / INVALID_PERIOD / INVALID_REFERENCE /
EMPTY_METRICS / INVALID_ROW / INVALID_SUBJECT / INVALID_METRIC /
INVALID_UNIT / DUPLICATE_METRIC), `integration_backoff_seconds(int)`
(60/300/900), `analytics_snapshot_is_stale(uuid)` (TTL 24 jam,
SECURITY INVOKER — RLS berlaku). Helper visibilitas pola 0016:
`is_unlimited_scope`, `is_analytics_snapshot_visible`,
`is_content_metric_visible`, `is_campaign_metric_visible`
(SECURITY DEFINER, search_path terkunci; viewer_client TIDAK ADA di
daftar peran mana pun). Fail-safe multi-brand: snapshot `brand_id`
NULL hanya terlihat member tanpa batas scope — penting karena
`brand_in_scope(NULL)` mengembalikan true (pelajaran 30).

Dua detail yang sengaja dikunci:

- **`retrieved_at` memakai `clock_timestamp()`, BUKAN `now()`** —
  `now()` = awal transaksi, jadi dua impor dalam satu transaksi
  (mis. pgTAP begin…rollback) mendapat timestamp identik dan merusak
  urutan DISTINCT ON latest-wins (pelajaran 31).
- **Validasi RPC atomik**: semua baris divalidasi dulu (subject ada +
  di workspace + dalam scope; kunci dikenal + bukan turunan; unit =
  unit kanonis; nilai regex `^[0-9]+(\.[0-9]+)?$` ≥ 0; duplikat dalam
  file) — satu baris buruk = seluruh impor gagal, tidak ada yang
  tertulis.

### pgTAP 07 — `supabase/tests/07_rls_phase7.sql` (854 baris v1.5, plan(77), 77 asersi)

57 `is` + 17 `throws_ok` (4 argumen, pesan lengkap) + 3 `lives_ok`
(komposisi v1.5 — v1.0 sempat 59 `is` + 15 `throws_ok`; T6a/T6d
diubah jadi `throws_ok` di v1.1, lihat §11.1.2).
Fixture prefix a700/b700/e700/d700/c700/f700; user A/B memakai UUID
yang sama dengan pgTAP 06 (placeholder `:'user_a'`/`:'user_b'` —
tidak ada UUID nyata di file). Setup: org A7/B7, workspace WS-A7/
WS-B7, A owner WS-A7 + **viewer_client di WS-B7**, B manager WS-A7
dengan `brand_scope=[Brand A]` + admin WS-B7.

| TES | Asersi | Isi |
| --- | ------ | --- |
| 1 | 6 | Seed 14 definisi (2 turunan, formula engagement_rate + adherence) |
| 2 | 8 | Impor happy path Brand A (4 baris → agregat campaign reach 1000, rate 12.0000, 2 event) |
| 3 | 11 | 10 validasi RPC (turunan, kunci tak dikenal, unit salah, negatif, duplikat, subject tak ada/lintas workspace, periode terbalik, kosong, FORBIDDEN scope) + atomik (0 baris baru) |
| 4 | 11 | RLS scope: B melihat snapshot/metrik Brand A saja; snapshot Brand A2 + multi-brand tersembunyi (fail-safe); A melihat semua |
| 5 | 6 | viewer_client: A di WS-B7 melihat 0 snapshot/metrik/campaign/event; B (admin) melihat 1 (kontrol) |
| 6 | 4 | channel_credentials deny-all (select 0, insert 42501, insert postgres lolos, tetap 0) |
| 7 | 5 | CHECK connection_status ('connected' 23514; 'disabled' lolos + snapshot blocker) |
| 8 | 2 | TTL 24 jam (baru tidak stale; −25 jam stale) |
| 9 | 3 | Backoff 60/300/900 |
| 10 | 6 | Tulis langsung ditolak 42501 (4 insert + update + delete) |
| 11 | 5 | CHECK tabel (kunci, nilai, periode, tipe event, provider) |
| 12 | 3 | integration_events pola actor (actor = pemanggil lolos; orang lain 42501 RLS; update 42501) |
| 13 | 4 | Impor ulang slice sama (reach 1500 menimpa 1000; rate 8.0000; 2 baris tersimpan) |
| 14 | 3 | Agregat campaign multi-subject (impressions 3000; 5 baris campaign) |

Cleanup daun → akar (pelajaran 06 v1.0): brands dihapus SETELAH
content_items; katalog global `metric_definitions` TIDAK dihapus.
Splitter: 15 bagian, 852 baris (sesudah strip `\set`), lossless;
file ternormalisasi ter-parse pglast 151 statement OK (v1.5).

### Verifier statis — `supabase/tests/rls_verify_phase7.py` (35/35 lolos)

Adaptasi `rls_verify_phase6.py`: pglast 0021 (97 stmt) + tes 07
(145 stmt); asersi == plan(77); throws_ok 4 argumen 15/15; tanpa
UUID nyata; UUID palsu hanya di 2 baris `\set`; tanpa placeholder
di `$$`/`$f$`; 6 tabel + RLS; revoke-all + grant select (5 tabel) /
tanpa grant (channel_credentials); RPC impor SECURITY DEFINER +
search_path terkunci (5 definer + 2 invoker = 7 fungsi terkunci);
helper visibilitas + fail-safe multi-brand; viewer_client tidak ada
di kode (komentar di-strip); policy SELECT memakai helper; tulis =
false (4 insert + 10 update/delete); seed 14 kunci + formula;
indeks partial unique; CHECK; `clock_timestamp()`; backoff + TTL;
kode galat RPC; tanpa fungsi adapter; tanpa `using(true)`; forward
reference 0021 (20 policy, 0 tabel belum dibuat, helper terdefinisi,
0 scan FROM/JOIN); graf RLS efektif 0001–0021: 196 policy efektif,
49 tabel, **0 siklus, 0 self-loop**.

### Uji statis migrasi — `tests/migrations.test.ts` (29 tes)

Daftar migrasi jadi 21 (0001–0021) + tes 0021 (6 tabel + RLS +
grant, helper + fail-safe, viewer_client tidak ada di kode, seed 14
kunci + formula, CHECK, indeks, `clock_timestamp()`, backoff + TTL,
kode galat, tanpa adapter, INSERT hanya WITH CHECK) + tes pgTAP 07
(plan(77), tanpa UUID nyata, `finish()`, T2a/T5b/T13b, cleanup
daun → akar + katalog tidak dihapus).

## 4. P7-04 s.d. P7-08 — Kode aplikasi

### Domain `features/analytics/` (7 file baru)

| File | Isi |
| ---- | --- |
| `constants.ts` | Katalog 14 kunci (salinan kanonis seed 0021 — paritas diuji), kolom CSV ASUMSI-7E, angka ASUMSI-7D, 5 laporan, status data, pesan tabel belum tersedia + penolakan viewer_client |
| `types.ts` | Tipe 6 tabel + ringkasan dashboard + baris laporan + hasil aksi/RPC |
| `metrics.ts` | Fungsi murni: engagement rate, kepatuhan jadwal (±15 mnt), latest-wins, backoff, TTL, rentang default 30 hari (zona workspace), format id-ID, status data |
| `csv.ts` | Parse + validasi CSV (header, tanggal dalam periode, UUID subject, kunci impor, unit kanonis, nilai ≥ 0, duplikat, maks 500 baris, ASUMSI-7C), template, ekspor |
| `params.ts` | Parse ?from&to&brand (tidak valid → default 30 hari; brand bukan UUID → null) |
| `queries.ts` | `QueryOutcome` (pola publishing): definisi, snapshot, metrik konten/campaign, brand, event, subject referensi, ringkasan dashboard, performa konten, nama campaign, volume publishing |
| `actions.ts` | `importAnalyticsCsvCore` + `importAnalyticsCsvAction` (Zod → peran `import_analytics` + scope brand → resolusi subject batch per jenis → RPC 0021; referensi kosong → `csv:impor.csv:<N>`) |

### Komponen `features/analytics/components/` (4 file baru)

- `AnalyticsDashboard.tsx` — status data + sumber + KPI (reach,
  engagements, engagement rate, perubahan pengikut, kepatuhan
  jadwal) + tabel total per metrik (bar CSS) + tabel per brand +
  tautan laporan/impor/integrasi; empty state "Belum ada data
  analytics" bila belum terhubung.
- `AnalyticsReports.tsx` — 5 laporan (tiap laporan + tautan "Unduh
  CSV" ke API ekspor) + tabel snapshot impor di laporan workspace.
- `ImportAnalyticsForm.tsx` — form tetap mounted (pelajaran
  Phase 3/4/5): brand opsional, periode, referensi, file CSV ATAU
  textarea, template, katalog 14 kunci, tabel referensi subject
  (UUID untuk `subject_ref`).
- `DashboardAnalyticsSummary.tsx` — kartu kecil Command Center
  (30 hari terakhir; "Belum terhubung" bila 0 snapshot).

### Integrasi `features/integrations/` (3 file baru)

- `constants.ts` — 7 platform (instagram, tiktok, youtube, facebook,
  linkedin, x, threads), SEMUA DISABLED + blocker yang sama:
  "Platform belum dipilih (langkah 7.1) + akses belum tersedia
  (langkah 7.3) — adapter DISABLED…".
- `queries.ts` — `listChannelsWithCapabilities` (social_channels +
  snapshot capability, RLS menyaring scope).
- `components/IntegrationsList.tsx` — banner "Adapter integrasi:
  DISABLED", kartu platform (tanpa tombol hubungkan — P1-13),
  channel tercatat + snapshot capability, jejak audit event.

### Route + API

| Route | Isi |
| ----- | --- |
| `app/(app)/analitik/page.tsx` | Dashboard + form periode GET; viewer_client ditolak tegas |
| `app/(app)/analitik/laporan/page.tsx` | 5 laporan + filter periode/brand |
| `app/(app)/analitik/impor/page.tsx` | Form impor (hanya peran `import_analytics`) |
| `app/(app)/integrasi/page.tsx` | Daftar integrasi DISABLED + channel + audit |
| `app/api/v1/analytics/export/route.ts` | GET CSV: `report=template` tanpa login (konten statis); 5 laporan butuh login + `export_data`; nama file `mative-analytics-<report>-<from>-<to>.csv` |

### Nav + wiring

- `components/layout/AppSidebar.tsx` — seksi baru "Analisis":
  Analitik, Laporan, Impor Data, Integrasi (sidebar tetap
  `hidden md:flex` — isu smoke mobile pre-existing TIDAK disentuh).
- `app/(app)/dashboard/page.tsx` — kartu `DashboardAnalyticsSummary`
  sesudah KPI, hanya bila `can(role, "view_analytics")`.
- `lib/permissions.ts` — capability baru `import_analytics`
  (owner/admin/manager/strategist/analyst true; creator/editor/
  approver/viewer_client false).
- `lib/validation/schemas.ts` — `importAnalyticsCsvSchema`
  (workspace UUID, brand opsional, periode YYYY-MM-DD + awal ≤ akhir,
  referensi maks 200, CSV wajib).

### Pola yang dipakai ulang (dari fase sebelumnya)

- `QueryOutcome` + `wrap` (publishing/queries.ts); Zod dulu → peran
  dari DB → client sesi → RPC (publishing/actions.ts); form tetap
  mounted + `ResultMessage` di bawah form (pelajaran Phase 3/4/5);
  `parseCsv`/`serializeCsvRow` (lib/csv.ts, tanpa dependensi baru);
  `PlanningShell` + `getPlanningContext` untuk semua halaman;
  `requireContext` + `errorJson` untuk API (pola approvals/
  publishing).
- **Tidak dipakai ulang karena tidak berlaku di sini:** memoize
  Next.js (pelajaran Phase 5) tidak relevan — query analytics
  membaca tabel berbeda per pemanggilan dan tidak ada lazy-create +
  re-read dengan URL sama.

### Tes unit — `tests/analytics.test.ts` (345 baris, 27/27)

Engagement rate (12, reach 0 → null); kepatuhan jadwal (±15 mnt,
cancelled tidak eligible, tanpa post tidak sesuai jadwal, kosong →
null); latest-wins (timpa, periode terpisah, subject/kunci
terpisah); backoff 60/300/900; TTL 24 jam (tepat 24 jam tidak stale);
rentang default (20 Nov 2026 10:00 UTC = 17:00 WIB → 2026-10-22 s.d.
2026-11-20); format id-ID ("1.500", "12,00"); status data; CSV
(template header, parse, baris valid + gabung source_notes,
turunan/kunci/unit ditolak, negatif/tanggal/UUID ditolak,
video_views/conversions tanpa notes ditolak, duplikat + nomor baris,
file kosong); paritas katalog (14 kunci, 12 impor + 2 turunan,
tiap entri sama persis dengan seed — kunci/label/unit/formula/
is_derived per baris); `parseAnalyticsParams`.

### e2e — `e2e/analytics.spec.ts` (211 baris; 4 tes @needs-db + 1 skip + 2 smoke)

- A7.1 dashboard workspace baru "Belum terhubung" + "Belum ada data
  analytics".
- A7.2 impor CSV (reach 1000 + engagements 120 untuk satu konten,
  UUID diambil dari tabel referensi halaman impor) → dashboard
  "Lengkap", reach 1.000, "12,00 %", sumber `csv:impor.csv:2`.
- A7.3 lima laporan tampil + ekspor CSV pertama mengunduh
  `mative-analytics-workspace…`.
- A7.4 /integrasi DISABLED + blocker, tanpa tombol hubungkan.
- A7.5 viewer_client di-SKIP (butuh akun kedua) — bukti: pgTAP 07
  TES 5 + permissions.test.ts + gate `can()`.
- Smoke tanpa login: /analitik + /integrasi → "Anda belum masuk".
- **Pelajaran workspace baru (ditulis ke spek):**
  `listMyWorkspaces` mengurutkan `created_at` ASC — workspace aktif
  default adalah yang TERLAMA, bukan yang baru dibuat. Spek menangkap
  UUID workspace baru lewat WorkspaceSwitcher lalu membawa
  `?workspace=<id>` di semua navigasi (tanpa ini brand/konten/
  impor mendarat di workspace residu lama).

## 5. P7-09 — Gate lokal (perintah + output aktual)

```bash
npx tsc --noEmit            # 0 galat
npx eslint .                # 0 masalah (1 warning import tak terpakai diperbaiki dulu)
npx vitest run              # 18 file, 216 tes lolos (sebelum fix 7314633)
npx vitest run tests/analytics.test.ts   # 27/27 sesudah fix 7314633
~/workspace/.venv-pglast/bin/python supabase/tests/rls_verify_phase7.py  # 35/35
npm run build               # exit 0 (5 route baru terdaftar)
```

Catatan: full suite **217/217** (18 file) dijalankan sesudah fix
`7314633` — angka di atas adalah hasil run final, bukan run sebelum fix.

## 6. Defect yang ditemukan & diperbaiki (tidak disembunyikan)

### 6.1 Defect migrasi — 2 fungsi tanpa `set search_path` (ditemukan verifier, diperbaiki PRA-COMMIT)

Run pertama `rls_verify_phase7.py`: 30/35 — 5 gagal. Satu di
antaranya cacat migrasi: `integration_backoff_seconds` dan
`analytics_snapshot_is_stale` tidak punya `set search_path =
public, pg_temp` (standar Phase 6: semua fungsi dikunci). Keduanya
juga tidak menulis `security invoker` eksplisit (default, tapi tidak
jelas). Perbaikan di migrasi 0021 SEBELUM commit (`11799a4`):
tambah `security invoker` + `set search_path = public, pg_temp` ke
kedua fungsi. pglast tetap 97 statement; verifier sesudahnya 35/35.
Empat kegagalan lain adalah verifier yang salah ekspektasi, bukan
migrasi (nama parameter `p_workspace_id` bukan `p_ws_id`; alias
`s.`/`cm.` bukan `a.`; nama indeks `idx_metric_definitions_ws_unique`
+ `idx_content_metrics_snapshot_subject_key`;
`integration_events` memang butuh grant select+insert pola actor;
`retrieved_at` di-inline `clock_timestamp()` di INSERT, bukan
variabel) — diperbaiki di verifier, bukan di migrasi.

### 6.2 Defect desain — ASUMSI-7C tidak ditegakkan (ditemukan saat menulis laporan, diperbaiki commit terpisah `7314633`)

Seed 0021 mendokumentasikan video_views/conversions "Wajib sebut
ambang/window attribution di source_notes", tetapi tidak ada lapis
yang menegakkannya — dashboard akan menampilkan nilainya tanpa
konteks. Perbaikan: `validateAnalyticsCsvRow` kini menolak baris
video_views/conversions dengan `source_notes` kosong; RPC 0021
tetap tidak menegakkan (satu-satunya jalur impor Phase 7 adalah
form ini). Tes +1 (27 tes analytics).

### 6.3 Bukan defect — latest-wins aplikasi memakai proksi `created_at`

`content_metrics` tidak punya `retrieved_at` (hanya snapshot yang
punya) — agregasi aplikasi memakai `created_at` baris sebagai proksi
urutan impor, dengan komentar di `queries.ts`. Di pemakaian nyata
tiap impor adalah transaksi sendiri sehingga `created_at` naik
seiring impor (benar). Pengecualian: dua impor dalam SATU transaksi
DB (hanya terjadi di pgTAP begin…rollback) berbagi `created_at` yang
sama — urutan tie-break mengikuti urutan baris dari DB. Agregat
campaign di DB TIDAK terpengaruh (memakai `clock_timestamp()` yang
benar). Lihat §7 butir 5.

### 6.4 Bukan defect — `listContentMetrics` sempat mengurutkan kolom yang tidak ada

Draf pertama `queries.ts` mengurutkan `content_metrics` berdasarkan
`retrieved_at` — kolom itu tidak ada di tabel (hanya di snapshot).
Ditemukan saat review sendiri sebelum gate; diperbaiki ke
`created_at`. Pelajaran: nama kolom di query harus dicek ke migrasi,
bukan ke ingatan.

## 7. Batas jujur — yang BELUM terbukti (wajib dibaca parent)

Batas Phase 6 §11 (a)–(g) TETAP berlaku (tanpa worker/cron; approval
target placement tanpa UI; dua-peran belum terbukti live; efek
samping `e6d705e`; timeout 30 dtk belum dibuktikan run ulang;
WebKit; build basi — rebuild sebelum e2e; residu p6 dibersihkan
04:09 WIB). **Batas jujur BARU Phase 7:**

1. **Migrasi 0021 BELUM live, pgTAP 07 BELUM jalan live, e2e
   analytics BELUM jalan live — SEBELUM deklarasi.** Semua bukti
   fase ini statis (pglast, verifier, Vitest, build) + spek e2e
   tertulis. **SUDAH TERBUKTI LIVE 20 Nov 2026 — lihat §11.0**
   (0021 v1.1 live ~04:44 WIB, pgTAP 07 v1.5 77/77 06:38 WIB,
   e2e analytics hijau Chromium + mobile 07:57–08:03 WIB).
2. **A7.5 viewer_client hanya dibuktikan RLS + unit, bukan e2e
   live.** Butuh akun kedua sebagai viewer_client + alur undangan —
   di luar spek e2e ini.
3. **Tidak ada koneksi platform sungguhan.** Semua angka analytics
   berasal dari impor manual/CSV. Bila seseorang mengimpor angka
   yang salah, dashboard menampilkan angka yang salah — tidak ada
   validasi silang ke platform (tidak ada platform untuk
   divalidasi silang).
4. **Kepatuhan jadwal hanya menghitung job yang dikonfirmasi
   terbit.** Job berstatus published tanpa `published_posts`
   (belum dikonfirmasi manual) tidak dihitung tepat jadwal; job
   tanpa jadwal atau dibatalkan tidak eligible; rate null bila
   tidak ada job eligible.
5. **Latest-wins aplikasi memakai proksi `created_at`** (§6.3) —
   benar di pemakaian nyata (satu impor = satu transaksi), tie-break
   tidak terjamin bila dua impor berbagi satu transaksi DB.
6. **Tabel referensi impor dibatasi 100 per jenis** (placement,
   konten, postingan terbit). Workspace dengan > 100 subject per
   jenis tidak melihat sisanya di halaman impor — impor tetap bisa
   dengan menempel UUID langsung.
7. **Ekspor CSV laporan memakai query yang sama dengan halaman,
   tetapi dihitung ulang saat unduh** — bila ada impor di antara
   buka halaman dan unduh, isi CSV bisa berbeda dari yang tampil.
8. **QA visual di browser nyata belum ada** untuk halaman analitik/
   laporan/impor/integrasi (layout dibuktikan lewat build + locator
   e2e, bukan render browser).

## 8. Instruksi penerapan ke live (untuk parent)

### Prasyarat

- Database live Supabase "mative" (`kwyqtlxglhlvtghfrnhr`) dalam
  keadaan Phase 6: migrasi 0001–0020 live, seed-only (residu p6
  dibersihkan 04:09 WIB).
- Pengguna auth uji pgTAP: A `094e8752-eef4-4f0e-b6ae-2d5813445018`
  (mative-test-a@example.com), B `aabb1dab-77c1-4659-af0e-c703c9de279c`
  (mative-test-b@example.com) — JANGAN pakai UUID palsu 1111.../2222...
  di live (itu hanya placeholder file).
- Akun e2e `mative-e2e@example.com` (UID
  `a00f1843-cf39-4214-8f81-b13f7ea6e86a`, dibuat 2026-11-20 02:05 WIB)
  — kata sandi TIDAK ada di file ini; bila hilang, prosedur standar:
  bersihkan residu org yang dimiliki akun itu dulu, verifikasi 0
  baris, baru hapus + buat ulang dengan Auto Confirm ON.
- pgTAP aktif di proyek Supabase (Dashboard → Database → Extensions
  → pgtap) atau `create extension if not exists pgtap;`.
- JANGAN terapkan migrasi dari VM ini — parent yang menerapkan lewat
  SQL Editor (aturan tugas).

### Langkah 1 — Terapkan migrasi, URUTAN INI (lewat SQL Editor, per file per run)

1. **`0021_analytics_foundation.sql`** — tempel SELURUH isi file ke
   SQL Editor, Run sekali. Dialog yang mungkin muncul:
   - Dialog RLS (file mengaktifkan RLS + menulis policy): pilih "Run
     without RLS" (migrasi mengaktifkan RLS sendiri).
   - Dialog destructive dari `drop ... if exists` yang terverifikasi
     sah (policy/helper lama yang di-drop hanya berjaga-jaga; 0021
     belum pernah diterapkan): pilih "Run query".
   - Verifikasi: 0 galat; 6 tabel baru ada
     (`metric_definitions`, `analytics_snapshots`, `content_metrics`,
     `campaign_metrics`, `integration_events`,
     `channel_credentials`); 20 policy (`select count(*) from
     pg_policies where schemaname = 'public' and tablename in
     ('metric_definitions','analytics_snapshots','content_metrics',
     'campaign_metrics','integration_events')` = 20 — channel_credentials
     SENGAJA 0 policy); 7 fungsi (`select proname from pg_proc
     where proname like 'import_analytics%' or proname like
     'integration_backoff%' or proname like
     'analytics_snapshot_is_stale' or proname like 'is_%_visible'
     or proname = 'is_unlimited_scope'`); seed 14 definisi
     (`select count(*) from public.metric_definitions where
     workspace_id is null` = 14).
2. **JANGAN ubah migrasi 0001–0020.** Bila ada galat, BERHENTI dan
   laporkan — jangan edit migrasi di live. Ingat pelajaran 0017:
   pglast OK ≠ Postgres menerima (policy INSERT hanya boleh WITH
   CHECK — 0021 sudah memakai pola itu, diuji statis di
   `tests/migrations.test.ts` + verifier 35/35).

### Langkah 2 — Jalankan pgTAP 07 live

1. Di file `supabase/tests/07_rls_phase7.sql`, ganti placeholder:
   `:'user_a'` → `094e8752-eef4-4f0e-b6ae-2d5813445018`,
   `:'user_b'` → `aabb1dab-77c1-4659-af0e-c703c9de279c`
   (atau jalankan via psql dengan `-v user_a=... -v user_b=...`).
   Perhatian: A harus terdaftar sebagai viewer_client di WS-B7 dan B
   sebagai manager WS-A7 dengan brand_scope [Brand A] — SEMUA itu
   dibuat oleh file tes sendiri (setup di awal file); yang dibutuhkan
   dari live hanyalah dua pengguna auth A/B.
2. Tempel SELURUH file ke SQL Editor, Run SEKALI (satu transaksi
   begin … rollback; JANGAN run per bagian — tiap Run adalah sesi baru
   dan transaksi tidak dipertahankan). Bila editor membagi file
   (batas tempel), pakai 14 bagian di `/tmp/07_pgtap/` (splitter,
   lossless, kumulatif) — tetap SATU Run kumulatif, bukan 14 Run.
3. Hasil yang diharapkan: **77/77 ok, 0 "not ok"**, `finish()` 0
   baris, residu 0 (rollback membersihkan data uji).
4. Bila gagal: catat nomor tes (Txx) + kode galat (23514/23505/42501/
   P0001) + statement-nya; JANGAN tebak statement yang gagal dari
   pesan saja (pelajaran Phase 4) — baca konteks galat + kode aktual.
   Perhatian khusus: T13 menguji impor ulang dalam transaksi yang
   sama — `retrieved_at` memakai `clock_timestamp()` sehingga urutan
   latest-wins tetap benar walau `now()` sama.

### Langkah 3 — Jalankan e2e Phase 7 live

```bash
cd ~/workspace/mative/app
npm run build
E2E_TEST_EMAIL=mative-e2e@example.com E2E_TEST_PASSWORD='<dari handoff internal>' \
  npx playwright test e2e/analytics.spec.ts --workers=1 --project=chromium
E2E_TEST_EMAIL=mative-e2e@example.com E2E_TEST_PASSWORD='<dari handoff internal>' \
  npx playwright test e2e/analytics.spec.ts --workers=1 --project=mobile
```

Hasil yang diharapkan: **A7.1–A7.4 lolos kedua proyek, A7.5 skip,
2 smoke lolos**. Timeout eksplisit 30 dtk sudah ada di spek (pelajaran
Phase 6). Rebuild `.next/` WAJIB sebelum run (`npm run start`
memakai build produksi — pelajaran Phase 6 (f)). Jangan pakai
`pkill -f "next-server"` (membunuh shell koordinator sendiri) —
bunuh server basi via `lsof` + PID.

### Langkah 4 — Setelah lolos

1. Bersihkan residu e2e (§8.1) + verifikasi seed-only.
2. Parent menyatakan Phase 7 LULUS di §11 laporan ini (isi tanggal +
   bukti live + batas jujur baru).
3. Luncurkan koordinator Phase 8 (AI) — dengan disiplin gate yang
   sama.

### 8.1 Data uji yang tertinggal di live + cara membersihkan

Pola slug residu spek e2e Phase 7: **`org-p7-*` / `ws-p7-*`**
(organisasi `Organisasi P7 a71-…`, workspace `Workspace P7 a71-…`,
brand `Brand P7 a71-…`, konten `Konten P7 a71-…`). pgTAP 07
membersihkan dirinya sendiri (rollback) — tidak ada residu pgTAP
bila Run sekali sampai selesai.

Pembersihan (sebagai postgres/service role, SETELAH e2e lolos dan
hasilnya dicatat — urutan hapus mengikuti FK, pola Phase 4/5/6 §8.1):

```sql
-- 1. Periksa dulu apa yang ada:
select slug from public.organizations where slug like 'org-p7-%';
select slug from public.workspaces where slug like 'ws-p7-%';
-- 2. Hapus workspace + org e2e (unset is_default brief template bila ada):
update public.brief_templates set is_default = false
where workspace_id in (select id from public.workspaces where slug like 'ws-p7-%');
delete from public.workspaces where slug like 'ws-p7-%';
delete from public.organizations where slug like 'org-p7-%';
-- 3. Verifikasi seed-only (harus sama seperti akhir Phase 6):
--    organizations 1, workspaces 1, organization_members 1,
--    workspace_members 2, brands 0, content_items 0, campaigns 0,
--    brief_templates 0; workspace_settings 1 milik seed.
```

Perhatian: impor CSV e2e (A7.2) menulis snapshot + metrik ke
workspace `ws-p7-a72-*` — ikut terhapus bersama workspace-nya
(CASCADE dari workspace ke snapshot/metrik). Tidak ada residu
analytics di luar workspace e2e.

## 9. File yang diserahkan (P7-01 s.d. P7-09)

| File | Isi |
| ---- | --- |
| `docs/decisions/ADR-0013-analytics-phase7.md` | 14 keputusan + asumsi 7B–7F |
| `supabase/migrations/0021_analytics_foundation.sql` | 838 baris, 97 stmt pglast OK |
| `supabase/tests/07_rls_phase7.sql` | plan(77), 77 asersi |
| `supabase/tests/rls_verify_phase7.py` | verifier statis, 35/35 |
| `tests/migrations.test.ts` | 21 migrasi + uji 0021 + uji pgTAP 07 |
| `tests/analytics.test.ts` | 27 uji rumus/CSV/paritas seed |
| `tests/permissions.test.ts` | +1 uji import_analytics |
| `features/analytics/{constants,types,metrics,csv,params,queries,actions}.ts` | domain analytics |
| `features/analytics/components/{AnalyticsDashboard,AnalyticsReports,ImportAnalyticsForm,DashboardAnalyticsSummary}.tsx` | komponen dashboard/laporan/impor/ringkasan |
| `features/integrations/{constants,queries}.ts` + `features/integrations/components/IntegrationsList.tsx` | 7 platform DISABLED + capability registry |
| `app/(app)/analitik/page.tsx` + `app/(app)/analitik/laporan/page.tsx` + `app/(app)/analitik/impor/page.tsx` | dashboard/laporan/impor |
| `app/(app)/integrasi/page.tsx` | halaman integrasi DISABLED |
| `app/api/v1/analytics/export/route.ts` | API ekspor CSV (template + 5 laporan) |
| `lib/permissions.ts` | capability import_analytics |
| `lib/validation/schemas.ts` | importAnalyticsCsvSchema |
| `components/layout/AppSidebar.tsx` | seksi nav "Analisis" |
| `app/(app)/dashboard/page.tsx` | kartu ringkasan analytics Command Center |
| `e2e/analytics.spec.ts` | A7.1–A7.4 + A7.5 skip + 2 smoke |
| `docs/phase-7-report.md` | laporan ini |

Dependensi baru: **tidak ada** (Intl bawaan + pola yang sudah ada).

## 10. Sub-keputusan terbuka yang diputuskan sendiri (default paling aman)

1. **ASUMSI-7B — adapter default DISABLED.** Alasan: langkah 7.1
   dan 7.3 tidak terpenuhi — membangun adapter tanpa platform dan
   tanpa akses adalah klaim palsu + pekerjaan sia-sia; manual/CSV
   tetap memberi nilai analytics sekarang. (§2.1)
2. **ASUMSI-7C — metrik tak terdefinisi tidak ditampilkan;
   video_views/conversions wajib notes.** Alasan: arti "view" dan
   "konversi" berbeda per penyedia — menampilkan tanpa ambang/
   attribution menyesatkan; turunan dihitung agar satu definisi
   (bukan dua angka yang bisa berbeda). (§2.3, §6.2)
3. **ASUMSI-7D — retry maks 3, backoff 60 → 300 → 900 detik, lease
   5 menit, TTL snapshot 24 jam, timeout 30 detik.** Alasan: angka
   kecil membatasi kerusakan; backoff memberi waktu pulih; TTL 24
   jam memaksa data segar tanpa membuat impor kemarin langsung
   "basi" di pagi hari. Semua angka hidup di satu tempat (fungsi
   SQL + `constants.ts`/`metrics.ts`). (§2.5)
4. **ASUMSI-7E — template CSV 9 kolom; satu CSV = satu snapshot =
   satu periode.** Alasan: satu periode per impor membuat
   latest-wins dan agregat campaign dapat dipahami (tidak ada
   slice lintas periode dalam satu file); tanggal per baris tetap
   divalidasi di dalam periode. (§2.6)
5. **ASUMSI-7F — tidak ada platform diklaim "didukung" sampai uji
   akun test lolos.** Alasan: klaim dukungan tanpa bukti adalah
   klaim palsu (standar akurasi user). (§2.1)
6. **Impor ulang menimpa, duplikat dalam file ditolak.** Alasan:
   koreksi angka harus mungkin tanpa menghapus snapshot lama
   (audit); duplikat dalam satu file hampir selalu kesalahan
   tempel, bukan koreksi. (§2.4)
7. **Tanpa periode pembanding di dashboard.** Alasan: tidak ada
   jendela pembanding yang dijamin ada datanya — membandingkan
   dengan periode kosong menghasilkan grafik menyesatkan.
8. **Ekspor CSV dulu, tanpa PDF.** Alasan: CSV cukup untuk audit +
   olah lanjut; PDF butuh library + layout baru tanpa nilai tambah
   di MVP.
9. **A7.5 di-skip di e2e.** Alasan: butuh akun kedua + alur
   undangan; bukti RLS (pgTAP TES 5) + unit (`can()`) sudah
   menutup dua lapis penegakan (DB + halaman). (§4 e2e)
10. **Referensi kosong di form impor diisi otomatis
    `csv:impor.csv:<N>`.** Alasan: RPC menolak referensi kosong
    (INVALID_REFERENCE) — form tidak boleh memaksa pengguna
    mengarang referensi hanya untuk lolos validasi.

## 11. Deklarasi — LULUS 20 Nov 2026

**Phase 7 DINYATAKAN LULUS 20 Nov 2026** (pgTAP 07 Run 8 06:38 WIB;
e2e Chromium selesai 07:57 WIB; e2e analytics mobile selesai 08:03
WIB). Parent memverifikasi langsung, bukan hanya dari laporan
koordinator: HEAD + commit via git, typecheck 0, lint 0, Vitest
217/217 (dijalankan ulang parent 07:58 WIB), hitung asersi file
pgTAP (57 `is` + 17 `throws_ok` + 3 `lives_ok` = 77).

### 11.0 Bukti live

- **Migrasi 0021 v1.1 live + terverifikasi** (diterapkan 20 Nov 2026
  ~04:44 WIB; 6 tabel, RLS aktif keenamnya, 20 policy —
  `channel_credentials` 0 by design — 7 fungsi, seed 14/14).
- **pgTAP 07 v1.5 Run 8: 77/77 live** (06:38 WIB; tab SQL baru
  `9566b2a9…`, snippet tersimpan "pgTAP 07 v1.5", 852 baris;
  asersi terakhir `ok 77 - T14c …` terverifikasi verbatim lewat
  dialog detail sel; tidak ada baris "not ok", tidak ada ringkasan
  "failed N tests of 77"; begin…rollback — tanpa perubahan data
  permanen).
- **e2e analytics Chromium: 6 lolos, 1 skip** (A7.1–A7.4 lolos,
  A7.5 skip, 2 smoke lolos — dua run hijau penuh berturut-turut:
  Run 6 + run konfirmasi).
- **e2e analytics mobile (iPhone 13): 6 lolos, 1 skip, 0 gagal**
  (08:03 WIB, 2,2 mnt, percobaan pertama).
- **Regresi Chromium: 16 lolos, 1 skip, 0 gagal** (11,7 mnt;
  termasuk A5.1 — pernah flake di Phase 6, kini lolos langsung —
  dan A6.1/A6.2/A6.3/A6.5).
- **Regresi mobile: 13 lolos, 1 skip, 3 gagal** — ketiganya
  PRE-EXISTING sidebar (lihat §11.3), bukan regresi Phase 7.
- **HEAD akhir: `409406b`; tree bersih; port 3000 bebas; `.next/`
  dibangun ulang dari HEAD akhir; tidak ada migrasi baru yang
  dibuat/diterapkan selama e2e.**

### 11.1 Cacat yang ditemukan live di migrasi/pgTAP (semua diperbaiki)

Migrasi 0021 hanya berubah SEKALI (v1.0 → v1.1); semua perbaikan
berikutnya ada di file pgTAP, bukan di migrasi.

1. **`max(uuid)` tidak ada di Postgres (Run 1, v1.0, ~04:55 WIB).**
   RPC 0021 abort `42883 max(uuid)` saat benar-benar dieksekusi —
   padahal lolos pglast, verifier statis, dan §8. Pelajaran:
   parse OK + verifikasi statis OK ≠ runtime OK; Postgres TIDAK
   punya agregat `max`/`min` untuk uuid. Perbaikan: 0021 v1.1
   (commit `1942b07`, subquery skalar LIMIT 1), diterapkan live
   04:58–04:59 WIB.
2. **T6a/T6d: jenis asersi salah (Run 2, v1.0).** Tes mengharapkan
   0 baris dari `channel_credentials`, padahal role tanpa grant
   melempar 42501, bukan 0 baris (pelajaran 10). Perbaikan: pgTAP
   v1.1 (commit `aa36f7d`, T6a/T6d → `throws_ok` 42501). Migrasi
   tidak berubah (desain no-grant sudah benar, ADR-0013).
3. **Run 3 (v1.1): 61 ok / 16 not ok.** Diagnosis lewat run
   diagnostik `_tap_out` (05:21–05:27 WIB, 16 baris `not ok`
   verbatim): 11 kegagalan = bug role (pelajaran 36: `_set_user()`
   hanya mengubah klaim JWT, BUKAN role — sesudah `reset role;`
   tes diam-diam berjalan sebagai postgres; langsung: T6d,
   T10a–T10f, T12b, T12c; berantai: T11a/T11b via DELETE postgres
   T10f yang menghapus snapshot WS-A7 + CASCADE menghapus
   `content_metrics` DAN `campaign_metrics` termasuk baris Okt);
   3 = akibat berantai (T13c NULL, T13d, T14c have-2); 2 = bug
   ekspektasi (T2g have 5 want 4; T8b subquery "latest" digugurkan
   oleh UPDATE penuaannya sendiri). Perbaikan: pgTAP v1.2 (commit
   `87282c9`): `set local role authenticated;` ditegaskan lagi
   sebelum `_set_user` sesudah tiap `reset role;` (T6d, T7b, T7e,
   T8b, T12a; TES 11 sengaja tetap postgres); T2g 4→5; T8b dipatok
   ke snapshot yang dituakan; T13d 2→3. Migrasi tidak berubah.
4. **Run 4 (v1.2): abort `21000` di T13b.** Subquery skalar
   `campaign_metrics` tanpa filter periode mengembalikan 2 baris
   (Nov 1500 + Okt 3000 dari impor multi-brand T4h) — agregat RPC
   memang PER PERIODE (baris Okt sah). Bug ini tersembunyi di Run 3
   karena T10f-sebagai-postgres sudah menghapus CASCADE baris Okt.
   Perbaikan: pgTAP v1.3 (commit `49eb829`): kelima subquery
   skalar `campaign_metrics` (T2e, T2f, T13b, T13c, T14b) difilter
   `period_start`/`period_end` Nov 2026. Migrasi tidak berubah.
5. **Run 5 (v1.3): abort `42501` di DELETE pertama cleanup.**
   Cleanup berjalan sebagai authenticated (T12a v1.2 menegaskan
   lagi role authenticated dan tidak ada yang mengembalikannya) —
   authenticated memang TANPA grant atas `channel_credentials`
   (server-only) dan hanya SELECT atas tabel analytics. Ke-77
   asersi kemungkinan sudah tereksekusi, tapi hasilnya tidak
   terlihat karena `finish()` tidak tercapai. Perbaikan: pgTAP v1.4
   (commit `0cda505`): `reset role;` ditegaskan segera sebelum
   blok cleanup (pelajaran 39). Migrasi tidak berubah.
6. **Run 6 (kanonik v1.4) vs Run 7 (diagnostik v1.4): selisih
   5-vs-1 yang TIDAK dapat dijelaskan dari bukti yang ada.** Run 6
   melaporkan `finish()` "failed 5 tests of 77" tanpa identitas
   tesnya (panel hanya menampilkan `finish()`); Run 7 (isi tes
   IDENTIK + pembungkus `_tap_out`, 06:16–06:19 WIB) hanya
   menunjukkan 1 kegagalan: `not ok 77 - T14c …` — `# have: 6 /
   want: 5` (baris ke-6 adalah agregat reach periode Okt yang sah
   dari impor multi-brand T4h; `count(*)` atas agregat per-periode
   juga wajib difilter periode — pelajaran 38 diperluas). Tidak ada
   mekanisme pada pembungkus yang mengubah hasil asersi;
   kemungkinan pembacaan grid `_tap_out` terlewat 4 baris `not ok`
   atau kondisi editor Run 6 berbeda — keduanya tidak terbukti.
   Perbaikan: pgTAP v1.5 (commit `1678a68`): T14c difilter periode
   Nov 2026, ekspektasi tetap 5. **Run 8 (kanonik v1.5) 77/77
   menyusul Run 6**: satu-satunya kegagalan yang pernah ditemukan
   diagnosis adalah T14c, kini diperbaiki dan lolos — selisih 5-vs-1
   dicatat jujur sebagai tidak terjawab, bukan sebagai kegagalan
   yang tersisa.
7. **Insiden penempelan Run 8 (bukan cacat tes).** Tugas browser
   lama error di bagian 9 dari 15 ("task and steering history
   exceeds the compaction budget" — riwayat instruksi terlalu
   panjang); tab SQL lama `e4062a49…` ternyata sudah tidak ada
   (tab lokal yang tidak tersimpan sebagai snippet, ikut hilang
   saat jendela tugas lama mati — pencarian "pgTAP" di dashboard:
   0 hasil). Pemulihan: tugas browser BARU, tempel ulang ke-15
   bagian dari disk (2 bagian per kiriman, supaya riwayat tugas
   tetap pendek), dan snippet DISIMPAN sebagai "pgTAP 07 v1.5"
   (tab `9566b2a9…`) sebagai checkpoint — tiap bagian terverifikasi
   total + ekor editor (127/239/356/414/469/528/586/652/711/767/
   824/852). Pelajaran dicatat di `AGENTS.md`: jangan menjalankan
   rangkaian tempel yang sangat panjang dalam satu tugas browser;
   simpan snippet sebagai checkpoint di tengah jalan.

### 11.2 Cacat yang ditemukan live di e2e (semua diperbaiki / dicatat)

1. **Cacat REAL aplikasi — kolom query analytics tidak ada di
   0021 (commit `cbca252`).** `features/analytics/queries.ts`
   memilih kolom yang TIDAK ADA di migrasi 0021:
   `source_type`/`updated_by`/`updated_at` di
   `analytics_snapshots`; `source_snapshot_id`/`updated_at` di
   `campaign_metrics`. Bukti live (sebagai user e2e): PostgREST
   HTTP 400 `column analytics_snapshots.source_type does not
   exist` (42703); sama untuk
   `campaign_metrics.source_snapshot_id`. Akibatnya `/analitik`
   dan `/analitik/laporan` menampilkan alert "Tabel Analytics
   belum diterapkan" padahal 0021 live dan pgTAP 77/77.
   Perbaikan: samakan daftar kolom + tipe (`source`,
   `snapshot_id`; tanpa `updated_*`). Verifikasi: tsc 0, lint 0,
   Vitest 217/217. Tanpa perubahan migrasi. (Catatan: draf pertama
   `queries.ts` pernah mengurutkan `content_metrics` berdasarkan
   `retrieved_at` yang juga tidak ada — §6.4; nama kolom di query
   harus dicek ke migrasi, bukan ke ingatan.)
2. **Cacat test-only — locator ambigu strict-mode (3 commit).**
   `2ebeeaa` (A7.4: heading "Integrasi" juga cocok dengan h2
   "Jejak audit integrasi" → `exact: true`); `cc20cf5` (A7.3 judul
   laporan exact; A7.4 "Instagram" sebagai heading exact; A7.2
   "Lengkap" → "Status data: Lengkap"); `6bc33ba` (A7.1: "Belum
   ada data analytics" muncul 2× → cek heading).
3. **Cacat test-only — timeout per tes (commit `409406b`).**
   `playwright.config.ts`: `timeout: 120_000` (sebelumnya default
   30 dtk). Bukti: A7.2 memakan 35,4 dtk, A7.3 27,6 dtk, A7.4
   32,3 dtk di run hijau — dengan 30 dtk, A7.2 Run 5 pasti mati
   lagi. Run 5: A7.2/A7.3 mati kehabisan anggaran padahal kerja
   server selesai normal sesudah tes mati (baris snapshot impor
   Run 5 ter-commit 1 dtk SESUDAH timeout tes). Hanya konfigurasi
   tes; tanpa perubahan aplikasi.
4. **Temuan — hang UI server action, INTERMITEN (flake tercatat,
   BUKAN penghalang gate).** 4 kejadian di 5 run analytics: Run 1
   impor, Run 2 setup A7.1, Run 4 setup A7.2, Run 5 impor A7.2.
   Pola konsisten: kerja database SELALU ter-commit (snapshot
   impor Run 1 23:45:56; konten Run 2 23:53:32; konten Run 4
   00:00:44; snapshot Run 5 00:08:14), tapi tombol tetap
   `[disabled]` + alert kosong > 30 dtk dan pesan sukses tidak
   muncul. Pengukuran langsung (spec debug temporer, 6 aksi
   buat-konten): POST action kembali HTTP 200 dalam ~1 dtk,
   sukses tampil dalam ~3,5 dtk — hang TIDAK ter-reproduksi di 6
   aksi itu. Tersangka utama (BELUM terbukti): transisi
   `useActionState` tertahan oleh router refresh pasca-
   `revalidatePath` di bawah badai prefetch RSC / antrean pooler —
   perlu bukti tangkapan saat hang. Dampak produk: tidak ada
   kehilangan/kerusakan data; wart UX-nya tombol berputar lama
   padahal data sudah tersimpan (risiko duplikat bila user klik
   ulang). Tidak ada perubahan aplikasi yang dibuat untuk ini;
   dipantau di Phase 9 (ambang performa adalah sub-keputusan
   terbuka di sana). Spec debug sudah dihapus; tree bersih.
   Flake ini TIDAK muncul di run analytics mobile.
5. **Insiden lingkungan (bukan cacat aplikasi).** Restart VM/service
   di tengah Run 5 (~00:09 UTC): server mati (`net::ERR_ABORTED`,
   `write EPIPE`), Run 5 BATAL/tidak valid. Restart juga menghapus
   isi `test-results/` (bukti Run 1–5 sudah terekam di catatan
   sesi) dan melenyapkan dependensi sistem WebKit. Perbaikan:
   `npx playwright install-deps webkit` (persetujuan Tuan
   2026-11-20 01:22 WIB mencakup instalasi lib yang sama);
   `apt-get update` mula-mula macet di mirror kedua
   `mirror.cogentco.com` — mirror itu dilepas dari
   `/etc/apt/sources.list.d/ubuntu.sources` (backup:
   `ubuntu.sources.bak-cogentco`, hanya `azure.archive.ubuntu.com`
   tersisa), instalasi lalu selesai exit 0. Mobile rerun kemudian
   berjalan normal.

### 11.3 Yang masih terbuka / batas jujur baru

1. **3 smoke mobile PRE-EXISTING (sejak Phase 6, keputusan produk
   masih menggantung).** planning.spec.ts:224 (tautan perencanaan),
   planning.spec.ts:233 (pencarian), production.spec.ts:234 (tautan
   produksi "Tugas Saya") — ketiganya gagal karena
   `AppSidebar.tsx:95` memakai `hidden … md:flex` sehingga sidebar
   tidak ter-render di bawah md dan tautan tidak ada di DOM pada
   390px. Solo-rerun ketiganya gagal lagi dengan pesan identik
   (deterministik, bukan flake). BUKAN regresi Phase 7; tidak
   diperbaiki (butuh keputusan produk: drawer mobile atau skip di
   mobile). Analytics mobile TIDAK terhambat (A7.1–A7.4 lolos di
   mobile — spek ini tidak tersandung masalah sidebar).
2. **Hang UI flake (§11.2.4)** — tercatat untuk Phase 9; bukan
   penghalang deklarasi Phase 7.
3. **A7.5 viewer_client di-skip di e2e by design** (butuh akun
   viewer_client kedua + alur undangan); terbukti via pgTAP TES 5 +
   `permissions.test.ts` + gate `can()` halaman.
4. **§7 butir 2–8 tetap berlaku** (angka impor yang salah tampil
   apa adanya; kepatuhan jadwal hanya menghitung job terkonfirmasi
   terbit; latest-wins aplikasi memakai proksi `created_at` —
   tie-break tidak terjamin bila dua impor berbagi satu transaksi
   DB; tabel referensi impor dibatasi 100 per jenis; ekspor CSV
   dihitung ulang saat unduh; belum ada QA visual browser nyata
   untuk halaman analitik/laporan/impor/integrasi).
5. **Batas Phase 6 §11 (a)–(g) tetap berlaku kecuali yang sudah
   ditutup**: timeout e2e kini 120 dtk di config (terbukti cukup —
   A7.2 35,4 dtk); dependensi WebKit diinstal ulang pasca-restart;
   rebuild `.next/` dilakukan sebelum tiap run e2e.

### 11.4 Residu + akun e2e

- **Residu menunggu dibersihkan parent (sesudah deklarasi ini):
  33 org `org-p7-*` + 33 workspace `ws-p7-*` + 3 org `org-dbg-*`
  (+3 ws)** — 29 dari run e2e koordinator pertama (7 run analytics
  × 4 + 1 solo-rerun A7.1) + 4 dari run analytics mobile. Urutan
  (§8.1): `update brief_templates set is_default=false` dulu, baru
  hapus workspace + org; verifikasi seed-only sesudahnya.
- **Akun e2e di-refresh 06:42 WIB** (UID lama
  `a00f1843-cf39-4214-8f81-b13f7ea6e86a` dihapus sesudah verifikasi
  0 baris miliknya di organizations/campaigns/ideas/content_items;
  UID baru `b2e98541-1162-4cc7-9835-603a217e0d1b`, Confirmed;
  kata sandi TIDAK tercatat di file/memory/chat mana pun).

### 11.5 Angka final terverifikasi

- Build Phase 7 (`730a573`..`ff97c53`): **33 file, 7.250
  insertions, 3 deletions** (termasuk 2 commit dokumentasi
  laporan ini).
- Migrasi 0021 v1.1: **846 baris**, 97 statement pglast OK.
- pgTAP 07 v1.5: **854 baris** (852 sesudah strip `\set`), split
  15 bagian lossless, pglast 151 statement OK, 57 `is` + 17
  `throws_ok` + 3 `lives_ok` = 77, `plan(77)`.
- Commit perbaikan live: `1942b07` (0021 v1.1), `aa36f7d` (pgTAP
  v1.1), `87282c9` (v1.2), `49eb829` (v1.3), `0cda505` (v1.4),
  `1678a68` (v1.5), `cbca252` (kolom analytics), `2ebeeaa` +
  `cc20cf5` + `6bc33ba` (locator e2e), `409406b` (timeout e2e).
- Gate lokal akhir (dijalankan ulang parent 07:58 WIB dari HEAD
  `409406b`): typecheck 0, lint 0, Vitest **217/217** (18 file),
  build produksi exit 0 (5 route baru).

**Langkah berikut:** bersihkan residu §11.4 → luncurkan koordinator
Phase 8 (AI Assistant) dengan disiplin gate yang sama.
