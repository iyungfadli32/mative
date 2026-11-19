# Laporan Fase 6 — Publishing Foundation, P6-01 s.d. P6-09 (MaTive DRAF)

> Status: **BUILD SELESAI (lokal) — BELUM DITERAPKAN LIVE, BELUM
> LOLOS.** Migrasi 0020 v1.1 + pgTAP 06 (109 asersi) + spek e2e
> publishing ditulis dan lolos gate lokal, tetapi **belum satu pun
> terbukti terhadap database live**. Parent menerapkan + menjalankan
> pgTAP/e2e live sesudah verifikasi first-hand (§8). Deklarasi §11
> diisi parent sesudah live lolos.

## 1. Ringkasan hasil

| Item                                 | Hasil (lokal, terverifikasi)                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Migrasi 0020 — publishing foundation | 979 baris, 80 statement, pglast OK (v1.1)                                                     |
| ADR-0012                             | 246 baris, manual-only + ASUMSI-6.1 s.d. 6.6                                                  |
| pgTAP 06                             | `supabase/tests/06_rls_phase6.sql`, plan(109), 109 asersi                                     |
| Verifier statis                      | `supabase/tests/rls_verify_phase6.py`, **33/33 lolos**                                        |
| Uji statis migrasi                   | `tests/migrations.test.ts` diperbarui ke 20 migrasi + uji 0020 + uji pgTAP 06                 |
| Uji unit baru                        | `tests/publishing.test.ts`, 17 uji                                                            |
| Vitest                               | **186/186 lolos** (17 file; naik dari 167)                                                    |
| ESLint                               | 0 error                                                                                       |
| Typecheck                            | 0 error                                                                                       |
| Build                                | lolos, 45 route (32 halaman cara hitung Phase 5 + 11 endpoint API)                            |
| Prettier                             | bersih pada file yang diubah (§5)                                                             |
| Spek e2e                             | `e2e/publishing.spec.ts`: 2 tes @needs-db (A6.1, A6.2/A6.3/A6.5) + 1 smoke = 3 tes × 2 proyek |
| Commit Phase 6                       | 7 (di atas HEAD Phase 5 `5185281`); laporan ini commit ke-8                                   |

Milestone yang tercapai (v2 + detail §6.1–§6.7):

- **M6.1** — antrean publishing lokal: job dibuat dari placement
  (status `ready` / `scheduled_locally`), tampil di `/publishing`
  dengan seksi "Perlu perhatian" terhitung.
- **M6.2** — preflight sebelum buat job: approval terkini,
  zona waktu, jadwal masa lalu, duplikat, peran/scope — dengan kode
  galat spesifik, bukan gagal diam-diam.
- **M6.3** — eksekusi publish manual-only: tidak ada provider, tidak
  ada status palsu; satu-satunya jalan ke Published adalah konfirmasi
  manual (URL + waktu + actor), tercatat di `published_posts`.
- **M6.4** — retry aman: hanya galat transient, maks 3 kali, backoff
  1 → 5 → 15 menit, keputusan retry eksplisit (ASUMSI-6.3).
- **M6.5** — pembatalan aman: sebelum kirim tanpa efek samping;
  sesudah kirim / dari terminal ditolak; slot idempotency bebas
  sesudah cancel.
- **M6.6** — zona waktu benar: `scheduled_at` selalu UTC, zona
  placement sumber kebenaran (ASUMSI-6.6); konversi wall-clock ↔ UTC
  eksplisit via Intl (server berjalan di UTC — §4.5).
- **M6.7** — audit trail: tiap percobaan tercatat di
  `publishing_attempts` (handoff_manual / failed / published /
  cancelled / recovered_ready / retry_scheduled).

Acceptance A6.1–A6.8 tercakup: A6.1 (e2e Tes 1 + pgTAP T8–T11/T13–T21),
A6.2 (e2e Tes 2 + API providers 501), A6.3 (pgTAP T12/T35–T36 + e2e
Tes 2), A6.4 (pgTAP T25–T28), A6.5 (pgTAP T22–T24 +
e2e Tes 2), A6.6 (Vitest 17/17 + pgTAP T2/T6), A6.7 (pgTAP T2–T7),
A6.8 (checklist Dok 11 — preflight + handoff + riwayat; §2).

## 2. P6-01 — Keputusan dikunci (ADR-0012)

`docs/decisions/ADR-0012-publishing-foundation-phase6.md` (246 baris).
Keputusan yang mengikat build ini:

