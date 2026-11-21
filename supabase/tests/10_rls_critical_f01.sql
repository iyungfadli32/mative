-- MaTive — Gerbang client_review di publishing (pgTAP) — v1.0
-- File tes untuk migrasi 0025 (perbaikan temuan audit Kritis (d) F-01).
-- 51 asersi. Menguji: gerbang client aktif + klien menolak → preflight
-- MEMBLOKIR pembuatan job (CLIENT_REJECTED); gerbang aktif + klien
-- menyetujui + internal menyetujui → preflight LOLOS (READY) + job
-- dibuat; gerbang nonaktif → perilaku lama (tidak diblokir); putusan
-- changes_requested/rejected atas request client mengembalikan produksi
-- ke 'changes_requested' (transisi legal; BUKAN 'editing'); client
-- masih in_review → CLIENT_APPROVAL_REQUIRED; process_publishing_jobs
-- ikut menegakkan gerbang (preflight ulang); regresi internal
-- (changes_requested internal → editing, preflight APPROVAL_REQUIRED);
-- CHECK enum approval_decisions (throws_ok).
-- ============================================================================
-- CARA MENJALANKAN (oleh koordinator — butuh DATABASE_URL / service role):
--   1. Terapkan migrasi 0001–0025 ke database BERSIH (0025 menimpa
--      publishing_preflight + decide_approval_request).
--   2. Aktifkan ekstensi pgTAP di proyek Supabase (Dashboard → Database →
--      Extensions → pgtap), atau jalankan:  create extension if not exists pgtap;
--   3. Buat 2 pengguna auth uji (mis. lewat Dashboard → Authentication →
--      Add user) dan catat UUID-nya; ganti placeholder di bawah.
--      User A = owner Workspace A9 + Workspace B9 (submitter + pembuat job).
--      User B = approver di Workspace A9 + Workspace B9 (pemutus).
--   4. Jalankan:  psql "$DATABASE_URL" -v user_a='<UUID-USER-A>'
--        -v user_b='<UUID-USER-B>' \
--        -f supabase/tests/10_rls_critical_f01.sql
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
-- POLA YANG DIIKUTI (pelajaran file 06 v1.0 + 08 v1.3):
--   - Setup sebagai postgres (bypass RLS), baru `set local role authenticated`.
--   - RPC mengembalikan jsonb {ok, code, message} (TIDAK melempar) — asersi
--     memakai is(->>'ok', 'true'/'false') dan is(->>'code', ...), BUKAN
--     throws_ok. throws_ok HANYA untuk exception DB sungguhan (CHECK 23514).
--   - RPC yang menyisipkan TIDAK BOLEH dipanggil dua kali untuk membaca
--     hasilnya: panggilan kedua menyisipkan baris/request baru — id request
--     dibaca dari tabel lewat subquery (bukan panggilan RPC kedua).
--     Pengecualian: publishing_preflight STABLE (baca saja) dan
--     create_publishing_job yang DIBLOKIR preflight (kembali sebelum
--     INSERT) aman dipanggil dua kali untuk membaca ok + code (T2g/T2h,
--     T2i/T2j, T3e/T3f, T4c/T4d).
--   - Placeholder :'user_a'/:'user_b' TIDAK BOLEH di dalam string $$...$$ —
--     SQL dinamis dibangun lewat format($f$...$f$, :'user_a').
--   - UUID palsu 1111.../2222... HANYA di dua baris \\set; UUID fixture
--     keluarga 9 (a9/b9/c9/d9/e9/f9) BELUM dipakai file tes 01–08.
--   - Ganti pengguna eksplisit sebelum tiap blok (_set_user): preflight /
--     create job HANYA boleh peran owner/admin/manager/strategist — B
--     (approver) mendapat FORBIDDEN bila memanggilnya.
--   - Asersi hitungan HARUS di-cast ::int (count mengembalikan bigint).
--   - Cleanup defensif HARUS berjalan sebagai postgres: tegaskan `reset
--     role;` sebelum blok cleanup (pelajaran 39, pgTAP 07 Run 5 v1.3).
--   - Cleanup defensif diurutkan daun → akar (pelajaran 06 v1.0: brands
--     TIDAK BOLEH dihapus sebelum content_items — RESTRICT).
--   - INSERT telanjang yang melanggar RLS WITH CHECK melempar 42501 dan
--     meng-abort SELURUH transaksi — tes ini TIDAK memakai insert telanjang
--     yang harus ditolak; semua penolakan dibuktikan lewat kode jsonb RPC.
-- ============================================================================

