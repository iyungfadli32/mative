-- MaTive Phase 5 — RLS + RPC brand scope / visual planner / template (pgTAP) — v1.2
-- v1.0 (2026-11-19): file baru untuk migrasi 0016 (brand scope, P1-A7) +
-- 0017 (visual planner + template). 59 asersi.
-- v1.1 (2026-11-19): perbaikan diagnosis live (47/59): B WS-A = manager
-- (bukan approver); pola throws_ok = pesan lengkap + nama constraint
-- terpotong 63 byte; butuh migrasi 0018 (posisi 1-based + kode
-- INVALID_STATE_TRANSITION untuk placement di luar scope).
-- v1.2 (2026-11-19): TES 16 (T16a/T16b) — regresi e2e live: INSERT brand
-- sebagai authenticated ditolak policy 0016 untuk SEMUA peran
-- (brand_in_scope(id baru) selalu false); butuh migrasi 0019. 61 asersi.
-- ============================================================================
-- CARA MENJALANKAN (oleh koordinator — butuh DATABASE_URL / service role):
--   1. Terapkan migrasi 0001–0019 ke database BERSIH (lihat
--      docs/phase-5-report.md §8; urutan: 0016 lalu 0017, lalu 0019).
--   2. Aktifkan ekstensi pgTAP di proyek Supabase (Dashboard → Database →
--      Extensions → pgtap), atau jalankan:  create extension if not exists pgtap;
--   3. Buat 2 pengguna auth uji (mis. lewat Dashboard → Authentication →
--      Add user) dan catat UUID-nya; ganti placeholder di bawah.
--      User A = owner Workspace A. User B = manager di Workspace A dengan
--      brand_scope = [Brand A] (TERBATAS), admin di Workspace B (tanpa scope).
--   4. Jalankan:  psql "$DATABASE_URL" -v user_a='<UUID-USER-A>' \
--        -v user_b='<UUID-USER-B>' \
--        -f supabase/tests/05_rls_phase5.sql
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
-- POLA YANG DIIKUTI (pelajaran file 01 v2.2 + 02 v1.2 + 03 v1.4 + 04 v1.4):
--   - Setup sebagai postgres (bypass RLS), baru `set local role authenticated`.
--   - RPC mengembalikan jsonb {ok, code, message} (TIDAK melempar) — asersi
--     memakai is(->>'ok', 'true'/'false') dan is(->>'code', ...), BUKAN
--     throws_ok. throws_ok HANYA untuk exception DB sungguhan (CHECK 23514,
--     unique 23505, trigger P0001, privilege 42501).
--   - UPDATE/DELETE di bawah RLS tidak melempar exception: pakai asersi
--     jumlah baris terpengaruh (count(*) ... ::int).
--   - Placeholder :'user_a'/:'user_b' TIDAK BOLEH di dalam string $$...$$ —
--     SQL dinamis dibangun lewat format($f$...$f$, :'user_b').
--   - UUID palsu 1111.../2222... HANYA di dua baris \\set.
--   - Insert baris uji di tengah tes memakai `reset role;` (postgres) lalu
--     `set local role authenticated;` lagi.
--   - Cleanup TIDAK menghapus brief_templates (tidak ada di file ini).
-- ============================================================================

begin;
select plan(61);

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
-- Setup: org + workspace + member + brand + channel + campaign + item +
-- placement + template (sebagai postgres, bypass RLS).
-- User B = manager WS-A dengan brand_scope [Brand A]; admin WS-B (tanpa scope).
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, owner_user_id)
values ('a1000000-0000-0000-0000-000000000001', 'Org A5 (sample test)', 'org-a5-test', :'user_a'),
       ('a1000000-0000-0000-0000-000000000002', 'Org B5 (sample test)', 'org-b5-test', :'user_b')
