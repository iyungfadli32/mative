# Laporan Fase 1 — Foundation & Design System (MaTive v0.1.0 DRAF)

- **Rencana:** PLAN-MATIVE-001, Rencana-MaTive-Lengkap-v2 (kanonis).
- **Tanggal pengerjaan:** 2026-11-19 (02:07–02:50 WIB).
- **Pelaksana:** coding agent Phase 1 (untuk Braderz Plan Management).
- **Status fase:** **BELUM SELESAI PENUH** — kode + migrasi + tes tertulis dan
  gate yang bisa jalan TANPA database live semuanya LOLOS; 3 gate (migrasi di
  DB bersih, integration/database test, browser test critical flow) dan deploy
  preview **BLOCKED menunggu koordinator** (lihat §5). Fase 2 TIDAK BOLEH
  dimulai sebelum blocker itu ditutup dan gate 1/5/6/9 dicatat LOLOS.

## 1. Ringkasan hasil

| Langkah | Status |
|---|---|
| P1-01 Repo GitHub `iyungfadli32/mative` | ⚠️ BLOCKED — GitHub App belum terinstal (403, 2×). Repo lokal siap (2 commit) di `~/workspace/mative/app` |
| P1-02 Verifikasi stack + kunci versi | ✅ SELESAI — ADR-0001 |
| P1-03 Toolchain + CI | ✅ SELESAI — lint/typecheck/test/build + secret scan + smoke di CI |
| P1-04 Design tokens (13 token) | ✅ SELESAI — CSS variables, ADR-0003 |
| P1-05 Komponen primitif (11) | ✅ SELESAI |
| P1-06 App shell responsif | ✅ SELESAI — screenshot 3 viewport |
| P1-07 Auth + profil | ✅ KODE SELESAI — bukti end-to-end menunggu migrasi + akun uji |
| P1-08 Org + workspace + undangan | ✅ KODE SELESAI — bukti end-to-end menunggu migrasi + akun uji |
| P1-09 RBAC 9 role | ✅ SELESAI (matriks + unit test) — penegakan DB menunggu migrasi |
| P1-10 Migrasi + RLS | ✅ TERTULIS (0001–0005) — ⚠️ BELUM DITERAPKAN ke DB live |
| P1-11 RLS policy tests (pgTAP, 14 tes) | ✅ TERTULIS — ⚠️ BELUM DIJALANKAN (butuh DB live) |
| P1-12 Seed demo sample | ✅ SELESAI (file) — belum dijalankan (butuh DB + UUID user uji) |
| P1-13 Dashboard shell (KPI record nyata) | ✅ SELESAI — 0/empty state, tanpa angka karangan |
| P1-14 Dokumen | ✅ SELESAI — README, .env.example, 6 ADR, CHANGELOG, laporan ini |
| P1-15 Quality gate Dok 11 | ⏳ 7/10 LOLOS (lihat §3); 3 BLOCKED |
| P1-16 Client portal dasar | ✅ KODE SELESAI — uji allow/deny menunggu migrasi (pgTAP T4/T5) |

### Milestone M1

| Milestone | Status |
|---|---|
| M1.1 Sign up/in/out + profil di browser | ⏳ Kode selesai; bukti browser menunggu migrasi + akun uji |
| M1.2 Buat org/workspace, beralih workspace, undang anggota | ⏳ Kode selesai; bukti browser menunggu migrasi + akun uji |
| M1.3 Uji RLS (cross-tenant UUID guessing) | ⏳ pgTAP tertulis (14 tes); belum dijalankan — menunggu migrasi |
| M1.4 App shell 1440/1024/390 | ✅ LOLOS — 9 screenshot di `docs/visual-qa/` |
| M1.5 CI hijau | ✅ LOLOS lokal (lint/typecheck/test/build); CI GitHub belum bisa jalan (repo belum ada) |
| M1.6 Dokumen lengkap | ✅ LOLOS |
| M1.7 Portal klien (M1.7 baru, v2) | ⏳ Kode + RLS tertulis; uji allow/deny menunggu migrasi |

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