begin;
select plan(51);

-- ---------------------------------------------------------------------------
-- Helper: set JWT claims untuk satu pengguna (simulasi auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function _set_user(p_user uuid, p_email text default 'test@example.com')
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email)::text, true);
$$;

-- Pengguna uji (GANTI dengan UUID auth user nyata dari database uji).
\set user_a '11111111-1111-1111-1111-111111111111'
\set user_b '22222222-2222-2222-2222-222222222222'

-- ---------------------------------------------------------------------------
-- Setup: org + workspace + member + brand + channel + item v1 + placement
-- + placement_versions + workflow default (sebagai postgres, bypass RLS).
-- WS-A9: gerbang client AKTIF. WS-B9: gerbang MATI (tanpa baris setting).
-- User A = owner kedua workspace. User B = approver kedua workspace.
-- Item A1–A5 di WS-A9; item B1–B2 di WS-B9. Semua item mulai 'editing'.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, owner_user_id)
values ('a9000000-0000-0000-0000-000000000001', 'Org A9 (sample test)', 'org-a9-test', :'user_a'),
       ('a9000000-0000-0000-0000-000000000002', 'Org B9 (sample test)', 'org-b9-test', :'user_b')
on conflict (slug) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at)
values ('a9000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('a9000000-0000-0000-0000-000000000002', :'user_b', 'owner', 'active', now())
on conflict (organization_id, user_id) do nothing;

insert into public.workspaces (id, organization_id, name, slug, timezone)
values ('b9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 'Workspace A9 (sample test)', 'ws-a9-test', 'Asia/Jakarta'),
       ('b9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000002', 'Workspace B9 (sample test)', 'ws-b9-test', 'Asia/Jakarta')
on conflict (organization_id, slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
values ('b9000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('b9000000-0000-0000-0000-000000000001', :'user_b', 'approver', 'active', now()),
       ('b9000000-0000-0000-0000-000000000002', :'user_a', 'owner', 'active', now()),
       ('b9000000-0000-0000-0000-000000000002', :'user_b', 'approver', 'active', now())
on conflict (workspace_id, user_id) do nothing;

-- Gerbang client AKTIF hanya di WS-A9 (WS-B9 tanpa baris = default mati).
insert into public.workspace_settings (workspace_id, key, value_json)
values ('b9000000-0000-0000-0000-000000000001', 'approval.client_review_enabled', '{"enabled": true}'::jsonb)
on conflict (workspace_id, key) do nothing;

insert into public.brands (id, workspace_id, name, slug, status)
values ('e9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'Brand A9 (sample test)', 'brand-a9-test', 'active'),
       ('e9000000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000002', 'Brand B9 (sample test)', 'brand-b9-test', 'active')
on conflict (workspace_id, slug) do nothing;

insert into public.social_channels (id, brand_id, platform, account_name, connection_status)
values ('e9100000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'instagram', 'Akun A9 (sample test)', 'not_connected'),
       ('e9100000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000002', 'instagram', 'Akun B9 (sample test)', 'not_connected')
on conflict (id) do nothing;

insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone)
values ('d9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'Item A9-1 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d9000000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'Item A9-2 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d9000000-0000-0000-0000-000000000003', 'b9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'Item A9-3 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d9000000-0000-0000-0000-000000000004', 'b9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'Item A9-4 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d9000000-0000-0000-0000-000000000005', 'b9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'Item A9-5 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d9000000-0000-0000-0000-000000000006', 'b9000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000002', 'Item B9-1 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d9000000-0000-0000-0000-000000000007', 'b9000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-000000000002', 'Item B9-2 (sample test)', 'editing', :'user_a', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by)
values ('d9100000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000001', 1, 'Skrip v1 A9-1', 'Caption v1 A9-1', 'CTA v1 A9-1', :'user_a'),
       ('d9100000-0000-0000-0000-000000000002', 'd9000000-0000-0000-0000-000000000002', 1, 'Skrip v1 A9-2', 'Caption v1 A9-2', 'CTA v1 A9-2', :'user_a'),
       ('d9100000-0000-0000-0000-000000000003', 'd9000000-0000-0000-0000-000000000003', 1, 'Skrip v1 A9-3', 'Caption v1 A9-3', 'CTA v1 A9-3', :'user_a'),
       ('d9100000-0000-0000-0000-000000000004', 'd9000000-0000-0000-0000-000000000004', 1, 'Skrip v1 A9-4', 'Caption v1 A9-4', 'CTA v1 A9-4', :'user_a'),
       ('d9100000-0000-0000-0000-000000000005', 'd9000000-0000-0000-0000-000000000005', 1, 'Skrip v1 A9-5', 'Caption v1 A9-5', 'CTA v1 A9-5', :'user_a'),
       ('d9100000-0000-0000-0000-000000000006', 'd9000000-0000-0000-0000-000000000006', 1, 'Skrip v1 B9-1', 'Caption v1 B9-1', 'CTA v1 B9-1', :'user_a'),
       ('d9100000-0000-0000-0000-000000000007', 'd9000000-0000-0000-0000-000000000007', 1, 'Skrip v1 B9-2', 'Caption v1 B9-2', 'CTA v1 B9-2', :'user_a')
on conflict (content_item_id, version_number) do nothing;

insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone)
values ('c9100000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000001', 'e9100000-0000-0000-0000-000000000001', 'reel', null, 'draft', 'Asia/Jakarta'),
       ('c9100000-0000-0000-0000-000000000002', 'd9000000-0000-0000-0000-000000000002', 'e9100000-0000-0000-0000-000000000001', 'reel', null, 'draft', 'Asia/Jakarta'),
       ('c9100000-0000-0000-0000-000000000003', 'd9000000-0000-0000-0000-000000000003', 'e9100000-0000-0000-0000-000000000001', 'reel', null, 'draft', 'Asia/Jakarta'),
       ('c9100000-0000-0000-0000-000000000004', 'd9000000-0000-0000-0000-000000000004', 'e9100000-0000-0000-0000-000000000001', 'reel', null, 'draft', 'Asia/Jakarta'),
       ('c9100000-0000-0000-0000-000000000005', 'd9000000-0000-0000-0000-000000000005', 'e9100000-0000-0000-0000-000000000001', 'reel', null, 'draft', 'Asia/Jakarta'),
       ('c9100000-0000-0000-0000-000000000006', 'd9000000-0000-0000-0000-000000000006', 'e9100000-0000-0000-0000-000000000002', 'reel', null, 'draft', 'Asia/Jakarta'),
       ('c9100000-0000-0000-0000-000000000007', 'd9000000-0000-0000-0000-000000000007', 'e9100000-0000-0000-0000-000000000002', 'reel', null, 'draft', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by)
values ('c9200000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-000000000001', 1, '{"platform_format": "reel", "scheduled_at": null, "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c9200000-0000-0000-0000-000000000002', 'c9100000-0000-0000-0000-000000000002', 1, '{"platform_format": "reel", "scheduled_at": null, "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c9200000-0000-0000-0000-000000000003', 'c9100000-0000-0000-0000-000000000003', 1, '{"platform_format": "reel", "scheduled_at": null, "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c9200000-0000-0000-0000-000000000004', 'c9100000-0000-0000-0000-000000000004', 1, '{"platform_format": "reel", "scheduled_at": null, "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c9200000-0000-0000-0000-000000000005', 'c9100000-0000-0000-0000-000000000005', 1, '{"platform_format": "reel", "scheduled_at": null, "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c9200000-0000-0000-0000-000000000006', 'c9100000-0000-0000-0000-000000000006', 1, '{"platform_format": "reel", "scheduled_at": null, "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a'),
       ('c9200000-0000-0000-0000-000000000007', 'c9100000-0000-0000-0000-000000000007', 1, '{"platform_format": "reel", "scheduled_at": null, "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a')
on conflict (placement_id, version_number) do nothing;

-- Workflow default (1 step, assignee_role approver, quorum 1) per workspace.
insert into public.approval_workflows (id, workspace_id, name, is_default, created_by)
values ('f9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'Workflow Default', true, :'user_a'),
       ('f9000000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000002', 'Workflow Default', true, :'user_a')
on conflict (id) do nothing;

insert into public.approval_steps (id, workflow_id, step_order, step_type, assignee_role, assignee_user_id, required_count)
values ('f9100000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-000000000001', 1, 'sequential', 'approver', null, 1),
       ('f9100000-0000-0000-0000-000000000002', 'f9000000-0000-0000-0000-000000000002', 1, 'sequential', 'approver', null, 1)
on conflict (id) do nothing;

-- Simulasikan peran authenticated untuk semua pemeriksaan RLS di bawah.
set local role authenticated;

-- ============================================================================
-- TES 1 — gerbang + fixture. (4)
-- ============================================================================
select is(
  (select (value_json ->> 'enabled')::boolean from public.workspace_settings where workspace_id = 'b9000000-0000-0000-0000-000000000001' and key = 'approval.client_review_enabled'),
  true,
  'T1a gerbang client_review AKTIF di WS-A9 (setting enabled=true)'
);
select is(
  (select count(*) from public.workspace_settings where workspace_id = 'b9000000-0000-0000-0000-000000000002' and key = 'approval.client_review_enabled')::int,
  0,
  'T1b WS-B9 TANPA baris setting = gerbang mati (default)'
);
select is(
  (select count(*) from public.content_items where workspace_id = 'b9000000-0000-0000-0000-000000000001')::int,
  5,
  'T1c 5 item fixture di WS-A9 (A1–A5)'
);
select is(
  (select count(*) from public.content_items where workspace_id = 'b9000000-0000-0000-0000-000000000002')::int,
  2,
  'T1d 2 item fixture di WS-B9 (B1–B2)'
);

-- ============================================================================
-- TES 2 — A1: gerbang aktif + klien minta revisi → preflight BLOKIR. (11)
-- Alur: A submit internal → B setujui → A ajukan client review →
-- B minta revisi → produksi changes_requested → preflight + create job
-- DITOLAK CLIENT_REJECTED, 0 job tercipta (ini inti temuan F-01).
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.create_approval_request('d9000000-0000-0000-0000-000000000001', 'd9100000-0000-0000-0000-000000000001') ->> 'ok'),
  'true',
  'T2a A submit internal v1 A1 lolos'
);
select _set_user(:'user_b');
select is(
  (public.decide_approval_request((select id from public.approval_requests where target_type = 'content_item' and target_id = 'd9000000-0000-0000-0000-000000000001' and request_type = 'internal' order by created_at desc limit 1), 'approved', null) ->> 'ok'),
  'true',
  'T2b B setujui internal A1 lolos'
);
select _set_user(:'user_a');
select is(
  (select production_status from public.content_items where id = 'd9000000-0000-0000-0000-000000000001'),
  'approved',
  'T2c produksi A1 = approved sesudah internal disetujui'
);
select is(
  (public.submit_content_for_client_review('d9000000-0000-0000-0000-000000000001', 'd9100000-0000-0000-0000-000000000001') ->> 'ok'),
  'true',
  'T2d A ajukan client review A1 lolos (gerbang aktif + internal approved)'
);
select _set_user(:'user_b');
select is(
  (public.decide_approval_request((select id from public.approval_requests where target_type = 'content_item' and target_id = 'd9000000-0000-0000-0000-000000000001' and request_type = 'client' order by created_at desc limit 1), 'changes_requested', 'Caption belum sesuai arahan klien.') ->> 'ok'),
  'true',
  'T2e B minta revisi atas client review A1 lolos'
);
select _set_user(:'user_a');
select is(
  (select production_status from public.content_items where id = 'd9000000-0000-0000-0000-000000000001'),
  'changes_requested',
  'T2f produksi A1 = changes_requested sesudah klien minta revisi (0025, F-01)'
);
select is(
  (public.publishing_preflight('c9100000-0000-0000-0000-000000000001', null, null) ->> 'ok'),
  'false',
  'T2g preflight A1 DITOLAK walau internal sudah approved'
);
select is(
  (public.publishing_preflight('c9100000-0000-0000-0000-000000000001', null, null) ->> 'code'),
  'CLIENT_REJECTED',
  'T2h preflight A1 berkode CLIENT_REJECTED'
);
select is(
  (public.create_publishing_job('c9100000-0000-0000-0000-000000000001', null, null) ->> 'ok'),
  'false',
  'T2i create_publishing_job A1 DITOLAK (preflight yang sama)'
);
select is(
  (public.create_publishing_job('c9100000-0000-0000-0000-000000000001', null, null) ->> 'code'),
  'CLIENT_REJECTED',
  'T2j create_publishing_job A1 berkode CLIENT_REJECTED'
);
select is(
  (select count(*) from public.publishing_jobs where placement_id = 'c9100000-0000-0000-0000-000000000001')::int,
  0,
  'T2k 0 job tercipta untuk placement A1 (penolakan tidak menulis job)'
);

-- ============================================================================
-- TES 3 — A2: gerbang aktif + klien menyetujui → preflight LOLOS. (9)
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.create_approval_request('d9000000-0000-0000-0000-000000000002', 'd9100000-0000-0000-0000-000000000002') ->> 'ok'),
  'true',
  'T3a A submit internal v1 A2 lolos'
);
select _set_user(:'user_b');
select is(
  (public.decide_approval_request((select id from public.approval_requests where target_type = 'content_item' and target_id = 'd9000000-0000-0000-0000-000000000002' and request_type = 'internal' order by created_at desc limit 1), 'approved', null) ->> 'ok'),
  'true',
  'T3b B setujui internal A2 lolos'
);
select _set_user(:'user_a');
select is(
  (public.submit_content_for_client_review('d9000000-0000-0000-0000-000000000002', 'd9100000-0000-0000-0000-000000000002') ->> 'ok'),
  'true',
  'T3c A ajukan client review A2 lolos'
);
select _set_user(:'user_b');
select is(
  (public.decide_approval_request((select id from public.approval_requests where target_type = 'content_item' and target_id = 'd9000000-0000-0000-0000-000000000002' and request_type = 'client' order by created_at desc limit 1), 'approved', null) ->> 'ok'),
  'true',
  'T3d B setujui client review A2 lolos'
);
select _set_user(:'user_a');
select is(
  (public.publishing_preflight('c9100000-0000-0000-0000-000000000002', null, null) ->> 'ok'),
  'true',
  'T3e preflight A2 LOLOS (internal + client approved)'
);
select is(
  (public.publishing_preflight('c9100000-0000-0000-0000-000000000002', null, null) ->> 'code'),
  'READY',
  'T3f preflight A2 berkode READY'
);
select is(
  (public.create_publishing_job('c9100000-0000-0000-0000-000000000002', null, null) ->> 'ok'),
  'true',
  'T3g create_publishing_job A2 lolos'
);
select is(
  (select count(*) from public.publishing_jobs where placement_id = 'c9100000-0000-0000-0000-000000000002')::int,
  1,
  'T3h tepat 1 job tercipta untuk placement A2'
);
select is(
  (select status from public.publishing_jobs where placement_id = 'c9100000-0000-0000-0000-000000000002'),
  'ready',
  'T3i job A2 berstatus ready (jadwal segera)'
);

-- ============================================================================
-- TES 4 — B1: gerbang NONAKTIF → perilaku lama (tidak diblokir). (6)
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.create_approval_request('d9000000-0000-0000-0000-000000000006', 'd9100000-0000-0000-0000-000000000006') ->> 'ok'),
  'true',
  'T4a A submit internal v1 B1 lolos'
);
select _set_user(:'user_b');
select is(
  (public.decide_approval_request((select id from public.approval_requests where target_type = 'content_item' and target_id = 'd9000000-0000-0000-0000-000000000006' and request_type = 'internal' order by created_at desc limit 1), 'approved', null) ->> 'ok'),
  'true',
  'T4b B setujui internal B1 lolos'
);
select _set_user(:'user_a');
select is(
  (public.publishing_preflight('c9100000-0000-0000-0000-000000000006', null, null) ->> 'ok'),
  'true',
  'T4c preflight B1 LOLOS tanpa client review (gerbang mati)'
);
select is(
  (public.publishing_preflight('c9100000-0000-0000-0000-000000000006', null, null) ->> 'code'),
  'READY',
  'T4d preflight B1 berkode READY'
);
select is(
  (public.create_publishing_job('c9100000-0000-0000-0000-000000000006', null, null) ->> 'ok'),
  'true',
  'T4e create_publishing_job B1 lolos (perilaku lama)'
);
select is(
  (select count(*) from public.publishing_jobs where placement_id = 'c9100000-0000-0000-0000-000000000006')::int,
  1,
  'T4f tepat 1 job tercipta untuk placement B1'
);

