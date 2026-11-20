# Laporan Fase 9 — Hardening & Launch, 9.1 s.d. 9.13 (MaTive DRAF)

> **Status laporan ini: DISUSUN KOORDINATOR, BELUM DIDEKLARASIKAN.**
> Koordinator Phase 9 (subagent) mengeksekusi dan melaporkan — deklarasi
> LULUS / GO / NO-GO ada di tangan parent (main agent) dan persetujuan
> go-live ada di tangan owner (Tuan Braderz). Rekomendasi koordinator ada
> di §12. Tanpa persetujuan eksplisit owner, status akhir adalah
> **READY FOR OWNER DEPLOYMENT**, bukan DEPLOYED/LIVE.

## 1. Ringkasan hasil

| Gate (Dok 11, 10 gate)      | Hasil                                                                                             | Bukti                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Migrasi di DB bersih        | Tidak ada migrasi baru di Phase 9 (tidak dibutuhkan)                                              | —                                                                   |
| Lint                        | 0 problem                                                                                         | `npx eslint .`                                                      |
| Typecheck                   | 0 error                                                                                           | `npx tsc --noEmit`                                                  |
| Unit                        | 241/241 lolos (20 file)                                                                           | `npx vitest run`                                                    |
| Integrasi/database (pgTAP)  | v1.3 statis OK (53 asersi, pglast 135 stmt); **live re-run BELUM**                                | `supabase/tests/08_rls_phase8.sql` + verifier                       |
| Browser critical flow (e2e) | Smoke logged-out 26 lolos + 4 skip, 0 gagal (chromium + mobile); **e2e login BELUM di-run ulang** | `e2e/smoke.spec.ts`, `planning.spec.ts`, `production.spec.ts`       |
| Production build            | exit 0 (46 rute)                                                                                  | `npm run build`                                                     |
| Responsive visual review    | 7 layar × 3 viewport, logged-out; 2 defect diperbaiki + terverifikasi ulang                       | `docs/visual-qa/phase9/` (23 PNG)                                   |
| Security/permission         | 8 tes Dok 06 §8: semua lolos (verifikasi §9.4)                                                    | Kode + pgTAP + kebijakan RLS                                        |
| Docs + batas                | CHANGELOG 0.5.0–0.9.0, PRIVACY, TERMS, runbook, laporan ini                                       | `CHANGELOG.md`, `PRIVACY.md`, `TERMS.md`, `docs/RELEASE_RUNBOOK.md` |

**Defect Critical/High yang tersisa: 0.** Satu High ditemukan dan diperbaiki di fase ini (hapus anggota — §4.3). Flake impor CSV dimitigasi, belum terbukti hilang (§4.5).

## 2. 9.1 — Audit akhir (Prompt 11)

Audit dibaca ulang dari repo (bukan dari laporan fase lama). Temuan:

- **Secret — BERSIH.** `.env.local` tidak terlacak; `SUPABASE_SERVICE_ROLE_KEY` hanya di server (`lib/supabase/server.ts`, dipakai hanya `features/tenancy/actions.ts:204` untuk email undangan, di belakang cek owner/admin; token undangan di-hash SHA-256, kedaluwarsa 7 hari). `lib/supabase/client.ts` tidak diimpor oleh apa pun — semua akses data server-side; publishable key + URL proyek bahkan tidak ada di bundle client.
- **RLS — BERSIH menurut hitungan.** 51 tabel, 51 `enable row level security` (tepat 1/tabel), 247 `create policy`, 0 `grant all`, 0 grant ke `anon`.
- **Aset privat — OK.** Bucket `mative-assets` privat; signed URL 1 jam; validasi MIME magic-bytes; maks 10 MB; tanpa pemindaian virus (batas desain, dicatat sejak Phase 3).
- **Approval — OK.** Penolakan versi basi di RPC 0014; keputusan append-only.
- **Publishing idempotency — OK.** Lease-based, max 20 job/run, `idempotency_key`, body Zod.
- **Portal — OK menurut kode.** `/portal` hanya lewat `listMyPortalShares()` (RLS `resource_shares`).
- **Gap yang ditemukan (semua ditangani di fase ini):**
  - (a) Tidak ada error boundary → diperbaiki (§4.4).
  - (b) `/api/health` melaporkan `phase: "1-foundation"` + `version: "0.1.0"` → diperbaiki (§4.4).
  - (c) CHANGELOG berhenti di 0.4.0 → dilengkapi 0.5.0–0.9.0 (§10).
  - (d) Dokumen hilang: PRIVACY, TERMS, RELEASE_RUNBOOK, laporan fase 9 → ditulis (§10, §8).
  - (e) Tidak ada structured logging (0 `console.error`/`console.warn` di `lib/`, `features/`, `app/api/`) → dicatat sebagai batas monitoring (§9).
  - (f) Banyak `.select("*")` tanpa `.limit()` — dibatasi default PostgREST 1000 baris; dapat diterima untuk MVP; tidak ada hotspot terbukti.

