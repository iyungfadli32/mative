# Laporan Fase 1 — Foundation & Design System (MaTive v0.1.0 DRAF)

- **Rencana:** PLAN-MATIVE-001, Rencana-MaTive-Lengkap-v2 (kanonis).
- **Tanggal pengerjaan:** 2026-11-19 (02:07–02:50 WIB).
- **Pelaksana:** coding agent Phase 1 (untuk Braderz Plan Management).
- **Status fase:** **HAMPIR SELESAI** — kode + migrasi + tes tertulis dan
  gate yang bisa jalan TANPA database live semuanya LOLOS; migrasi
  0001–0006 sudah diterapkan ke DB live dan pgTAP **14/14 LOLOS**
  (04:47 WIB). Tersisa: (a) seed belum diterapkan ke live (menunggu
  langkah browser koordinator/parent — file sudah siap + idempotent);
  (b) browser test critical flow (gate 6) SEBAGIAN: smoke 7/7 lolos di
  server produksi yang terhubung ke live, tetapi alur masuk → buat
  org/workspace belum bisa dibuktikan karena proyek mewajibkan
  konfirmasi email (`mailer_autoconfirm: False`) dan kata sandi 2 akun
  uji yang ada tidak tercatat — butuh akun uji terkonfirmasi baru dari
  parent (lihat §5). (c) repo GitHub + deploy preview masih menunggu
  instalasi App oleh Tuan. Fase 2 TIDAK BOLEH dimulai sebelum gate
  1/5/6/9 dicatat LOLOS — gate 1 dan 5 sudah LOLOS (lihat §3).

## 1. Ringkasan hasil

| Langkah                                  | Status                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01 Repo GitHub `iyungfadli32/mative`  | ⚠️ BLOCKED — GitHub App belum terinstal (403, 2×). Repo lokal siap (2 commit) di `~/workspace/mative/app`                                                 |
| P1-02 Verifikasi stack + kunci versi     | ✅ SELESAI — ADR-0001                                                                                                                                     |
| P1-03 Toolchain + CI                     | ✅ SELESAI — lint/typecheck/test/build + secret scan + smoke di CI                                                                                        |
| P1-04 Design tokens (13 token)           | ✅ SELESAI — CSS variables, ADR-0003                                                                                                                      |
| P1-05 Komponen primitif (11)             | ✅ SELESAI                                                                                                                                                |
| P1-06 App shell responsif                | ✅ SELESAI — screenshot 3 viewport                                                                                                                        |
| P1-07 Auth + profil                      | ✅ KODE SELESAI — bukti end-to-end menunggu migrasi + akun uji                                                                                            |
| P1-08 Org + workspace + undangan         | ✅ KODE SELESAI — bukti end-to-end menunggu migrasi + akun uji                                                                                            |
| P1-09 RBAC 9 role                        | ✅ SELESAI (matriks + unit test) — penegakan DB menunggu migrasi                                                                                          |
| P1-10 Migrasi + RLS                      | ✅ SELESAI — 0001–0005 diterapkan 03:35 WIB; 0006 (perbaikan rekursi RLS) diterapkan 04:05 WIB; 9 tabel + 5 helper SECURITY DEFINER terverifikasi di live |
| P1-11 RLS policy tests (pgTAP, 14 tes)   | ✅ LOLOS 14/14 — 04:47 WIB (v2.2; riwayat: 0/14 karena rekursi 42P17 → 11/14 karena cacat file tes → 14/14 setelah v2.2)                                  |
| P1-12 Seed demo sample                   | ✅ SELESAI (file) — idempotent (semua INSERT `ON CONFLICT DO NOTHING`); BELUM diterapkan ke live (menunggu langkah browser parent)                        |
| P1-13 Dashboard shell (KPI record nyata) | ✅ SELESAI — 0/empty state, tanpa angka karangan; smoke dashboard lolos di server produksi                                                                |
| P1-14 Dokumen                            | ✅ SELESAI — README, .env.example, 6 ADR, CHANGELOG, laporan ini                                                                                          |
| P1-15 Quality gate Dok 11                | ⏳ 9/10 LOLOS (lihat §3); gate 6 SEBAGIAN + seed (gate 9) menunggu langkah parent                                                                         |
| P1-16 Client portal dasar                | ✅ KODE SELESAI — uji allow/deny LOLOS di pgTAP (T4/T5, T5b)                                                                                              |

### Milestone M1