1. **Manual-only di MVP, adapter DISABLED (Keputusan #3, v2).**
   Tidak ada fungsi adapter provider (`uploadOrCreatePost`,
   `getPublishStatus`, `fetchPostMetadata`, `fetchAnalytics`) — bukan
   implementasi palsu, bukan stub diam-diam. Bila ada yang meminta aksi
   provider, jawab `501 UNSUPPORTED_CAPABILITY`
   (`GET/POST /api/v1/publishing/providers`).
2. **9 label status Dok 08 §6 harfiah** — `draft → ready →
scheduled_locally → sending → uploaded_or_draft_created → published
→ failed → needs_manual_action → cancelled`.
   `uploaded_or_draft_created` tidak pernah tercapai di Phase 6 (tidak
   ada provider). "Scheduled locally" tidak pernah tampil sebagai
   "Scheduled (provider)"; upload/draft tidak pernah tampil sebagai
   Published. Job dan placement bergerak bersama dalam satu transaksi
   RPC yang sama.
3. **ASUMSI-6.1 (diadopsi):** `needs_manual_action → ready` (atau →
   `scheduled_locally` bila `scheduled_at` masih di masa depan) sesudah
   preflight ulang lolos, atau `→ cancelled` bila dibatalkan eksplisit
   dengan alasan. Tidak ada transisi langsung `→ sending` tanpa
   preflight ulang.
4. **ASUMSI-6.2 (diadopsi):** `idempotency_key` unik per `placement_id`
   - `scheduled_at` UTC, format
     `pub:<placement_id>:<scheduled_at ISO atau 'immediate'>`. Indeks
     unik **partial** — hanya job bukan `cancelled`; job dibatalkan
     membebaskan slotnya sehingga waktu yang sama bisa dijadwalkan ulang.
5. **ASUMSI-6.3 (diputuskan koordinator, default teraman — §10.1):**
   retry maks 3 kali untuk error transient, backoff eksponensial
   1 menit → 5 menit → 15 menit, lease/lock worker 5 menit, timeout
   pemrosesan job 2 menit (budget pemrosesan di pemanggil, bukan batas
   DB). Backoff di satu tempat: fungsi SQL
   `publishing_backoff_minutes` + konstanta yang sama di
   `features/publishing/constants.ts`. Retry hanya sesudah keputusan
   retry eksplisit; tidak ada blind retry pada outcome non-idempotent
   yang tidak diketahui.
6. **ASUMSI-6.4 (diadopsi, ditegakkan DB):** `provider_job_id` dan
   `provider_post_id` selalu null di Phase 6 (CHECK). Bila ada kode
   yang mengisinya, itu bug.
7. **ASUMSI-6.5 (diadopsi):** tombol "Open platform" hanya bila URL
   resmi diketahui; bila tidak diketahui, tombol tidak tampil. Daftar
   resmi: instagram `https://www.instagram.com`, tiktok
   `https://www.tiktok.com`, youtube `https://studio.youtube.com`,
   facebook `https://www.facebook.com`, linkedin
   `https://www.linkedin.com`, x `https://x.com`, threads
   `https://www.threads.net`, other — tidak ada tombol. Tidak ada URL
   yang ditebak.
8. **ASUMSI-6.6 (diputuskan koordinator, default teraman — §10.2):**
   bila `content_items.timezone` dan `content_placements.timezone`
   berbeda, yang dipakai `content_placements.timezone` (jadwal melekat
   pada placement). Ini menegaskan P2-A9 yang sudah diputuskan sejak
   Phase 2. Job menyimpan `timezone` (disalin dari placement saat
   dibuat, atau override yang divalidasi IANA) dan `scheduled_at`
   selalu UTC.
9. **Preflight (ADR-0012 §9):** "approved/current" = versi konten
   **terbaru** punya request approval internal `approved` (target_type
   `content_item`). Request approved untuk versi lama = `APPROVAL_STALE`.
   Blokir: `FORBIDDEN` (peran/scope), `TIMEZONE_INVALID`,
   `ALREADY_PUBLISHED`, `APPROVAL_REQUIRED`, `APPROVAL_STALE`,
   `SCHEDULE_PAST`, `DUPLICATE_JOB`. Peringatan (tidak memblokir):
   koneksi — selalu "Belum ada koneksi → manual" di Phase 6; format
   media kosong.
10. **Worker lokal:** tidak ada Inngest/Trigger.dev/cron di repo (dan
    tidak ada deploy Vercel tempat cron berjalan — B5 masih terbuka).
    "Worker" Phase 6 dipicu eksplisit: (1) saat halaman Publishing
    Queue dimuat (server component memanggil RPC proses — idempotent),
    dan (2) via `POST /api/v1/publishing/process`. Claim atomik
    (`FOR UPDATE SKIP LOCKED`) + lease 5 menit.
11. **Reminder MVP:** bukan record yang "dikirim" — tidak ada kanal
    email/push dan tabel `notifications` CHECK-nya tidak diubah.
    "Reminder" adalah tampilan terhitung di Queue: seksi "Perlu
    perhatian" (job `needs_manual_action` + job jatuh tempo ≤ 24 jam +
    job terlambat).
12. **viewer_client:** tidak melihat antrean publishing dan tidak bisa
    membuat/membatalkan/mengonfirmasi job (v2). Pengecualian: job atas
    placement yang content item-nya dibagikan eksplisit ke klien itu
    terlihat baca-saja (RLS lewat `is_placement_shared_with_me`).
    Mutasi job hanya lewat RPC dengan peran `schedule_publish`
    (owner/admin/manager/strategist-limited).
13. **Sengaja tidak dibangun:** adapter provider, OAuth,
    polling/webhook provider, analytics sync → Phase 7; scraping /
    shared-password login / automation pelanggar kebijakan platform →
    tidak pernah (Dok 08 §9); worker/cron otomatis, pengingat
    email/push → Phase 7+; submit approval per-placement di UI → scope
    Phase 4; hapus job (hard delete) → tidak ada, pembatalan adalah
    status `cancelled`.

## 3. P6-02/P6-03 — Migrasi 0020 + verifikasi statis

### 0020 — `supabase/migrations/0020_publishing_foundation.sql` (979 baris, 80 statement pglast OK, v1.1)

**BELUM diterapkan live** — parent menerapkan sesudah verifikasi
first-hand (§8).

- (1) CHECK `content_placements`: `remote_post_id` tetap null;
  `published_url` kini boleh diisi konfirmasi manual (CHECK lama yang
  melarang keduanya dicabut, sesuai komentar 0007).
- (2) Tabel baru: `publishing_jobs` (workspace_id, placement_id,
  placement_version_id, scheduled_at, timezone default 'Asia/Jakarta',
  status CHECK `ready/scheduled_locally/sending/needs_manual_action/
failed/published/cancelled`, idempotency_key, provider_job_id CHECK
  null, next_attempt_at, attempt_count ≥ 0, lease_owner, lease_until,
  created_by), `publishing_attempts` (job_id, attempt_number ≥ 1,
  result_status CHECK `handoff_manual/failed/published/cancelled/
recovered_ready/retry_scheduled`, provider_response_safe, error_code,
  error_message_safe, started_at, completed_at, unique (job,
  attempt_number)), `published_posts` (workspace_id, placement_id
  unique, provider_post_id CHECK null, canonical_url wajib tidak
  kosong, published_at, confirmation_source CHECK hanya
  `manual_user_confirmation`, raw_metadata_reference, created_by).
- (3) Indeks: workspace+status, scheduled_at, placement,
  `idx_publishing_jobs_idempotency_active` unique partial
  (placement_id, scheduled_at) where status <> 'cancelled', attempts
  (job, attempt_number), published_posts workspace.
- (4) RLS: ketiga tabel `enable row level security`; policy select
  lewat helper visibilitas (§6.1); policy insert/update/delete
  `with check (false)` / `using (false)` — tulis hanya lewat RPC
  (pola visual_orders 0017); grant select saja (revoke all dari anon,
  authenticated). 12 policy total (4 per tabel).
- (5) `publishing_backoff_minutes(integer)`: 1 → 1 mnt, 2 → 5 mnt,
  3+ → 15 mnt.
- (6) `publishing_preflight(uuid, timestamptz, text, uuid)` — STABLE
  SECURITY DEFINER, tidak pernah melempar, mengembalikan `{ok, code,
message, checks}`; zona waktu divalidasi lewat katalog
  `pg_timezone_names`; cek duplikat mengecualikan `p_exclude_job_id`.
- (7) `create_publishing_job(uuid, timestamptz, text)` — preflight
  dulu, snapshot versi placement terbaru, status `scheduled_locally`
  bila jadwal di masa depan else `ready`, kunci idempotency, update
  placement (scheduled_at/timezone/distribution_status) dalam satu
  transaksi; `unique_violation` → `DUPLICATE_JOB`.
- (8) `claim_publishing_job(uuid, uuid)` — klaim atomik satu job jatuh
  tempo (`FOR UPDATE SKIP LOCKED`) + lease 5 menit; mengembalikan
  `NO_DUE_JOB` dengan job_id null bila tidak ada yang bisa diklaim;
  jalur p_job_id untuk periksa-ulang.
