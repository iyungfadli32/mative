-- MaTive Phase 6 — RLS + RPC publishing foundation (pgTAP) — v1.1
-- v1.0 (2026-11-20): file baru untuk migrasi 0020 v1.1 (publishing_jobs,
-- publishing_attempts, published_posts + 7 RPC + preflight + backoff).
-- v1.1 (2026-11-20): cleanup defensif diurutkan daun → akar — v1.0 gagal
-- Run live 23503 karena brands dihapus sebelum content_items (brand_id
-- ON DELETE RESTRICT); finish() tidak pernah tercapai, 109 asersi tak
-- diketahui hasilnya. BUKAN cacat produk/migrasi — hanya urutan cleanup
-- file tes. Tidak ada perubahan asersi (tetap plan(109)).
-- 109 asersi. Menguji: preflight (blokir + peringatan), create (status +
-- idempotency + snapshot), duplicate + slot bebas sesudah cancel, claim /
-- process (handoff manual + PLACEMENT_CHANGED), confirm (satu-satunya jalan
-- ke Published), cancel (alasan wajib + terminal), retry (transient saja,
-- < 3, backoff 1/5/15), RLS baca (member + brand scope v1.1 + shared),
-- tulis langsung ditolak (42501), CHECK (provider null, status, URL),
-- unik attempts + indeks idempotency partial.
-- ============================================================================
-- CARA MENJALANKAN (oleh koordinator — butuh DATABASE_URL / service role): <redacted>
--   1. Terapkan migrasi 0001–0020 ke database BERSIH (lihat
--      docs/phase-6-report.md §8; urutan: 0016, 0017, 0018, 0019, lalu 0020).
--   2. Aktifkan ekstensi pgTAP di proyek Supabase (Dashboard → Database →
--      Extensions → pgtap), atau jalankan:  create extension if not exists pgtap;
--   3. Buat 2 pengguna auth uji (mis. lewat Dashboard → Authentication →
--      Add user) dan catat UUID-nya; ganti placeholder di bawah.
--      User A = owner Workspace A. User B = manager di Workspace A dengan
--      brand_scope = [Brand A] (TERBATAS), admin di Workspace B (tanpa scope).
--   4. Jalankan:  psql "$DATABASE_URL" -v user_a='<UUID-USER-A>'
--        -v user_b='<UUID-USER-B>' \
--        -f supabase/tests/06_rls_phase6.sql
--   Hasil yang diharapkan: semua tes ok (tidak ada "not ok").
--   DI SQL EDITOR (tanpa psql): hapus kedua baris \\set, ganti setiap :'user_a'
--   dengan literal UUID-A dan setiap :'user_b' dengan literal UUID-B, lalu
--   jalankan seluruh file sebagai satu query (begin ... rollback di akhir
--   membersihkan data uji).
--   PENTING: SQL Editor TIDAK mempertahankan transaksi antar-Run (tiap Run
--   sesi baru) — tempel SELURUH file ke editor lalu Run SEKALI (pelajaran
--   pgTAP 03 v1.0 / 04 v1.4).
--
-- CATATAN: tes ini TIDAK BOLEH dijalankan di database produksi berisi data
-- nyata — hanya database bersih/preview. Tes memakai JWT claims palsu lewat
-- set_config('request.jwt.claims') untuk mensimulasikan tiap pengguna.
--
-- POLA YANG DIIKUTI (pelajaran file 01 v2.2 + 02 v1.2 + 03 v1.4 + 04 v1.4 + 05 v1.2):
--   - Setup sebagai postgres (bypass RLS), baru `set local role authenticated`.
--   - RPC mengembalikan jsonb {ok, code, message} (TIDAK melempar) — asersi
--     memakai is(->>'ok', 'true'/'false') dan is(->>'code', ...), BUKAN
--     throws_ok. throws_ok HANYA untuk exception DB sungguhan (CHECK 23514,
--     unique 23505, privilege 42501).
--   - UPDATE/DELETE di bawah RLS tidak melempar exception: pakai asersi
--     jumlah baris terpengaruh (count(*) ... ::int).
--   - Placeholder :'user_a'/:'user_b' TIDAK BOLEH di dalam string $$...$$ —
--     SQL dinamis dibangun lewat format($f$...$f$, :'user_b').
--   - UUID palsu 1111.../2222... HANYA di dua baris \\set.
--   - Insert baris uji di tengah tes memakai `reset role;` (postgres) lalu
--     `set local role authenticated;` lagi.
--   - Pola throws_ok = pesan galat lengkap (nama constraint terpotong 63
--     byte bila perlu); pola pendek GAGAL walau galatnya benar (pelajaran 05).
-- ============================================================================

begin;
select plan(109);

-- ---------------------------------------------------------------------------
-- Helper: set JWT claims untuk satu pengguna (simulasi auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function _set_user(p_user uuid, p_email text default 'test@example.com')
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email)::text, true);
$$;
create or replace function _as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{}', true);
$$;

-- Pengguna uji (GANTI dengan UUID auth user nyata dari database uji).
\set user_a '11111111-1111-1111-1111-111111111111'
\set user_b '22222222-2222-2222-2222-222222222222'

-- ---------------------------------------------------------------------------
-- Setup: org + workspace + member + brand + channel + item + versi +
-- placement + placement_version + workflow + approval (sebagai postgres,
-- bypass RLS). User B = manager WS-A dengan brand_scope [Brand A]; admin
-- WS-B (tanpa scope). Jadwal memakai Desember 2026 (masa depan).
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, owner_user_id)
values ('a6000000-0000-0000-0000-000000000001', 'Org A6 (sample test)', 'org-a6-test', :'user_a'),
       ('a6000000-0000-0000-0000-000000000002', 'Org B6 (sample test)', 'org-b6-test', :'user_b')