| Milestone                                                  | Status                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1.1 Sign up/in/out + profil di browser                    | ⏳ SEBAGIAN — smoke halaman masuk/daftar lolos; sign-in akun baru TERBUKTI diblokir konfirmasi email proyek (`mailer_autoconfirm: False`, diverifikasi via `/auth/v1/settings`); butuh akun uji terkonfirmasi (lihat §5) |
| M1.2 Buat org/workspace, beralih workspace, undang anggota | ⏳ Menunggu M1.1 (butuh sesi masuk)                                                                                                                                                                                      |
| M1.3 Uji RLS (cross-tenant UUID guessing)                  | ✅ LOLOS — pgTAP 14/14 (04:47 WIB)                                                                                                                                                                                       |
| M1.4 App shell 1440/1024/390                               | ✅ LOLOS — 9 screenshot di `docs/visual-qa/`                                                                                                                                                                             |
| M1.5 CI hijau                                              | ✅ LOLOS lokal (lint/typecheck/test/build); CI GitHub belum bisa jalan (repo belum ada)                                                                                                                                  |
| M1.6 Dokumen lengkap                                       | ✅ LOLOS                                                                                                                                                                                                                 |
| M1.7 Portal klien (M1.7 baru, v2)                          | ✅ LOLOS — uji allow/deny pgTAP (T4/T5/T5b) lolos; smoke portal lolos                                                                                                                                                    |

## 2. Supabase live — verifikasi konektivitas (anon/publishable key)

- Proyek "mative", ref `kwyqtlxglhlvtghfrnhr`, Free, ap-southeast-1, Healthy.
- `GET /auth/v1/health` + header apikey → **HTTP 200**, GoTrue v2.198.0.
- `GET /rest/v1/profiles` (anon JWT dan publishable key) → **HTTP 404
  PGRST205 "Could not find the table 'public.profiles'"** — membuktikan
  koneksi + kunci diterima; tabel belum ada karena migrasi belum diterapkan.
- `.env.local` berisi HANYA nilai publik, di-`.gitignore`, dan TIDAK ikut
  commit (terverifikasi `git check-ignore`). `.env.example` hanya nama +
  penjelasan, tanpa nilai. Secret scan repo: BERSIH (lihat §3 gate 9).

## 3. Quality gate Dok 11 — perintah + output aktual

