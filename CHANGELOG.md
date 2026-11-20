# Changelog — MaTive

Format: [Versi] — tanggal (WIB) — ringkasan.

## [0.9.0] — 2026-11-20 — Phase 9: Hardening & Launch (DRAF)

### Ditambahkan

- pgTAP 08 v1.3: asersi baru T3f `INSERT ... RETURNING` pada `ai_generations` (regresi defect 0023 — SELECT policy self-lookup memblokir RETURNING; menutup celah cakupan butir 7 laporan Phase 8 §11). Plan 52 → 53 asersi; verifikasi statis pglast 135 statement.
- Server action `removeMemberAction` (owner-only) + tombol "Hapus" di Tim & Peran — menutup celah Dok 06 §8 butir 5: sebelumnya owner hanya bisa mencabut undangan (pra-gabung), bukan menghapus anggota yang sudah bergabung. Guard: pemanggil harus owner (dibaca dari sesi, bukan body), diri sendiri dan owner tidak bisa dihapus; kebijakan RLS `ws_members_delete_owner` (0006) menegakkan hal yang sama di DB.
- Error boundary: `app/(app)/error.tsx`, `app/error.tsx`, `app/global-error.tsx` — sebelumnya tidak ada error boundary di mana pun (gap 9.1 a). Terverifikasi di browser nyata: halaman uji yang melempar menampilkan fallback "Terjadi kesalahan" + tombol muat ulang.
- Visual QA Phase 9: 21 capture logged-out (7 layar × 3 viewport) + 2 capture after-fix di `docs/visual-qa/phase9/`.
- Dokumen peluncuran: `PRIVACY.md`, `TERMS.md`, `docs/RELEASE_RUNBOOK.md`, `docs/phase-9-report.md`.

### Diperbaiki

- Navigasi mobile: halaman `/lainnya` hanya memuat 16 dari 25 tujuan sidebar — Tugas Saya, Pustaka Aset, Template Brief, Template, Analitik, Laporan, Impor Data, Integrasi, Asisten AI tidak bisa dicapai lewat navigasi mobile. Ditambah kesembilan tautan + subjudul usang "Phase 2" diperbarui.
- Dialog "Buat cepat" Topbar (desktop) masih menampilkan Buat konten / Tangkap ide / Unggah aset sebagai tombol disabled "belum tersedia (Phase 2/3)" padahal ketiganya sudah rilis — diganti 4 aksi tersedia, sama dengan dialog mobile (yang juga ditambah "Unggah aset").
- Tes smoke mobile (3 kegagalan pra-Phase 9): locator `/lainnya` (nama aksesibel = label + deskripsi), tes "modul fase berikut disabled" yang sudah usang diganti tes dialog Buat cepat, asersi pencarian topbar di mobile diubah jadi `toBeHidden` (form `hidden md:block` sesuai desain). Smoke suite kini 26 lolos + 4 skip, 0 gagal (chromium + mobile).
- Baris tombol aksi Command Center meluber di viewport 390px ("Undang anggota" terpotong) — tambah `flex-wrap`; terverifikasi lewat screenshot ulang.
- Footer sidebar "MaTive v0.3.0 — Phase 3 (DRAF)" di semua halaman — diperbarui ke v0.9.0 Phase 9 (DRAF); `package.json` 0.1.0 → 0.9.0; `/api/health` kini melaporkan `phase: "9-hardening-launch"` + `version` dari `package.json` (sebelumnya hardcode "1-foundation" / "0.1.0").
- Mitigasi flake hang UI impor CSV (Phase 7, 4× dalam 5 run): `importAnalyticsCsvAction` kini hanya merevalidasi `/analitik/impor` (sebelumnya 3 path sekaligus). Penyebab pasti belum terbukti; pembuktian butuh re-run e2e login.

### Keamanan (review 9.4 — 8 tes Dok 06 §8)

- (1) Cross-tenant UUID guessing: DENY — pgTAP 01 T1, 02 T1b/T1c. (2) Ubah role sendiri: ditolak — tidak ada endpoint ubah role; kebijakan `ws_members_update_owner_admin` (0006) mensyaratkan owner/admin di USING + WITH CHECK. (3) Creator tidak bisa approve tanpa penugasan — pgTAP 04. (4) Viewer tidak bisa mutasi — pgTAP 02 T3b/T3c/T6b. (5) Member dicabut kehilangan akses seketika — pgTAP 01 T6 (DB) + aksi hapus anggota baru (aplikasi). (6) Signed URL aset privat kedaluwarsa 1 jam. (7) Idempotency publishing via `idempotency_key`. (8) Tidak ada secret di bundle browser (verifikasi 9.1).
- Ancaman AI (Dok 09 §5): tidak berlaku selama AI nonaktif — tidak ada data yang dikirim ke model eksternal; verifikasi ulang sebelum aktivasi AI.

### Performa terukur (9.5, localhost, server production)