on conflict (slug) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at)
values ('a6000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('a6000000-0000-0000-0000-000000000002', :'user_b', 'owner', 'active', now())
on conflict (organization_id, user_id) do nothing;

insert into public.workspaces (id, organization_id, name, slug, timezone)
values ('b6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'Workspace A6 (sample test)', 'ws-a6-test', 'Asia/Jakarta'),
       ('b6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000002', 'Workspace B6 (sample test)', 'ws-b6-test', 'Asia/Jakarta')
on conflict (organization_id, slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
values ('b6000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('b6000000-0000-0000-0000-000000000001', :'user_b', 'manager', 'active', now()),
       ('b6000000-0000-0000-0000-000000000002', :'user_b', 'admin', 'active', now())
on conflict (workspace_id, user_id) do nothing;

-- B di WS-A dibatasi hanya Brand A (P1-A7).
update public.workspace_members
set brand_scope = '["e6000000-0000-0000-0000-000000000001"]'::jsonb
where workspace_id = 'b6000000-0000-0000-0000-000000000001' and user_id = :'user_b';

insert into public.brands (id, workspace_id, name, slug, status)
values ('e6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'Brand A6 (sample test)', 'brand-a6-test', 'active'),
       ('e6000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000001', 'Brand A2-6 (sample test)', 'brand-a2-6-test', 'active'),
       ('e6000000-0000-0000-0000-000000000003', 'b6000000-0000-0000-0000-000000000002', 'Brand B6 (sample test)', 'brand-b6-test', 'active')
on conflict (workspace_id, slug) do nothing;

insert into public.social_channels (id, brand_id, platform, account_name, connection_status)
values ('e6100000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'instagram', 'Akun A6 (sample test)', 'not_connected'),
       ('e6100000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000002', 'instagram', 'Akun A2-6 (sample test)', 'not_connected'),
       ('e6100000-0000-0000-0000-000000000003', 'e6000000-0000-0000-0000-000000000003', 'instagram', 'Akun B6 (sample test)', 'not_connected'),
       ('e6100000-0000-0000-0000-000000000004', 'e6000000-0000-0000-0000-000000000001', 'instagram', 'Akun A6-2 (sample test)', 'not_connected')
on conflict (id) do nothing;

insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone)
values ('d6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'Item A6-1 (sample test)', 'approved', :'user_a', 'Asia/Jakarta'),
       ('d6000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'Item A6-2 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d6000000-0000-0000-0000-000000000003', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'Item A6-3 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d6000000-0000-0000-0000-000000000004', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000002', 'Item A2-6-1 (sample test)', 'approved', :'user_a', 'Asia/Jakarta'),
       ('d6000000-0000-0000-0000-000000000005', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'Item A6-5 (sample test)', 'approved', :'user_a', 'Asia/Jakarta'),
       ('d6000000-0000-0000-0000-000000000006', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'Item A6-6 (sample test)', 'approved', :'user_a', 'Asia/Jakarta'),
       ('d6000000-0000-0000-0000-000000000007', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'Item A6-7 (sample test)', 'approved', :'user_a', 'Asia/Jakarta'),
       ('d6000000-0000-0000-0000-000000000008', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'Item A6-8 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d6000000-0000-0000-0000-000000000009', 'b6000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000003', 'Item B6-1 (sample test)', 'approved', :'user_b', 'Asia/Jakarta'),
       ('d6000000-0000-0000-0000-000000000010', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'Item A6-9 (sample test)', 'approved', :'user_a', 'Asia/Jakarta'),
       ('d6000000-0000-0000-0000-000000000011', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'Item A6-10 (sample test)', 'approved', :'user_a', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by)
values ('d6100000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 1, 'Skrip v1 A6-1', 'Caption v1 A6-1', 'CTA v1 A6-1', :'user_a'),
       ('d6100000-0000-0000-0000-000000000002', 'd6000000-0000-0000-0000-000000000002', 1, 'Skrip v1 A6-2', 'Caption v1 A6-2', 'CTA v1 A6-2', :'user_a'),
       ('d6100000-0000-0000-0000-000000000003', 'd6000000-0000-0000-0000-000000000003', 1, 'Skrip v1 A6-3', 'Caption v1 A6-3', 'CTA v1 A6-3', :'user_a'),
       ('d6100000-0000-0000-0000-000000000004', 'd6000000-0000-0000-0000-000000000003', 2, 'Skrip v2 A6-3', 'Caption v2 A6-3', 'CTA v2 A6-3', :'user_a'),
       ('d6100000-0000-0000-0000-000000000005', 'd6000000-0000-0000-0000-000000000004', 1, 'Skrip v1 A2-6-1', 'Caption v1 A2-6-1', 'CTA v1 A2-6-1', :'user_a'),
       ('d6100000-0000-0000-0000-000000000006', 'd6000000-0000-0000-0000-000000000005', 1, 'Skrip v1 A6-5', 'Caption v1 A6-5', 'CTA v1 A6-5', :'user_a'),
       ('d6100000-0000-0000-0000-000000000007', 'd6000000-0000-0000-0000-000000000006', 1, 'Skrip v1 A6-6', 'Caption v1 A6-6', 'CTA v1 A6-6', :'user_a'),
       ('d6100000-0000-0000-0000-000000000008', 'd6000000-0000-0000-0000-000000000007', 1, 'Skrip v1 A6-7', 'Caption v1 A6-7', 'CTA v1 A6-7', :'user_a'),
       ('d6100000-0000-0000-0000-000000000009', 'd6000000-0000-0000-0000-000000000008', 1, 'Skrip v1 A6-8', 'Caption v1 A6-8', 'CTA v1 A6-8', :'user_a'),
       ('d6100000-0000-0000-0000-000000000010', 'd6000000-0000-0000-0000-000000000009', 1, 'Skrip v1 B6-1', 'Caption v1 B6-1', 'CTA v1 B6-1', :'user_b'),
       ('d6100000-0000-0000-0000-000000000011', 'd6000000-0000-0000-0000-000000000010', 1, 'Skrip v1 A6-9', 'Caption v1 A6-9', 'CTA v1 A6-9', :'user_a'),
       ('d6100000-0000-0000-0000-000000000012', 'd6000000-0000-0000-0000-000000000011', 1, 'Skrip v1 A6-10', 'Caption v1 A6-10', 'CTA v1 A6-10', :'user_a')
on conflict (content_item_id, version_number) do nothing;

insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone)
values ('c6100000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'e6100000-0000-0000-0000-000000000001', 'reel', '2026-12-01T10:00:00Z', 'draft', 'Asia/Jakarta'),
       ('c6100000-0000-0000-0000-000000000002', 'd6000000-0000-0000-0000-000000000002', 'e6100000-0000-0000-0000-000000000001', 'reel', '2026-12-02T10:00:00Z', 'draft', 'Asia/Jakarta'),
       ('c6100000-0000-0000-0000-000000000003', 'd6000000-0000-0000-0000-000000000003', 'e6100000-0000-0000-0000-000000000001', 'reel', '2026-12-03T10:00:00Z', 'draft', 'Asia/Jakarta'),
       ('c6100000-0000-0000-0000-000000000004', 'd6000000-0000-0000-0000-000000000004', 'e6100000-0000-0000-0000-000000000002', 'reel', '2026-12-04T10:00:00Z', 'draft', 'Asia/Jakarta'),
       ('c6100000-0000-0000-0000-000000000005', 'd6000000-0000-0000-0000-000000000005', 'e6100000-0000-0000-0000-000000000001', 'reel', null, 'draft', 'Asia/Jakarta'),
       ('c6100000-0000-0000-0000-000000000006', 'd6000000-0000-0000-0000-000000000006', 'e6100000-0000-0000-0000-000000000001', 'reel', '2026-12-05T10:00:00Z', 'draft', 'Asia/Jakarta'),
       ('c6100000-0000-0000-0000-000000000007', 'd6000000-0000-0000-0000-000000000007', 'e6100000-0000-0000-0000-000000000001', 'reel', null, 'draft', 'Asia/Jakarta'),
       ('c6100000-0000-0000-0000-000000000008', 'd6000000-0000-0000-0000-000000000008', 'e6100000-0000-0000-0000-000000000001', 'reel', null, 'draft', 'Asia/Jakarta'),
       ('c6100000-0000-0000-0000-000000000009', 'd6000000-0000-0000-0000-000000000009', 'e6100000-0000-0000-0000-000000000003', 'reel', '2026-12-06T10:00:00Z', 'draft', 'Asia/Jakarta'),
       ('c6100000-0000-0000-0000-000000000010', 'd6000000-0000-0000-0000-000000000010', 'e6100000-0000-0000-0000-000000000004', 'reel', null, 'draft', 'Asia/Jakarta'),
       ('c6100000-0000-0000-0000-000000000011', 'd6000000-0000-0000-0000-000000000011', 'e6100000-0000-0000-0000-000000000001', 'reel', '2026-12-07T10:00:00Z', 'draft', 'Asia/Jakarta')
on conflict (id) do nothing;

-- Placement p9 (c61...010) SENGAJA tanpa placement_versions — untuk T16.
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by)
values ('c6200000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000001', 1, '{"platform_format": "reel", "scheduled_at": "2026-12-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c6200000-0000-0000-0000-000000000002', 'c6100000-0000-0000-0000-000000000002', 1, '{"platform_format": "reel", "scheduled_at": "2026-12-02T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c6200000-0000-0000-0000-000000000003', 'c6100000-0000-0000-0000-000000000003', 1, '{"platform_format": "reel", "scheduled_at": "2026-12-03T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c6200000-0000-0000-0000-000000000004', 'c6100000-0000-0000-0000-000000000004', 1, '{"platform_format": "reel", "scheduled_at": "2026-12-04T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c6200000-0000-0000-0000-000000000005', 'c6100000-0000-0000-0000-000000000005', 1, '{"platform_format": "reel", "scheduled_at": null, "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c6200000-0000-0000-0000-000000000006', 'c6100000-0000-0000-0000-000000000006', 1, '{"platform_format": "reel", "scheduled_at": "2026-12-05T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c6200000-0000-0000-0000-000000000007', 'c6100000-0000-0000-0000-000000000007', 1, '{"platform_format": "reel", "scheduled_at": null, "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c6200000-0000-0000-0000-000000000008', 'c6100000-0000-0000-0000-000000000008', 1, '{"platform_format": "reel", "scheduled_at": null, "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c6200000-0000-0000-0000-000000000009', 'c6100000-0000-0000-0000-000000000009', 1, '{"platform_format": "reel", "scheduled_at": "2026-12-06T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_b'),
       ('c6200000-0000-0000-0000-000000000010', 'c6100000-0000-0000-0000-000000000011', 1, '{"platform_format": "reel", "scheduled_at": "2026-12-07T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a')
on conflict (placement_id, version_number) do nothing;

insert into public.approval_workflows (id, workspace_id, name, is_default, created_by)
values ('f6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'Workflow Default', true, :'user_a'),
       ('f6000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000002', 'Workflow Default', true, :'user_b')
on conflict (id) do nothing;

insert into public.approval_steps (id, workflow_id, step_order, step_type, assignee_role, assignee_user_id, required_count)
values ('f6100000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000001', 1, 'sequential', 'approver', null, 1),
       ('f6100000-0000-0000-0000-000000000002', 'f6000000-0000-0000-0000-000000000002', 1, 'sequential', 'approver', null, 1)
on conflict (id) do nothing;

-- Item-3: request approved hanya untuk v1 (basi — terbaru v2). Item-2 dan
-- item-8: TANPA request (APPROVAL_REQUIRED). Sisanya: approved di v1.
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order)
values ('f2600000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'content_item', 'd6000000-0000-0000-0000-000000000001', 'd6100000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000001', 'internal', 'approved', :'user_a', now(), now(), 1),
       ('f2600000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000001', 'content_item', 'd6000000-0000-0000-0000-000000000003', 'd6100000-0000-0000-0000-000000000003', 'f6000000-0000-0000-0000-000000000001', 'internal', 'approved', :'user_a', now(), now(), 1),
       ('f2600000-0000-0000-0000-000000000003', 'b6000000-0000-0000-0000-000000000001', 'content_item', 'd6000000-0000-0000-0000-000000000004', 'd6100000-0000-0000-0000-000000000005', 'f6000000-0000-0000-0000-000000000001', 'internal', 'approved', :'user_a', now(), now(), 1),
       ('f2600000-0000-0000-0000-000000000004', 'b6000000-0000-0000-0000-000000000001', 'content_item', 'd6000000-0000-0000-0000-000000000005', 'd6100000-0000-0000-0000-000000000006', 'f6000000-0000-0000-0000-000000000001', 'internal', 'approved', :'user_a', now(), now(), 1),
       ('f2600000-0000-0000-0000-000000000005', 'b6000000-0000-0000-0000-000000000001', 'content_item', 'd6000000-0000-0000-0000-000000000006', 'd6100000-0000-0000-0000-000000000007', 'f6000000-0000-0000-0000-000000000001', 'internal', 'approved', :'user_a', now(), now(), 1),
       ('f2600000-0000-0000-0000-000000000006', 'b6000000-0000-0000-0000-000000000001', 'content_item', 'd6000000-0000-0000-0000-000000000007', 'd6100000-0000-0000-0000-000000000008', 'f6000000-0000-0000-0000-000000000001', 'internal', 'approved', :'user_a', now(), now(), 1),
       ('f2600000-0000-0000-0000-000000000007', 'b6000000-0000-0000-0000-000000000002', 'content_item', 'd6000000-0000-0000-0000-000000000009', 'd6100000-0000-0000-0000-000000000010', 'f6000000-0000-0000-0000-000000000002', 'internal', 'approved', :'user_b', now(), now(), 1),
       ('f2600000-0000-0000-0000-000000000008', 'b6000000-0000-0000-0000-000000000001', 'content_item', 'd6000000-0000-0000-0000-000000000010', 'd6100000-0000-0000-0000-000000000011', 'f6000000-0000-0000-0000-000000000001', 'internal', 'approved', :'user_a', now(), now(), 1),
       ('f2600000-0000-0000-0000-000000000009', 'b6000000-0000-0000-0000-000000000001', 'content_item', 'd6000000-0000-0000-0000-000000000011', 'd6100000-0000-0000-0000-000000000012', 'f6000000-0000-0000-0000-000000000001', 'internal', 'approved', :'user_a', now(), now(), 1)
on conflict (id) do nothing;

-- Simulasikan peran authenticated untuk semua pemeriksaan RLS di bawah.
set local role authenticated;

-- ============================================================================
-- TES 1 — backoff (ASUMSI-6.3): 1 → 1 mnt, 2 → 5 mnt, 3+ → 15 mnt. (4)
-- ============================================================================
select is(
  public.publishing_backoff_minutes(1),
  1,
  'T1a backoff percobaan ke-1 = 1 menit'
);
select is(
  public.publishing_backoff_minutes(2),
  5,
  'T1b backoff percobaan ke-2 = 5 menit'
);
select is(
  public.publishing_backoff_minutes(3),
  15,
  'T1c backoff percobaan ke-3 = 15 menit'
);
select is(
  public.publishing_backoff_minutes(9),
  15,
  'T1d backoff percobaan ke-9 tetap 15 menit'
);

-- ============================================================================
-- TES 2 — preflight OK (p1, jadwal masa depan): ok + READY + 5 checks. (3)
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000001', '2026-12-01T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'true',
  'T2a preflight p1 lolos'
);
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000001', '2026-12-01T10:00:00Z', 'Asia/Jakarta') ->> 'code'),
  'READY',
  'T2b preflight p1 kode READY'
);
select is(
  jsonb_array_length(public.publishing_preflight('c6100000-0000-0000-0000-000000000001', '2026-12-01T10:00:00Z', 'Asia/Jakarta') -> 'checks'),
  5,
  'T2c preflight p1 mengembalikan 5 checks (timezone, approval, schedule, connection, format)'
);

-- ============================================================================
-- TES 3 — preflight APPROVAL_REQUIRED (p2 tanpa request). (2)
-- ============================================================================
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000002', '2026-12-02T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'false',
  'T3a preflight p2 (tanpa approval) tidak lolos'
);
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000002', '2026-12-02T10:00:00Z', 'Asia/Jakarta') ->> 'code'),
  'APPROVAL_REQUIRED',
  'T3b preflight p2 kode APPROVAL_REQUIRED'
);

-- ============================================================================
-- TES 4 — preflight APPROVAL_STALE (p3: approved hanya v1, terbaru v2). (2)
-- ============================================================================
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000003', '2026-12-03T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'false',
  'T4a preflight p3 (approval basi) tidak lolos'
);
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000003', '2026-12-03T10:00:00Z', 'Asia/Jakarta') ->> 'code'),
  'APPROVAL_STALE',
  'T4b preflight p3 kode APPROVAL_STALE'
);

-- ============================================================================
-- TES 5 — preflight FORBIDDEN scope (B manager scope [Brand A] pada p4
-- Brand A2). (2)
-- ============================================================================
select _set_user(:'user_b');
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000004', '2026-12-04T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'false',
  'T5a preflight p4 (Brand A2, di luar scope B) tidak lolos'
);
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000004', '2026-12-04T10:00:00Z', 'Asia/Jakarta') ->> 'code'),
  'FORBIDDEN',
  'T5b preflight p4 kode FORBIDDEN'
);

