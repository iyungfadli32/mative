# ADR-0012 — Publishing Foundation Phase 6 (Antrean Lokal + Preflight + Konfirmasi Manual)

- **Status:** Diterima (menuangkan Keputusan #3 + ASUMSI-6.1 s.d. 6.6 sebagai default yang diputuskan sendiri — mode One-Shot, tanpa bertanya lagi)
- **Tanggal:** 2026-11-20
- **Konteks:** Rencana kanonis v2 (`Rencana-MaTive-Lengkap-v2.md`, Phase 6) +
  rencana detail Phase 6 §6.1–6.7 + Dok 05 §3/§4, Dok 06 §3/§4, Dok 07 §3,
  Dok 08 §5/§6/§9, Dok 11 §6, Dok 12 Phase 6. Keputusan #3 (dikunci Tuan
  2026-11-19 01:52 WIB) sudah menyelesaikan integrasi pertama: **manual-only
  di MVP, adapter DISABLED**. ADR ini menuangkan keputusan itu ke implementasi
  + mengunci default ASUMSI-6.x agar Phase 6 bisa dibangun tanpa bertanya lagi.

## 1. Manual-only — tidak ada adapter provider (Keputusan #3)

- Tidak ada satu pun fungsi adapter provider (`uploadOrCreatePost`,
  `getPublishStatus`, `fetchPostMetadata`, `fetchAnalytics`) di fase ini —
  bukan sebagai implementasi palsu, bukan sebagai stub diam-diam.
- Satu-satunya jalan menuju `Published` di fase ini adalah **konfirmasi
  manual eksplisit** (actor + waktu + URL bukti, `confirmation_source =
  'manual_user_confirmation'`) — Dok 08 §9.
- Bila ada yang meminta aksi provider (API `POST .../publish` atau kode
  yang memanggil adapter), jawabannya adalah `501 UNSUPPORTED_CAPABILITY`
  dengan pesan jelas — bukan galat generik, bukan diam-diam.
- `provider_job_id` (publishing_jobs) dan `provider_post_id`
  (published_posts) **selalu null** di fase ini (ASUMSI-6.4) — ditegakkan
  di database dengan CHECK, bukan hanya di kode aplikasi. Bila ada kode
  yang mengisinya di fase ini, itu adalah bug.
- `remote_post_id` di `content_placements` tetap null di fase ini (CHECK
  lama `remote_post_id is null and published_url is null` diganti di
  migrasi 0020 menjadi `remote_post_id is null` saja — `published_url`
  kini BOLEH diisi oleh konfirmasi manual; CHECK lama dicabut sesuai
  komentar 0007).

## 2. Status — 9 label Dok 08 §6 secara harfiah

`distribution_status` (`content_placements`, sudah ada sejak 0007) dan
`publishing_jobs.status` memakai label yang sama, tanpa sinonim:

`draft → ready → scheduled_locally → sending → uploaded_or_draft_created
→ published → failed → needs_manual_action → cancelled`

- `uploaded_or_draft_created` **tidak pernah tercapai di Phase 6** (tidak
  ada provider yang mengembalikan upload/draft) — status itu ada di CHECK
  untuk Phase 7, dan UI tidak pernah menampilkannya sebagai Published.
- "Scheduled locally" tidak pernah tampil sebagai "Scheduled (provider)"
  (A6.2); upload/draft tidak pernah tampil sebagai Published (A6.2).
- Job dan placement bergerak bersama: setiap transisi job yang sah
  menulis `distribution_status` placement yang sama dalam SATU transaksi
  yang sama (RPC). Tidak ada penulisan status langsung dari client —
  satu-satunya jalan sah adalah RPC 0020 (pola approval 0014).

### Tabel transisi job (ditegakkan di RPC, diuji pgTAP 06)