## 3. 9.2 — Full test suite

Perintah + hasil (dijalankan lokal, HEAD `55f495f` + dokumen):

- `npx tsc --noEmit` → 0 error.
- `npx eslint .` → 0 problem.
- `npx vitest run` → 20 file, 241/241 lolos.
- `npm run build` → exit 0, 46 rute.
- `npx prettier --check` pada file yang diubah → bersih.
- pgTAP 08 v1.3: verifikasi statis lolos (pglast 135 statement, verifier OK, plan 53 asersi, `tests/migrations.test.ts` 32/32). **Live re-run belum** — butuh tugas browser (parent).
- e2e login lengkap (auth, planning, production, approval, publishing, analytics, ai): **belum di-run ulang** — butuh kredensial (parent). Yang di-run ulang lokal: smoke logged-out (§7).

## 4. 9.3 — Daftar defect + perbaikan (commit per defect)

### 4.1 High — Navigasi mobile: 9 tujuan tidak terjangkau (`425a430`)

`/lainnya` hanya memuat 16 dari 25 tujuan sidebar. Tugas Saya, Pustaka Aset, Template Brief, Template, Analitik, Laporan, Impor Data, Integrasi, Asisten AI hanya bisa dicapai dengan mengetik URL langsung. Perbaikan: tambah kesembilan tautan + perbarui subjudul usang "Phase 2". Terverifikasi: smoke production mobile kini lolos; `href` ganda (sidebar + main) terkonfirmasi di HTML.

### 4.2 Medium — Dialog "Buat cepat" menampilkan aksi yang sudah rilis sebagai disabled (`425a430`)

Dialog Topbar (desktop) menampilkan Buat konten / Tangkap ide / Unggah aset sebagai tombol disabled "belum tersedia (Phase 2/3)" padahal ketiganya sudah rilis sejak Phase 2/3. Dialog mobile (AppShell) tidak punya "Unggah aset". Perbaikan: kedua dialog kini menampilkan 4 aksi tersedia yang sama. Tes smoke terkait ditulis ulang (tes lama mengasersi item disabled Phase 3 — sudah usang).

### 4.3 High — Tidak ada jalur hapus anggota (`55f495f`)

Owner hanya bisa mencabut UNDANGAN (pra-gabung); anggota yang sudah bergabung tidak bisa dicabut aksesnya dari aplikasi — Dok 06 §8 butir 5 tidak terpenuhi di lapisan aplikasi (di DB sudah ada: pgTAP 01 T6 + kebijakan `ws_members_delete_owner`). Perbaikan: `removeMemberAction` (owner-only; role dibaca dari sesi, bukan body; diri sendiri + owner tidak bisa dihapus) + kolom Aksi di Tim & Peran. Gate: build 0, tsc 0, lint 0, Vitest 241/241. **Verifikasi e2e hapus anggota butuh login (parent).**

### 4.4 Medium — Tidak ada error boundary + metadata health basi (`829c955`)

Tidak ada `error.tsx`/`global-error.tsx` di mana pun. Ditambah `app/(app)/error.tsx`, `app/error.tsx`, `app/global-error.tsx`. Terverifikasi di browser nyata (halaman uji yang melempar menampilkan fallback). `/api/health` diperbaiki: `phase: "9-hardening-launch"` + `version` dari `package.json`.

### 4.5 Medium — Flake hang UI impor CSV (mitigasi, `67033c8`)

