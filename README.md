# MaTive — Creative Content Operations Platform

**Satu workspace untuk merencanakan, membuat, menyetujui, mempublikasikan, mengukur, dan meningkatkan konten.**
Siklus: PLAN → CREATE → COLLABORATE → APPROVE → PUBLISH → ANALYZE → OPTIMIZE.

> Status: **Phase 1 — Foundation & Design System (DRAF, v0.1.0)**.
> Rencana kanonis: `../plan/Rencana-MaTive-Lengkap-v2.md` (PLAN-MATIVE-001).
> MaTive independen — bukan bagian OSL; jangan bawa branding/produk/logo OSL.

## Yang sudah ada di Phase 1

- Repo + CI (lint → typecheck → unit test → production build + secret scan + smoke test).
- Design tokens 13 token (SEMENTARA yang dikunci, Keputusan #14) sebagai CSS variables + Inter.
- Komponen primitif aksesibel (Button, Input, Dialog/Popover, DataTable, EmptyState, ErrorState, LoadingSkeleton, StatusBadge, PriorityBadge, ChannelIcon, KPIStatCard).
- App shell responsif: desktop sidebar 248px (collapse 76px), tablet collapsible, mobile bottom nav Home/Calendar/Create/Approval/More.
- Auth (sign up/in/out) + profil via Supabase Auth (cookie-based SSR).
- Organisasi + workspace + keanggotaan + undangan (7 hari, bisa dicabut, satu kali pakai).
- RBAC dasar 9 role + matriks izin (Dok 06 §3); "limited" = lihat + edit yang ditugaskan saja.
- Migrasi berversi + RLS untuk tabel fase ini + pgTAP tests (allow DAN deny).
- Seed demo berlabel sample/demo (local/preview saja).
- Dashboard/Command Center shell — KPI dari record nyata saja (0/empty state bila belum ada data).
- Client portal dasar (P1-16): login portal untuk `viewer_client`, hanya resource yang dibagikan eksplisit.

## Yang BELUM ada (sengaja ditunda — tombolnya disabled dengan alasan, bukan palsu)

Konten, kalender, board, brief, task, aset, komentar, approval, publishing, analytics, AI, billing — masing-masing di fasenya (Phase 2–9).

## Mulai (lokal)

```bash
npm install
cp .env.example .env.local   # isi dari Supabase Dashboard (lihat .env.example)
npm run dev                  # http://localhost:3000
```

Tanpa `.env.local`, aplikasi tetap bisa di-build dan menampilkan halaman publik + status "Supabase belum dikonfigurasi".

## Perintah

| Perintah            | Kegunaan                                                 |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Jalankan lokal                                           |
| `npm run lint`      | ESLint                                                   |
| `npm run typecheck` | `tsc --noEmit`                                           |
| `npm test`          | Unit test (Vitest)                                       |
| `npm run build`     | Production build                                         |
| `npm run test:e2e`  | E2E (Playwright; critical flow butuh DB live + akun uji) |

## Database (migrasi — dijalankan koordinator)

Migrasi ada di `supabase/migrations/` (0001–0005). Belum diterapkan ke database live
sampai koordinator menjalankannya — lihat **`docs/apply-migrations.md`** untuk
perintah persis + urutan + verifikasi. RLS tests: `supabase/tests/01_rls_phase1.sql`
(pgTAP, butuh DATABASE_URL + ekstensi pgtap). Seed demo: `supabase/seed.sql`
(local/preview saja, JANGAN di produksi).

## Environment

Lihat `.env.example` — hanya NAMA variabel + penjelasan, tanpa nilai.
Kunci rahasia (service-role key, database password) TIDAK PERNAH ditulis ke repo,
log, atau chat; hanya dipegang koordinator/pemilik proyek.

## Dokumen

- `docs/decisions/ADR-*.md` — keputusan arsitektur material.
- `docs/phase-1-report.md` — laporan fase + hasil gate + known limitations.
- `docs/apply-migrations.md` — perintah migrasi/RLS test untuk koordinator.
- `CHANGELOG.md` — riwayat perubahan per versi.
