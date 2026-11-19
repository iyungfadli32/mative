# ADR-0013 — First Official Integration + Analytics Phase 7 (Adapter DISABLED, Manual-Only Berlanjut)

- **Status:** Diterima (menuangkan Keputusan #3 + ASUMSI-7B s.d. 7F sebagai default yang diputuskan sendiri — tanpa bertanya lagi)
- **Tanggal:** 2026-11-20
- **Konteks:** Rencana kanonis v2 (`Rencana-MaTive-Lengkap-v2.md`, Phase 7) +
  rencana detail Phase 7 §7.1–§7.14 + Dok 08 §4/§7/§9, Dok 10 §1–§7,
  Dok 11 §6, Dok 12 Phase 7. Keputusan #3 (dikunci Tuan 2026-11-19
  01:52 WIB) sudah menyelesaikan integrasi pertama: **manual-only di
  MVP, adapter DISABLED**. ADR ini menuangkan keputusan itu ke
  implementasi Phase 7 + mengunci default ASUMSI-7.x agar Phase 7 bisa
  dibangun tanpa bertanya lagi.

## 0. Keputusan integrasi pertama (langkah 7.1–7.3) — BELUM TERPENUHI

- **Platform pertama BELUM dipilih Tuan** (langkah 7.1) dan **tidak ada
  akses apa pun** — tidak ada developer app, OAuth, scope, maupun akun
  test resmi (langkah 7.3). Karena itu langkah 7.2 (verifikasi
  dokumentasi resmi platform), 7.5 (adapter end-to-end), 7.6 (sambung
  adapter ke job lifecycle), dan 7.7 (uji e2e akun test) **TIDAK
  dikerjakan di fase ini** — bukan ditunda diam-diam, melainkan
  dinyatakan sebagai blocker yang didokumentasikan (§1).
- Yang dibangun di fase ini adalah yang **tidak terblokir**: capability
  registry + layar setup yang jujur (7.4), analytics ingestion dari
  record nyata + impor manual/CSV berlabel (7.8, 7.11), definisi 14
  kunci metrik (7.9), dashboard + 5 laporan awal (7.10), dan uji
  keamanan/isolasi tenant (7.12). Visual QA layar yang berubah (7.13)
  dicatat sebagai batas jujur — tidak ada screenshot browser di fase
  ini (lihat laporan Phase 7 §7).

## 1. Adapter DISABLED — blocker yang didokumentasikan

- Tidak ada satu pun fungsi adapter provider (`connectAccount`,
  `refreshCredentials`, `getAccountProfile`, `getCapabilities`,
  `validatePlacement`, `prepareMedia`, `uploadOrCreatePost`,
  `getPublishStatus`, `fetchPostMetadata`, `fetchAnalytics`,
  `disconnectAccount`) di fase ini — bukan sebagai implementasi palsu,
  bukan sebagai stub diam-diam (Dok 08 §4, ASUMSI-7B).
- Layar `/integrasi` menampilkan status **DISABLED untuk setiap
  platform** beserta alasan blocker yang persis:
  1. platform pertama belum dipilih Tuan (langkah 7.1);
  2. tidak ada akses developer app / OAuth / akun test (langkah 7.3);
  3. tidak ada platform yang diklaim "didukung" sampai uji akun test
     lolos (ASUMSI-7F).
- `social_channels.connection_status` diperluas dari
  `('not_connected', 'manual')` menjadi `('not_connected', 'manual',
  'disabled')` — nilai `'disabled'` berarti "adapter fase ini
  dinonaktifkan karena blocker di atas", bukan "pernah terhubung lalu
  putus". `capability_snapshot` channel diisi snapshot blocker yang
  terdokumentasi (`status: 'disabled'`, `blocker`, `checked_at`,
  `source: 'manual-only'`).
- Satu-satunya jalan menuju `Published` tetap **konfirmasi manual
  eksplisit** Phase 6 (ADR-0012 §1). Tidak ada tombol/klaim publishing
  palsu; status `Scheduled locally` tidak pernah tampil sebagai
  "Published".

## 2. Capability registry — `social_channels` + snapshot

- Registry = tabel `social_channels` yang sudah ada (0007, metadata
  saja) + `capability_snapshot` jsonb + `capability_checked_at`
  (kolom baru 0021, nullable — kapan snapshot terakhir diperiksa).