- (9) `process_publishing_jobs(uuid, uuid)` — loop maks 20 job;
  PLACEMENT_CHANGED → `needs_manual_action`; preflight lolos →
  handoff manual (`needs_manual_action`, attempt `handoff_manual`);
  preflight gagal → `needs_manual_action` dengan kode preflight;
  galat tak terduga per job → `failed`/`TRANSIENT_ERROR`, batch tetap
  jalan.
- (10) `retry_publishing_job(uuid)` — hanya job `failed`, galat
  terakhir `TRANSIENT_ERROR`, kegagalan < 3; → `ready` +
  `next_attempt_at` backoff; attempt `retry_scheduled`.
- (11) `cancel_publishing_job(uuid, text)` — alasan wajib, maks 500
  karakter; ditolak dari `published`/`cancelled` dan dari `sending`
  dengan lease aktif; placement ikut `cancelled`; attempt `cancelled`
  berisi alasan.
- (12) `confirm_publishing_job(uuid, text, timestamptz)` — satu-satunya
  jalan ke Published; URL harus `https?://`, tanpa spasi, ≤ 2048;
  `published_at` wajib, tidak boleh di masa depan > 5 menit; ditolak
  dari `published`/`cancelled`/`failed` dan dari `sending` ber-lease
  aktif; cek `ALREADY_PUBLISHED`; menulis `published_posts` +
  placement `published_url` + status `published` + attempt
  `published`, satu transaksi.

### pgTAP 06 — `supabase/tests/06_rls_phase6.sql` (974 baris, plan(109), 109 asersi)

Setup: org A6/B6, WS-A6/WS-B6, A owner WS-A, B manager WS-A scope
`[Brand A6]` + admin WS-B; brands A6/A2-6/B6; channels IG A6/A2-6/B6/
A6-2; 11 item (item-2 & item-8 tanpa approval; item-3 v1 approved
tapi terbaru v2 → STALE; item-9 placement p9 SENGAJA tanpa
placement_versions → PREFLIGHT_FAILED); placement p1–p10 + pB
(jadwal Desember 2026); workflow default + approval_requests approved
internal. UUID palsu `11111111-...`/`22222222-...` hanya di 2 baris
`\set` (verifier menegakkannya).

| Tes     | Isi                                                                                                                                                                                       | Asersi |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T1      | `publishing_backoff_minutes` 1/5/15                                                                                                                                                       | 4      |
| T2–T7   | Preflight: READY + 5 checks; APPROVAL_REQUIRED; APPROVAL_STALE; FORBIDDEN scope + non-member; UNAUTHENTICATED / NOT_FOUND / TIMEZONE_INVALID / SCHEDULE_PAST; p9 tanpa placement_versions | 13     |
| T8–T11  | Create: scheduled_locally + ready + kunci idempotency + snapshot versi                                                                                                                    | 12     |
| T12     | DUPLICATE_JOB (RPC + preflight)                                                                                                                                                           | 2      |
| T13–T14 | Claim NO_DUE_JOB + claim job jatuh tempo                                                                                                                                                  | 6      |
| T15–T18 | Process handoff manual (processed=1 lalu 0; job + placement → needs_manual_action; attempt handoff_manual; attempt_count=1)                                                               | 13     |
| T19     | PLACEMENT_CHANGED (insert placement v2 mid-test via `reset role;`)                                                                                                                        | 4      |
| T20–T21 | Confirm manual → Published + published_posts + placement published_url + confirmation_source manual; confirm ulang/URL buruk/waktu masa depan ditolak                                     | 8      |
| T22–T24 | Cancel + alasan tercatat + cancel ulang/terminal ditolak + alasan kosong INVALID_REASON + slot bebas sesudah cancel                                                                       | 6      |
| T25–T28 | Retry transient (backoff 5 mnt untuk kegagalan ke-2; next_attempt_at dalam jendela now+4..6 mnt) + retry dari ready ditolak + galat non-transient ditolak + batas 3 kegagalan             | 18     |
| T29–T31 | Tulis langsung 42501 (3 tabel) + CHECK provider null/status/sumber manual/remote_post_id (23514, pesan lengkap) + unik attempts (23505)                                                   | 6      |
| T32–T34 | RLS baca scope v1.1 (B melihat 6 dari 7 job WS-A; job p4 Brand A2 tersembunyi; B melihat 2 attempt job p5)                                                                                | 14     |
| T35–T36 | Indeks partial idempotency (duplikat aktif 23505; slot cancelled bebas via `lives_ok`)                                                                                                    | 3      |

Total: 109 asersi (dihitung per label T1–T36 dari file; cocok dengan
`plan(109)` — diverifikasi `rls_verify_phase6.py` 33/33). Cleanup di
akhir file (begin … rollback) menghapus semua data uji.

### Verifier statis — `supabase/tests/rls_verify_phase6.py` (33/33 lolos)

Jalankan: `~/workspace/.venv-pglast/bin/python supabase/tests/rls_verify_phase6.py`
(python3 sistem tidak punya pglast; venv sama seperti Phase 4/5).
Memeriksa: pglast penuh 0020 (80 stmt) + tes 06 (174 stmt);
plan(109) == 109 asersi; throws_ok bentuk 4 argumen; tidak ada UUID
uji nyata; CHECK + helper visibilitas + 12 policy + shared tidak
di-scope; 3 tabel + RLS + revoke-all + grant select saja; 7 RPC +
backoff; tidak ada fungsi adapter; indeks partial idempotency;
forward-reference 0020; graf RLS efektif 0001–0020.

Pelajaran verifier yang dicatat: cek string "7 RPC" awalnya gagal
karena migrasi menulis parameter bernama multi-baris — cek diperbaiki
ke nama fungsi + `(`; ambang `security definer`/`search_path` adalah 9
(7 RPC + 2 helper; fungsi backoff memang tanpa SECURITY DEFINER karena
tidak menyentuh auth), bukan 10.

### Uji statis migrasi — `tests/migrations.test.ts`

Diperbarui ke 20 migrasi (0001–0020) + uji khusus 0020 (3 tabel + RLS +
revoke-all + grant select saja; 7 RPC + backoff; helper visibilitas
v1.1 + `brand_in_scope(ci.brand_id)`; **TIDAK ADA fungsi adapter
provider**; indeks partial idempotency + CHECK provider null +
confirmation_source manual; policy INSERT hanya WITH CHECK — regresi
0017; preflight tidak pernah melempar; loop proses maks 20; claim
atomik) + uji pgTAP 06 (plan(109) + T2a/T20c/T32b + placeholder benar).
Vitest 186/186 (naik dari 167 — 17 uji publishing + 2 uji migrasi
baru).

## 4. P6-04 s.d. P6-08 — Kode aplikasi

### Domain `features/publishing/` (5 file baru)

- `constants.ts` (116 baris) — 9 label status, angka ASUMSI-6.3
  (retry maks 3, backoff 1/5/15, lease 5 mnt, timeout 2 mnt), URL
  resmi platform (ASUMSI-6.5), kode galat.
