# Changelog — MaTive

Format: [Versi] — tanggal (WIB) — ringkasan.

## [0.3.0] — 2026-11-19 — Phase 3: Production Operations (DRAF)

### Ditambahkan

- Migrasi `0009_production_ops.sql` — 9 tabel (brief_templates, tasks, task_checklist_items, assets, asset_versions, content_assets, comments, mentions, notifications) + 36 policy RLS + 9 helper + bucket privat `mative-assets` + 5 policy storage; pgTAP `03_rls_phase3.sql` (34 asersi, verifikasi statis 50/50, graf RLS efektif 128 policy 0 siklus).
- Migrasi `0010_production_transactions.sql` — 5 fungsi RPC `SECURITY DEFINER` (buat task + checklist, transisi status task, komentar + mention, pulihkan versi, jadikan template default — masing-masing satu transaksi); grant EXECUTE hanya ke `authenticated`.
- Migrasi `0011_fix_content_item_brand_null.sql` — perbaikan defect laten Phase 2: trigger scope `content_items` kini mengizinkan brand NULL (pola `validate_idea_scope`); konversi ide tanpa brand yang sebelumnya selalu gagal kini bisa; + hardening revoke fungsi `SECURITY DEFINER`.
- Kode aplikasi Production Operations (ADR-0009): domain `features/production/` (skema Zod, mesin status task, deteksi MIME dari magic bytes + SHA-256, queries, server actions) + halaman Task Center (`/tugas`), Pustaka Aset (`/pustaka`), Template Brief (`/template-brief`), dan editor konten bertab (`/konten/[id]` — overview/brief/script/media/placements/tasks/comments/versions) + Inbox Ide yang diperluas (filter + detail + konversi) + toggle komentar klien di `/pengaturan`.
- Tes: unit 107/107 (11 file), Playwright chromium smoke + visual 29 lolos + 1 skip, planning.spec.ts live 4/4 (regresi editor bertab), visual QA 9 screenshot baru (tugas/pustaka/template-brief × 1440/1024/390).
- Dokumen: ADR-0009, laporan fase 3 (`docs/phase-3-report.md`), `docs/apply-migrations.md` (langkah apply 0009–0011 + pgTAP 03 + e2e Phase 3).

### Diperbaiki