-- ============================================================================
-- TES 5 — A3: regresi internal — changes_requested internal → editing. (4)
-- Perilaku request INTERNAL tidak berubah oleh 0025.
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.create_approval_request('d9000000-0000-0000-0000-000000000003', 'd9100000-0000-0000-0000-000000000003') ->> 'ok'),
  'true',
  'T5a A submit internal v1 A3 lolos'
);
select _set_user(:'user_b');
select is(
  (public.decide_approval_request((select id from public.approval_requests where target_type = 'content_item' and target_id = 'd9000000-0000-0000-0000-000000000003' and request_type = 'internal' order by created_at desc limit 1), 'changes_requested', 'Skrip perlu direvisi.') ->> 'ok'),
  'true',
  'T5b B minta revisi atas internal A3 lolos'
);
select _set_user(:'user_a');
select is(
  (select production_status from public.content_items where id = 'd9000000-0000-0000-0000-000000000003'),
  'editing',
  'T5c produksi A3 = editing (cabang internal lama, tidak berubah)'
);
select is(
  (public.publishing_preflight('c9100000-0000-0000-0000-000000000003', null, null) ->> 'code'),
  'APPROVAL_REQUIRED',
  'T5d preflight A3 APPROVAL_REQUIRED (belum ada internal approved)'
);