| Dari | Ke | Syarat |
| ---- | -- | ------ |
| — | `ready` | Buat job tanpa `scheduled_at`, preflight lolos |
| — | `scheduled_locally` | Buat job dengan `scheduled_at` (masa depan), preflight lolos |
| `ready` / `scheduled_locally` | `sending` | Claim oleh worker lokal (lease 5 menit) |
| `sending` | `needs_manual_action` | Proses: tidak ada provider → serahkan ke manual (handoff) |
| `sending` | `failed` | Proses: galat transient yang diketahui |
| `needs_manual_action` | `ready` / `scheduled_locally` | Preflight ulang lolos (ASUMSI-6.1; via proses/periksa-ulang) |
| `failed` | `ready` | Retry eksplisit, error transient, percobaan < 3 (ASUMSI-6.3) |
| `ready` / `scheduled_locally` / `needs_manual_action` / `failed` | `cancelled` | Batal eksplisit + alasan wajib |
| `ready` / `scheduled_locally` / `needs_manual_action` | `published` | Konfirmasi manual (URL + waktu + actor) |
| `sending` | — (ditolak) | Cancel dari `sending` ditolak selama lease aktif |
| `published` / `cancelled` | — (terminal) | Tidak ada transisi keluar |

## 3. ASUMSI-6.1 — Transisi keluar `needs_manual_action` (DIADOPSI)

`needs_manual_action → ready` (atau `→ scheduled_locally` bila
`scheduled_at` masih di masa depan) setelah pengguna memperbaiki masalah
dan preflight ulang lolos; atau `→ cancelled` bila dibatalkan eksplisit
dengan alasan. **Tidak ada** transisi langsung `needs_manual_action →
sending` tanpa preflight ulang. Alasan aman: Dok 07 §3 tidak
mendefinisikan transisi keluarnya; asumsi ini menutup lubang itu tanpa
mengubah status lain. Tetap butuh jawaban Tuan bila ingin dikunci permanen.

## 4. ASUMSI-6.2 — Scope unik `idempotency_key` (DIADOPSI + penyempurnaan)

Unik per `placement_id` + `scheduled_at` (UTC). Format kunci:
`pub:<placement_id>:<scheduled_at ISO atau 'immediate'>` (job tanpa
jadwal memakai `'immediate'` — jadi hanya satu job aktif tanpa jadwal
per placement). **Penyempurnaan terhadap teks rencana:** indeks unik
bersifat *partial* — hanya berlaku untuk job yang statusnya BUKAN
`cancelled`. Alasan: job yang dibatalkan tidak pernah beraksi, jadi
slot waktunya harus bisa dijadwalkan ulang; tanpa pengecualian ini,
batal + jadwal-ulang di slot yang sama menjadi jalan buntu. Duplikat
aktif tetap ditolak (`DUPLICATE_JOB`) sebelum indeks bicara.

## 5. ASUMSI-6.3 — Angka operasional retry/backoff/lease (DIADOPSI)

Maksimal **3 kali percobaan** untuk error transient, backoff eksponensial
**1 menit → 5 menit → 15 menit**, lease/lock worker **5 menit**, timeout
pemrosesan job **2 menit**. Angka ini hanya berlaku untuk job lokal di
fase ini ("percobaan" = pemrosesan lokal, bukan panggilan provider).

- Backoff hidup di satu tempat: fungsi SQL
  `publishing_backoff_minutes(p_attempt_number)` + konstanta yang sama di
  `features/publishing/constants.ts` (diuji Vitest + pgTAP).
- Timeout 2 menit adalah **budget pemrosesan per job di pemanggil**
  (worker lokal) — bukan batas yang ditegakkan database; lease 5 menit
  adalah guard di database bila worker mati di tengah claim.
- Retry **hanya** untuk error transient yang diketahui (`TRANSIENT_ERROR`)
  dan **hanya** sesudah keputusan retry eksplisit (tombol/API) — tidak ada
  blind retry, tidak ada retry otomatis pada outcome non-idempotent yang
  tidak diketahui (A6.4, R6.3). Bila Tuan menetapkan angka lain, ganti di
  satu tempat konfigurasi.

## 6. ASUMSI-6.4 — `provider_job_id` selalu null (DIADOPSI, ditegakkan DB)