-- ============================================================================
-- TES 6 — preflight FORBIDDEN non-member (A bukan member WS-B, pada pB). (2)
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000009', '2026-12-06T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'false',
  'T6a preflight pB (A bukan member WS-B) tidak lolos'
);
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000009', '2026-12-06T10:00:00Z', 'Asia/Jakarta') ->> 'code'),
  'FORBIDDEN',
  'T6b preflight pB kode FORBIDDEN'
);

-- ============================================================================
-- TES 7 — preflight UNAUTHENTICATED (anon). (2)
-- ============================================================================
select _as_anon();
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000001', '2026-12-01T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'false',
  'T7a preflight anon tidak lolos'
);
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000001', '2026-12-01T10:00:00Z', 'Asia/Jakarta') ->> 'code'),
  'UNAUTHENTICATED',
  'T7b preflight anon kode UNAUTHENTICATED'
);

-- ============================================================================
-- TES 8 — preflight NOT_FOUND (placement tidak ada). (2)
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.publishing_preflight('99999999-9999-9999-9999-999999999999', null, null) ->> 'ok'),
  'false',
  'T8a preflight placement tidak ada tidak lolos'
);
select is(
  (public.publishing_preflight('99999999-9999-9999-9999-999999999999', null, null) ->> 'code'),
  'NOT_FOUND',
  'T8b preflight placement tidak ada kode NOT_FOUND'
);

