-- MaTive Phase 1 — RLS policy tests (pgTAP) — v2
-- ============================================================================
-- CARA MENJALANKAN (oleh koordinator — butuh DATABASE_URL / service role):
--   1. Terapkan migrasi 0001–0006 ke database BERSIH (lihat docs/apply-migrations.md).
--      Migrasi 0006 WAJIB: tanpa 0006, policy rekursif dan T1 gagal 42P17.
--   2. Aktifkan ekstensi pgTAP di proyek Supabase (Dashboard → Database →
--      Extensions → pgtap), atau jalankan:  create extension if not exists pgtap;
--   3. Buat 2 pengguna auth uji (mis. lewat Dashboard → Authentication →
--      Add user) dan catat UUID-nya; ganti placeholder di bawah.
--   4. Jalankan:  psql "$DATABASE_URL" -v user_a='<UUID-A>' -v user_b='<UUID-B>'
--        -f supabase/tests/01_rls_phase1.sql
--   Hasil yang diharapkan: semua tes ok (tidak ada "not ok").
--   DI SQL EDITOR (tanpa psql): hapus kedua baris \set, ganti setiap :'user_a'
--   dengan literal UUID-A dan setiap :'user_b' dengan literal UUID-B, lalu
--   jalankan seluruh file sebagai satu query (begin ... rollback di akhir
--   membersihkan data uji; GRANT untuk T9 ikut rollback).
-- CATATAN: tes ini TIDAK BOLEH dijalankan di database produksi berisi data
-- nyata — hanya database bersih/preview. Tes memakai JWT claims palsu lewat
-- set_config('request.jwt.claims') untuk mensimulasikan tiap pengguna.
--
-- RIWAYAT PERBAIKAN (v2, 2026-11-19 — lihat docs/rls-test-fix.md):
--   - Setup T7 (INSERT undangan) dipindah ke setup postgres — sebelumnya
--     dijalankan sebagai authenticated B ke workspace A → 42501, transaksi
--     abort sebelum finish().
--   - throws_ok dipakai bentuk 4 argumen (sql, kode SQLSTATE, pola pesan
--     error, deskripsi) — v2 memakai 3 argumen dan GAGAL 3 tes karena pgTAP
--     yang terpasang memperlakukan argumen ke-3 sebagai pola pesan error,
--     bukan deskripsi (diperbaiki v2.1, 2026-11-19). v2.1 masih gagal 3 tes
--     karena pola hanya awalan pesan, sedangkan pgTAP mencocokkan dengan
--     SELURUH pesan error (v2.2: pola = pesan lengkap, termasuk akhiran
--     'for table ...' dan nama constraint, 2026-11-19).
--   - T3/T4b diganti asersi jumlah baris terpengaruh (CTE UPDATE/DELETE +
--     is(count, 0)) — UPDATE/DELETE di bawah RLS tidak melempar exception;
--     policy memfilter baris → 0 baris terpengaruh.
--   - T8 memakai UUID uji nyata (placeholder :'user_a'/:'user_b') — UUID
--     palsu 1111.../2222... ditolak foreign key (23503) sebelum unique
--     constraint sempat diperiksa.
--   - T9: GRANT SELECT ke anon di dalam transaksi (ikut rollback).
--   - plan(14) kini benar: 14 asersi (T3 punya 2 asersi — 0 baris terpengaruh
--     + role tetap 'owner').
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
-- Nilai di bawah HANYA placeholder psql — jalankan dengan -v user_a/user_b
-- (atau ganti literal di SQL Editor); tanpa itu setup gagal di foreign key.
\set user_a '11111111-1111-1111-1111-111111111111'
\set user_b '22222222-2222-2222-2222-222222222222'

-- ---------------------------------------------------------------------------
-- Setup: organisasi + workspace + member + undangan T7
-- (sebagai postgres, bypass RLS).
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

-- Undangan kedaluwarsa untuk T7 — WAJIB di setup postgres: policy INSERT
-- workspace_invitations hanya mengizinkan owner/admin workspace; user B
-- bukan member workspace A, jadi INSERT ini sebagai authenticated B selalu
-- ditolak 42501 dan menggugurkan seluruh transaksi (cacat v1).
insert into public.workspace_invitations (workspace_id, email, role, token_hash, status, expires_at, invited_by)
values ('b0000000-0000-0000-0000-000000000001', 'b@example.com', 'creator',
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'pending',
        now() - interval '1 day', :'user_a')