- `types.ts` (95 baris) — PublishingJob/Attempt/PublishedPost/
  PreflightResult/JobRow/ActionResult — ActionResult kini punya field
  `code` opsional untuk pemetaan status HTTP API.
- `utils.ts` (214 baris) — fungsi murni: konversi zona waktu eksplisit
  via Intl, kunci idempotency, backoff, validasi URL, guard transisi,
  pengingat overdue/due-soon.
- `queries.ts` (212 baris) — pola `runQuery` → `unavailable`, bukan
  null; `listPublishingJobs`, `getPublishingJob`,
  `getActivePublishingJobForPlacement`, `getPublishedPostForPlacement`,
  `runPreflight`.
- `actions.ts` (556 baris) — direfaktor di P6-05 jadi fungsi *Core —
  `create/retry/cancel/confirm/reschedule/processPublishingJobsCore` —
  dipakai form action DAN route API, satu jalur penegakan; form action
  tipis: Zod FormData → wall-clock → UTC → core → revalidatePath.
- `lib/validation/schemas.ts` — skema Zod Phase 6 (job + konfirmasi +
  cancel + reschedule + proses).

### Komponen `features/publishing/components/` (6 file baru)

- `StatusBadge.tsx` (28 baris) — label harfiah 9 status.
- `PreflightChecklist.tsx` (40 baris) — blokir vs peringatan, tombol
  buat-job disabled bila ada blokir.
- `CreateJobForm.tsx` (84 baris) — preflight server-side, tombol
  disabled bila ada blokir.
- `JobActionForms.tsx` (261 baris) — Confirm/Cancel/Reschedule/Retry/
  Recheck/ProcessQueue — **SEMUA form tetap mounted; aksi yang tidak
  berlaku di-DISABLE dengan alasan, bukan disembunyikan** (pelajaran
  unmount Phase 3/4/5 — §6.3).
- `PublishingQueue.tsx` (131 baris) — seksi "Perlu perhatian"
  terhitung + semua job.
- `JobDetail.tsx` (160 baris) — status, jadwal zona placement, bukti
  terbit, riwayat attempts, form aksi.

### Route + API

- `app/(app)/publishing/page.tsx` (70 baris) — Queue; worker lokal:
  proses job jatuh tempo saat halaman dimuat, idempotent, hanya bila
  `can(role, "schedule_publish")`.
- `app/(app)/publishing/[id]/page.tsx` (67 baris) — detail;
  `notFound()` bila job milik workspace lain.
- `app/(app)/publishing/new/page.tsx` (117 baris) — buat job dari
  `?placementId=`; preflight server-side; `notFound()` bila placement
  milik workspace lain.