4× dalam 5 run Phase 7: DB ter-commit, tombol tetap disabled + alert kosong > 30 dtk. Penyebab pasti belum terbukti. Mitigasi: `importAnalyticsCsvAction` kini hanya merevalidasi `/analitik/impor` (sebelumnya 3 path). `/analitik` + `/analitik/laporan` memuat ulang datanya sendiri saat dikunjungi (fetch no-store). **Pembuktian hilang/tidaknya flake butuh re-run e2e login (parent).** Aksi lain yang merevalidasi 2 path (publishing, ai, campaign) tidak diubah — tidak ada flake tercatat di sana.

### 4.6 Medium — Baris tombol aksi dashboard meluber di mobile (`30bb460`)

4 tombol Command Center (flex tanpa wrap) meluber di 390px — "Undang anggota" terpotong di tepi kanan. Perbaikan: `flex-wrap`. Terverifikasi lewat screenshot ulang mobile.

### 4.7 Low — Footer versi basi (`30bb460`)

Sidebar menampilkan "MaTive v0.3.0 — Phase 3 (DRAF)" di semua halaman. Diperbarui ke v0.9.0 Phase 9 (DRAF); `package.json` 0.1.0 → 0.9.0; 0 kemunculan "v0.3.0" tersisa di HTML yang disajikan.

### 4.8 Tes saja — smoke mobile (`f9c5534`, `eba5cc1`)

3 tes sidebar dibuat viewport-aware (mobile: bottom nav + `/lainnya`); locator `/lainnya` memakai regex berjangkar dalam `<main>` (nama aksesibel = label + deskripsi; "Konten" tanpa jangkar mencocok 5 tautan); asersi pencarian topbar mobile diubah jadi `toBeHidden` (`hidden md:block` sesuai desain). Hasil akhir: smoke suite 26 lolos + 4 skip, 0 gagal (chromium + mobile).

## 5. 9.4 — Security review (Dok 06 §8, 8 tes)

| #   | Tes                                                                    | Hasil                      | Bukti                                                                                                                         |
| --- | ---------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | User Workspace A tidak bisa baca konten Workspace B meski menebak UUID | LULUS                      | pgTAP 01 T1, 02 T1b/T1c (DENY)                                                                                                |
| 2   | User tidak bisa mengubah role sendiri lewat body request               | LULUS                      | Tidak ada endpoint ubah role; kebijakan `ws_members_update_owner_admin` (0006) mensyaratkan owner/admin di USING + WITH CHECK |
| 3   | Creator tidak bisa approve tanpa penugasan/izin                        | LULUS                      | pgTAP 04 (peran approver)                                                                                                     |
| 4   | Viewer tidak bisa mutasi komentar/konten/aset/task                     | LULUS                      | pgTAP 02 T3b/T3c/T6b                                                                                                          |
| 5   | Member yang dicabut kehilangan akses seketika                          | LULUS (DB + aplikasi baru) | pgTAP 01 T6; `removeMemberAction` + RLS delete owner-only (§4.3)                                                              |
| 6   | URL file privat tidak bisa dipakai ulang sesudah kedaluwarsa           | LULUS (mekanisme)          | Signed URL 1 jam (Supabase); `ASSET_SIGNED_URL_SECONDS = 3600`                                                                |
| 7   | Event webhook/job duplikat idempotent                                  | LULUS (mekanisme)          | `idempotency_key` (publishing utils + RPC create)                                                                             |
| 8   | Log server + bundle browser tidak mengandung secret                    | LULUS                      | Verifikasi 9.1 (tidak ada service_role/JWT di chunk client)                                                                   |

Ancaman integrasi (Dok 08): publikasi manual saja — tidak ada koneksi platform otomatis yang bisa disalahgunakan; kredensial platform belum ada. Ancaman AI (Dok 09 §5): tidak berlaku selama AI nonaktif — tidak ada data yang dikirim ke model eksternal; verifikasi ulang sebelum aktivasi AI.

## 6. 9.5 — Performance (ambang terukur)

Kit tidak memberi angka — ambang diputuskan dengan default paling aman yang terdokumentasi (ASUMSI-9C): TTFB hangat < 500 ms per rute (localhost); total JS gzip < 600 KB; chunk tunggal gzip < 100 KB.

Terukur (server production lokal, build 9, 20 Nov 2026 ~04:29 WIB):