-- ============================================================================
-- TES 6 — A4: gerbang aktif + klien MENOLAK → CLIENT_REJECTED. (6)
-- Varian 'rejected' (bukan hanya 'changes_requested' seperti A1).
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.create_approval_request('d9000000-0000-0000-0000-000000000004', 'd9100000-0000-0000-0000-000000000004') ->> 'ok'),
  'true',
  'T6a A submit internal v1 A4 lolos'
);
select _set_user(:'user_b');
select is(
  (public.decide_approval_request((select id from public.approval_requests where target_type = 'content_item' and target_id = 'd9000000-0000-0000-0000-000000000004' and request_type = 'internal' order by created_at desc limit 1), 'approved', null) ->> 'ok'),
  'true',
  'T6b B setujui internal A4 lolos'
);
select _set_user(:'user_a');
select is(
  (public.submit_content_for_client_review('d9000000-0000-0000-0000-000000000004', 'd9100000-0000-0000-0000-000000000004') ->> 'ok'),
  'true',
  'T6c A ajukan client review A4 lolos'
);
select _set_user(:'user_b');
select is(
  (public.decide_approval_request((select id from public.approval_requests where target_type = 'content_item' and target_id = 'd9000000-0000-0000-0000-000000000004' and request_type = 'client' order by created_at desc limit 1), 'rejected', 'Tidak sesuai arahan klien.') ->> 'ok'),
  'true',
  'T6d B tolak client review A4 lolos'
);
select _set_user(:'user_a');
select is(
  (select production_status from public.content_items where id = 'd9000000-0000-0000-0000-000000000004'),
  'changes_requested',
  'T6e produksi A4 = changes_requested sesudah klien menolak (0025, F-01)'
);
select is(
  (public.publishing_preflight('c9100000-0000-0000-0000-000000000004', null, null) ->> 'code'),
  'CLIENT_REJECTED',
  'T6f preflight A4 berkode CLIENT_REJECTED'
);