on conflict (token_hash) do nothing;

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
-- UPDATE di bawah RLS TIDAK melempar exception: policy memfilter baris
-- (0 baris terpengaruh). Karena itu T3 memakai 2 asersi jumlah/nilai:
--   (a) UPDATE oleh B tidak mengubah baris apa pun (count = 0);
--   (b) role user A tetap 'owner' (dibaca sebagai A sendiri).
-- Targetnya user A NYATA (barisnya ada) — menarget UUID yang tidak ada
-- akan lolos sepele tanpa menguji policy.
-- ============================================================================
select _set_user(:'user_b');
with upd as (
  update public.workspace_members set workspace_role = 'viewer_client'
  where workspace_id = 'b0000000-0000-0000-0000-000000000001' and user_id = :'user_a'
  returning 1
)
select is(
  (select count(*) from upd)::int,
  0,
  'T3 DENY: user B tidak bisa mengubah role member workspace A (0 baris terpengaruh)'
);
select _set_user(:'user_a');
select is(
  (select workspace_role from public.workspace_members
   where workspace_id = 'b0000000-0000-0000-0000-000000000001' and user_id = :'user_a'),
  'owner',
  'T3 DENY: role user A di workspace A tetap owner setelah percobaan ubah oleh B'
);
-- User B juga tidak bisa mengubah role-nya SENDIRI menjadi owner di workspace A.
-- INSERT yang ditolak WITH CHECK melempar 42501 → throws_ok 3 argumen.
-- SQL dibangun lewat format() agar placeholder :'user_b' tersubstitusi psql
-- (interpolasi psql TIDAK terjadi di dalam string $$...$$).
select _set_user(:'user_b');
select throws_ok(
  format($f$insert into public.workspace_members (workspace_id, user_id, workspace_role)
     values ('b0000000-0000-0000-0000-000000000001', %L, 'owner')$f$, :'user_b'),
  '42501',
  'new row violates row-level security policy for table "workspace_members"',
  'T3b DENY: user B tidak bisa menyisipkan diri sebagai owner workspace A'
);

-- ============================================================================
-- TES 4 (Dok 06 §8 tes 4): viewer_client tidak bisa mutasi.
-- User B sebagai PENERIMA share (bukan member workspace A) mencoba INSERT share
-- (ditolak WITH CHECK → 42501) dan DELETE share (difilter RLS → 0 baris).
-- ============================================================================
select _set_user(:'user_b');
select throws_ok(
  format($f$insert into public.resource_shares (workspace_id, resource_type, resource_id, shared_with_user_id, shared_by)
     values ('b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000002', %L, %L)$f$, :'user_b', :'user_b'),
  '42501',
  'new row violates row-level security policy for table "resource_shares"',
  'T4 DENY: penerima share (bukan member workspace) tidak bisa membuat share'
);
with del as (
  delete from public.resource_shares where id = 'c0000000-0000-0000-0000-000000000001' returning 1
)
select is(
  (select count(*) from del)::int,
  0,
  'T4b DENY: penerima share tidak bisa mencabut share (0 baris terhapus)'
);

-- ============================================================================
-- TES 5 (Dok 06 §8 tes 4/portal): portal allow + deny.
-- ALLOW: user B (penerima) bisa membaca share-nya. DENY: user B TIDAK bisa
-- membaca share yang TIDAK dibagikan ke dia (UUID guessing di portal).
-- T5 sekaligus membuktikan share c0000000... masih ada setelah percobaan T4b.
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
-- Baris undangan sudah dibuat di setup postgres (lihat atas); di sini hanya
-- asersinya. Email JWT harus cocok dengan email undangan ('b@example.com').
-- ============================================================================
select _set_user(:'user_b', 'b@example.com');
select is(
  (select accept_invitation('deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef') ->> 'ok'),
  'false',
  'T7 DENY: undangan kedaluwarsa ditolak fungsi accept_invitation'
);

-- ============================================================================
-- TES 8: duplikasi share ditolak (unique constraint — idempotency dasar).
-- Dijalankan sebagai postgres (bypass RLS) agar yang diuji murni unique
-- constraint. shared_with/shared_by memakai UUID uji NYATA (placeholder):
-- UUID palsu ditolak foreign key (23503) sebelum unique constraint diperiksa.
-- SQL dibangun lewat format() agar placeholder tersubstitusi psql
-- (interpolasi psql TIDAK terjadi di dalam string $$...$$).
-- ============================================================================
reset role;
select throws_ok(
  format($f$insert into public.resource_shares (workspace_id, resource_type, resource_id, shared_with_user_id, shared_by)
     values ('b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000001', %L, %L)$f$, :'user_b', :'user_a'),
  '23505',
  'duplicate key value violates unique constraint "resource_shares_resource_type_resource_id_shared_with_user__key"',
  'T8 DENY: share duplikat (resource + klien sama) ditolak unique constraint'
);

-- ============================================================================
-- TES 9: anon (belum login) tidak bisa membaca apa pun.
-- GRANT SELECT ke anon diperlukan agar query is_empty bisa dieksekusi
-- (tanpa grant, error 42501 permission denied, bukan hasil RLS).
-- Grant ini DI DALAM transaksi file (ikut rollback di akhir) — tidak
-- mengubah database secara permanen. Policy RLS 'to authenticated' tetap
-- yang menolak anon: query jalan, hasilnya 0 baris.
-- ============================================================================
grant select on public.workspaces to anon;
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