- Bentuk snapshot blocker (didokumentasikan di
  `features/integrations/constants.ts`, satu tempat):
  `{"status": "disabled", "adapter": "disabled", "blocker": "platform
  belum dipilih + akses belum tersedia (langkah 7.1/7.3)", "checked_at":
  "<ISO>", "source": "manual-only", "docs_checked": null}`.
  `docs_checked` tetap null — tidak ada dokumentasi resmi platform yang
  diperiksa di fase ini (langkah 7.2 tidak dikerjakan), dan mengisinya
  dengan tautan Dok 13 tanpa pemeriksaan ulang adalah klaim palsu.
- TTL snapshot **24 jam** (ASUMSI-7D): snapshot yang `checked_at`-nya
  lebih dari 24 jam lalu dianggap kedaluwarsa — fungsi SQL
  `analytics_snapshot_is_stale` dan penanda di UI. Snapshot kedaluwarsa
  tidak memblokir apa pun di fase ini (tidak ada panggilan provider),
  tetapi wajib di-refresh sebelum publish bila adapter kelak ada
  (R7.7).
- `channel_credentials` dibuat di 0021 sebagai tabel **server-only**:
  RLS aktif TANPA policy apa pun (tolak semua untuk `authenticated`) +
  `revoke all` tanpa grant. Kolomnya hanya menyimpan
  `secret_reference` (referensi ke secret manager, BUKAN secret).
  Tabel ini kosong di seluruh fase — tidak ada token yang disimpan
  sebelum OAuth resmi berhasil.

## 3. 14 kunci metrik — didefinisikan untuk sumber `manual` (7.9)

Katalog Dok 10 §3 hanya berisi "definition requirement", bukan definisi.
Fase ini menetapkan definisi untuk **sumber `manual`** (angka dari impor
CSV/manual berlabel) — bukan untuk platform mana pun. Definisi hidup di
dua tempat yang sama isinya: tabel `metric_definitions` (seed 0021, 14
baris, `source_platform = 'manual'`, `workspace_id IS NULL` = katalog
global) + `features/analytics/metrics.ts` (kanonis di kode, diuji
Vitest). Bila keduanya berbeda, itu bug.

| Kunci | Satuan | Definisi (sumber manual) |
| ----- | ------ | ------------------------ |
| `reach` | akun | Akun unik yang dijangkau (angka dari sumber impor); tidak sama dengan impressions. |
| `impressions` | tayangan | Total tayangan yang ditampilkan (angka dari sumber impor); tidak sama dengan reach. |
| `views` | tayangan | Tayangan menurut arti penyedia pada sumber impor; arti persis dicatat di notes impor. |
| `video_views` | tayangan | Tayangan video menurut ambang/definisi penyedia pada sumber impor; bila ambang tidak diketahui, kunci ini tidak ditampilkan. |
| `engagements` | interaksi | Jumlah interaksi yang didukung = likes + comments + shares + saves; hanya komponen yang tersedia yang dijumlahkan. |
| `likes` / `comments` / `shares` / `saves` | interaksi | Masing-masing komponen, terpisah. |
| `clicks` | klik | Klik (tautan/profil/CTA); jenis klik dicatat di notes impor; tanpa jenis klik, nilai tidak dibandingkan antar sumber. |
| `followers_net_change` | akun | Selisih pengikut selama periode (akhir − awal), bukan total pengikut. |
| `conversions` | konversi | Hanya bila ada sumber attribution/event; window/model attribution dicatat di notes impor. Tanpa sumber attribution, kunci ini tidak ditampilkan. |
| `engagement_rate` | persen | `engagements / reach × 100`; hanya bila reach > 0 dan kedua komponen dari periode + sumber yang sama. **DIHITUNG, bukan diimpor.** |
| `publishing_adherence` | persen | `published sesuai jadwal / planned eligible content × 100`; toleransi ±15 menit dari `scheduled_at`; dihitung dari `publishing_jobs` + `published_posts` nyata. **DIHITUNG, bukan diimpor.** |

- **ASUMSI-7C:** metrik yang belum terdefinisi tidak ditampilkan.
  Konsekuensi di fase ini: `video_views` dan `conversions` tidak
  ditampilkan bila notes impornya tidak menyebut ambang/sumber
  attribution — dashboard menampilkannya sebagai "belum terdefinisi
  untuk sumber ini", bukan angka.
- Metrik antar platform **tidak pernah** dicampur dalam satu chart/angka
  (R7.6) — di fase ini hanya ada satu sumber (`manual`), jadi aturan ini
  ditegakkan dengan tidak menampilkan agregat lintas sumber.