-- ============================================================================
-- TES 7 — A5: gerbang aktif + client review MASIH in_review → blokir. (4)
-- Belum diputuskan (bukan ditolak) → CLIENT_APPROVAL_REQUIRED, bukan
-- CLIENT_REJECTED — pesan membedakan "belum" dari "ditolak".
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.create_approval_request('d9000000-0000-0000-0000-000000000005', 'd9100000-0000-0000-0000-000000000005') ->> 'ok'),
  'true',
  'T7a A submit internal v1 A5 lolos'
);
select _set_user(:'user_b');
select is(
  (public.decide_approval_request((select id from public.approval_requests where target_type = 'content_item' and target_id = 'd9000000-0000-0000-0000-000000000005' and request_type = 'internal' order by created_at desc limit 1), 'approved', null) ->> 'ok'),
  'true',
  'T7b B setujui internal A5 lolos'
);
select _set_user(:'user_a');
select is(
  (public.submit_content_for_client_review('d9000000-0000-0000-0000-000000000005', 'd9100000-0000-0000-0000-000000000005') ->> 'ok'),
  'true',
  'T7c A ajukan client review A5 lolos'
);
select is(
  (public.publishing_preflight('c9100000-0000-0000-0000-000000000005', null, null) ->> 'code'),
  'CLIENT_APPROVAL_REQUIRED',
  'T7d preflight A5 berkode CLIENT_APPROVAL_REQUIRED (client belum memutuskan)'
);

