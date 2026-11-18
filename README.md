# MaTive — Creative Content Operations Platform

**Satu workspace untuk merencanakan, membuat, menyetujui, mempublikasikan, mengukur, dan meningkatkan konten.**
Siklus: PLAN → CREATE → COLLABORATE → APPROVE → PUBLISH → ANALYZE → OPTIMIZE.

> Status: **Phase 2 — Planning Core (DRAF, v0.2.0)**.
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

## Yang sudah ada di Phase 2 (P2-01 s.d. P2-15 — kode tertulis, BELUM diterapkan ke live)

- ERD Planning Core: 14 tabel (brands, social_channels, content_pillars, audiences, campaigns, campaign_brands, ideas, content_items, content_placements, content_versions, placement_versions, content_status_events, tags, content_tags) + 56 policy RLS — migrasi `0007_planning_core.sql` + pgTAP `02_rls_phase2.sql` (20 asersi).
- 6 fungsi RPC transaksional — migrasi `0008_planning_transactions.sql` (buat/edit konten + versi, transisi status, konversi ide, reschedule, ubah distribusi — masing-masing satu transaksi).
- Halaman perencanaan: Merek, Channel (registry metadata — selalu "belum terhubung", tanpa OAuth), Pilar & Audiens, Campaign, Ide (tangkap minimal + konversi), Konten (daftar/buat/detail + riwayat status), Kalender Month + Agenda (drag/drop HTML5 + collision), Board Kanban (10 kolom, WIP tanpa batas), Pencarian global.
- Pencarian ter-scope tenant; filter tercermin di URL; deep link lintas workspace → 404.
- ADR-0007 (ERD) + ADR-0008 (kode aplikasi: drag/drop, enum terkunci, tabel transisi, JSONB, daftar polimorfik Phase 3).

## Yang BELUM ada (sengaja ditunda — tombolnya disabled dengan alasan, bukan palsu)

Kalender Week/Day/List, brief editor, task, aset, komentar, version compare/restore, approval, publishing, analytics, AI, billing — masing-masing di fasenya (Phase 3–9). Channel TIDAK terhubung ke platform mana pun (metadata saja) sampai fase integrasi.

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

Migrasi ada di `supabase/migrations/` (0001–0008). Belum diterapkan ke database live
sampai koordinator menjalankannya — lihat **`docs/apply-migrations.md`** untuk
perintah persis + urutan + verifikasi. RLS tests: `supabase/tests/01_rls_phase1.sql`
dan `supabase/tests/02_rls_phase2.sql` (pgTAP, butuh DATABASE_URL + ekstensi pgtap).
Seed demo: `supabase/seed.sql` (local/preview saja, JANGAN di produksi).

## Environment

Lihat `.env.example` — hanya NAMA variabel + penjelasan, tanpa nilai.
Kunci rahasia (service-role key, database password) TIDAK PERNAH ditulis ke repo,
log, atau chat; hanya dipegang koordinator/pemilik proyek.

## Dokumen

- `docs/decisions/ADR-*.md` — keputusan arsitektur material.
- `docs/phase-1-report.md` — laporan fase + hasil gate + known limitations.
- `docs/phase-2-report.md` — laporan Phase 2 (ERD + kode aplikasi + gate lokal + gate yang menunggu koordinator).
- `docs/apply-migrations.md` — perintah migrasi/RLS test untuk koordinator.
- `CHANGELOG.md` — riwayat perubahan per versi.