- Agregasi menghindari double-counting: satu content item yang tayang di
  banyak channel dihitung per subject (placement/content item), dan
  impor ulang slice yang sama **menimpa** nilai lama — agregasi memakai
  snapshot terbaru per (subject, metrik, periode, sumber). Duplikat
  dalam satu file impor ditolak (ASUMSI-7E + §5).

## 4. Analytics ingestion — hanya dari record nyata (7.8)

- Tabel 0021: `analytics_snapshots` (satu baris = satu impor/batch:
  sumber, periode, `retrieved_at`, `raw_payload_reference` = referensi
  file impor, pengimpor), `content_metrics` (nilai ternormalisasi +
  subject + snapshot + periode + sumber + notes), `campaign_metrics`
  (agregat dari content terkait + definisi + periode + aturan agregasi).
- **Tidak ada satu pun angka demo.** Dashboard tanpa snapshot
  menampilkan "not connected" (bukan angka 0 dan bukan angka mockup
  seperti Reach 482,3K di gambar konsep — angka-angka itu adalah angka
  demo, Dok 10 §1). Dashboard dengan data sebagian menampilkan
  "partial data" + sumber + waktu pembaruan terakhir.
- Payload mentah (file CSV) dipisah dari metrik ternormalisasi: file
  disimpan sebagai referensi (`raw_payload_reference`), bukan isinya
  di-copy ke kolom metrik. Kolom `source_notes` per baris mencatat arti
  penyedia (ambang video views, jenis klik, window attribution).
- `integration_events` mencatat kejadian integrasi (append-only, pola
  `activity_logs` 0004: SELECT member, INSERT hanya bila
  `actor_user_id = auth.uid()` + member, tanpa update/delete):
  `adapter_disabled`, `capability_checked`, `snapshot_refreshed`,
  `snapshot_expired`, `import_completed`, `import_failed`,
  `connection_requested`.

## 5. Impor manual/CSV — template ASUMSI-7E (7.11)

- Kolom kanonis (satu tempat: `features/analytics/csv.ts` +
  `ANALYTICS_CSV_COLUMNS`): `date, platform, account, subject_type,
  subject_ref, metric_key, value, unit, source_notes`.
  - `date` = tanggal metrik (YYYY-MM-DD), wajib dalam periode impor.
  - `platform` = nama platform sumber angka (mis. `instagram`) — ini
    label sumber, BUKAN klaim integrasi.
  - `account` = nama akun sumber angka.
  - `subject_type` = `placement` | `content_item` | `published_post`;
    `subject_ref` = UUID subject itu di workspace ini.
  - `metric_key` = satu dari 14 kunci; `engagement_rate` dan
    `publishing_adherence` **ditolak** (dihitung, §3).
  - `value` = angka ≥ 0; `unit` wajib SAMA dengan satuan kanonis kunci
    itu (validasi unit); `source_notes` = arti penyedia (boleh kosong,
    wajib untuk `video_views`/`conversions`).
- **Impor bersifat atomik:** satu baris tidak valid → seluruh impor
  gagal, tidak ada baris yang tersimpan; RPC mengembalikan kode galat +
  nomor baris pertama yang gagal. Validasi: header lengkap, kolom,
  unit, rentang tanggal, duplikat dalam file, dan mapping subject →
  UUID yang ada di workspace + dalam brand scope pengimpor.
- Penulisan HANYA lewat RPC `import_analytics_snapshot` (transaksi
  tunggal: snapshot + metrik + agregat campaign + event) — pola
  publishing 0020. RLS keempat tabel analytics: baca member + brand
  scope; tulis `false` (kecuali `integration_events` INSERT pola
  activity_logs).

## 6. ASUMSI-7B s.d. 7F — diadopsi

- **7B — adapter default DISABLED.** Tidak ada token yang disimpan dan
  tidak ada panggilan provider sebelum OAuth resmi berhasil (§1).
- **7C — metrik yang belum terdefinisi tidak ditampilkan** (§3).
- **7D — angka operasional** (proposal, Tuan dapat mengubah tanpa
  mengubah arsitektur): retry hanya error transient, **maks 3 kali**,
  backoff eksponensial **mulai 60 detik** (60 → 300 → 900 detik, fungsi
  SQL `integration_backoff_seconds` + konstanta TS yang sama);
  **lease/lock worker 5 menit**; **TTL capability snapshot 24 jam**;
  **timeout provider call 30 detik**. Di fase ini angka-angka itu hanya
  hidup sebagai konstanta + fungsi SQL — tidak ada worker/cron yang
  memakainya (batas jujur Phase 6 §7.3 tetap berlaku).