-- ============================================================================
-- TES 8 — B2: gerbang dinyalakan SESUDAH job dibuat → process menegakkan. (6)
-- Job dibuat saat gerbang mati (lolos), lalu gerbang dinyalakan; proses
-- antrean memanggil preflight ulang dan harus menolak job itu.
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.create_approval_request('d9000000-0000-0000-0000-000000000007', 'd9100000-0000-0000-0000-000000000007') ->> 'ok'),
  'true',
  'T8a A submit internal v1 B2 lolos'
);
select _set_user(:'user_b');
select is(
  (public.decide_approval_request((select id from public.approval_requests where target_type = 'content_item' and target_id = 'd9000000-0000-0000-0000-000000000007' and request_type = 'internal' order by created_at desc limit 1), 'approved', null) ->> 'ok'),
  'true',
  'T8b B setujui internal B2 lolos'
);
select _set_user(:'user_a');
select is(
  (public.create_publishing_job('c9100000-0000-0000-0000-000000000007', null, null) ->> 'ok'),
  'true',
  'T8c create_publishing_job B2 lolos (gerbang WS-B9 masih mati)'
);
-- Nyalakan gerbang WS-B9 sesudah job dibuat (sebagai postgres).
reset role;
insert into public.workspace_settings (workspace_id, key, value_json)
values ('b9000000-0000-0000-0000-000000000002', 'approval.client_review_enabled', '{"enabled": true}'::jsonb)
on conflict (workspace_id, key) do update set value_json = excluded.value_json;
set local role authenticated;
select _set_user(:'user_a');
select is(
  ((public.process_publishing_jobs('b9000000-0000-0000-0000-000000000002') ->> 'processed'))::int,
  2,
  'T8d process WS-B9 memproses 2 job jatuh tempo (B1 + B2)'
);
select is(
  (select status from public.publishing_jobs where placement_id = 'c9100000-0000-0000-0000-000000000007'),
  'needs_manual_action',
  'T8e job B2 jadi needs_manual_action sesudah preflight ulang gagal'
);
select is(
  (select count(*) from public.publishing_attempts where publishing_job_id = (select id from public.publishing_jobs where placement_id = 'c9100000-0000-0000-0000-000000000007') and error_code = 'CLIENT_APPROVAL_REQUIRED')::int,
  1,
  'T8f attempt B2 mencatat CLIENT_APPROVAL_REQUIRED (gerbang di proses)'
);