- Ambang yang dipakai (ASUMSI-9C — kit tidak memberi angka): TTFB hangat < 500 ms per rute; total JS gzip < 600 KB; chunk tunggal gzip < 100 KB.
- Terukur: TTFB hangat 10–35 ms per rute (`/dashboard` 16–33 ms, `/kalender` ~13 ms, `/ai` 11–23 ms, `/analitik` 12–16 ms, `/` 29 ms); total JS gzip ≈ 503 KB; chunk terbesar 72 KB gzip. Semua di bawah ambang.

### Aksesibilitas (9.6 — review statis)

- Tidak ada temuan High: semua `<img>` punya alt; semua tombol punya nama aksesibel (teks atau aria-label); semua input punya label (termasuk label sr-only); focus-visible ada di komponen Button; Dialog punya role + aria-label; alert/status memakai role yang benar. Catatan: belum ada run axe otomatis — review statis saja.

### Diketahui belum selesai / blocker

- pgTAP 08 v1.3 (53 asersi) + e2e login lengkap (termasuk re-run flake impor CSV + hapus anggota) BELUM di-run live — butuh tugas browser + kredensial (dipegang parent).
- Visual QA layar kerja yang butuh login (grid kalender, kanban, editor, antrean approval berisi data) hanya menampilkan login gate saat logged-out — butuh re-run dengan kredensial.
- Backup/restore + rollback BELUM diuji (prosedur tertulis di `docs/RELEASE_RUNBOOK.md`; pengujian butuh akses DB staging — dipegang parent).
- Monitoring masih minimal: endpoint `/api/health` + jejak audit `activity_logs` saja; tidak ada structured logging dan tidak ada layanan alerting (tanpa persetujuan user — ASUMSI-9B).
- Aset tanpa pemindaian virus (batas desain, sejak Phase 3).
- GitHub repo (B5) tetap belum dibuat — CI + deploy Vercel + publish worker menunggu user; status akhir: READY FOR OWNER DEPLOYMENT, bukan DEPLOYED/LIVE.

## [0.8.0] — 2026-11-20 — Phase 8: AI Assistant (DRAF)

### Ditambahkan

- Migrasi `0022_ai_foundation.sql` — fondasi AI: 2 kolom baru `content_versions`, retensi 90 hari, tabel `ai_generations` (log pemakaian AI); migrasi `0023_ai_generations_select_policy_fix.sql` — perbaikan defect nyata: SELECT policy memakai self-lookup `is_ai_generation_visible` sehingga `INSERT ... RETURNING` gagal 42501 dan log AI tidak pernah tersimpan; policy ditulis ulang ke `is_ws_member` langsung.
- Asisten AI (`/ai`): nonaktif — tanpa provider yang dikonfigurasi; seluruh keluaran AI adalah draf sampai disetujui manusia.
- Tes: pgTAP 08 v1.2 52/52 lolos live; e2e Chromium 6/6 + mobile 6/6 (A8.1–A8.5 + smoke); Vitest 241/241; visual QA login `/ai` 9 screenshot.

### Diperbaiki

- Defect 0023 (di atas) — ditemukan e2e, bukan pgTAP: pgTAP tanpa RETURNING tidak bisa menangkapnya. Pelajaran dicatat: pgTAP 08 v1.3 (Phase 9) menambah tes RETURNING.

### Diketahui belum selesai / blocker

- pgTAP 08 tidak mencakup `INSERT ... RETURNING` (ditutup di Phase 9, T3f).
- GitHub repo (B5) tetap belum dibuat.

## [0.7.0] — 2026-11-20 — Phase 7: First Official Integration + Analytics (DRAF)

### Ditambahkan

- Migrasi `0021_analytics_foundation.sql` — fondasi analitik: metrik, impor CSV, laporan.
- Analitik (`/analitik`, `/analitik/laporan`, `/analitik/impor`): dashboard performa, laporan, impor metrik CSV.
- Tes: pgTAP 07 v1.5 77/77 lolos live; e2e Chromium 6 lolos + 1 skip, mobile 6 lolos + 1 skip; Vitest 217/217.

### Diperbaiki

- Defect nyata: kolom query analitik hilang → PostgREST 400 (commit `cbca252`).

### Diketahui belum selesai / blocker

- Flake hang UI impor CSV (4× dalam 5 run): DB ter-commit, tombol tetap disabled + alert kosong > 30 dtk — penyebab belum terbukti; mitigasi di Phase 9.
- GitHub repo (B5) tetap belum dibuat.

## [0.6.0] — 2026-11-20 — Phase 6: Publishing Foundation (DRAF)

### Ditambahkan

- Migrasi `0020_publishing_foundation.sql` — fondasi publishing: antrean job, lease, `idempotency_key`, status manual.
- Publishing (`/publishing`): antrean publikasi manual + konfirmasi terbit; pemrosesan lease-based, max 20 job per run, body tervalidasi Zod.
- Tes: pgTAP 06 v1.1 109/109 lolos live; e2e publishing 6/6.

### Diketahui belum selesai / blocker

- Publish otomatis ke platform (worker) menunggu repo GitHub (B5) + kredensial platform; saat ini hanya publikasi manual.
- GitHub repo (B5) tetap belum dibuat.