| #   | Gate                           | Perintah                                                     | Hasil                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Migrasi di DB bersih           | `supabase db push` / psql (lihat `docs/apply-migrations.md`) | ✅ **LOLOS** — 0001–0005 diterapkan via SQL editor 03:35 WIB (9 tabel terverifikasi); 0006 diterapkan 04:05 WIB ("Success. No rows returned"; 5 helper SECURITY DEFINER + 25 policy tulis ulang terverifikasi di `pg_policies`)                                                                                                                                                                                                                                                                                              |
| 2   | Lint lolos                     | `npm run lint`                                               | ✅ **LOLOS** — 0 error, 0 warning (dijalankan ulang 04:50 WIB)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3   | Typecheck lolos                | `npm run typecheck` (`tsc --noEmit`)                         | ✅ **LOLOS** — 0 error (dijalankan ulang 04:50 WIB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4   | Unit test lolos                | `npm test` (Vitest)                                          | ✅ **LOLOS** — 6 file, **35/35 tes lolos** (dijalankan ulang 04:50 WIB; sempat 33/35 karena 2 tes `migrations.test.ts` masih mengasumsikan 5 migrasi — diperbaiki: ekspektasi 6 migrasi + RLS hanya untuk migrasi pembuat tabel)                                                                                                                                                                                                                                                                                             |
| 5   | Integration/database test      | pgTAP `supabase/tests/01_rls_phase1.sql`                     | ✅ **LOLOS — 14/14** (04:47 WIB, file v2.2; SQL editor; UUID uji A/B nyata; rollback bersih, 0 sisa)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | Browser test critical flow     | `npx playwright test e2e/auth.spec.ts`                       | ⏳ **SEBAGIAN** — smoke 7/7 LOLOS di production server yang terhubung ke live (04:50 WIB); `auth.spec.ts` auto-skip tanpa `E2E_TEST_EMAIL/PASSWORD`. Percobaan daftar akun baru via UI (Playwright, 04:52 WIB) GAGAL masuk karena proyek mewajibkan konfirmasi email (`mailer_autoconfirm: False` — diverifikasi via `GET /auth/v1/settings`); domain `@example.com` juga ditolak Auth ("Email address is invalid", tanpa MX). BUTUH akun uji terkonfirmasi dari parent (lihat §5) — kode auth sendiri tidak terbukti cacat. |
| 6a  | Browser smoke (halaman publik) | `npx playwright test e2e/smoke.spec.ts --project=chromium`   | ✅ **LOLOS** — **7/7** (production server, 04:50 WIB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 7   | Production build               | `npm run build`                                              | ✅ **LOLOS** — 13/13 halaman (dijalankan ulang 04:50 WIB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 8   | Responsive visual review       | `npx playwright test e2e/visual.spec.ts --project=chromium`  | ✅ **LOLOS** — **9/9**, 9 screenshot di `docs/visual-qa/` (landing/dashboard/portal × 1440/1024/390). Temuan: Low — nama workspace mobile terpotong ("Belum ada wor…"); sidebar tablet tampil penuh (collapse manual tersedia, auto-collapse belum). Bukan defect High/Critical.                                                                                                                                                                                                                                             |
| 9   | Security/permission test       | pgTAP 14 tes + secret scan repo                              | ✅ **pgTAP 14/14 LOLOS**; ✅ **secret scan BERSIH** (grep pola kunci asli di semua file repo kecuali `tests/`, `node_modules/`, `.next/`, `.env.local`)                                                                                                                                                                                                                                                                                                                                                                      |
| 10  | Docs + known limitations       | README, `.env.example`, ADR, CHANGELOG, laporan ini          | ✅ **LOLOS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Perintah format: `npm run format` → **LOLOS** (semua file sesuai Prettier setelah `format:write`).

## 4. Defect yang ditemukan + diperbaiki (semua sudah habis)

| #   | Defect                                                                                                                                   | Severity | Perbaikan                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Dashboard HTTP 500: "Event handlers cannot be passed to Client Component props" — `EmptyState` menerima `onAction` dari Server Component | **High** | `Button` diberi `"use client"`; `onAction` dihapus dari dashboard (tautan "Ke halaman masuk" sudah ada di bawahnya). Terverifikasi: dashboard HTTP 200 + smoke 7/7 |
| D2  | `useActionState` menolak server action ber-signature `(formData)`                                                                        | High     | Semua form action diubah ke signature `(prevState, formData)` (React 19). Typecheck 0 error                                                                        |
| D3  | `profile` menyempit ke `never` (supabase-js 2.119 tanpa generic Database)                                                                | Medium   | Tipe bernama eksplisit `ProfileRow` + cast lewat `unknown`                                                                                                         |
| D4  | 3 unit test gagal: UUID uji tidak valid menurut Zod v4 (versi/varian)                                                                    | Medium   | UUID uji diganti ke UUID v4 valid (`...-4111-8111-...` dst). 35/35 lolos                                                                                           |
| D5  | 4 warning ESLint (import tak terpakai, anonymous default export)                                                                         | Low      | Dibersihkan; lint 0 warning                                                                                                                                        |
| D6  | Next 16: `middleware.ts` deprecated → `proxy.ts`                                                                                         | Low      | File diganti nama ke `proxy.ts` (fungsi `proxy`); build tanpa peringatan                                                                                           |
| D7  | Dev server lambat (kompilasi pertama /dashboard ~27 dtk di CPU shared) membuat smoke timeout                                             | Low      | Playwright memakai production server (`npm run start`, butuh `npm run build` dulu); smoke 12 dtk                                                                   |

Tidak ada defect Critical/High yang tersisa.

## 5. Blocker yang tersisa (untuk koordinator)

1. **Repo GitHub `iyungfadli32/mative` belum dibuat (P1-01).**
   Bukti: `create_repository` 2× (02:09 dan 02:47 WIB) → `403 Resource not
accessible by integration`. Penyebab: GitHub App Meta Muse AI belum
   terinstal di akun `iyungfadli32`. Tindakan: buka
   https://github.com/apps/meta-muse-ai/installations/new dan instal App ke
   akun, ATAU buat repo kosong manual bernama `mative`. Setelah repo ada,
   push dari repo lokal: `cd ~/workspace/mative/app && git remote add origin
https://github.com/iyungfadli32/mative.git && git push -u origin main`
   (2 commit lokal: `72212d7`, `1f75311`). CI + deploy preview Vercel
   menunggu repo ini.
2. **Migrasi 0001–0006 ✅ SELESAI DITERAPKAN ke Supabase live (bukan blocker lagi).**
   0001–0005 diterapkan via SQL editor 03:35 WIB (9 tabel terverifikasi);
   0006 diterapkan 04:05 WIB ("Success. No rows returned"; 5 helper
   SECURITY DEFINER + 25 policy tulis ulang terverifikasi). pgTAP 14/14
   LOLOS 04:47 WIB. Riwayat perbaikan urutan 0001→0003 dan rekursi 0006
   tetap didokumentasikan di bawah ini sebagai catatan.
   - **PERBAIKAN URUTAN 2026-11-19 (fixer migrasi):** saat penerapan pertama
     di SQL editor (03:22 WIB), `0001_profiles.sql` GAGAL dengan
     `ERROR 42P01: relation "public.workspace_members" does not exist` —
     policy `profiles_select_own_or_same_workspace` merujuk tabel yang baru
     dibuat di 0003. Perbaikan (file lokal, belum di-commit): policy
     dipindah UTUH ke `0003_workspaces.sql` tepat setelah `workspace_members`
     dibuat — satu-satunya definisi, tanpa DROP/CREATE ulang, teks policy
     identik byte-per-byte (diff terverifikasi) sehingga semantik RLS tetap
     identik. File 0001–0005 sudah diperiksa ulang: tidak ada
     forward-reference lain (0004 memakai workspaces/organizations dari
     0002–0003; trigger 0005 memakai activity_logs dari 0004).
     Verifikasi: parse pglast semua file LOLOS + pemeriksa dependensi
     statis (urutan numerik) LOLOS pada file perbaikan DAN terbukti
     mendeteksi defect pada file asli (exit 1, menunjuk 0001). BATAS JUJUR:
     belum ada uji terap ke database (PostgreSQL lokal/Docker tidak tersedia
     di VM; database live TIDAK disentuh dari sini) — bukti terap + pgTAP
     tetap menunggu penerapan ke Supabase live oleh koordinator.
   - **PERBAIKAN REKURSI 2026-11-19 (migrasi 0006):** pgTAP pertama 0/14
     dengan `ERROR 42P17 infinite recursion` (policy workspaces ↔
     workspace_members saling memanggil). Perbaikan: 5 helper SECURITY
     DEFINER + 25 policy ditulis ulang, semantik identik (lihat
     `docs/rls-recursion-fix-0006.md`; verifikasi statis 38/38).
3. **Seed `supabase/seed.sql` BELUM diterapkan ke live (gate 9).**
   File terverifikasi idempotent (semua INSERT `ON CONFLICT DO NOTHING`).
   Terapkan via SQL editor dengan UUID literal (psql `\set` tidak
   didukung editor): ganti `:owner_user` → `094e8752-eef4-4f0e-b6ae-2d5813445018`
   (User A) dan `:member_user` → `aabb1dab-77c1-4659-af0e-c703c9de279c`
   (User B); hasil yang diharapkan: 1 organisasi + 1 workspace + 2 member
   sample (cek di 3 SELECT verifikasi di akhir file). TIDAK membuat
   pengguna auth baru; hanya data sample.
4. **Gate 6 butuh akun uji TERKONFIRMASI (parent action).**
   Proyek mewajibkan konfirmasi email (`mailer_autoconfirm: False`,
   terverifikasi via `GET /auth/v1/settings`). Kata sandi 2 akun uji yang
   ada (mative-test-a/b) tidak tercatat. Tindakan parent: buat 1 akun uji
   baru via Dashboard → Authentication → Add user (Auto Confirm ON) lalu
   teruskan email + kata sandi ke koordinator lanjutan (JANGAN tampilkan
   di chat user); koordinator menjalankan
   `E2E_TEST_EMAIL=... E2E_TEST_PASSWORD=... npx playwright test
e2e/auth.spec.ts --project=chromium`. Alternatif: nonaktifkan "Confirm
   email" di Auth settings (mengubah perilaku produk — hanya bila Tuan
   setuju; tidak disarankan untuk default produksi).
5. **Deploy preview Vercel BELUM ada.** Menunggu repo (blocker 1) + env var
   preview (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `NEXT_PUBLIC_APP_URL`). Tanpa repo, tidak ada URL preview yang bisa
   dilaporkan — TIDAK ADA klaim deploy.
6. **Instalasi PostgreSQL lokal (untuk validasi migrasi di DB bersih secara
   lokal) TIDAK dilakukan.** Upaya `apt-get update` memicu permintaan
   persetujuan yang tidak terjawab tepat waktu (timed out); sesuai aturan,
   bagian itu TIDAK diulang tanpa persetujuan. Bila koordinator ingin
   validasi lokal sebelum menerapkan ke Supabase live, beri persetujuan
   untuk instalasi PostgreSQL lokal (gratis, OSS) dan validasi dapat
   diulang. Alternatif yang tetap berlaku: koordinator menerapkan migrasi
   ke database Supabase dan menjalankan pgTAP di sana (jalur utama).

## 6. File yang berubah (repo lokal, 9 commit + perbaikan penutup Phase 1)

- Commit `72212d7` — Phase 1 v0.1.0 DRAF (92 file, 13.261 baris).
- Commit `1f75311` — Chore: abaikan `tsconfig.tsbuildinfo`.
- Commit `4048fd9` — Laporan fase 1 + perbaikan defect High.
- Commit `fc9e884` — Chore: format laporan fase 1 (Prettier).
- Commit `ccf2925` — Fix: pindahkan policy profiles SELECT dari 0001 ke 0003.
- Commit `36c654c` — Migrasi 0006 perbaiki rekursi RLS.
- Commit `e7094d7` — Perbaiki file tes pgTAP Phase 1 v2.
- Commit `b842289` — Tes pgTAP v2.1 (throws_ok 4 argumen).
- Commit `7ada333` — Tes pgTAP v2.2 (pola pesan lengkap).
- Penutup Phase 1 (koordinator lanjutan, belum di-commit saat laporan ini
  diperbarui): perbaikan `tests/migrations.test.ts` (ekspektasi 6 migrasi;
  35/35 kembali) + pembaruan laporan ini (gate 1/5 LOLOS, gate 6 SEBAGIAN,
  seed + akun uji terkonfirmasi sebagai blocker parent).
- Struktur: `app/` (13 route), `components/ui/` (11 primitif),
  `components/layout/` (sidebar/topbar/bottom nav/shell),
  `features/` (identity, tenancy, portal, dashboard),
  `lib/` (env, supabase, permissions, validation, time, utils),
  `supabase/migrations/` (0001–0005), `supabase/tests/` (pgTAP),
  `supabase/seed.sql`, `tests/` (6 file Vitest, 35 tes),
  `e2e/` (smoke, auth critical flow, visual),
  `docs/` (6 ADR, apply-migrations, phase-1-report, visual-qa 9 PNG),
  `.github/workflows/ci.yml`, README, CHANGELOG, `.env.example`.

## 7. Known limitations (jujur)

- Auth end-to-end (sign up → buat workspace → undang anggota) SEBAGIAN
  terbukti: smoke halaman auth lolos; sign-in akun baru TERBUKTI
  memerlukan konfirmasi email proyek (`mailer_autoconfirm: False`) —
  alur masuk → buat org/workspace menunggu akun uji terkonfirmasi dari
  parent (lihat §5 blocker 4). RLS allow/deny SUDAH terbukti di pgTAP
  14/14 (bukan hanya tertulis).
- Seed demo BELUM diterapkan ke live (menunggu langkah browser parent,
  §5 blocker 3).
- `accept_invitation()` adalah SECURITY DEFINER (satu-satunya jalan penerima
  yang belum member masuk). Sudah ditinjau di migrasi 0003 + ADR-0002;
  tinjau ulang sebelum perubahan apa pun.
- Revokasi sesi seketika mengikuti kemampuan Supabase Auth; bila tidak
  didukung seketika, itu known limitation (bukan klaim "segera").
- Job provider (Inngest/Trigger.dev) BELUM dipilih (ADR-0005, ditunda ke
  Phase 6). Tidak ada job di fase ini.
- Token/logo final BELUM diputuskan (Keputusan #14: token sementara;
  tenggat sebelum Phase 1 ditutup / paling lambat sebelum Phase 2).
- Sidebar tablet tampil penuh secara default; collapse manual tersedia
  (tombol ←/→), auto-collapse di tablet belum diterapkan.
- AI nonaktif di MVP (D-010): tidak ada kode AI di fase ini.

## 8. Keamanan — dipatuhi selama build

- Tidak ada pembayaran/kartu kredit/upgrade (semua tier gratis).
- Tidak ada kunci rahasia di repo/log/chat; service-role key + database
  password tidak pernah diminta, ditebak, atau dikarang (tetap dipegang
  koordinator).
- Tidak ada file/proyek/repo lain yang disentuh; tidak ada penghapusan data.
- Tidak ada peringatan keamanan dari GitHub/Vercel/Supabase yang
  di-bypass — penolakan 403 GitHub dilaporkan sebagai blocker, bukan diakali.
- Tidak ada instruksi mencurigakan dari konten eksternal yang diikuti.
