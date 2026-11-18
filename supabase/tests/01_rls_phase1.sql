-- MaTive Phase 1 — RLS policy tests (pgTAP)
-- ============================================================================
-- CARA MENJALANKAN (oleh koordinator — butuh DATABASE_URL / service role):
--   1. Terapkan migrasi 0001–0005 ke database BERSIH (lihat docs/apply-migrations.md).
--   2. Aktifkan ekstensi pgTAP di proyek Supabase (Dashboard → Database →
--      Extensions → pgtap), atau jalankan:  create extension if not exists pgtap;
--   3. Buat 2 pengguna auth uji (mis. lewat Dashboard → Authentication →
--      Add user) dan catat UUID-nya; ganti placeholder di bawah.
--   4. Jalankan:  psql "$DATABASE_URL" -v user_a='<UUID-A>' -v user_b='<UUID-B>'
--        -f supabase/tests/01_rls_phase1.sql
--   Hasil yang diharapkan: semua tes ok (tidak ada "not ok").
-- CATATAN: tes ini TIDAK BOLEH dijalankan di database produksi berisi data
-- nyata — hanya database bersih/preview. Tes memakai JWT claims palsu lewat
-- set_config('request.jwt.claims') untuk mensimulasikan tiap pengguna.
-- ============================================================================

begin;
select plan(14);

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
-- User A = owner Workspace A. User B = member Workspace B (bukan member A).
\set user_a '11111111-1111-1111-1111-111111111111'
\set user_b '22222222-2222-2222-2222-222222222222'

-- ---------------------------------------------------------------------------
-- Setup: organisasi + workspace + member (sebagai postgres, bypass RLS).
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, owner_user_id)
values ('a0000000-0000-0000-0000-000000000001', 'Org A (sample test)', 'org-a-test', :'user_a'),
       ('a0000000-0000-0000-0000-000000000002', 'Org B (sample test)', 'org-b-test', :'user_b')