-- ============================================================================
-- TES 9 — preflight TIMEZONE_INVALID. (2)
-- ============================================================================
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000001', '2026-12-01T10:00:00Z', 'Zona/TidakAda') ->> 'ok'),
  'false',
  'T9a preflight zona tidak valid tidak lolos'
);
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000001', '2026-12-01T10:00:00Z', 'Zona/TidakAda') ->> 'code'),
  'TIMEZONE_INVALID',
  'T9b preflight zona tidak valid kode TIMEZONE_INVALID'
);

-- ============================================================================
-- TES 10 — preflight SCHEDULE_PAST. (2)
-- ============================================================================
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000001', '2020-01-01T00:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'false',
  'T10a preflight jadwal lampau tidak lolos'
);
select is(
  (public.publishing_preflight('c6100000-0000-0000-0000-000000000001', '2020-01-01T00:00:00Z', 'Asia/Jakarta') ->> 'code'),
  'SCHEDULE_PAST',
  'T10b preflight jadwal lampau kode SCHEDULE_PAST'
);

-- ============================================================================
-- TES 11 — create job terjadwal (p1): CREATED + scheduled_locally +
-- kunci idempotency + placement ikut terjadwal. (6)
-- ============================================================================
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000001', '2026-12-01T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'true',
  'T11a create job p1 berhasil'
);
select is(
  (select placement_version_id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000001'),
  'c6200000-0000-0000-0000-000000000001',
  'T11b job p1 menyimpan snapshot placement v1 (untuk deteksi PLACEMENT_CHANGED)'
);
select is(
  (select status from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000001'),
  'scheduled_locally',
  'T11c job p1 berstatus scheduled_locally (jadwal masa depan)'
);
select is(
  (select idempotency_key from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000001'),
  'pub:c6100000-0000-0000-0000-000000000001:2026-12-01T10:00:00Z',
  'T11d kunci idempotency p1 = pub:<placement>:<UTC detik> (ASUMSI-6.2)'
);
select is(
  (select distribution_status from public.content_placements where id = 'c6100000-0000-0000-0000-000000000001'),
  'scheduled_locally',
  'T11e placement p1 ikut berstatus scheduled_locally'
);
select is(
  (select timezone from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000001'),
  'Asia/Jakarta',
  'T11f job p1 menyimpan zona placement (ASUMSI-6.6)'
);

-- ============================================================================
-- TES 12 — create duplikat (p1 + waktu sama) ditolak DUPLICATE_JOB. (2)
-- ============================================================================
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000001', '2026-12-01T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'false',
  'T12a create duplikat p1 tidak lolos'
);
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000001', '2026-12-01T10:00:00Z', 'Asia/Jakarta') ->> 'code'),
  'DUPLICATE_JOB',
  'T12b create duplikat p1 kode DUPLICATE_JOB'
);

-- ============================================================================
-- TES 13 — create job segera (p5, tanpa jadwal): CREATED + ready +
-- kunci immediate. (4)
-- ============================================================================
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000005', null, null) ->> 'ok'),
  'true',
  'T13a create job p5 (segera) berhasil'
);
select is(
  (select scheduled_at from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000005'),
  null,
  'T13b job p5 scheduled_at null (segera — bukan jadwal palsu)'
);
select is(
  (select status from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000005'),
  'ready',
  'T13c job p5 berstatus ready (tanpa jadwal)'
);
select is(
  (select idempotency_key from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000005'),
  'pub:c6100000-0000-0000-0000-000000000005:immediate',
  'T13d kunci idempotency p5 memakai immediate (ASUMSI-6.2)'
);

-- ============================================================================
-- TES 14 — create APPROVAL_REQUIRED (p2). (2)
-- ============================================================================
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000002', '2026-12-02T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'false',
  'T14a create p2 (tanpa approval) tidak lolos'
);
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000002', '2026-12-02T10:00:00Z', 'Asia/Jakarta') ->> 'code'),
  'APPROVAL_REQUIRED',
  'T14b create p2 kode APPROVAL_REQUIRED'
);

-- ============================================================================
-- TES 15 — create FORBIDDEN scope (B pada p4 Brand A2). (2)
-- ============================================================================
select _set_user(:'user_b');
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000004', '2026-12-04T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'false',
  'T15a create p4 (Brand A2, di luar scope B) tidak lolos'
);
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000004', '2026-12-04T10:00:00Z', 'Asia/Jakarta') ->> 'code'),
  'FORBIDDEN',
  'T15b create p4 kode FORBIDDEN'
);