| Rute           | TTFB hangat                                                                            |
| -------------- | -------------------------------------------------------------------------------------- |
| `/`            | ~10 ms (cold 79 ms)                                                                    |
| `/dashboard`   | 66–97 ms (cold 411 ms; run sebelumnya 16–33 ms — variasi antar run, keduanya < ambang) |
| `/kalender`    | ~25 ms                                                                                 |
| `/board`       | ~21 ms                                                                                 |
| `/persetujuan` | ~19–24 ms                                                                              |
| `/api/health`  | 200 (cold 0,126 s)                                                                     |

Bundle: total JS gzip ≈ 500 KB (512.479 byte); `.next/static` 2,0 MB; chunk tunggal terbesar 72 KB gzip (73.311 byte). **Semua di bawah ambang.**

## 7. 9.6 — Accessibility (review statis)

Tidak ada temuan High. Diperiksa: semua `<img>` punya `alt` (2/2 di AssetCard); semua tombol punya nama aksesibel (teks/aria-label); semua input punya label (termasuk label sr-only); focus-visible ada di Button; Dialog punya role + aria-label; alert/status memakai role benar. **Batas:** review statis saja — belum ada run axe otomatis.

## 8. 9.7 — Visual QA (7 layar × 3 viewport)

Capture logged-out di `docs/visual-qa/phase9/` — 21 PNG (p9-01..07 × desktop 1440×1000 / tablet 1024×900 / mobile 390×844) + 2 after-fix dashboard. Ditinjau visual: 8 capture (desktop 01–04, mobile 05–07, tablet 01).

Temuan & perbaikan: hanya 2 (baris tombol dashboard mobile §4.6; footer versi §4.7) — keduanya diperbaiki dan terverifikasi ulang (before/after di folder yang sama).

**Batas jujur:** saat logged-out, kalender/board/editor/persetujuan hanya menampilkan login gate (perilaku benar) — UI kerja sesungguhnya (grid kalender, kanban, editor bertab, antrean approval berisi data) **belum** terverifikasi visual di fase ini; butuh capture dengan kredensial login (parent).

Perbedaan vs referensi yang disengaja (bukan defect): label sidebar berbahasa Indonesia (referensi berbahasa Inggris); data referensi "Cedar Studio" adalah mock — aplikasi menampilkan empty state jujur ("Belum ada data — angka dihitung dari record nyata").

## 9. 9.8 — Backup/restore + rollback

Prosedur ditulis lengkap di `docs/RELEASE_RUNBOOK.md` (§3 backup, §4 rollback, §5 restore): backup harian Supabase Free + `pg_dump` manual sebelum migrasi berisiko; rollback kode = redeploy build terakhir yang lolos gate; rollback skema = migrasi kompensasi (tidak ada down-migration); restore diuji dulu di staging, baru ke live.

**Status: prosedur BELUM DIUJI** — tidak ada DB staging / kredensial DATABASE_URL di lingkungan ini. Pengujian wajib sebelum go-live publik (langkah di runbook §5).

## 10. 9.9 — Monitoring/alerting

Keadaan saat ini (dicatat jujur): `/api/health` (status/phase/version/supabaseConfigured) + jejak audit `activity_logs`. **Belum ada:** structured logging, alerting otomatis, dashboard uptime. Tidak ada layanan berbayar yang dipakai tanpa persetujuan owner (ASUMSI-9B). Rekomendasi: cukup untuk staging; sebelum go-live publik, pertimbangkan pencatatan log terstruktur minimal (tanpa layanan berbayar) + pengecekan health berkala.

## 11. 9.10 — Dokumen peluncuran

- `CHANGELOG.md` dilengkapi 0.5.0–0.9.0 (Phase 5–9).
- `PRIVACY.md` (baru): data yang dikumpulkan, AI nonaktif, pihak ketiga (hanya Supabase), keamanan, hak pengguna — termasuk kejujuran bahwa penghapusan akun mandiri **belum tersedia**.
- `TERMS.md` (baru): kepemilikan konten, approval append-only, publikasi manual, AI draf, "sebagaimana adanya", hukum Indonesia.
- `.env.example` sudah lengkap (6 variabel, sesuai `lib/env.ts`) — tidak diubah.
- Keluaran AI adalah draf sampai disetujui manusia (ditegaskan di PRIVACY + TERMS + CHANGELOG 0.8.0).