## [0.5.0] — 2026-11-20 — Phase 5: Campaign & Visual Planning (DRAF)

### Ditambahkan

- Migrasi `0016_brand_scope.sql` (brand scope per anggota), `0017_visual_planner_templates.sql` (template visual), `0018_set_visual_order_fixes.sql`, `0019_brands_insert_scope_fix.sql` (perbaikan defect: WITH CHECK policy tidak boleh self-lookup ke baris yang disisipkan — pola yang sama dengan defect 0022/0023).
- Campaign & Visual Planning: brand scope anggota, template visual, pengurutan visual.
- Tes: pgTAP 05 v1.2 61/61 lolos live; e2e Chromium 13 lolos + 1 skip, mobile 4/4; Vitest 165/165.

### Diketahui belum selesai / blocker

- GitHub repo (B5) tetap belum dibuat.

## [0.4.0] — 2026-11-19 — Phase 4: Review & Approval (DRAF)

### Ditambahkan

- Migrasi `0013_approval_core.sql` — 4 tabel (approval_workflows, approval_steps, approval_requests, approval_decisions) + 16 policy RLS + 4 helper SECURITY DEFINER + perluasan CHECK `notifications.type` (approval_requested / approval_decided / approval_reapproval_required); pgTAP `04_rls_phase4.sql` (64 asersi, verifier statis 51/51, graf RLS efektif 0001–0014 144 policy 0 siklus).
- Migrasi `0014_approval_transactions.sql` — 6 RPC `SECURITY DEFINER` (workflow default malas, buat request, putuskan request, submit client review, komentar klien, + guard `transition_content_item_status` yang menolak internal_review → approved tanpa request approved — kode `APPROVAL_REQUIRED`) + 5 trigger critical-change (script/caption/cta/asset/channel/format/scheduled_time → `reapproval_required` + notifikasi).
- Kode aplikasi Review & Approval (ADR-0010): domain `features/approval/` (skema Zod, logika transisi murni, queries, server actions) + Approval Center (`/persetujuan` — 5 antrean: menunggu saya / semua tertunda / disetujui / minta revisi / ditolak) + tab "Approval" ke-9 di editor konten + panel review klien di portal (`/portal/[shareId]` — komentar hanya bila workspace mengizinkan, default tidak boleh; komentar klien tidak pernah menjadi keputusan) + API v1 (`GET /api/v1/approvals`, `GET /api/v1/approvals/[id]`, `POST /api/v1/approvals/[id]/decisions`).
- Tes: unit 131/131 (12 file, termasuk `tests/approval.test.ts` 20 tes), Playwright chromium smoke + visual + approval 38 lolos + 2 skip (@needs-db), visual QA 3 screenshot baru (`/persetujuan` × 1440/1024/390).
- Dokumen: ADR-0010, laporan fase 4 (`docs/phase-4-report.md`), `docs/apply-migrations.md` (langkah apply 0013–0014 + pgTAP 04 + e2e Phase 4).

### Diperbaiki

- Keamanan: grant EXECUTE `approval_critical_fields` dan `flag_request_reapproval` ke `authenticated` DIHAPUS (keduanya helper internal — yang pertama membocorkan daftar critical-fields workspace lain, yang kedua bisa memaksa reapproval konten orang lain). Commit `03c1f0a`.
- File tes: pgTAP 04 T10d memakai UUID palsu literal di dalam blok `$$` (tidak akan disubstitusi SQL Editor) — diperbaiki dengan `format($f$...%L...$f$,:'user_b')`. Commit `03c1f0a`.
- Tes smoke pra-Phase 4 ("tombol modul fase berikut") gagal deterministik karena mengharapkan tombol di dalam Dialog "Buat cepat" tanpa membuka dialog — diperbaiki dengan mengklik "Buat cepat" dulu (file tes saja; aplikasi benar).

### Diketahui belum selesai / blocker

- Migrasi 0013 + 0014 BELUM diterapkan ke database live (butuh SQL Editor — dipegang parent). Lihat `docs/phase-4-report.md` §8.
- pgTAP 04 (64 asersi) + spek penerimaan e2e Phase 4 (`e2e/approval.spec.ts`) BELUM bisa lolos live sebelum migrasi diterapkan.
- Visual QA keadaan login (antrean berisi data, tab Approval berisi request, portal klien berisi konten) belum ada screenshot-nya — hanya shell belum-login.
- Separation of duties (submitter ≠ approver) tidak di-enforce di DB (sengaja — ADR-0010); dua peran sejati belum terbukti live sampai akun approver kedua dibuat.
- Playwright WebKit tetap BLOCKED (B4); GitHub repo (B5) tetap belum dibuat — CI + deploy Vercel menunggu user; dashboard KPI memakai workspace pertama; filter kalender/board limit 200 item.
- Prettier: 2 file pra-Phase 4 (`docs/phase-3-report.md`, `e2e/production.spec.ts`) sudah tidak bersih sejak commit Phase 3 — sengaja tidak diformat ulang di fase ini agar diff tidak tercemar.

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