-- ============================================================================
-- TES 16 — create PREFLIGHT_FAILED (p9 tanpa placement_versions). (2)
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000010', null, null) ->> 'ok'),
  'false',
  'T16a create p9 (tanpa versi placement) tidak lolos'
);
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000010', null, null) ->> 'code'),
  'PREFLIGHT_FAILED',
  'T16b create p9 kode PREFLIGHT_FAILED'
);

-- ============================================================================
-- TES 17 — claim NO_DUE_JOB (WS-B tanpa job). (3)
-- ============================================================================
select _set_user(:'user_b');
select is(
  (public.claim_publishing_job('b6000000-0000-0000-0000-000000000002', null) ->> 'ok'),
  'true',
  'T17a claim WS-B (tanpa job) mengembalikan ok'
);
select is(
  (public.claim_publishing_job('b6000000-0000-0000-0000-000000000002', null) ->> 'code'),
  'NO_DUE_JOB',
  'T17b claim WS-B kode NO_DUE_JOB'
);
select is(
  (public.claim_publishing_job('b6000000-0000-0000-0000-000000000002', null) ->> 'job_id'),
  null,
  'T17c claim WS-B job_id null (bukan galat)'
);

-- ============================================================================
-- TES 18 — process job segera (p5): handoff manual, bukan failed. (6)
-- Job p1 (terjadwal Desember) TIDAK jatuh tempo — processed tepat 1.
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.process_publishing_jobs('b6000000-0000-0000-0000-000000000001', null) ->> 'processed'),
  '1',
  'T18a process pertama WS-A memproses 1 job (p5 yang segera)'
);
select is(
  (public.process_publishing_jobs('b6000000-0000-0000-0000-000000000001', null) ->> 'processed'),
  '0',
  'T18b process kedua WS-A memproses 0 job (p5 sudah handoff, p1 belum jatuh tempo)'
);
select is(
  (select status from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000005'),
  'needs_manual_action',
  'T18c job p5 sesudah process berstatus needs_manual_action (handoff manual)'
);
select is(
  (select count(*) from public.publishing_attempts where publishing_job_id = (select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000005') and result_status = 'handoff_manual')::int,
  1,
  'T18d job p5 punya 1 attempt handoff_manual'
);
select is(
  (select distribution_status from public.content_placements where id = 'c6100000-0000-0000-0000-000000000005'),
  'needs_manual_action',
  'T18e placement p5 ikut berstatus needs_manual_action'
);
select is(
  (select attempt_count from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000005'),
  1,
  'T18f attempt_count job p5 = 1 sesudah handoff'
);

-- ============================================================================
-- TES 19 — PLACEMENT_CHANGED: job dibuat (snapshot v1), placement diedit
-- (v2), lalu process menolak ke needs_manual_action. (4)
-- ============================================================================
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000006', '2026-12-05T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'true',
  'T19a create job p6 berhasil'
);
-- Placement diedit sesudah job dibuat (versi baru v2) — sebagai postgres.
reset role;
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by)
values ('c6200000-0000-0000-0000-000000000011', 'c6100000-0000-0000-0000-000000000006', 2, '{"platform_format": "reel", "scheduled_at": "2026-12-05T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a')
on conflict (placement_id, version_number) do nothing;
set local role authenticated;
select _set_user(:'user_a');
select is(
  (public.process_publishing_jobs('b6000000-0000-0000-0000-000000000001', (select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000006')) ->> 'ok'),
  'true',
  'T19b process satu job p6 berhasil'
);
select is(
  (select status from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000006'),
  'needs_manual_action',
  'T19c job p6 sesudah edit placement berstatus needs_manual_action'
);
select is(
  (select error_code from public.publishing_attempts where publishing_job_id = (select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000006') order by attempt_number desc limit 1),
  'PLACEMENT_CHANGED',
  'T19d attempt terakhir p6 berkode PLACEMENT_CHANGED'
);

-- ============================================================================
-- TES 20 — confirm manual (p5): satu-satunya jalan ke Published. (6)
-- ============================================================================
select is(
  (public.confirm_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000005'), 'https://www.instagram.com/p/abc123/', now()) ->> 'ok'),
  'true',
  'T20a confirm p5 berhasil'
);
select is(
  (select confirmation_source from public.published_posts where placement_id = 'c6100000-0000-0000-0000-000000000005'),
  'manual_user_confirmation',
  'T20b published_posts p5 confirmation_source = manual_user_confirmation (satu-satunya sumber di Phase 6)'
);
select is(
  (select status from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000005'),
  'published',
  'T20c job p5 berstatus published sesudah konfirmasi manual'
);
select is(
  (select count(*) from public.published_posts where placement_id = 'c6100000-0000-0000-0000-000000000005')::int,
  1,
  'T20d satu baris published_posts tercatat untuk p5'
);
select is(
  (select canonical_url from public.published_posts where placement_id = 'c6100000-0000-0000-0000-000000000005'),
  'https://www.instagram.com/p/abc123/',
  'T20e published_posts p5 menyimpan URL yang dikonfirmasi'
);
select is(
  (select published_url from public.content_placements where id = 'c6100000-0000-0000-0000-000000000005'),
  'https://www.instagram.com/p/abc123/',
  'T20f placement p5 ikut menyimpan published_url'
);

-- ============================================================================
-- TES 21 — confirm job published ditolak INVALID_STATE_TRANSITION. (2)
-- ============================================================================
select is(
  (public.confirm_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000005'), 'https://www.instagram.com/p/abc123/', now()) ->> 'ok'),
  'false',
  'T21a confirm ulang p5 (sudah published) tidak lolos'
);
select is(
  (public.confirm_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000005'), 'https://www.instagram.com/p/abc123/', now()) ->> 'code'),
  'INVALID_STATE_TRANSITION',
  'T21b confirm ulang p5 kode INVALID_STATE_TRANSITION'
);

-- ============================================================================
-- TES 22 — confirm INVALID_URL (p6, masih needs_manual_action). (2)
-- ============================================================================
select is(
  (public.confirm_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000006'), 'bukan-url', now()) ->> 'ok'),
  'false',
  'T22a confirm p6 dengan URL bukan-URL tidak lolos'
);
select is(
  (public.confirm_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000006'), 'bukan-url', now()) ->> 'code'),
  'INVALID_URL',
  'T22b confirm p6 kode INVALID_URL'
);

-- ============================================================================
-- TES 23 — confirm INVALID_PUBLISHED_AT (waktu di masa depan). (2)
-- ============================================================================
select is(
  (public.confirm_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000006'), 'https://www.instagram.com/p/def456/', now() + interval '1 hour') ->> 'ok'),
  'false',
  'T23a confirm p6 dengan waktu masa depan tidak lolos'
);
select is(
  (public.confirm_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000006'), 'https://www.instagram.com/p/def456/', now() + interval '1 hour') ->> 'code'),
  'INVALID_PUBLISHED_AT',
  'T23b confirm p6 kode INVALID_PUBLISHED_AT'
);

-- ============================================================================
-- TES 24 — confirm p6 dengan data benar → PUBLISHED. (2)
-- ============================================================================
select is(
  (public.confirm_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000006'), 'https://www.instagram.com/p/def456/', now()) ->> 'ok'),
  'true',
  'T24a confirm p6 dengan data benar berhasil'
);
select is(
  (public.confirm_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000006'), 'https://www.instagram.com/p/def456/', now()) ->> 'code'),
  'INVALID_STATE_TRANSITION',
  'T24b confirm ulang p6 ditolak — bukti confirm T24a sudah membuat job published'
);

-- ============================================================================
-- TES 25 — cancel (p10): CANCELLED + placement cancelled + alasan tercatat. (6)
-- ============================================================================
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000011', '2026-12-07T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'true',
  'T25a create job p10 berhasil'
);
select is(
  (public.cancel_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011'), 'Dibatalkan untuk tes.') ->> 'ok'),
  'true',
  'T25b cancel job p10 berhasil'
);
select is(
  (select attempt_count from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011'),
  1,
  'T25c attempt_count job p10 = 1 sesudah cancel'
);
select is(
  (select status from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011'),
  'cancelled',
  'T25d job p10 berstatus cancelled'
);
select is(
  (select distribution_status from public.content_placements where id = 'c6100000-0000-0000-0000-000000000011'),
  'cancelled',
  'T25e placement p10 ikut berstatus cancelled'
);
select is(
  (select error_message_safe from public.publishing_attempts where publishing_job_id = (select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011') and result_status = 'cancelled'),
  'Dibatalkan untuk tes.',
  'T25f attempt cancelled p10 mencatat alasan pembatalan'
);

-- ============================================================================
-- TES 26 — cancel job cancelled ditolak INVALID_STATE_TRANSITION. (2)
-- ============================================================================
select is(
  (public.cancel_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011'), 'Dibatalkan lagi.') ->> 'ok'),
  'false',
  'T26a cancel ulang p10 (sudah cancelled) tidak lolos'
);
select is(
  (public.cancel_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011'), 'Dibatalkan lagi.') ->> 'code'),
  'INVALID_STATE_TRANSITION',
  'T26b cancel ulang p10 kode INVALID_STATE_TRANSITION'
);

-- ============================================================================
-- TES 27 — slot bebas sesudah cancel (buat ulang waktu sama) + alasan
-- kosong ditolak INVALID_REASON. (3)
-- ============================================================================
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000011', '2026-12-07T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'true',
  'T27a create ulang p10 pada waktu sama berhasil — slot bebas sesudah cancel (ASUMSI-6.2)'
);
select is(
  (public.cancel_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011' and status <> 'cancelled'), '') ->> 'ok'),
  'false',
  'T27b cancel job p10 tanpa alasan tidak lolos'
);
select is(
  (public.cancel_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011' and status <> 'cancelled'), '') ->> 'code'),
  'INVALID_REASON',
  'T27c cancel tanpa alasan kode INVALID_REASON'
);

-- ============================================================================
-- TES 28 — retry transient (p7): RETRY_SCHEDULED + ready + backoff 5 mnt
-- (1 kegagalan → percobaan ke-2) + attempt retry_scheduled. (7)
-- ============================================================================
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000007', null, null) ->> 'ok'),
  'true',
  'T28a create job p7 (segera) berhasil'
);
-- Paksa job gagal transient (simulasi galat worker) — sebagai postgres.
reset role;
update public.publishing_jobs set status = 'failed', updated_at = now() where placement_id = 'c6100000-0000-0000-0000-000000000007';
insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_code, error_message_safe, started_at, completed_at)
values ((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000007'), 1, 'failed', 'TRANSIENT_ERROR', 'Galat transient simulasi.', now(), now());
set local role authenticated;
select _set_user(:'user_a');
select is(
  (public.retry_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000007')) ->> 'ok'),
  'true',
  'T28b retry job p7 (failed transient) berhasil'
);
select is(
  (select lease_until from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000007'),
  null,
  'T28c lease job p7 dibersihkan sesudah retry'
);
select is(
  (select status from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000007'),
  'ready',
  'T28d job p7 sesudah retry berstatus ready'
);
select is(
  (select next_attempt_at > now() + interval '4 minutes' and next_attempt_at <= now() + interval '6 minutes' from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000007'),
  true,
  'T28e next_attempt_at p7 = now + 5 menit (backoff percobaan ke-2)'
);
select is(
  (select count(*) from public.publishing_attempts where publishing_job_id = (select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000007') and result_status = 'retry_scheduled')::int,
  1,
  'T28f job p7 punya 1 attempt retry_scheduled'
);
select is(
  (select attempt_count from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000007'),
  1,
  'T28g attempt_count job p7 = 1 sesudah retry'
);

-- ============================================================================
-- TES 29 — retry dari ready ditolak INVALID_STATE_TRANSITION. (2)
-- ============================================================================
select is(
  (public.retry_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000007')) ->> 'ok'),
  'false',
  'T29a retry job p7 (sudah ready) tidak lolos'
);
select is(
  (public.retry_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000007')) ->> 'code'),
  'INVALID_STATE_TRANSITION',
  'T29b retry job p7 kode INVALID_STATE_TRANSITION'
);

-- ============================================================================
-- TES 30 — retry galat non-transient ditolak (p7, galat terakhir
-- PREFLIGHT_FAILED). (2)
-- ============================================================================
reset role;
update public.publishing_jobs set status = 'failed', updated_at = now() where placement_id = 'c6100000-0000-0000-0000-000000000007';
insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_code, error_message_safe, started_at, completed_at)
values ((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000007'), 3, 'failed', 'PREFLIGHT_FAILED', 'Preflight gagal simulasi.', now(), now());
set local role authenticated;
select _set_user(:'user_a');
select is(
  (public.retry_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000007')) ->> 'ok'),
  'false',
  'T30a retry job p7 (galat terakhir bukan transient) tidak lolos'
);
select is(
  (public.retry_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000007')) ->> 'code'),
  'INVALID_STATE_TRANSITION',
  'T30b retry job p7 kode INVALID_STATE_TRANSITION'
);

-- ============================================================================
-- TES 31 — retry batas 3 kegagalan (p10 job kedua, 3x failed transient). (2)
-- ============================================================================
reset role;
update public.publishing_jobs set status = 'failed', updated_at = now() where placement_id = 'c6100000-0000-0000-0000-000000000011' and status <> 'cancelled';
insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_code, error_message_safe, started_at, completed_at)
values ((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011' and status = 'failed'), 1, 'failed', 'TRANSIENT_ERROR', 'Galat transient simulasi 1.', now(), now()),
       ((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011' and status = 'failed'), 2, 'failed', 'TRANSIENT_ERROR', 'Galat transient simulasi 2.', now(), now()),
       ((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011' and status = 'failed'), 3, 'failed', 'TRANSIENT_ERROR', 'Galat transient simulasi 3.', now(), now());
set local role authenticated;
select _set_user(:'user_a');
select is(
  (public.retry_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011' and status = 'failed')) ->> 'ok'),
  'false',
  'T31a retry job p10 (3 kegagalan) tidak lolos'
);
select is(
  (public.retry_publishing_job((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000011' and status = 'failed')) ->> 'code'),
  'INVALID_STATE_TRANSITION',
  'T31b retry job p10 kode INVALID_STATE_TRANSITION'
);

-- ============================================================================
-- TES 32 — RLS baca scope (0020 v1.1): B (scope [Brand A]) tidak melihat
-- job/attempt brand lain; A melihat semua. (6)
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.create_publishing_job('c6100000-0000-0000-0000-000000000004', '2026-12-04T10:00:00Z', 'Asia/Jakarta') ->> 'ok'),
  'true',
  'T32a create job p4 (Brand A2, oleh A) berhasil'
);
select _set_user(:'user_b');
select is(
  (select count(*) from public.publishing_jobs where workspace_id = 'b6000000-0000-0000-0000-000000000001')::int,
  6,
  'T32b B hanya melihat 6 dari 7 job WS-A (job p4 Brand A2 tersembunyi)'
);
select _set_user(:'user_a');
select is(
  (select count(*) from public.publishing_jobs where workspace_id = 'b6000000-0000-0000-0000-000000000001')::int,
  7,
  'T32c A (scope NULL) melihat 7 job WS-A'
);
select _set_user(:'user_b');
select is_empty(
  $$ select 1 from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000004' $$,
  'T32d B tidak bisa membaca job p4 meski menebak placement_id'
);
select _set_user(:'user_a');
select isnt_empty(
  $$ select 1 from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000004' $$,
  'T32e A bisa membaca job p4'
);
select _set_user(:'user_b');
select is(
  (select count(*) from public.publishing_attempts where publishing_job_id = (select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000005'))::int,
  2,
  'T32f B melihat 2 attempt job p5 (Brand A, dalam scope)'
);

-- ============================================================================
-- TES 33 — tulis langsung ke 3 tabel ditolak 42501 (grant select saja;
-- tulis hanya lewat RPC). (3)
-- ============================================================================
select _set_user(:'user_a');
select throws_ok(
  $$ insert into public.publishing_jobs (workspace_id, placement_id, idempotency_key) values ('b6000000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002', 'pub:langsung') $$,
  '42501',
  'permission denied for table publishing_jobs',
  'T33a INSERT langsung ke publishing_jobs ditolak 42501'
);
select throws_ok(
  $$ insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status) select id, 1, 'failed' from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000001' limit 1 $$,
  '42501',
  'permission denied for table publishing_attempts',
  'T33b INSERT langsung ke publishing_attempts ditolak 42501'
);
select throws_ok(
  $$ insert into public.published_posts (workspace_id, placement_id, canonical_url, published_at) values ('b6000000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002', 'https://example.com/p/1', now()) $$,
  '42501',
  'permission denied for table published_posts',
  'T33c INSERT langsung ke published_posts ditolak 42501'
);

-- ============================================================================
-- TES 34 — CHECK: provider selalu null, status valid, remote_post_id null.
-- (5) — sebagai postgres (CHECK berlaku untuk semua peran).
-- ============================================================================
reset role;
select throws_ok(
  $$ insert into public.publishing_jobs (workspace_id, placement_id, idempotency_key, provider_job_id) values ('b6000000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002', 'pub:check1', 'job-123') $$,
  '23514',
  'new row for relation "publishing_jobs" violates check constraint "publishing_jobs_provider_job_id_null_check"',
  'T34a provider_job_id tidak boleh diisi (ASUMSI-6.4)'
);
select throws_ok(
  $$ insert into public.publishing_jobs (workspace_id, placement_id, status, idempotency_key) values ('b6000000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002', 'bogus', 'pub:check2') $$,
  '23514',
  'new row for relation "publishing_jobs" violates check constraint "publishing_jobs_status_check"',
  'T34b status job harus salah satu dari 7 label (uploaded_or_draft_created + draft tidak bisa ditulis job)'
);
select throws_ok(
  $$ insert into public.published_posts (workspace_id, placement_id, provider_post_id, canonical_url, published_at) values ('b6000000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002', 'post-1', 'https://example.com/p/1', now()) $$,
  '23514',
  'new row for relation "published_posts" violates check constraint "published_posts_provider_post_id_null_check"',
  'T34c provider_post_id tidak boleh diisi (ASUMSI-6.4)'
);
select throws_ok(
  $$ insert into public.published_posts (workspace_id, placement_id, confirmation_source, canonical_url, published_at) values ('b6000000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002', 'provider', 'https://example.com/p/1', now()) $$,
  '23514',
  'new row for relation "published_posts" violates check constraint "published_posts_confirmation_source_check"',
  'T34d confirmation_source hanya manual_user_confirmation di Phase 6'
);
select throws_ok(
  $$ update public.content_placements set remote_post_id = 'x' where id = 'c6100000-0000-0000-0000-000000000002' $$,
  '23514',
  'new row for relation "content_placements" violates check constraint "content_placements_remote_post_id_null_check"',
  'T34e remote_post_id tetap null (belum ada provider)'
);

-- ============================================================================
-- TES 35 — unik attempts (job, attempt_number). (1)
-- ============================================================================
select throws_ok(
  $$ insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status) values ((select id from public.publishing_jobs where placement_id = 'c6100000-0000-0000-0000-000000000005'), 1, 'failed') $$,
  '23505',
  'duplicate key value violates unique constraint "publishing_attempts_publishing_job_id_attempt_number_key"',
  'T35a attempt_number ganda untuk job yang sama ditolak'
);

-- ============================================================================
-- TES 36 — indeks idempotency partial: duplikat aktif ditolak, slot
-- cancelled bebas. (2)
-- ============================================================================
select throws_ok(
  $$ insert into public.publishing_jobs (workspace_id, placement_id, scheduled_at, status, idempotency_key) values ('b6000000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000001', '2026-12-01T10:00:00Z', 'ready', 'pub:c6100000-0000-0000-0000-000000000001:2026-12-01T10:00:00Z') $$,
  '23505',
  'duplicate key value violates unique constraint "idx_publishing_jobs_idempotency_active"',
  'T36a job aktif kedua untuk placement + waktu sama ditolak indeks partial'
);
insert into public.publishing_jobs (workspace_id, placement_id, scheduled_at, status, idempotency_key)
values ('b6000000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002', '2026-12-09T10:00:00Z', 'cancelled', 'pub:c6100000-0000-0000-0000-000000000002:2026-12-09T10:00:00Z');
select lives_ok(
  $$ insert into public.publishing_jobs (workspace_id, placement_id, scheduled_at, status, idempotency_key) values ('b6000000-0000-0000-0000-000000000001', 'c6100000-0000-0000-0000-000000000002', '2026-12-09T10:00:00Z', 'ready', 'pub:c6100000-0000-0000-0000-000000000002:2026-12-09T10:00:00Z') $$,
  'T36b job baru pada slot yang hanya berisi job cancelled berhasil (indeks partial)'
);

-- ---------------------------------------------------------------------------
-- Cleanup defensif (rollback di akhir membersihkan semuanya; delete di sini
-- hanya pengaman bila file dijalankan tanpa transaksi).
-- Urutan WAJIB daun → akar (v1.1): brands TIDAK BOLEH dihapus sebelum
-- content_items (brand_id ON DELETE RESTRICT — v1.0 gagal 23503 di sini).
-- ---------------------------------------------------------------------------
delete from public.published_posts where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002');
delete from public.publishing_attempts where publishing_job_id in
  (select id from public.publishing_jobs where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002'));
delete from public.publishing_jobs where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002');
delete from public.placement_versions where placement_id in
  (select id from public.content_placements where content_item_id in
  (select id from public.content_items where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002')));
delete from public.content_placements where content_item_id in
  (select id from public.content_items where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002'));
delete from public.approval_requests where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002');
delete from public.approval_steps where workflow_id in
  (select id from public.approval_workflows where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002'));
delete from public.approval_workflows where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002');
delete from public.content_versions where content_item_id in
  (select id from public.content_items where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002'));
delete from public.content_items where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002');
delete from public.social_channels where brand_id in
  (select id from public.brands where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002'));
delete from public.brands where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002');
update public.brief_templates set is_default = false where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002');
delete from public.brief_templates where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002');
delete from public.workspace_settings where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002');
delete from public.workspace_members where workspace_id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002');
delete from public.workspaces where id in
  ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002');
delete from public.organization_members where organization_id in
  ('a6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002');
delete from public.organizations where id in
  ('a6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002');
drop function if exists _set_user(uuid, text);
drop function if exists _as_anon();

select * from finish();
rollback;