| # | Gate | Perintah | Hasil |
|---|---|---|---|
| 1 | Migrasi di DB bersih | `supabase db push` / psql (lihat `docs/apply-migrations.md`) | ⏳ **BLOCKED** — butuh DATABASE_URL (koordinator) |
| 2 | Lint lolos | `npm run lint` | ✅ **LOLOS** — 0 error, 0 warning |
| 3 | Typecheck lolos | `npm run typecheck` (`tsc --noEmit`) | ✅ **LOLOS** — 0 error |
| 4 | Unit test lolos | `npm test` (Vitest) | ✅ **LOLOS** — 6 file, **35/35 tes lolos** |
| 5 | Integration/database test | pgTAP `supabase/tests/01_rls_phase1.sql` | ⏳ **BLOCKED** — butuh DB live + ekstensi pgtap |
| 6 | Browser test critical flow | `npx playwright test e2e/auth.spec.ts` | ⏳ **BLOCKED** — butuh migrasi + akun uji (tes auto-skip tanpa `E2E_TEST_EMAIL/PASSWORD`) |
| 6a | Browser smoke (halaman publik) | `npx playwright test e2e/smoke.spec.ts --project=chromium` | ✅ **LOLOS** — **7/7** (production server) |
| 7 | Production build | `npm run build` | ✅ **LOLOS** — compiled 29 dtk, 13/13 halaman, semua route ada (`/`, `/masuk`, `/daftar`, `/dashboard`, `/portal`, `/portal/[shareId]`, `/pengaturan`, `/pengaturan/anggota`, `/pengaturan/organisasi`, `/profil`, `/lainnya`, `/undangan/[token]`, `/api/health`) |
| 8 | Responsive visual review | `npx playwright test e2e/visual.spec.ts --project=chromium` | ✅ **LOLOS** — **9/9**, 9 screenshot di `docs/visual-qa/` (landing/dashboard/portal × 1440/1024/390). Temuan: Low — nama workspace mobile terpotong ("Belum ada wor…"); sidebar tablet tampil penuh (collapse manual tersedia, auto-collapse belum). Bukan defect High/Critical. |
| 9 | Security/permission test | pgTAP 14 tes + secret scan repo | ⏳ **pgTAP BLOCKED** (menunggu DB); ✅ **secret scan BERSIH** (grep pola kunci asli di semua file repo kecuali `tests/`, `node_modules/`, `.next/`, `.env.local`) |
| 10 | Docs + known limitations | README, `.env.example`, ADR, CHANGELOG, laporan ini | ✅ **LOLOS** |

Perintah format: `npm run format` → **LOLOS** (semua file sesuai Prettier setelah `format:write`).

## 4. Defect yang ditemukan + diperbaiki (semua sudah habis)

| # | Defect | Severity | Perbaikan |
|---|---|---|---|
| D1 | Dashboard HTTP 500: "Event handlers cannot be passed to Client Component props" — `EmptyState` menerima `onAction` dari Server Component | **High** | `Button` diberi `"use client"`; `onAction` dihapus dari dashboard (tautan "Ke halaman masuk" sudah ada di bawahnya). Terverifikasi: dashboard HTTP 200 + smoke 7/7 |
| D2 | `useActionState` menolak server action ber-signature `(formData)` | High | Semua form action diubah ke signature `(prevState, formData)` (React 19). Typecheck 0 error |
| D3 | `profile` menyempit ke `never` (supabase-js 2.119 tanpa generic Database) | Medium | Tipe bernama eksplisit `ProfileRow` + cast lewat `unknown` |
| D4 | 3 unit test gagal: UUID uji tidak valid menurut Zod v4 (versi/varian) | Medium | UUID uji diganti ke UUID v4 valid (`...-4111-8111-...` dst). 35/35 lolos |
| D5 | 4 warning ESLint (import tak terpakai, anonymous default export) | Low | Dibersihkan; lint 0 warning |
| D6 | Next 16: `middleware.ts` deprecated → `proxy.ts` | Low | File diganti nama ke `proxy.ts` (fungsi `proxy`); build tanpa peringatan |
| D7 | Dev server lambat (kompilasi pertama /dashboard ~27 dtk di CPU shared) membuat smoke timeout | Low | Playwright memakai production server (`npm run start`, butuh `npm run build` dulu); smoke 12 dtk |

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
2. **Migrasi 0001–0005 BELUM diterapkan ke Supabase live.**
   File: `supabase/migrations/0001_profiles.sql` s.d.
   `0005_resource_shares.sql`. Perintah persis + verifikasi ada di
   `docs/apply-migrations.md` (Opsi A `supabase db push` / Opsi B psql).
   Setelah diterapkan, jalankan pgTAP (`supabase/tests/01_rls_phase1.sql`,
   14 tes) + seed (opsional, preview saja) + e2e critical flow dengan akun
   uji. Baru setelah itu gate 1/5/6/9 bisa dinyatakan LOLOS.
3. **Deploy preview Vercel BELUM ada.** Menunggu repo (blocker 1) + env var
   preview (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `NEXT_PUBLIC_APP_URL`). Tanpa repo, tidak ada URL preview yang bisa
   dilaporkan — TIDAK ADA klaim deploy.
4. **Instalasi PostgreSQL lokal (untuk validasi migrasi di DB bersih secara
   lokal) TIDAK dilakukan.** Upaya `apt-get update` memicu permintaan
   persetujuan yang tidak terjawab tepat waktu (timed out); sesuai aturan,
   bagian itu TIDAK diulang tanpa persetujuan. Bila koordinator ingin
   validasi lokal sebelum menerapkan ke Supabase live, beri persetujuan
   untuk instalasi PostgreSQL lokal (gratis, OSS) dan validasi dapat
   diulang. Alternatif yang tetap berlaku: koordinator menerapkan migrasi
   ke database Supabase dan menjalankan pgTAP di sana (jalur utama).

## 6. File yang berubah (repo lokal, 2 commit)

- Commit `72212d7` — Phase 1 v0.1.0 DRAF (92 file, 13.261 baris).
- Commit `1f75311` — Chore: abaikan `tsconfig.tsbuildinfo`.
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

- Auth end-to-end (sign up → buat workspace → undang anggota) dan RLS
  allow/deny BELUM terbukti di browser/DB live — kode + tes tertulis, bukti
  menunggu blocker 2.
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