on conflict (slug) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at)
values ('a1000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('a1000000-0000-0000-0000-000000000002', :'user_b', 'owner', 'active', now())
on conflict (organization_id, user_id) do nothing;

insert into public.workspaces (id, organization_id, name, slug, timezone)
values ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Workspace A5 (sample test)', 'ws-a5-test', 'Asia/Jakarta'),
       ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'Workspace B5 (sample test)', 'ws-b5-test', 'Asia/Jakarta')
on conflict (organization_id, slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
values ('b1000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('b1000000-0000-0000-0000-000000000001', :'user_b', 'manager', 'active', now()),
       ('b1000000-0000-0000-0000-000000000002', :'user_b', 'admin', 'active', now())
on conflict (workspace_id, user_id) do nothing;

-- B di WS-A dibatasi hanya Brand A (P1-A7).
update public.workspace_members
set brand_scope = '["e1000000-0000-0000-0000-000000000001"]'::jsonb
where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_b';

insert into public.brands (id, workspace_id, name, slug, status)
values ('e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Brand A5 (sample test)', 'brand-a5-test', 'active'),
       ('e1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'Brand A2-5 (sample test)', 'brand-a2-5-test', 'active'),
       ('e1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000002', 'Brand B5 (sample test)', 'brand-b5-test', 'active')
on conflict (workspace_id, slug) do nothing;

insert into public.social_channels (id, brand_id, platform, account_name, connection_status)
values ('e1100000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'instagram', 'Akun A5 (sample test)', 'not_connected'),
       ('e1100000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'instagram', 'Akun A2-5 (sample test)', 'not_connected'),
       ('e1100000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003', 'instagram', 'Akun B5 (sample test)', 'not_connected')
on conflict (id) do nothing;

insert into public.campaigns (id, workspace_id, name, status, owner_user_id, target_metrics)
values ('f7000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Campaign A5 (sample test)', 'draft', :'user_a', '{}'::jsonb),
       ('f7000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'Campaign B5 (sample test)', 'draft', :'user_b', '{}'::jsonb)
on conflict (id) do nothing;

insert into public.campaign_brands (campaign_id, brand_id)
values ('f7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'),
       ('f7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002'),
       ('f7000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003')
on conflict (campaign_id, brand_id) do nothing;

insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone)
values ('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'Item A5-1 (sample test)', 'approved', :'user_a', 'Asia/Jakarta'),
       ('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'Item A5-2 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'Item A2-5-1 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003', 'Item B5-1 (sample test)', 'approved', :'user_b', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone)
values ('c1100000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 'reel', '2026-12-01T10:00:00Z', 'draft', 'Asia/Jakarta'),
       ('c1100000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', 'e1100000-0000-0000-0000-000000000001', 'reel', '2026-12-02T10:00:00Z', 'draft', 'Asia/Jakarta'),
       ('c1100000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000003', 'e1100000-0000-0000-0000-000000000002', 'reel', '2026-12-03T10:00:00Z', 'draft', 'Asia/Jakarta'),
       ('c1100000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000004', 'e1100000-0000-0000-0000-000000000003', 'reel', null, 'draft', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.campaign_templates (id, workspace_id, name, source_campaign_id, objective, audience_id, target_metrics, created_by)
values ('f5000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Template A5 (sample test)', 'f7000000-0000-0000-0000-000000000001', null, null, '{}'::jsonb, :'user_a'),
       ('f5000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'Template B5 (sample test)', 'f7000000-0000-0000-0000-000000000002', null, null, '{}'::jsonb, :'user_b')
on conflict (id) do nothing;

insert into public.campaign_template_brands (template_id, brand_id)
values ('f5000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001'),
       ('f5000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003')
on conflict (template_id, brand_id) do nothing;

insert into public.content_templates (id, workspace_id, name, source_content_item_id, title, brand_id, pillar_id, script, caption, created_by)
values ('f6000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Template Konten A5 (sample test)', 'd1000000-0000-0000-0000-000000000001', 'Konten Template A5', 'e1000000-0000-0000-0000-000000000001', null, 'Skrip template', 'Caption template', :'user_a'),
       ('f6000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'Template Konten B5 (sample test)', 'd1000000-0000-0000-0000-000000000004', 'Konten Template B5', 'e1000000-0000-0000-0000-000000000003', null, 'Skrip template', 'Caption template', :'user_b')
on conflict (id) do nothing;

insert into public.content_template_placements (template_id, social_channel_id, platform_format)
values ('f6000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 'reel'),
       ('f6000000-0000-0000-0000-000000000002', 'e1100000-0000-0000-0000-000000000003', 'reel')
on conflict (template_id, social_channel_id) do nothing;

-- Simulasikan peran authenticated untuk semua pemeriksaan RLS di bawah.
set local role authenticated;

-- ============================================================================
-- TES 2 — brand_in_scope (0016): NULL = semua, array = hanya itu, [] = tidak ada.
-- ============================================================================
select _set_user(:'user_a');
select is(
  public.brand_in_scope('e1000000-0000-0000-0000-000000000001'),
  true,
  'T2a ALLOW: owner A (scope NULL) masuk scope Brand A'
);
select _set_user(:'user_b');
select is(
  public.brand_in_scope('e1000000-0000-0000-0000-000000000001'),
  true,
  'T2b ALLOW: B (scope [Brand A]) masuk scope Brand A'
);
select is(
  public.brand_in_scope('e1000000-0000-0000-0000-000000000002'),
  false,
  'T2c DENY: B (scope [Brand A]) TIDAK masuk scope Brand A2'
);
select is(
  public.brand_in_scope('e1000000-0000-0000-0000-000000000003'),
  true,
  'T2d ALLOW: B admin WS-B (scope NULL) masuk scope Brand B'
);
select _as_anon();
select is(
  public.brand_in_scope('e1000000-0000-0000-0000-000000000001'),
  false,
  'T2e DENY: anon (tanpa sesi) tidak masuk scope brand mana pun'
);

-- ============================================================================
-- TES 3 — RLS brands (0016): member ber-scope hanya melihat brand-nya.
-- ============================================================================
select _set_user(:'user_b');
select is(
  (select count(*) from public.brands where workspace_id = 'b1000000-0000-0000-0000-000000000001')::int,
  1,
  'T3a DENY: B hanya melihat 1 dari 2 brand WS-A (Brand A2 tersembunyi)'
);
select _set_user(:'user_a');
select is(
  (select count(*) from public.brands where workspace_id = 'b1000000-0000-0000-0000-000000000001')::int,
  2,
  'T3b ALLOW: A (scope NULL) melihat 2 brand WS-A'
);
select _set_user(:'user_b');
select is_empty(
  $$ select 1 from public.brands where id = 'e1000000-0000-0000-0000-000000000002' $$,
  'T3c DENY: B tidak bisa membaca Brand A2 meski menebak UUID'
);
select _set_user(:'user_a');
select is_empty(
  $$ select 1 from public.brands where id = 'e1000000-0000-0000-0000-000000000003' $$,
  'T3d DENY: A (bukan member WS-B) tidak bisa membaca Brand B meski menebak UUID'
);

-- ============================================================================
-- TES 4 — RLS content_items (0016): item brand di luar scope tersembunyi.
-- ============================================================================
select _set_user(:'user_b');
select is(
  (select count(*) from public.content_items where workspace_id = 'b1000000-0000-0000-0000-000000000001')::int,
  2,
  'T4a DENY: B hanya melihat 2 dari 3 item WS-A (item Brand A2 tersembunyi)'
);
select is_empty(
  $$ select 1 from public.content_items where id = 'd1000000-0000-0000-0000-000000000003' $$,
  'T4b DENY: B tidak bisa membaca item Brand A2 meski menebak UUID'
);
select _set_user(:'user_a');
select is(
  (select count(*) from public.content_items where workspace_id = 'b1000000-0000-0000-0000-000000000001')::int,
  3,
  'T4c ALLOW: A melihat 3 item WS-A'
);
select _set_user(:'user_b');
select is(
  (select count(*) from public.content_items where workspace_id = 'b1000000-0000-0000-0000-000000000002')::int,
  1,
  'T4d ALLOW: B admin WS-B melihat 1 item WS-B'
);

-- ============================================================================
-- TES 5 — RLS content_placements (0016): placement ikut ter-scope lewat item.
-- ============================================================================
select _set_user(:'user_b');
select is(
  (select count(*) from public.content_placements where social_channel_id in
    ('e1100000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000002'))::int,
  2,
  'T5a DENY: B hanya melihat 2 dari 3 placement WS-A (channel dihitung langsung, tanpa subquery items yang ikut ter-RLS)'
);
select is_empty(
  $$ select 1 from public.content_placements where id = 'c1100000-0000-0000-0000-000000000003' $$,
  'T5b DENY: B tidak bisa membaca placement Brand A2 meski menebak UUID'
);
select _set_user(:'user_a');
select is(
  (select count(*) from public.content_placements where social_channel_id in
    ('e1100000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000002'))::int,
  3,
  'T5c ALLOW: A melihat 3 placement WS-A'
);

-- ============================================================================
-- TES 6 — RLS campaign_brands (0016): tautan brand di luar scope tersembunyi.
-- ============================================================================
select _set_user(:'user_b');
select is(
  (select count(*) from public.campaign_brands where campaign_id = 'f7000000-0000-0000-0000-000000000001')::int,
  1,
  'T6a DENY: B hanya melihat 1 dari 2 tautan brand Campaign A5'
);
select is_empty(
  $$ select 1 from public.campaign_brands where campaign_id = 'f7000000-0000-0000-0000-000000000001' and brand_id = 'e1000000-0000-0000-0000-000000000002' $$,
  'T6b DENY: B tidak bisa membaca tautan Campaign A5 ↔ Brand A2'
);
select _set_user(:'user_a');
select is(
  (select count(*) from public.campaign_brands where campaign_id = 'f7000000-0000-0000-0000-000000000001')::int,
  2,
  'T6c ALLOW: A melihat 2 tautan brand Campaign A5'
);

-- ============================================================================
-- TES 7 — Cabang SHARED tidak di-scope (0016): berbagi eksplisit mengalahkan scope.
-- Share dibuat di tengah tes (reset role → postgres, lalu authenticated lagi).
-- ============================================================================
reset role;
insert into public.resource_shares (id, workspace_id, resource_type, resource_id, shared_with_user_id, shared_by)
values ('f4000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'content_item', 'd1000000-0000-0000-0000-000000000003', :'user_b', :'user_a')
on conflict (id) do nothing;
set local role authenticated;
select _set_user(:'user_b');
select isnt_empty(
  $$ select 1 from public.content_items where id = 'd1000000-0000-0000-0000-000000000003' $$,
  'T7a ALLOW: item Brand A2 yang DIBAGIKAN eksplisit ke B tetap terlihat B'
);
select isnt_empty(
  $$ select 1 from public.content_placements where id = 'c1100000-0000-0000-0000-000000000003' $$,
  'T7b ALLOW: placement item yang dibagikan ikut terlihat B (cabang shared policy placements)'
);

-- ============================================================================
-- TES 8 — Campaigns TIDAK di-scope per brand (0016): campaign tetap terlihat.
-- ============================================================================
select _set_user(:'user_b');
select is(
  (select count(*) from public.campaigns where workspace_id = 'b1000000-0000-0000-0000-000000000001')::int,
  1,
  'T8a ALLOW: B melihat Campaign A5 meski campaign itu menaut Brand A2'
);
select _set_user(:'user_a');
select is_empty(
  $$ select 1 from public.campaigns where id = 'f7000000-0000-0000-0000-000000000002' $$,
  'T8b DENY: A (bukan member WS-B) tidak bisa membaca Campaign B5'
);

-- ============================================================================
-- TES 9 — visual_orders: tulis langsung DITOLAK (0017: revoke all + grant select).
-- ============================================================================
select _set_user(:'user_a');
select throws_ok(
  $$ insert into public.visual_orders (workspace_id, brand_id, social_channel_id, placement_id, position)
     values ('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000001', 1) $$,
  '42501',
  'permission denied for table visual_orders',
  'T9a DENY: INSERT langsung ke visual_orders ditolak (tulis hanya via RPC)'
);
select throws_ok(
  $$ update public.visual_orders set position = 99 where placement_id = 'c1100000-0000-0000-0000-000000000001' $$,
  '42501',
  'permission denied for table visual_orders',
  'T9b DENY: UPDATE langsung ke visual_orders ditolak'
);
select throws_ok(
  $$ delete from public.visual_orders where placement_id = 'c1100000-0000-0000-0000-000000000001' $$,
  '42501',
  'permission denied for table visual_orders',
  'T9c DENY: DELETE langsung dari visual_orders ditolak'
);
select is_empty(
  $$ select 1 from public.visual_orders where workspace_id = 'b1000000-0000-0000-0000-000000000001' $$,
  'T9d ALLOW: SELECT visual_orders bisa dibaca (grant select) — masih 0 baris'
);

-- ============================================================================
-- TES 10 — RPC set_visual_order: jalur sukses + M5.4 (scheduled_at TIDAK BERUBAH).
-- ============================================================================
select _set_user(:'user_a');
select is(
  (select (public.set_visual_order(
    'b1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'e1100000-0000-0000-0000-000000000001',
    array['c1100000-0000-0000-0000-000000000002', 'c1100000-0000-0000-0000-000000000001']::uuid[]
  ) ->> 'ok')),
  'true',
  'T10a ALLOW: set_visual_order (urutan terbalik P-A2, P-A1) mengembalikan ok=true'
);
select is(
  (select (public.set_visual_order(
    'b1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'e1100000-0000-0000-0000-000000000001',
    array['c1100000-0000-0000-0000-000000000002', 'c1100000-0000-0000-0000-000000000001']::uuid[]
  ) ->> 'count')),
  '2',
  'T10b ALLOW: set_visual_order idempotent — dipanggil 2x tetap count=2'
);
select is(
  (select placement_id::text from public.visual_orders
   where workspace_id = 'b1000000-0000-0000-0000-000000000001'
     and brand_id = 'e1000000-0000-0000-0000-000000000001'
     and social_channel_id = 'e1100000-0000-0000-0000-000000000001'
     and position = 1),
  'c1100000-0000-0000-0000-000000000002',
  'T10c ALLOW: posisi 1 = P-A2 (urutan yang diminta, bukan urutan jadwal)'
);
select is(
  (select placement_id::text from public.visual_orders
   where workspace_id = 'b1000000-0000-0000-0000-000000000001'
     and brand_id = 'e1000000-0000-0000-0000-000000000001'
     and social_channel_id = 'e1100000-0000-0000-0000-000000000001'
     and position = 2),
  'c1100000-0000-0000-0000-000000000001',
  'T10d ALLOW: posisi 2 = P-A1'
);
select is(
  (select scheduled_at from public.content_placements where id = 'c1100000-0000-0000-0000-000000000001'),
  '2026-12-01T10:00:00Z'::timestamptz,
  'T10e M5.4: scheduled_at P-A1 TIDAK BERUBAH sesudah set_visual_order'
);
select is(
  (select scheduled_at from public.content_placements where id = 'c1100000-0000-0000-0000-000000000002'),
  '2026-12-02T10:00:00Z'::timestamptz,
  'T10f M5.4: scheduled_at P-A2 TIDAK BERUBAH sesudah set_visual_order'
);
select is(
  (select count(*) from public.activity_logs
   where workspace_id = 'b1000000-0000-0000-0000-000000000001'
     and entity_type = 'visual_order' and action = 'visual_order.set')::int,
  2,
  'T10g ALLOW: 2 panggilan RPC tercatat di activity_logs (jejak audit)'
);

-- ============================================================================
-- TES 11 — RPC set_visual_order: validasi (brand/channel/tenant/duplikat/scope).
-- ============================================================================
select _set_user(:'user_a');
select is(
  (select (public.set_visual_order(
    'b1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'e1100000-0000-0000-0000-000000000001',
    array['c1100000-0000-0000-0000-000000000003']::uuid[]
  ) ->> 'ok')),
  'false',
  'T11a DENY: placement Brand A2 (channel A2) tidak bisa masuk urutan Brand A'
);
select is(
  (select (public.set_visual_order(
    'b1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'e1100000-0000-0000-0000-000000000001',
    array['c1100000-0000-0000-0000-000000000003']::uuid[]
  ) ->> 'code')),
  'INVALID_STATE_TRANSITION',
  'T11a2 DENY: penolakan placement beda brand memakai kode INVALID_STATE_TRANSITION'
);
select is(
  (select (public.set_visual_order(
    'b1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'e1100000-0000-0000-0000-000000000001',
    array['c1100000-0000-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000001']::uuid[]
  ) ->> 'ok')),
  'false',
  'T11b DENY: placement duplikat dalam satu daftar ditolak'
);
select is(
  (select (public.set_visual_order(
    'b1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'e1100000-0000-0000-0000-000000000001',
    array['c1100000-0000-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000001']::uuid[]
  ) ->> 'code')),
  'INVALID_STATE_TRANSITION',
  'T11b2 DENY: penolakan duplikat memakai kode INVALID_STATE_TRANSITION'
);
select is(
  (select (public.set_visual_order(
    'b1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'e1100000-0000-0000-0000-000000000001',
    array['c1100000-0000-0000-0000-000000000004']::uuid[]
  ) ->> 'ok')),
  'false',
  'T11c DENY: placement workspace lain (P-B1) tidak bisa masuk urutan WS-A'
);
select is(
  (select (public.set_visual_order(
    'b1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'e1100000-0000-0000-0000-000000000001',
    array['c1100000-0000-0000-0000-000000000004']::uuid[]
  ) ->> 'code')),
  'INVALID_STATE_TRANSITION',
  'T11c2 DENY: penolakan placement workspace lain memakai kode INVALID_STATE_TRANSITION'
);
select _set_user(:'user_b');
select is(
  (select (public.set_visual_order(
    'b1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'e1100000-0000-0000-0000-000000000001',
    array['c1100000-0000-0000-0000-000000000001']::uuid[]
  ) ->> 'ok')),
  'true',
  'T11e ALLOW: B (member WS-A, scope Brand A) boleh mengatur urutan Brand A'
);
select is(
  (select (public.set_visual_order(
    'b1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000002',
    'e1100000-0000-0000-0000-000000000002',
    array['c1100000-0000-0000-0000-000000000003']::uuid[]
  ) ->> 'ok')),
  'false',
  'T11e2 DENY: B TIDAK boleh mengatur urutan Brand A2 (di luar scope)'
);
select is(
  (select (public.set_visual_order(
    'b1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000002',
    'e1100000-0000-0000-0000-000000000002',
    array['c1100000-0000-0000-0000-000000000003']::uuid[]
  ) ->> 'code')),
  'FORBIDDEN',
  'T11e3 DENY: penolakan scope memakai kode FORBIDDEN'
);
select _set_user(:'user_a');
select is(
  (select (public.set_visual_order(
    'b1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'e1100000-0000-0000-0000-000000000001',
    array[]::uuid[]
  ) ->> 'ok')),
  'true',
  'T11d ALLOW: daftar kosong menghapus urutan (ok=true)'
);
select is(
  (select count(*) from public.visual_orders
   where workspace_id = 'b1000000-0000-0000-0000-000000000001'
     and brand_id = 'e1000000-0000-0000-0000-000000000001'
     and social_channel_id = 'e1100000-0000-0000-0000-000000000001')::int,
  0,
  'T11d2 ALLOW: sesudah clear, 0 baris urutan tersisa untuk scope itu'
);

-- ============================================================================
-- TES 12 — Trigger scope visual_orders (0017): workspace/brand/channel harus cocok.
-- ============================================================================
reset role;
select throws_ok(
  $$ insert into public.visual_orders (workspace_id, brand_id, social_channel_id, placement_id, position)
     values ('b1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000001', 1) $$,
  'P0001',
  'scope mismatch: visual_orders.placement_id belongs to a different workspace/brand/channel',
  'T12a DENY: visual_order dengan workspace salah (WS-B untuk placement WS-A) ditolak trigger'
);
insert into public.visual_orders (workspace_id, brand_id, social_channel_id, placement_id, position)
values ('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000001', 1);
select is(
  (select count(*) from public.visual_orders where placement_id = 'c1100000-0000-0000-0000-000000000001')::int,
  1,
  'T12b ALLOW: visual_order dengan scope benar bisa ditulis langsung sebagai postgres'
);
delete from public.visual_orders where placement_id = 'c1100000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.visual_orders where placement_id = 'c1100000-0000-0000-0000-000000000001')::int,
  0,
  'T12c ALLOW: baris uji T12b terhapus (tidak mengotori tes berikutnya)'
);
set local role authenticated;

-- ============================================================================
-- TES 13 — Template RLS + trigger scope (0017).
-- ============================================================================
select _set_user(:'user_b');
select is(
  (select count(*) from public.campaign_templates where workspace_id = 'b1000000-0000-0000-0000-000000000001')::int,
  1,
  'T13a ALLOW: B melihat 1 template campaign WS-A (brand-nya dalam scope)'
);
select is(
  (select count(*) from public.content_templates where workspace_id = 'b1000000-0000-0000-0000-000000000001')::int,
  1,
  'T13b ALLOW: B melihat 1 template konten WS-A (Brand A dalam scope)'
);
select _set_user(:'user_a');
select is_empty(
  $$ select 1 from public.campaign_templates where id = 'f5000000-0000-0000-0000-000000000002' $$,
  'T13c DENY: A (bukan member WS-B) tidak bisa membaca template campaign WS-B'
);
reset role;
select throws_ok(
  $$ insert into public.campaign_template_brands (template_id, brand_id)
     values ('f5000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003') $$,
  'P0001',
  'scope mismatch: campaign_template_brands template and brand belong to different workspaces',
  'T13d DENY: tautan template campaign ke brand workspace lain ditolak trigger'
);
select throws_ok(
  $$ insert into public.content_template_placements (template_id, social_channel_id, platform_format)
     values ('f6000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000002', 'reel') $$,
  'P0001',
  'scope mismatch: content_template_placements channel belongs to a different workspace/brand than its template',
  'T13e DENY: placement template ke channel brand lain ditolak trigger'
);
set local role authenticated;

-- ============================================================================
-- TES 14 — CHECK brand_scope (0016): NULL atau array saja (dijalankan di akhir
-- agar baris anggota uji tidak mengganggu tes lintas-tenant di atas).
-- ============================================================================
reset role;
select throws_ok(
  format($f$insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, brand_scope, joined_at)
    values ('b1000000-0000-0000-0000-000000000002', %L, 'creator', 'active', '"bukan-array"'::jsonb, now())$f$, :'user_a'),
  '23514',
  'new row for relation "workspace_members" violates check constraint "workspace_members_brand_scope_check"',
  'T14a DENY: brand_scope string (bukan array) ditolak CHECK'
);
select throws_ok(
  format($f$insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, brand_scope, joined_at)
    values ('b1000000-0000-0000-0000-000000000002', %L, 'creator', 'active', '{"a":1}'::jsonb, now())$f$, :'user_a'),
  '23514',
  'new row for relation "workspace_members" violates check constraint "workspace_members_brand_scope_check"',
  'T14b DENY: brand_scope objek (bukan array) ditolak CHECK'
);
insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, brand_scope, joined_at)
values ('b1000000-0000-0000-0000-000000000002', :'user_a', 'creator', 'active', '["not-a-uuid"]'::jsonb, now());
select is(
  (select count(*) from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000002' and user_id = :'user_a')::int,
  1,
  'T14c ALLOW: CHECK hanya memeriksa bentuk array — elemen bukan UUID lolos CHECK (ditolak belakangan oleh brand_in_scope)'
);
delete from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000002' and user_id = :'user_a';
set local role authenticated;

-- ============================================================================
-- TES 15 — Unik ganda visual_orders (0017): per placement + per posisi.
-- ============================================================================
reset role;
insert into public.visual_orders (workspace_id, brand_id, social_channel_id, placement_id, position)
values ('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000001', 1);
select is(
  (select count(*) from public.visual_orders where placement_id = 'c1100000-0000-0000-0000-000000000001')::int,
  1,
  'T15a ALLOW: baris visual_order pertama masuk'
);
select throws_ok(
  $$ insert into public.visual_orders (workspace_id, brand_id, social_channel_id, placement_id, position)
     values ('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000001', 2) $$,
  '23505',
  'duplicate key value violates unique constraint "visual_orders_workspace_id_brand_id_social_channel_id_place_key"',
  'T15b DENY: placement yang sama tidak boleh dua kali dalam satu scope'
);
select throws_ok(
  $$ insert into public.visual_orders (workspace_id, brand_id, social_channel_id, placement_id, position)
     values ('b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000002', 1) $$,
  '23505',
  'duplicate key value violates unique constraint "visual_orders_workspace_id_brand_id_social_channel_id_posit_key"',
  'T15c DENY: posisi yang sama tidak boleh dipakai dua placement dalam satu scope'
);
delete from public.visual_orders where placement_id = 'c1100000-0000-0000-0000-000000000001';

-- ============================================================================
-- TES 16 — INSERT brand sebagai authenticated (0019): policy INSERT 0016
-- menolak SEMUA pembuatan brand (brand_in_scope(id baru) selalu false
-- karena baris belum ada di tabel) — regresi e2e live 2026-11-19.
-- ============================================================================
set local role authenticated;
select _set_user(:'user_a');
select lives_ok(
  $$ insert into public.brands (id, workspace_id, name, slug, status)
     values ('e1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001', 'Brand T16 (sample test)', 'brand-t16-test', 'active') $$,
  'T16a ALLOW: owner WS-A (scope NULL) bisa membuat brand baru'
);
select is(
  (select count(*) from public.brands where id = 'e1000000-0000-0000-0000-000000000004')::int,
  1,
  'T16b ALLOW: brand baru terlihat owner (scope NULL) sesudah INSERT'
);

-- ============================================================================
-- Cleanup: hapus semua data uji + helper.
-- Dijalankan sebagai postgres (bypass RLS). (Tidak ada brief_templates di
-- file ini, jadi tidak ada risiko trigger P0001 template default.)
-- ============================================================================
reset role;
delete from public.visual_orders where workspace_id in
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');
delete from public.campaign_template_brands where template_id in
  (select id from public.campaign_templates where workspace_id in
    ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002'));
delete from public.campaign_templates where workspace_id in
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');
delete from public.content_template_placements where template_id in
  (select id from public.content_templates where workspace_id in
    ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002'));
delete from public.content_templates where workspace_id in
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');
delete from public.campaign_brands where campaign_id in
  (select id from public.campaigns where workspace_id in
    ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002'));
delete from public.campaigns where workspace_id in
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');
delete from public.resource_shares where workspace_id in
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');
delete from public.activity_logs where workspace_id in
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');
delete from public.content_placements where content_item_id in
  (select id from public.content_items where workspace_id in
    ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002'));
delete from public.content_items where workspace_id in
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');
delete from public.social_channels where brand_id in
  (select id from public.brands where workspace_id in
    ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002'));
delete from public.brands where workspace_id in
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');
delete from public.workspace_members where workspace_id in
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');
delete from public.workspaces where id in
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');
delete from public.organization_members where organization_id in
  ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002');
delete from public.organizations where id in
  ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002');
drop function if exists _set_user(uuid, text);
drop function if exists _as_anon();

select * from finish();
rollback;