Lihat §1: CHECK `provider_job_id is null` (jobs) dan
`provider_post_id is null` (published_posts). Kolom tetap ada untuk
Phase 7.

## 7. ASUMSI-6.5 — URL "Open platform" (DIADOPSI)

Tombol hanya tampil bila URL resmi platform diketahui; bila tidak
diketahui, tombol **tidak tampil** (bukan tampil tetapi mati). Daftar
resmi yang dikunci fase ini:

| Platform | URL resmi |
| -------- | --------- |
| instagram | https://www.instagram.com |
| tiktok | https://www.tiktok.com |
| youtube | https://studio.youtube.com |
| facebook | https://www.facebook.com |
| linkedin | https://www.linkedin.com |
| x | https://x.com |
| threads | https://www.threads.net |
| other | — (tidak ada tombol) |

Tidak ada URL yang ditebak. Bila platform belum ada di daftar, tombol
tidak tampil.

## 8. ASUMSI-6.6 — Zona waktu sumber kebenaran (DIADOPSI)

Bila `content_items.timezone` dan `content_placements.timezone` berbeda,
yang dipakai adalah **`content_placements.timezone`** — karena jadwal
melekat pada placement, bukan pada konten master. Ini sudah diputuskan
sejak Phase 2 (P2-A9: "Penjadwalan placement memakai
`content_placements.timezone`"); ASUMSI-6.6 hanya menegaskan kembali
untuk job publishing. Job menyimpan `timezone` (disalin dari placement
saat dibuat, atau override eksplisit yang divalidasi IANA) dan
`scheduled_at` selalu UTC. Tampilan selalu menyebut zona waktunya
("WIB (Asia/Jakarta)" dst.). Tetap butuh jawaban Tuan bila ingin dikunci
permanen (sebelum Phase 7 memakai timezone untuk panggilan provider).

## 9. Preflight — definisi "approved/current" (diputuskan fase ini)

Preflight (`publishing_preflight`, SQL, dipanggil RPC buat-job dan
proses) memblokir pembuatan job bila salah satu gagal — dengan kode
spesifik, bukan gagal diam-diam:

| Pemeriksaan | Blokir bila | Kode |
| ----------- | ----------- | ---- |
| Keanggotaan + peran | Bukan member aktif / peran tanpa `schedule_publish` | `FORBIDDEN` |
| Brand scope | Brand placement di luar scope pemanggil | `FORBIDDEN` |
| Approval | Versi konten **terbaru** belum punya request approval internal `approved` | `APPROVAL_REQUIRED` |
| Approval basi | Request approved menunjuk versi lama (ada versi konten lebih baru) | `APPROVAL_STALE` |
| Sudah terbit | Placement sudah punya `published_posts` | `ALREADY_PUBLISHED` |
| Zona waktu | `timezone` placement bukan IANA valid | `TIMEZONE_INVALID` |
| Jadwal | `scheduled_at` di masa lalu | `SCHEDULE_PAST` |
| Duplikat | Job aktif untuk placement + waktu yang sama sudah ada | `DUPLICATE_JOB` |

Peringatan (tidak memblokir, tampil di checklist):

| Pemeriksaan | Peringatan |
| ----------- | --------- |
| Koneksi provider | "Belum ada koneksi → manual" (di fase ini SELALU — tidak ada provider) |
| Format media | `platform_format` kosong — format belum diisi, bisa dilengkapi manual |

**Keputusan yang dicatat jujur:** approval yang diperiksa preflight
adalah approval **content version** (target_type `content_item`) —
karena itulah approval yang bisa dihasilkan lewat UI (tab Approval,
Phase 4). Approval target `placement` memang ada di RPC/database 0014,
tetapi TIDAK ADA UI-nya; Phase 6 **tidak** menambah submit approval
per-placement (itu scope Phase 4). Sebagai pengaman "current" untuk
placement itu sendiri, job menyimpan snapshot `placement_version_id`
saat dibuat; bila placement diedit sesudah job dibuat (versi baru),
preflight saat proses menolak dengan `PLACEMENT_CHANGED` → job ke
`needs_manual_action`. Batas ini dicatat di laporan Phase 6 §7.

## 10. Worker lokal — tanpa cron, tanpa antrean eksternal

Tidak ada Inngest/Trigger.dev/cron di repo (dan tidak ada deploy Vercel
tempat cron berjalan — B5 masih terbuka). Karena itu "worker lokal"
Phase 6 adalah pemrosesan server-side yang dipicu secara eksplisit:

1. **Saat halaman Publishing Queue dimuat** (server component memanggil
   RPC proses — idempotent, hanya job yang jatuh tempo + lease kadaluarsa
   yang disentuh), dan
2. **Via `POST /api/v1/publishing/process`** (pemicu manual / calon cron
   Phase 7).

Claim atomik (`claim_publishing_job`, `FOR UPDATE SKIP LOCKED`) +
lease 5 menit mencegah pemrosesan ganda bila dua pemicu berjalan
bersamaan. Ini adalah batas jujur yang dicatat: job yang jatuh tempo
TIDAK diproses sendiri tanpa ada yang membuka Queue atau memanggil
endpoint proses — Phase 7 boleh menggantinya dengan worker/cron
sungguhan tanpa mengubah model job.

## 11. Reminder — bentuk MVP yang jujur

Tidak ada kanal email/push dan tidak ada pengirim notifikasi untuk
publishing di scope ini (tabel `notifications` CHECK-nya tidak diubah —
menambah tipe di luar scope adalah scope creep). "Reminder" Phase 6
adalah **tampilan terhitung di Queue**: seksi "Perlu perhatian"
(job `needs_manual_action` + job yang jatuh tempo ≤ 24 jam + job yang
terlambat). Bukan record reminder yang "dikirim". Bila Tuan meminta
pengingat terkirim (email/push), itu pekerjaan Phase 7+ dengan kanal
yang disepakati.

## 12. `viewer_client` — baca saja, lewat share eksplisit

Klien **tidak melihat antrean publishing** dan **tidak bisa
membuat/membatalkan/mengonfirmasi job** (v2). Pengecualian satu-satunya:
job atas placement yang content item-nya **dibagikan eksplisit** ke
klien itu terlihat (baca saja) — ditegakkan di RLS lewat
`is_placement_shared_with_me`. Mutasi job hanya lewat RPC dengan peran
`schedule_publish` (owner/admin/manager/strategist-limited); penegakan
sesungguhnya di RPC + RLS, `can()` hanya cermin.

## 13. Yang sengaja TIDAK dibangun (bukan dihilangkan diam-diam)

- Adapter provider apa pun, OAuth, polling/webhook provider, analytics
  sync → Phase 7.
- Scraping / shared-password login / automation pelanggar kebijakan
  platform → TIDAK PERNAH (Dok 08 §9).
- Worker/cron otomatis, pengingat email/push → Phase 7+ (lihat §10/§11).
- Submit approval per-placement di UI → scope Phase 4 (lihat §9).
- Hapus job (hard delete) → tidak ada; pembatalan adalah status
  `cancelled` (audit trail utuh).

## 14. Konsekuensi implementasi

- Modul baru `features/publishing/` (constants, types, utils, queries,
  actions, components) + route `/publishing` + API
  `/api/v1/publishing/*` + migrasi `0020_publishing_foundation.sql`
  (3 tabel + 7 RPC + preflight + backoff) + pgTAP
  `06_rls_phase6.sql` + spek e2e `publishing.spec.ts` (A6.1 + A6.2).
- Mengubah placement: RPC buat-job menulis `scheduled_at`/`timezone`/
  `distribution_status` placement (penjadwalan = pembuatan job);
  konfirmasi menulis `published_url` placement; batal menulis
  `cancelled`. Tidak ada penulisan `scheduled_at` oleh visual planner
  (R5.1 tetap berlaku — `set_visual_order` tidak disentuh).
- Mengubah CHECK `content_placements_remote_post_id_null_check` (0007)
  — lihat §1. Tidak ada perubahan pada migrasi 0001–0019.