- `app/api/v1/publishing/` — `helpers.ts` (re-export `errorJson`/
  `requireContext` dari approvals + `actionStatusFor`: FORBIDDEN→403,
  NOT_FOUND→404, UNAUTHENTICATED→401, lain→400); `jobs/route.ts`
  (GET list RLS + POST create, body JSON ISO UTC, 201);
  `jobs/[id]/route.ts` (GET satu job); `jobs/[id]/retry|cancel|
confirm/route.ts` (POST; cancel body `{reason}`, confirm body
  `{canonical_url, published_at}` ISO); `process/route.ts` (POST, body
  opsional `{job_id}`); `providers/route.ts` (GET + POST → **501
  `UNSUPPORTED_CAPABILITY`** — adapter DISABLED, Decision #3).

### Nav + wiring

- `components/layout/AppSidebar.tsx` — Publishing di seksi Produksi.
- `app/(app)/lainnya/page.tsx` — tautan Publishing.
- `app/(app)/konten/[id]/page.tsx` — paragraf lama "Approval &
  publishing: belum tersedia di fase ini (Phase 4)" diganti tautan
  antrean publishing; tiap placement menampilkan `published_url` bila
  terbit + tautan "Jadwalkan publikasi" bila
  `can(role, "schedule_publish")` dan belum published; `PlacementsTab`
  kini menerima prop `role`.

### Pola yang dipakai ulang (dari fase sebelumnya)

- `lib/permissions.ts` (`schedule_publish` = owner/admin/manager true,
  strategist "limited", lainnya false; `can()` = true atau "limited").
- `features/planning/context.ts` (`getPlanningContext`,
  `getCallerRole`, `getCallerBrandScope`).
- `lib/time.ts` (simpan UTC, render di timezone workspace default
  Asia/Jakarta; `isValidTimezone` via Intl).
- `Input` UI selalu berlabel (`id` + `label` + `hint` wajib — komponen
  merender label sendiri); `useActionState` + `ResultMessage` (role
  status/alert); platform enum
  instagram/tiktok/youtube/facebook/linkedin/x/threads/other.

### 4.5 Temuan zona waktu (penting, di luar lingkup perbaikan)

Server/VM berjalan di **UTC**. Pola lama repo (`new Date(v).toISOString()`
di `lib/validation/schemas.ts` `optionalDatetime` + form placement/
due-date) mengartikan wall-clock sebagai UTC — untuk pengguna WIB bisa
geser 7 jam. Form publishing Phase 6 memakai konversi eksplisit zona
placement (`zonedWallClockToUtcIso` / `utcIsoToZonedWallClock` di
`features/publishing/utils.ts`, Intl, independen zona server). Form lama
di luar lingkup Phase 6 — catat sebagai batas jujur (§7.4), jangan
perbaiki diam-diam di luar cakupan.

### Tes unit — `tests/publishing.test.ts` (155 baris, 17/17)

Konversi zona WIB vs New York, round-trip stabil, kunci idempotency,
backoff 1/5/15, URL, ASUMSI-6.6, guard retry/cancel/confirm, pengingat
overdue/due-soon.

### e2e — `e2e/publishing.spec.ts` (277 baris; 2 tes @needs-db + 1 smoke)

- **Tes 1 (A6.1):** setup org/workspace/brand/channel/konten
  (`org-p6-*`/`ws-p6-*`) → walk stage idea→editing (5 langkah, pola
  approval.spec.ts) → tab Approval → tugaskan step ke diri sendiri
  (select `assigneeUserId` index 1 = owner) → submit v1 → setujui v1
  (klik "Kirim keputusan" tanpa pilih "Minta revisi") → tambah
  placement IG → tautan "Jadwalkan publikasi" → preflight lolos →
  buat job segera (jadwal kosong) → `/publishing` memproses otomatis
  → kartu "Needs manual action" → detail (riwayat 1, "Diserahkan ke
  manual") → konfirmasi URL `https://www.instagram.com/p/p6e2e123/` →
  "Publikasi dikonfirmasi manual — status Published (konfirmasi
  pengguna, bukan provider)." → bukti terbit tampil + persist sesudah
  reload → placement di halaman konten menampilkan "Terbit:" + URL.
- **Tes 2 (A6.2/A6.3/A6.5):** job terjadwal 7 hari ke depan
  (wall-clock, input `#pub-scheduled-at`) → "dijadwalkan secara lokal
  (bukan jadwal provider)" → kartu "Scheduled locally", tanpa
  "Published"/"Scheduled (provider)"/"Uploaded / Draft created" →
  kunjungi ulang URL buat-job: preflight menampilkan duplikat + tombol
  buat-job disabled (duplikat diblokir preflight sebelum submit;
  penolakan RPC-nya ditanggung pgTAP T12) → batal dengan alasan →
  "Job dibatalkan sebelum terkirim — tanpa efek samping." →
  "Cancelled" persist.
- **Tes 3 (smoke tanpa login):** `/publishing` menampilkan
  "Anda belum masuk".
- Pola dari spek lain yang dipakai: `test.setTimeout(300000)`,
  `expect.configure({ timeout: 30000 })`,
  `test.skip(!hasTestAccount, ...)`, pesan sukses dicek `exact: true`
  bila ada hint statis serupa, locator `details`/`summary` untuk form
  tambah placement/channel, residu pola `org-p6-*`/`ws-p6-*` untuk
  dibersihkan parent.

## 5. P6-09 — Gate lokal (perintah + output aktual)

Dijalankan di `~/workspace/mative/app`, HEAD `430aaf7`
(sesudah commit e2e + migrations.test.ts; sebelum laporan ini):

| Gate      | Perintah                                                                                                   | Hasil                                                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck | `npx tsc --noEmit`                                                                                         | **0 error**                                                                                                                                                                                                                                 |
| ESLint    | `npx eslint .`                                                                                             | **0 error**                                                                                                                                                                                                                                 |
| Vitest    | `npm test`                                                                                                 | **186/186 lolos, 17 file** (naik dari 167/167)                                                                                                                                                                                              |
| Prettier  | `npx prettier --check e2e/publishing.spec.ts tests/migrations.test.ts` (sesudah `--write` pada 2 file itu) | **bersih**                                                                                                                                                                                                                                  |
| Build     | `npm run build`                                                                                            | **exit 0, 45 route**: 34 halaman (termasuk `/` + `/_not-found`) + 11 endpoint API; cara hitung Phase 5 (halaman tanpa `/` dan `/_not-found`): **32 halaman** (29 + 3 publishing baru: `/publishing`, `/publishing/[id]`, `/publishing/new`) |

Prettier: hanya file yang diubah/ditambah di Phase 6 yang diperiksa
dan dibersihkan. File pra-Phase 6 yang sudah tidak bersih (laporan
Phase 3/4, §6.5 Phase 5) dibiarkan — keputusan parent masih pending,
kosmetik saja.

## 6. Defect yang ditemukan & diperbaiki (tidak disembunyikan)

### 6.1 Defect keamanan — policy SELECT 0020 v1.0 tidak menegakkan brand scope (ditemukan saat merancang pgTAP 06, diperbaiki PRA-LIVE)

Policy SELECT v1.0 hanya memeriksa keanggotaan workspace — member
scope-terbatas bisa MEMBACA job/attempt/bukti brand lain (kebocoran
baca; mutasi sudah benar karena RPC memeriksa scope). Perbaikan
(amend 0020 → v1.1, commit `612af5e`): helper baru
`is_publishing_job_visible` + `is_publishing_post_visible` (cabang
member = peran 8 peran non-klien AND `brand_in_scope(ci.brand_id)`,
pola 0016; cabang shared `is_placement_shared_with_me` tidak berubah);
helper lama `is_publishing_job_member` dihapus (tidak ada dependen —
hanya dipakai policy attempts, belum live). pglast 0020 naik 76 → 80
statement. Alasan amend (bukan migrasi 0021): 0020 belum pernah
diterapkan di mana pun (live maupun preview); preseden 0019 memakai
migrasi baru karena 0016 sudah live. **Pelajaran yang dicatat (§3
Phase 5, pelajaran 25):** policy SELECT tabel baru HARUS menegakkan
brand scope (pola 0016), bukan hanya keanggotaan workspace — bila
tidak, member scope-terbatas bisa membaca record brand lain. Helper
visibilitas (SECURITY DEFINER, hanya boolean) membungkus join-nya;
policy sendiri tidak boleh memindai tabel lain (FROM/JOIN).

### 6.2 Defect spek e2e — komentar `org-p6-*/` menutup blok komentar (TS1109)

Komentar header `e2e/publishing.spec.ts` berisi pola residu
`org-p6-*/ws-p6-*` — substring `*/` menutup blok `/* ... */` lebih
awal, sehingga sisa baris menjadi kode dan typecheck gagal
(TS1109/TS1005/TS1434, baris 19) + ESLint parsing error. Perbaikan:
pola ditulis `org-p6-[slug]/ws-p6-[slug]`. Typecheck 0 + lint 0
sesudahnya. **Pelajaran:** jangan tulis `*/` di dalam komentar blok —
pola glob `x-*/` adalah jebakan yang sama.

### 6.3 Defect spek e2e — asersi duplikat cocok 2 elemen (strict mode)

Asersi `getByText("Sudah ada job aktif untuk placement ini pada waktu
yang sama.")` cocok dengan DUA elemen (header checklist "Preflight
gagal: ..." + item checklist "Blokir: ...") → Playwright strict mode
violation. Perbaikan: asersi memakai teks lengkap header dengan
`exact: true`. **Pelajaran (lanjutan pelajaran 11 Phase 5):** teks
pesan yang muncul di header DAN di item daftar harus diassert dengan
teks lengkap + exact, atau pakai `.first()` bila memang sengaja.

### 6.4 Bukan defect — pola form tetap mounted (pelajaran Phase 3/4/5 diterapkan)

Semua form aksi job (`JobActionForms.tsx`) tetap dirender; aksi yang
tidak berlaku di-DISABLE dengan alasan, bukan disembunyikan — pola
unmount yang menelan pesan sukses di Phase 3 (2 cacat), Phase 4
(3 cacat), Phase 5 (1 cacat) tidak terulang di Phase 6.

### 6.5 Bukan defect — memoize Next.js dihindari (pelajaran Phase 5)

Jalur baca-ulang sesudah lazy-create dihindari: `create_publishing_job`
mengembalikan baris job-nya langsung; halaman detail membaca job
berdasarkan `id` dari URL (bukan baca-ulang daftar dengan URL GET yang
sama sesudah tulis). Tidak ada baca → tulis → baca ulang dengan URL
identik dalam satu render server di jalur Phase 6.

## 7. Batas jujur — yang BELUM terbukti (wajib dibaca parent)

1. **Migrasi 0020 v1.1, pgTAP 06, dan e2e publishing TERBUKTI live**
   (lihat §11): 0020 live 01:35–01:36 WIB 20 Nov 2026, pgTAP 06 v1.1
   109/109 live 02:32 WIB, e2e publishing 6/6 live (Chromium +
   mobile).
2. **Tes mobile WebKit SUDAH dijalankan dan lolos untuk publishing**
   (6/6 incl. mobile, §11) — library sistem sempat hilang lalu
   diinstal ulang 20 Nov 2026 (lihat §11 butir (e)). Yang belum lolos
   di mobile: 3 smoke planning/production (pre-existing, sidebar
   hidden < md — lihat §11 butir 3).
3. **Job jatuh tempo tidak diproses sendiri** tanpa ada yang membuka
   Queue atau memanggil endpoint proses — tidak ada worker/cron
   otomatis di Phase 6 (B5 repo GitHub masih terbuka; tidak ada deploy
   Vercel tempat cron berjalan). Phase 7 boleh menggantinya dengan
   worker/cron sungguhan tanpa mengubah model job.
4. **Form lama (placement/due-date) memakai `new Date(v)` di zona
   server UTC** — untuk pengguna WIB jadwal bisa geser 7 jam (§4.5).
   Jalur placement DIPERBAIKI live Phase 6 (`a2ed6cb`:
   `optionalWallClock` + `zonedWallClockToUtcIso`); jalur
   campaign/idea/task (`optionalDatetime`) masih memakai `new Date(v)`
   — di luar cakupan Phase 6.
5. **Approval target placement ada di DB (0014) tapi tanpa UI.**
   Phase 6 tidak menambah submit approval per-placement (scope
   Phase 4). Sebagai pengaman, job menyimpan snapshot
   `placement_version_id` saat dibuat; bila placement diedit
   sesudahnya, proses menolak dengan `PLACEMENT_CHANGED` →
   `needs_manual_action`.
6. **Approval dua-peran belum terbukti live** (bawaan Phase 4) — tidak
   berubah di Phase 6.
7. **Pola seed malas yang menelan galat diam-diam** sudah diperbaiki
   untuk 2 jalur yang terbukti cacat di Phase 5, tetapi pola yang sama
   di tempat lain belum diaudit menyeluruh (bawaan Phase 5).
8. **Anggota scope-terbatas yang membuat brand tidak melihatnya sampai
   owner menambahkannya ke scope** (fail-safe di sisi baca, bukan
   kebocoran — bawaan 0019).
9. **QA visual di browser nyata belum ada** untuk halaman publishing
   (layout Queue/detail/new dibuktikan lewat build + e2e locator,
   bukan render browser).
10. **Tiga file rencana detail masih berisi teks pra-v2** (harus direvisi
    mengikuti v2 — item terbuka, §2 Phase 5).
11. **Framework Plan Management masih DRAF** (tidak pernah disetujui
    eksplisit oleh user).

## 8. Instruksi penerapan ke live (untuk parent)

### Prasyarat

- Database live Supabase "mative" (`kwyqtlxglhlvtghfrnhr`) dalam keadaan
  Phase 5: migrasi 0001–0019 live, seed-only.
- Pengguna auth uji pgTAP: A `094e8752-eef4-4f0e-b6ae-2d5813445018`
  (mative-test-a@example.com), B `aabb1dab-77c1-4659-af0e-c703c9de279c`
  (mative-test-b@example.com) — JANGAN pakai UUID palsu 1111.../2222...
  di live (itu hanya placeholder file).
- Akun e2e `mative-e2e@example.com` (UID
  `6786efb0-75c6-4648-a96e-a0d7649036bc`) — kata sandi dari handoff
  internal (TIDAK ada di file ini).
- pgTAP aktif di proyek Supabase (Dashboard → Database → Extensions →
  pgtap) atau `create extension if not exists pgtap;`.
- JANGAN terapkan migrasi dari VM ini — parent yang menerapkan lewat
  SQL Editor (aturan tugas).

### Langkah 1 — Terapkan migrasi, URUTAN INI (lewat SQL Editor, per file per run)

1. **`0020_publishing_foundation.sql` (v1.1)** — tempel SELURUH isi
   file ke SQL Editor, Run sekali. Dialog yang mungkin muncul:
   - Dialog RLS (file mengaktifkan RLS + menulis policy): pilih "Run
     without RLS" (migrasi mengaktifkan RLS sendiri).
   - Dialog destructive dari `drop ... if exists` yang terverifikasi
     sah (policy/helper lama `is_publishing_job_member` TIDAK ada di
     live — 0020 belum pernah diterapkan; drop di file hanya
     berjaga-jaga): pilih "Run query".
   - Verifikasi: 0 galat; 3 tabel baru ada (`publishing_jobs`,
     `publishing_attempts`, `published_posts`); 12 policy
     (`select count(*) from pg_policies where schemaname = 'public'
and tablename in ('publishing_jobs','publishing_attempts',
'published_posts')` = 12); 7 RPC + backoff + 2 helper ada
     (`select proname from pg_proc where proname like
'publishing_%' or proname like 'is_publishing_%'`).
2. **JANGAN ubah migrasi 0001–0019.** Bila ada galat, BERHENTI dan
   laporkan — jangan edit migrasi di live. Ingat pelajaran 0017:
   pglast OK ≠ Postgres menerima (policy INSERT hanya boleh WITH
   CHECK — 0020 sudah memakai pola itu, diuji statis di
   `tests/migrations.test.ts`).

### Langkah 2 — Jalankan pgTAP 06 live

1. Di file `supabase/tests/06_rls_phase6.sql`, ganti placeholder:
   `:'user_a'` → `094e8752-eef4-4f0e-b6ae-2d5813445018`,
   `:'user_b'` → `aabb1dab-77c1-4659-af0e-c703c9de279c`
   (atau jalankan via psql dengan `-v user_a=... -v user_b=...`).
2. Tempel SELURUH file ke SQL Editor, Run SEKALI (satu transaksi
   begin … rollback; JANGAN run per bagian — tiap Run adalah sesi baru
   dan transaksi tidak dipertahankan).
3. Hasil yang diharapkan: **109/109 ok, 0 "not ok"**, `finish()` 0
   baris, residu 0 (rollback membersihkan data uji).
4. Bila gagal: catat nomor tes (Txx) + kode galat (23514/23505/42501/
   P0001) + statement-nya; JANGAN tebak statement yang gagal dari
   pesan saja (pelajaran Phase 4: tebakan browser task tentang T2 vs
   T16 pernah salah) — baca konteks galat + kode aktual.

### Langkah 3 — Jalankan e2e Phase 6 live

```bash
cd ~/workspace/mative/app
E2E_TEST_EMAIL=mative-e2e@example.com E2E_TEST_PASSWORD='<dari handoff internal>' \
  npx playwright test e2e/publishing.spec.ts
```

Hasil yang diharapkan: 2 tes @needs-db + 1 smoke × 2 proyek
(chromium + mobile) = **6 lolos, 0 gagal** (bagian mobile hanya bila
B4 disetujui — bila tidak, 3 lolos Chromium). (Regresi: jalankan juga
`e2e/planning.spec.ts` + `e2e/approval.spec.ts` +
`e2e/production.spec.ts` + `e2e/campaign.spec.ts` — perubahan
`app/(app)/konten/[id]/page.tsx` menyentuh jalur Phase 2/3/4/5.)

### Langkah 4 — Setelah lolos

1. Perbarui `docs/apply-migrations.md` (migrasi kini 0001–0020).
2. Isi §11 laporan ini (deklarasi parent) + perbarui `~/MEMORY.md`
   (buku rencana 8/11 = 73%) + catat satu baris completions
   `C<YYYYMMDDHHMM>-plan` di `~/workspace/monitor/completions.jsonl`.
3. Luncurkan koordinator Phase 7.

### 8.1 Data uji yang tertinggal di live + cara membersihkan

Pola slug residu spek e2e Phase 6: **`org-p6-*` / `ws-p6-*`**
(organisasi `Organisasi E2E p6a-…`, workspace `Workspace E2E p6a-…`,
brand `Brand E2E p6a-…`, dst.). pgTAP 06 membersihkan dirinya sendiri
(rollback) — tidak ada residu pgTAP bila Run sekali sampai selesai.

Pembersihan (sebagai postgres/service role, SETELAH e2e lolos dan
hasilnya dicatat — urutan hapus mengikuti FK, pola Phase 4/5 §8.1):

```sql
-- 1. Periksa dulu apa yang ada:
select slug from public.organizations where slug like 'org-p6-%';
select slug from public.workspaces where slug like 'ws-p6-%';
-- 2. Hapus workspace + org e2e (unset is_default brief template bila ada):
update public.brief_templates set is_default = false
where workspace_id in (select id from public.workspaces where slug like 'ws-p6-%');
delete from public.workspaces where slug like 'ws-p6-%';
delete from public.organizations where slug like 'org-p6-%';
-- 3. Verifikasi seed-only (harus sama seperti akhir Phase 5):
--    organizations 1, workspaces 1, organization_members 1,
--    workspace_members 2, brands 0, content_items 0, campaigns 0,
--    brief_templates 0; workspace_settings 1 milik seed.
```

## 9. File yang diserahkan (P6-01 s.d. P6-09)

| File                                                                                                                                                               | Isi                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `docs/decisions/ADR-0012-publishing-foundation-phase6.md`                                                                                                          | 12 keputusan Phase 6                                   |
| `supabase/migrations/0020_publishing_foundation.sql`                                                                                                               | 979 baris, 80 stmt (v1.1)                              |
| `supabase/tests/06_rls_phase6.sql`                                                                                                                                 | plan(109), 109 asersi                                  |
| `supabase/tests/rls_verify_phase6.py`                                                                                                                              | verifier statis, 33/33                                 |
| `tests/migrations.test.ts`                                                                                                                                         | 20 migrasi + uji 0020 + uji pgTAP 06                   |
| `tests/publishing.test.ts`                                                                                                                                         | 17 uji zona waktu/idempotency/backoff/guard            |
| `features/publishing/{constants,types,utils,queries,actions}.ts`                                                                                                   | domain publishing                                      |
| `features/publishing/components/{StatusBadge,PreflightChecklist,CreateJobForm,JobActionForms,PublishingQueue,JobDetail}.tsx`                                       | komponen Queue/detail/buat                             |
| `app/(app)/publishing/page.tsx` + `app/(app)/publishing/[id]/page.tsx` + `app/(app)/publishing/new/page.tsx`                                                       | Queue/detail/buat job                                  |
| `app/api/v1/publishing/{helpers,jobs/route,jobs/[id]/route,jobs/[id]/retry/route,jobs/[id]/cancel/route,jobs/[id]/confirm/route,process/route,providers/route}.ts` | API v1 publishing                                      |
| `lib/validation/schemas.ts`                                                                                                                                        | skema Zod Phase 6                                      |
| `components/layout/AppSidebar.tsx`                                                                                                                                 | nav "Publishing" (Produksi)                            |
| `app/(app)/lainnya/page.tsx`                                                                                                                                       | tautan Publishing                                      |
| `app/(app)/konten/[id]/page.tsx`                                                                                                                                   | tautan antrean + published_url + "Jadwalkan publikasi" |
| `e2e/publishing.spec.ts`                                                                                                                                           | A6.1 + A6.2/A6.3/A6.5 + smoke                          |
| `docs/phase-6-report.md`                                                                                                                                           | laporan ini                                            |

Dependensi baru: **tidak ada** (Intl bawaan + pola yang sudah ada).

## 10. Sub-keputusan terbuka yang diputuskan sendiri (default paling aman)

1. **ASUMSI-6.3 — retry maks 3, backoff 1 → 5 → 15 menit, lease 5
   menit, timeout pemrosesan 2 menit.** Alasan: retry hanya untuk
   galat transient dan hanya sesudah keputusan retry eksplisit —
   angka kecil membatasi kerusakan bila sebuah job ternyata
   non-idempotent (tidak ada blind retry tanpa batas); backoff
   eksponensial memberi waktu pulih pada gangguan sementara tanpa
   membanjiri; lease 5 menit cukup untuk handoff manual yang cepat
   sekaligus membebaskan job yang macet; timeout 2 menit adalah budget
   pemrosesan di pemanggil, bukan batas DB (tidak ada statement
   timeout di migrasi). Semua angka hidup di satu tempat
   (`publishing_backoff_minutes` + `constants.ts`) agar tidak
   berpecah. (§2.5, §7.3 — batas jujur: angka ini default koordinator,
   bukan dikunci Tuan; ubah bila Tuan memerintahkan.)
2. **ASUMSI-6.6 — zona placement sumber kebenaran bila zona item dan
   placement berbeda.** Alasan: jadwal melekat pada placement (satu
   konten bisa punya banyak placement di zona berbeda); ini menegaskan
   P2-A9 yang sudah diputuskan sejak Phase 2, jadi bukan keputusan
   baru yang bertentangan dengan preseden. Job menyimpan `timezone`
   (disalin dari placement saat dibuat) dan `scheduled_at` selalu UTC.
   (§2.8)
3. **ASUMSI-6.1 (diadopsi):** `needs_manual_action → ready` /
   `scheduled_locally` sesudah preflight ulang lolos, atau `→
cancelled`; tidak ada transisi langsung `→ sending` tanpa
   preflight ulang. (§2.3)
4. **ASUMSI-6.2 (diadopsi):** kunci idempotency
   `pub:<placement_id>:<scheduled_at ISO atau 'immediate'>`, indeks
   unik partial (bukan `cancelled`) — job dibatalkan membebaskan
   slotnya. (§2.4)
5. **ASUMSI-6.4 (diadopsi):** `provider_job_id`/`provider_post_id`
   selalu null di Phase 6 (CHECK). (§2.6)
6. **ASUMSI-6.5 (diadopsi):** tombol "Open platform" hanya bila URL
   resmi diketahui; bila tidak, tombol tidak tampil. (§2.7)
7. **Reminder = tampilan terhitung, bukan record terkirim** (tidak ada
   kanal email/push; tabel `notifications` tidak diubah). (§2.11)
8. **Worker lokal dipicu eksplisit** (muat Queue / POST process) —
   bukan cron/Inngest di repo. (§2.10)
9. **Form aksi job tetap mounted, di-disable dengan alasan** (bukan
   disembunyikan) — pelajaran unmount Phase 3/4/5. (§6.4)
10. **Form lama di luar lingkup tidak diperbaiki** (geser 7 jam
    `new Date(v)` di zona UTC — §4.5) — dicatat sebagai batas jujur,
    bukan diperbaiki diam-diam. **Pembaruan live:** jalur placement
    akhirnya DIPERBAIKI (`a2ed6cb`) karena bug itu memblokir A6.2;
    jalur campaign/idea/task tetap tidak disentuh.

## 11. Deklarasi — DINYATAKAN LULUS oleh parent, 2026-11-20 04:03 WIB

**Phase 6 LULUS.** Bukti live (semua diverifikasi parent langsung):

1. **Migrasi 0020 v1.1 live** 2026-11-20 01:35–01:36 WIB ("Success. No
   rows returned", 979 baris, tanpa dialog), terverifikasi 01:37–01:39
   WIB: 3 tabel RLS true, 12 policy (4/tabel), 10 fungsi (7 RPC +
   `publishing_backoff_minutes` + 2 helper visibilitas), indeks unik
   partial idempotency ada.
2. **pgTAP 06 v1.1 live 109/109** — Run 2026-11-20 02:32 WIB (tab baru,
   1015 baris; dialog destructive dijawab "Run query"). v1.0 sempat
   gagal 23503 karena cleanup menghapus `brands` sebelum
   `content_items` (RESTRICT); v1.1 (commit `8dff127`) mengurutkan
   cleanup daun → akar. Hasil: tanpa galat, asersi terakhir
   `ok 109 - T36b`, tidak ada "not ok", `finish()` 0 baris (= lolos
   penuh). Rollback bersih — fixture pgTAP terverifikasi semua 0
   (02:33 WIB).
3. **e2e publishing live 6/6** (Chromium + mobile iPhone 13,
   `--workers=1`):
   - Run 1 (02:32–03:03 WIB): A6.1 lolos kedua proyek; A6.2 gagal
     kedua proyek karena bug lama `new Date(v)` (§4.5) — jadwal WIB
     bergeser 7 jam, trigger 0014 menembak dengan BENAR
     (`reapproval_required`) sehingga preflight kena
     `APPROVAL_REQUIRED` sebelum pesan DUPLIKAT tercapai.
   - Perbaikan: `a2ed6cb` (placement `scheduledAt` kini
     `optionalWallClock` + `zonedWallClockToUtcIso`, tanpa migrasi;
     `optionalDatetime` campaign/idea/task sengaja tidak disentuh) +
     `e6d705e` (preflight halaman buat-job memakai jadwal placement,
     bukan null — cacat aplikasi nyata kedua yang ditemukan run
     ulang) + spek `6dfac74` (A6.2 isi jadwal placement = jadwal job).
   - Run 2: run penuh 5/6 (A6.1 Chromium gagal 1×, flake cold-start)
     + run ulang solo A6.1 lolos 1,9 mnt → **6/6**. Flake dikeraskan
     dengan timeout eksplisit 30 dtk (`5a408ec`).
   - Regresi (16,2 mnt): **22 lolos, 2 skip, 4 gagal.** A5.1 Chromium
     flake timing yang sama (run ulang solo lolos 1,1 mnt, dikeraskan
     `3bf9c79`). 3 smoke mobile (planning ×2, production ×1) gagal
     deterministik dan PRE-EXISTING: `AppSidebar.tsx:95` memakai
     `hidden ... md:flex` — sidebar tidak dirender di bawah breakpoint
     md, tautan "Board Produksi"/"Tugas Saya" tidak ada di DOM iPhone
     13 (390px). Smoke planning/production mobile belum pernah
     dijalankan sebelum run ini (mobile Phase 5 hanya campaign) — jadi
     ini ketidakcocokan tes-vs-desain responsif, BUKAN regresi Phase 6.
     Butuh keputusan produk (drawer mobile atau skip di mobile) —
     di luar mandat Phase 6.
4. **Verifikasi parent langsung** (2026-11-20 04:02 WIB): HEAD
   `3bf9c79`, tree bersih; typecheck 0, lint 0, Vitest **187/187**
   (17 file).

**Batas jujur yang TETAP berlaku sesudah deklarasi ini:** §7.3 (job
jatuh tempo tidak diproses sendiri — tanpa worker/cron), §7.5
(approval target placement ada di DB tanpa UI), §7.6 (approval
dua-peran belum terbukti live), §7.7–§7.11. **Batas jujur BARU dari
live Phase 6:**

- (a) 3 smoke mobile gagal (pre-existing, lihat butir 3) — keputusan
  produk tertunda.
- (b) Efek samping `e6d705e`: selama ada job terjadwal aktif, tombol
  buat-job di halaman itu disabled — job segera untuk placement yang
  sama tidak bisa dibuat dari halaman itu sampai job terjadwal
  dibatalkan (satu placement = satu rencana terbit).
- (c) Timeout eksplisit 30 dtk (`5a408ec`, `3bf9c79`) belum dibuktikan
  run ulang sesudah commit-nya — run ulang solo lolos sebelum commit.
- (d) `optionalDatetime` (campaign/idea/task) masih memakai
  `new Date(v)` — di luar cakupan Phase 6.
- (e) Library sistem WebKit sempat hilang total
  (`libgstreamer-1.0.so.0` tidak ter-resolve) lalu diinstal ulang
  (`npx playwright install-deps webkit`, persetujuan user 01:22 WIB
  masih berlaku untuk pustaka yang sama); penyebab hilangnya tidak
  diketahui.
- (f) Build produksi basi: e2e memakai `npm run start` dari `.next/`
  (terakhir 19 Nov 19:08) — perbaikan pertama kali tidak ada di build.
  Aturan: selalu rebuild sebelum e2e.
- (g) Residu e2e `org-p6-*`/`ws-p6-*` BELUM dibersihkan saat deklarasi
  ini ditulis — **dibersihkan 04:09 WIB sesudah deklarasi (§8.1),
  verifikasi seed-only: 32 organisasi + 31 workspace dihapus (19 p6
  + 13 pola lama p3/p4/p5/e2e dari run regresi), tersisa hanya seed
  (organizations 1, workspaces 1, organization_members 1,
  workspace_members 2, sisanya 0, workspace_settings 1).**

**Keputusan:** Phase 6 DINYATAKAN LULUS. Buku rencana kini **8/11 =
73%**. Lanjut Phase 7 (Integrasi + Analytics).
