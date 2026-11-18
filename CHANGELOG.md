# Changelog — MaTive

Format: [Versi] — tanggal (WIB) — ringkasan.

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