on conflict (slug) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at)
values ('a0000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('a0000000-0000-0000-0000-000000000002', :'user_b', 'owner', 'active', now())
on conflict (organization_id, user_id) do nothing;

insert into public.workspaces (id, organization_id, name, slug, timezone)
values ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Workspace A (sample test)', 'ws-a-test', 'Asia/Jakarta'),
       ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Workspace B (sample test)', 'ws-b-test', 'Asia/Jakarta')
on conflict (organization_id, slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
values ('b0000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('b0000000-0000-0000-0000-000000000002', :'user_b', 'admin', 'active', now())
on conflict (workspace_id, user_id) do nothing;

-- Share portal: resource milik Workspace A dibagikan ke User B (klien).
insert into public.resource_shares (id, workspace_id, resource_type, resource_id, shared_with_user_id, shared_by)
values ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000001', :'user_b', :'user_a')
on conflict (resource_type, resource_id, shared_with_user_id) do nothing;

-- Simulasikan peran authenticated untuk semua pemeriksaan RLS di bawah.
set local role authenticated;

-- ============================================================================
-- TES 1 (Dok 06 §8 tes 1): cross-tenant UUID guessing — DENY.
-- User B menebak UUID workspace A → tidak boleh membaca.
-- ============================================================================
select _set_user(:'user_b');
select is_empty(
  $$ select 1 from public.workspaces where id = 'b0000000-0000-0000-0000-000000000001' $$,
  'T1 DENY: user B tidak bisa membaca workspace A meski menebak UUID'
);
select is_empty(
  $$ select 1 from public.organizations where id = 'a0000000-0000-0000-0000-000000000001' $$,
  'T1b DENY: user B tidak bisa membaca organisasi A meski menebak UUID'
);

-- ============================================================================
-- TES 2 (Dok 06 §8 tes 1, ALLOW): user A membaca workspace-nya sendiri.
-- ============================================================================
select _set_user(:'user_a');
select isnt_empty(
  $$ select 1 from public.workspaces where id = 'b0000000-0000-0000-0000-000000000001' $$,
  'T2 ALLOW: user A bisa membaca workspace A'
);

-- ============================================================================
-- TES 3 (Dok 06 §8 tes 2): role tampering — DENY.
-- User B (admin di B, BUKAN member A) mencoba mengubah role user A di workspace A.
-- ============================================================================
select _set_user(:'user_b');
select throws_ok(
  $$ update public.workspace_members set workspace_role = 'viewer_client'
     where workspace_id = 'b0000000-0000-0000-0000-000000000001' and user_id = '11111111-1111-1111-1111-111111111111' $$,
  'T3 DENY: user B tidak bisa mengubah role member workspace A'
);
-- User B juga tidak bisa mengubah role-nya SENDIRI menjadi owner di workspace A.
select throws_ok(
  $$ insert into public.workspace_members (workspace_id, user_id, workspace_role)
     values ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'owner') $$,
  'T3b DENY: user B tidak bisa menyisipkan diri sebagai owner workspace A'
);

-- ============================================================================
-- TES 4 (Dok 06 §8 tes 4): viewer_client tidak bisa mutasi.
-- User B sebagai PENERIMA share (bukan member workspace A) mencoba INSERT share.
-- ============================================================================
select _set_user(:'user_b');
select throws_ok(
  $$ insert into public.resource_shares (workspace_id, resource_type, resource_id, shared_with_user_id, shared_by)
     values ('b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222') $$,
  'T4 DENY: penerima share (bukan member workspace) tidak bisa membuat share'
);
select throws_ok(
  $$ delete from public.resource_shares where id = 'c0000000-0000-0000-0000-000000000001' $$,
  'T4b DENY: penerima share tidak bisa mencabut share'
);

-- ============================================================================
-- TES 5 (Dok 06 §8 tes 4/portal): portal allow + deny.
-- ALLOW: user B (penerima) bisa membaca share-nya. DENY: user B TIDAK bisa
-- membaca share yang TIDAK dibagikan ke dia (UUID guessing di portal).
-- ============================================================================
select isnt_empty(
  $$ select 1 from public.resource_shares where id = 'c0000000-0000-0000-0000-000000000001' $$,
  'T5 ALLOW: klien bisa membaca share yang dibagikan ke dia'
);
select is_empty(
  $$ select 1 from public.resource_shares where resource_id = 'd0000000-0000-0000-0000-000000000099' $$,
  'T5b DENY: klien tidak bisa membaca share/resource yang tidak dibagikan (tebak UUID)'
);

-- ============================================================================
-- TES 6 (Dok 06 §8 tes 5): member yang dicabut kehilangan akses.
-- ============================================================================
-- (Sebagai postgres) cabut membership user B di workspace B, lalu periksa sebagai B.
reset role;
update public.workspace_members set membership_status = 'removed'
where workspace_id = 'b0000000-0000-0000-0000-000000000002' and user_id = :'user_b';
set local role authenticated;
select _set_user(:'user_b');
select is_empty(
  $$ select 1 from public.workspaces where id = 'b0000000-0000-0000-0000-000000000002' $$,
  'T6 DENY: member yang dicabut (removed) tidak bisa lagi membaca workspace B'
);
-- Kembalikan untuk tes berikut.
reset role;
update public.workspace_members set membership_status = 'active'
where workspace_id = 'b0000000-0000-0000-0000-000000000002' and user_id = :'user_b';
set local role authenticated;

-- ============================================================================
-- TES 7: undangan kedaluwarsa tidak bisa dipakai (fungsi accept_invitation).
-- ============================================================================
select _set_user(:'user_b', 'b@example.com');
insert into public.workspace_invitations (workspace_id, email, role, token_hash, status, expires_at, invited_by)
values ('b0000000-0000-0000-0000-000000000001', 'b@example.com', 'creator',
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'pending',
        now() - interval '1 day', :'user_a')
on conflict (token_hash) do nothing;
select is(
  (select accept_invitation('deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef') ->> 'ok'),
  'false',
  'T7 DENY: undangan kedaluwarsa ditolak fungsi accept_invitation'
);

-- ============================================================================
-- TES 8: duplikasi share ditolak (unique constraint — idempotency dasar).
-- ============================================================================
reset role;
select throws_ok(
  $$ insert into public.resource_shares (workspace_id, resource_type, resource_id, shared_with_user_id, shared_by)
     values ('b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111') $$,
  'T8 DENY: share duplikat (resource + klien sama) ditolak unique constraint'
);

-- ============================================================================
-- TES 9: anon (belum login) tidak bisa membaca apa pun.
-- ============================================================================
set local role anon;
select _as_anon();
select is_empty(
  $$ select 1 from public.workspaces where id = 'b0000000-0000-0000-0000-000000000001' $$,
  'T9 DENY: anon tidak bisa membaca workspace'
);

-- Bersihkan data uji (hanya baris yang dibuat file ini).
reset role;
delete from public.resource_shares where id = 'c0000000-0000-0000-0000-000000000001';
delete from public.workspace_invitations where token_hash = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
delete from public.workspace_members where workspace_id in ('b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002');
delete from public.workspaces where id in ('b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002');
delete from public.organization_members where organization_id in ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002');
delete from public.organizations where id in ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002');
drop function if exists _set_user(uuid, text);
drop function if exists _as_anon();

select * from finish();
rollback;