## 12. 9.11 — Smoke staging/preview + 9.12 GO/NO-GO

**9.11: tidak ada deploy staging yang bisa di-smoke.** Repo GitHub (B5) belum ada → tidak ada CI, tidak ada preview Vercel. Smoke yang dijalankan adalah terhadap server production lokal (build 9): health 200 + smoke suite 26 lolos + 4 skip.

**Rekomendasi koordinator: GO untuk staging/preview — NO-GO untuk go-live publik (belum).**

Alasan GO staging: semua gate lokal hijau; 0 Critical/High tersisa; keamanan 8/8; performa di bawah ambang; visual QA logged-out bersih sesudah perbaikan; dokumen peluncuran lengkap.

Alasan NO-GO publik (belum): (1) pgTAP 08 v1.3 belum di-run live; (2) e2e login belum di-run ulang (termasuk pembuktian flake impor CSV + hapus anggota); (3) backup/restore belum diuji; (4) repo GitHub (B5) belum ada sehingga tidak ada jalur deploy; (5) visual QA layar kerja login belum ada; (6) persetujuan go-live eksplisit owner belum ada.

Bila butir 1–2 hijau dan butir 3 diuji, status dapat naik menjadi GO untuk go-live — keputusan akhir tetap di tangan owner.

## 13. Batas jujur — yang BELUM terbukti (wajib dibaca parent)

1. pgTAP 08 v1.3 (53 asersi, termasuk T3f RETURNING) — statis OK, live BELUM.
2. e2e login lengkap — BELUM di-run ulang di Phase 9 (terakhir hijau di Phase 8).
3. Flake hang UI impor CSV — dimitigasi, belum terbukti hilang.
4. Hapus anggota — aksi + UI baru, belum diuji e2e login.
5. Visual QA layar kerja (login) — hanya login gate yang terlihat.
6. Backup/restore/rollback — prosedur tertulis, belum diuji.
7. Monitoring — minimal (health + audit trail); tanpa alerting.
8. Aset tanpa pemindaian virus (batas desain sejak Phase 3).
9. WebKit Playwright tetap BLOCKED (B4, sejak fase awal).
10. GitHub repo (B5) belum ada — memblokir CI, preview Vercel, dan deploy apa pun.

## 14. Instruksi untuk parent (yang dibutuhkan dari parent)

1. **pgTAP 08 v1.3 live re-run** (tugas browser): tempel `supabase/tests/08_rls_phase8.sql` utuh di SQL Editor, Run sekali, harapkan 53/53 (termasuk T3f).
2. **e2e login re-run**: auth, planning, production, approval, publishing, analytics (fokus: impor CSV — buktikan flake hilang/tidak), ai, + hapus anggota (owner menghapus anggota → anggota kehilangan akses).
3. **Visual QA login**: capture 7 layar berisi data (kalender/board/editor/persetujuan).
4. **Backup/restore test**: buat staging, backup → restore → verifikasi (runbook §5).
5. **B5**: buat repo GitHub `mative` (butuh tindakan owner) → push → Vercel preview → smoke 9.11.
6. **Keputusan owner**: go-live — hanya sesudah 1–5 hijau + persetujuan eksplisit.

## 15. Jejak commit Phase 9

| Commit       | Isi                                                          |
| ------------ | ------------------------------------------------------------ |
| `2bf5228`    | pgTAP 08 v1.3 — T3f INSERT ... RETURNING (53 asersi)         |
| `f9c5534`    | 3 tes sidebar smoke jadi viewport-aware                      |
| `425a430`    | /lainnya lengkapi 9 tautan; dialog Buat cepat samakan 4 aksi |
| `eba5cc1`    | Smoke mobile — locator /lainnya + dialog + /cari             |
| `67033c8`    | Mitigasi flake impor CSV (revalidasi 1 path)                 |
| `30bb460`    | Tombol aksi dashboard wrap; footer v0.9.0                    |
| `771898a`    | Capture Visual QA Phase 9 (23 PNG)                           |
| `829c955`    | Error boundary + metadata /api/health                        |
| `55f495f`    | Hapus anggota workspace (owner-only)                         |
| (berikutnya) | Dokumen peluncuran + laporan ini                             |