- Langkah 0: edit placement tidak pernah bisa simpan ("Data tidak valid.") — select Channel disabled tidak ikut ter-submit; diperbaiki dengan hidden input `socialChannelId` (pola yang sama dengan defect ContentForm #5). Commit `3485eb1`; probe 1/1 + planning.spec.ts 4/4.

### Diketahui belum selesai / blocker

- Migrasi 0009 + 0010 + 0011 BELUM diterapkan ke database live (butuh SQL Editor — dipegang koordinator). Lihat `docs/phase-3-report.md` §8.
- pgTAP 03 (34 asersi) + spek penerimaan e2e Phase 3 (`e2e/production.spec.ts`) BELUM bisa lolos live sebelum migrasi diterapkan; e2e Phase 3 saat ini gagal di langkah konversi ide tanpa brand (defect yang diperbaiki 0011) — bukti + perbaikan di `docs/phase-3-report.md` §6.4.
- Visual QA keadaan login (daftar task, grid aset, editor berisi data) belum ada screenshot-nya — hanya shell belum-login.
- Aset tanpa pemindaian virus (batas desain); `duration_ms` selalu null; item tanpa brand tidak bisa diberi placement (keputusan desain).
- Playwright WebKit tetap BLOCKED (B4); kalender Week/Day/List ditunda; dashboard KPI memakai workspace pertama; filter kalender/board limit 200 item.

## [0.2.0] — 2026-11-19 — Phase 2: Planning Core (DRAF)

### Ditambahkan

- ERD Planning Core (ADR-0007): migrasi `0007_planning_core.sql` — 14 tabel + 56 policy RLS + trigger audit (0 siklus), pgTAP `02_rls_phase2.sql` (20 asersi, verifikasi statis 21/21).
- Migrasi `0008_planning_transactions.sql` — 6 fungsi RPC `SECURITY DEFINER` (buat/edit konten + versi, transisi status, konversi ide, reschedule placement, ubah distribusi) sebagai satu transaksi; grant EXECUTE hanya ke `authenticated`.
- Kode aplikasi Planning Core (ADR-0008): domain `features/planning/` (constants, transisi, kalender/timezone, search, queries, server actions Zod + RLS) + 11 halaman: Merek, Channel, Pilar & Audiens, Campaign, Ide, Konten (daftar/buat/detail + riwayat status), Kalender Month + Agenda, Board Kanban, Pencarian global.
- Drag/drop HTML5 native (tanpa dnd-kit) + alternatif tombol untuk sentuh/keyboard; collision placement → dialog tetap/geser 1 jam/batal.
- Board Kanban 10 kolom (8 tahap + Terkendala + Diarsipkan), WIP tanpa batas; kalender + board membaca record kanonis yang sama.
- Pencarian ter-scope tenant + filter di URL; deep link lintas workspace → 404.
- Tes: unit 84/84 (10 file), Playwright chromium 28 lolos + 3 skip (@needs-db), visual QA kalender/board/konten di 1440/1024/390.
- Dokumen: ADR-0007 + ADR-0008, laporan fase 2 (P2-01 s.d. P2-15), `docs/apply-migrations.md` (langkah apply 0007 + 0008).

### Diketahui belum selesai / blocker

- Migrasi 0007 + 0008 BELUM diterapkan ke database live (butuh DATABASE_URL — dipegang koordinator). Lihat `docs/phase-2-report.md` §12 + `docs/apply-migrations.md`.
- pgTAP 02 (20 asersi) + spek penerimaan e2e Phase 2 BELUM bisa dijalankan (menunggu migrasi live + akun uji).
- Proyek Playwright mobile (WebKit) BLOCKED oleh 3 lib sistem (`libmanette-0.2-0`, `libenchant-2-2`, `libsecret-1-0`); persetujuan apt kedaluwarsa dan tidak diulang. Visual 390px terbukti lewat viewport Chromium.
- Kalender Week/Day/List + List/Timeline view board ditunda (ADR-0008 §6–§7).
- Dashboard KPI memakai workspace pertama pengguna; filter kalender/board memakai query tunggal limit 200 item.

## [0.1.0] — 2026-11-19 — Phase 1: Foundation & Design System (DRAF)

### Ditambahkan

- Repo + struktur folder sesuai Dok 04 §8 (`app/`, `components/`, `features/`, `lib/`, `supabase/migrations/`, `docs/`, `e2e/`, `public/`).
- Stack terkunci (ADR-0001): Next.js 16.4.6, React 19.3.1, TypeScript 5.9.3, Tailwind 4.3.5, Zod 4.6.7, React Hook Form 7.92.0, Supabase JS 2.119.1 / SSR 0.12.7, Vitest 5.1.1, Playwright 1.65.1.
- Toolchain: ESLint (flat) + Prettier + `tsc --noEmit` + CI GitHub Actions (lint → typecheck → unit test → secret scan → production build → smoke test).
- Design tokens 13 token sebagai CSS variables + Inter (ADR-0003, sementara — Keputusan #14).
- 11 komponen primitif aksesibel + state umum (Empty/Error/Loading).
- App shell responsif (sidebar 248px/collapse 76px, topbar, bottom nav mobile).
- Auth Supabase (sign up/in/out) + profil (ADR-0004).
- Organisasi + workspace + keanggotaan + undangan 7 hari (token hash sha256) + fungsi `accept_invitation()`.
- RBAC 9 role + matriks izin; `limited` = lihat + edit yang ditugaskan saja.
- Migrasi 0001–0005 + RLS per operasi + pgTAP tests (14 tes allow/deny).
- Seed demo berlabel sample (local/preview saja).
- Dashboard shell — KPI dari record nyata saja (0/empty state di Phase 1).
- Client portal dasar P1-16 (ADR-0006): `resource_shares` + audit trigger.
- Dokumen: README, `.env.example` (tanpa nilai), 6 ADR, `docs/apply-migrations.md`, laporan fase.

### Diketahui belum selesai / blocker

- Migrasi BELUM diterapkan ke database live (butuh DATABASE_URL/service-role — dipegang koordinator). Lihat `docs/apply-migrations.md`.
- RLS pgTAP test + e2e critical flow BELUM bisa dijalankan (menunggu migrasi + akun uji).
- Repo GitHub `iyungfadli32/mative` BELUM dibuat (create via GitHub App ditolak 403 — App belum terinstal di akun; perlu dibuat manual / instalasi App).
- Deploy preview Vercel BELUM ada (menunggu repo + env var preview).
- Job provider (Inngest/Trigger.dev) BELUM dipilih (ditunda ke Phase 6 — ADR-0005).