- **7E — template CSV impor** (§5).
- **7F — tidak ada platform yang diklaim "didukung".** Sampai langkah
  7.7 lolos dengan akun test resmi, status integrasi setiap platform
  adalah "belum terverifikasi" — termasuk TikTok, YouTube, dan
  Instagram yang tautan docs-nya ada di Dok 13.

## 7. Dashboard + 5 laporan (7.10, Dok 10 §5/§7)

- `/analitik`: rentang tanggal default eksplisit dan terlihat (30 hari
  terakhir); tampilkan waktu pembaruan terakhir + sumber; bila data
  tidak lengkap tampilkan "partial data" / "not connected"; periode
  pembanding HANYA bila window sebanding tersedia — di fase ini TIDAK
  ada periode pembanding (satu periode saja, didokumentasikan); chart
  berupa tabel berlabel + ringkasan teks aksesibel + batang CSS
  sederhana (tanpa library chart baru — Recharts tidak terinstal di
  repo); agregasi hindari double-counting (§3).
- 5 laporan awal di `/analitik/laporan` (CSV export dulu, PDF menyusul
  setelah definisi/layout stabil): (1) workspace overview, (2)
  brand/channel breakdown, (3) campaign report, (4) content-level
  performance, (5) publishing volume + schedule adherence.
- Izin: `view_analytics` (matriks Dok 06 §3 sudah ada — owner/admin/
  manager/strategist/analyst penuh; creator/editor/approver "limited";
  `viewer_client` "shared"); impor memakai capability baru
  `import_analytics` (owner/admin/manager/strategist/analyst penuh,
  creator/editor/approver/viewer_client tidak) — ditambahkan ke
  `lib/permissions.ts` di fase ini; `export_data` untuk unduh CSV
  (owner/admin/manager/analyst penuh, strategist "limited").

## 8. `viewer_client` — tidak melihat analytics (v2)

- Klien **tidak melihat analytics** kecuali dibagikan eksplisit — dan
  berbagi analytics **TIDAK dibangun di fase ini** (tidak ada tipe
  share analytics di `resource_shares`, tidak ada UI portal analytics).
  Konsekuensi: policy RLS keempat tabel analytics hanya mencantumkan 8
  peran non-klien (tanpa cabang shared seperti publishing 0020), dan
  halaman `/analitik*` menolak peran `viewer_client` di lapis aplikasi
  (`can(role, 'view_analytics')` = false untuk "shared").
- Angka performa tidak pernah tampil ke klien tanpa sumber yang jelas —
  di fase ini angka itu tidak tampil sama sekali ke klien.

## 9. Yang sengaja TIDAK dibangun (bukan dihilangkan diam-diam)

- Adapter platform apa pun, OAuth, token, polling/webhook provider,
  analytics sync otomatis → menunggu langkah 7.1–7.3 (Tuan).
- Integrasi platform ke-2 dan seterusnya, inbox/comment sync, export
  PDF, billing/plan limits/usage metering, white-label → backlog
  (rencana detail §7.3).
- Periode pembanding di dashboard → belum ada window sebanding yang
  terjamin; satu periode saja di fase ini.
- Scraping / shared-password login / automation pelanggar kebijakan
  platform → TIDAK PERNAH (Dok 08 §9).
- Worker/cron otomatis untuk ingestion → Phase 7+ (batas jujur §7.3
  tetap berlaku; impor dipicu eksplisit oleh pengguna).

## 10. Konsekuensi implementasi

- Modul baru `features/analytics/` (constants, types, metrics, csv,
  queries, actions, components) + `features/integrations/` (constants,
  queries, components) + route `/analitik`, `/analitik/laporan`,
  `/analitik/impor`, `/integrasi` + migrasi `0021_analytics_foundation.sql`
  (6 tabel + 3 fungsi + 1 RPC impor + seed 14 definisi) + pgTAP
  `07_rls_phase7.sql` + spek e2e `analytics.spec.ts` (A7.1–A7.5).
- Mengubah CHECK `social_channels_connection_status_check` (0007) —
  tambah `'disabled'`; tambah kolom `capability_checked_at`. Tidak ada
  perubahan pada migrasi 0001–0020.
- Menambah capability `import_analytics` ke `lib/permissions.ts`
  (matriks Dok 06 §3).