-- ============================================================================
-- TES 9 — CHECK enum approval_decisions (throws_ok, pesan lengkap). (1)
-- Keputusan di luar enum ditolak database — enum inilah yang dipakai
-- cabang decide 0025 (approved / changes_requested / rejected).
-- ============================================================================
reset role;
select throws_ok(
  format($f$ insert into public.approval_decisions (approval_request_id, step_id, approver_user_id, decision, comment) values (%L, 'f9100000-0000-0000-0000-000000000001', %L, 'bogus', 'x') $f$,
    (select id from public.approval_requests where target_type = 'content_item' and target_id = 'd9000000-0000-0000-0000-000000000002' and request_type = 'client' order by created_at desc limit 1),
    :'user_a'),
  '23514',
  'new row for relation "approval_decisions" violates check constraint "approval_decisions_decision_check"',
  'T9a keputusan di luar enum ditolak CHECK 23514'
);

-- ============================================================================
-- Cleanup HARUS sebagai postgres (reset role): authenticated TIDAK PUNYA
-- grant update/delete atas approval_requests/publishing_jobs — DELETE
-- cleanup sebagai authenticated abort 42501 sebelum finish() (pelajaran
-- 39, pgTAP 07 Run 5 v1.3).
-- Cleanup defensif (rollback di akhir membersihkan semuanya; delete di sini
-- menjaga kebersihan bila rollback tidak jalan — urutan daun → akar).
-- activity_logs/notifications/content_status_events ikut terhapus lewat
-- CASCADE dari workspace/item (0004/0007/0009).
-- ============================================================================
reset role;
delete from public.published_posts where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002');
delete from public.publishing_attempts where publishing_job_id in
  (select id from public.publishing_jobs where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002'));
delete from public.publishing_jobs where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002');
delete from public.approval_decisions where approval_request_id in
  (select id from public.approval_requests where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002'));
delete from public.placement_versions where placement_id in
  (select id from public.content_placements where content_item_id in
  (select id from public.content_items where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002')));
delete from public.content_placements where content_item_id in
  (select id from public.content_items where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002'));
delete from public.approval_requests where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002');
delete from public.approval_steps where workflow_id in
  (select id from public.approval_workflows where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002'));
delete from public.approval_workflows where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002');
delete from public.content_versions where content_item_id in
  (select id from public.content_items where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002'));
delete from public.content_items where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002');
delete from public.social_channels where brand_id in
  (select id from public.brands where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002'));
delete from public.brands where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002');
update public.brief_templates set is_default = false where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002');
delete from public.brief_templates where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002');
delete from public.workspace_settings where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002');
delete from public.workspace_members where workspace_id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002');
delete from public.workspaces where id in
  ('b9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000002');
delete from public.organization_members where organization_id in
  ('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000002');
delete from public.organizations where id in
  ('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000002');
drop function if exists _set_user(uuid, text);

select * from finish();
rollback;
