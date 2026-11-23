-- MaTive -- pgTAP 13: Perbaikan (c) T-1..T-4 (0029)
-- =====================================================
-- T-4: komentar biasa memberi notifikasi 'comment_created' ke pemilik konten
--   + assignee tugas; tanpa ganda (mention/balasan/penulis sendiri).
-- T-1: sweep_stale_asset_uploads menandai 'uploading' lama menjadi 'failed'.
-- T-3: restore_asset_version memulihkan versi lama sebagai versi BARU.
-- Pola mengikuti 12_rls_publishing_recovery_t1_t5.sql: begin...rollback,
-- _set_user(), fixture di dalam transaksi, plan() eksplisit.
-- CATATAN: fungsi 0029 mengembalikan jsonb {ok, ...} (bukan raise), jadi
-- penolakan diuji lewat ok=false/code, bukan helper exception.
begin;
select plan(40);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
create or replace function _set_user(p_user uuid, p_email text)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email)::text, true);
$$;
create or replace function _as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{}', true);
$$;

-- Hitung notifikasi tanpa RLS: asersi berjalan sebagai role authenticated,
-- dan policy SELECT notifications hanya memperlihatkan notifikasi milik
-- sendiri, jadi hitungan lintas-pengguna harus lewat fungsi security
-- definer ini (dibuat di dalam transaksi, ikut rollback).
create or replace function _notif_count(p_recipient uuid, p_type text, p_target uuid)
returns bigint language sql security definer as $$
  select count(*) from public.notifications
  where (p_recipient is null or recipient_user_id = p_recipient)
    and (p_type is null or type = p_type)
    and (p_target is null or target_id = p_target);
$$;

insert into public.organizations (id, name, slug, owner_user_id)
values ('c8000000-0000-0000-0000-000000000001', 'Org C8', 'org-c8-pgtap13', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.workspaces (id, organization_id, name, slug, timezone)
values ('d8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000001', 'WS C8', 'ws-c8-pgtap13', 'Asia/Jakarta');
insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
values
  ('d8000000-0000-0000-0000-000000000001', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'owner', 'active', now()),
  ('d8000000-0000-0000-0000-000000000001', 'aabb1dab-77c1-4659-af0e-c703c9de279c', 'creator', 'active', now()),
  ('d8000000-0000-0000-0000-000000000001', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'creator', 'active', now());
insert into public.brands (id, workspace_id, name, slug, status)
values ('e8100000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001', 'Brand C8', 'brand-c8-pgtap13', 'active');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone)
values ('e8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001', 'e8100000-0000-0000-0000-000000000001', 'Konten C8', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.tasks (id, workspace_id, title, status, priority, assignee_user_id, parent_type, parent_id, created_by)
values ('f8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001', 'Tugas C8', 'todo', 'medium', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'content_item', 'e8000000-0000-0000-0000-000000000001', '094e8752-eef4-4f0e-b6ae-2d5813445018');
-- Aset siap + 2 versi (saat ini v2), aset uploading basi + aset uploading segar.
insert into public.assets (id, workspace_id, object_key, original_filename, mime_type, byte_size, uploaded_by, processing_status, created_at)
values
  ('a8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001/a8000000-0000-0000-0000-000000000001/v2.png', 'gambar-v2.png', 'image/png', 2048, '094e8752-eef4-4f0e-b6ae-2d5813445018', 'ready', now()),
  ('a8000000-0000-0000-0000-000000000002', 'd8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001/a8000000-0000-0000-0000-000000000002/basi.png', 'basi.png', 'image/png', 1024, 'aabb1dab-77c1-4659-af0e-c703c9de279c', 'uploading', now() - interval '2 hours'),
  ('a8000000-0000-0000-0000-000000000003', 'd8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001/a8000000-0000-0000-0000-000000000003/segar.png', 'segar.png', 'image/png', 1024, 'aabb1dab-77c1-4659-af0e-c703c9de279c', 'uploading', now());
insert into public.asset_versions (id, asset_id, version_number, storage_object_key, mime_type, byte_size, uploaded_by)
values
  ('b8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000001', 1, 'd8000000-0000-0000-0000-000000000001/a8000000-0000-0000-0000-000000000001/v1.png', 'image/png', 1024, '094e8752-eef4-4f0e-b6ae-2d5813445018'),
  ('b8000000-0000-0000-0000-000000000002', 'a8000000-0000-0000-0000-000000000001', 2, 'd8000000-0000-0000-0000-000000000001/a8000000-0000-0000-0000-000000000001/v2.png', 'image/png', 2048, '094e8752-eef4-4f0e-b6ae-2d5813445018');

-- ---------------------------------------------------------------------------
-- T-4: comment_created ke pemilik konten
-- ---------------------------------------------------------------------------
select public._set_user('aabb1dab-77c1-4659-af0e-c703c9de279c', 'mative-test-b@example.com');
set local role authenticated;
do $$
declare
  v_result jsonb;
  v_comment_id uuid;
begin
  select public.create_comment_with_mentions(
  'd8000000-0000-0000-0000-000000000001',
  'content_item', 'e8000000-0000-0000-0000-000000000001', null, 'Komentar biasa tanpa mention', '{}'::uuid[]) into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-4: komentar biasa berhasil dibuat');
  v_comment_id := (v_result->>'comment_id')::uuid;
  perform ok(
    public._notif_count('094e8752-eef4-4f0e-b6ae-2d5813445018', 'comment_created', v_comment_id) = 1,
    'T-4: pemilik konten mendapat 1 notifikasi comment_created');
  perform ok(
    public._notif_count('aabb1dab-77c1-4659-af0e-c703c9de279c', 'comment_created', v_comment_id) = 0,
    'T-4: penulis komentar tidak mendapat notifikasi untuk komentarnya sendiri');
  perform ok(
    public._notif_count(null, null, v_comment_id) = 1,
    'T-4: tepat 1 notifikasi untuk komentar biasa (tanpa ganda)');
end $$;

-- T-4: komentar pada tugas -- pembuat tugas + assignee sama-sama diberitahu.
do $$
declare
  v_result jsonb;
  v_comment_id uuid;
begin
  select public.create_comment_with_mentions(
  'd8000000-0000-0000-0000-000000000001',
  'task', 'f8000000-0000-0000-0000-000000000001', null, 'Komentar pada tugas', '{}'::uuid[]) into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-4: komentar pada tugas berhasil dibuat');
  v_comment_id := (v_result->>'comment_id')::uuid;
  perform ok(
    public._notif_count('094e8752-eef4-4f0e-b6ae-2d5813445018', 'comment_created', v_comment_id) = 1,
    'T-4: pembuat tugas mendapat comment_created');
  perform ok(
    public._notif_count('b2e98541-1162-4cc7-9835-603a217e0d1b', 'comment_created', v_comment_id) = 1,
    'T-4: assignee tugas mendapat comment_created');
  perform ok(
    public._notif_count(null, 'comment_created', v_comment_id) = 2,
    'T-4: tepat 2 comment_created untuk komentar tugas');
end $$;

-- T-4: mention tetap 'mention', bukan comment_created; pemilik tetap comment_created.
do $$
declare
  v_result jsonb;
  v_comment_id uuid;
begin
  select public.create_comment_with_mentions(
  'd8000000-0000-0000-0000-000000000001',
  'content_item', 'e8000000-0000-0000-0000-000000000001', null, 'Tolong cek ini', array['b2e98541-1162-4cc7-9835-603a217e0d1b']::uuid[]) into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-4: komentar dengan mention berhasil dibuat');
  v_comment_id := (v_result->>'comment_id')::uuid;
  perform ok(
    public._notif_count('094e8752-eef4-4f0e-b6ae-2d5813445018', 'comment_created', v_comment_id) = 1,
    'T-4: pemilik konten tetap mendapat comment_created saat ada mention lain');
  perform ok(
    public._notif_count('b2e98541-1162-4cc7-9835-603a217e0d1b', 'mention', v_comment_id) = 1,
    'T-4: yang di-mention mendapat mention');
  perform ok(
    public._notif_count('b2e98541-1162-4cc7-9835-603a217e0d1b', 'comment_created', v_comment_id) = 0,
    'T-4: yang di-mention tidak mendapat comment_created ganda');
end $$;

-- T-4: balasan -- pemilik (penulis komentar induk) mendapat comment_reply saja.
do $$
declare
  v_parent jsonb;
  v_parent_id uuid;
  v_result jsonb;
  v_reply_id uuid;
begin
  perform _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018', 'mative-test-a@example.com');
  select public.create_comment_with_mentions(
  'd8000000-0000-0000-0000-000000000001',
  'content_item', 'e8000000-0000-0000-0000-000000000001', null, 'Komentar induk dari pemilik', '{}'::uuid[]) into v_parent;
  -- Komentar induk ditulis pemilik sendiri: tidak ada notifikasi untuknya.
  v_parent_id := (v_parent->>'comment_id')::uuid;
  perform _set_user('aabb1dab-77c1-4659-af0e-c703c9de279c', 'mative-test-b@example.com');
  select public.create_comment_with_mentions(
  'd8000000-0000-0000-0000-000000000001',
  'content_item', 'e8000000-0000-0000-0000-000000000001', v_parent_id, 'Balasan dari creator', '{}'::uuid[]) into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-4: balasan komentar berhasil dibuat');
  v_reply_id := (v_result->>'comment_id')::uuid;
  perform ok(
    public._notif_count('094e8752-eef4-4f0e-b6ae-2d5813445018', 'comment_reply', v_reply_id) = 1,
    'T-4: penulis komentar induk mendapat comment_reply');
  perform ok(
    public._notif_count('094e8752-eef4-4f0e-b6ae-2d5813445018', 'comment_created', v_reply_id) = 0,
    'T-4: penulis komentar induk tidak mendapat comment_created ganda untuk balasan');
end $$;

-- T-4: pemilik mengomentari kontennya sendiri -- tidak ada notifikasi.
select public._set_user('094e8752-eef4-4f0e-b6ae-2d5813445018', 'mative-test-a@example.com');
do $$
declare
  v_result jsonb;
  v_comment_id uuid;
begin
  select public.create_comment_with_mentions(
  'd8000000-0000-0000-0000-000000000001',
  'content_item', 'e8000000-0000-0000-0000-000000000001', null, 'Catatan pemilik untuk diri sendiri', '{}'::uuid[]) into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-4: pemilik berhasil mengomentari kontennya sendiri');
  v_comment_id := (v_result->>'comment_id')::uuid;
  perform ok(
    public._notif_count(null, null, v_comment_id) = 0,
    'T-4: tidak ada notifikasi saat pemilik mengomentari kontennya sendiri');
end $$;

-- ---------------------------------------------------------------------------
-- T-1: sweep_stale_asset_uploads
-- ---------------------------------------------------------------------------
select public._set_user('094e8752-eef4-4f0e-b6ae-2d5813445018', 'mative-test-a@example.com');
do $$
declare
  v_result jsonb;
begin
  select public.sweep_stale_asset_uploads('d8000000-0000-0000-0000-000000000001', 60) into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-1: penyapu berjalan sebagai anggota');
  perform ok((v_result->>'swept_count')::integer = 1, 'T-1: tepat 1 unggahan basi disapu');
  perform ok(
    (v_result->'object_keys') @> '["d8000000-0000-0000-0000-000000000001/a8000000-0000-0000-0000-000000000002/basi.png"]'::jsonb,
    'T-1: penyapu mengembalikan object_key aset basi untuk pembersihan Storage');
  perform ok(
    (select processing_status from public.assets where id = 'a8000000-0000-0000-0000-000000000002') = 'failed',
    'T-1: aset uploading basi menjadi failed');
  perform ok(
    (select processing_status from public.assets where id = 'a8000000-0000-0000-0000-000000000003') = 'uploading',
    'T-1: aset uploading segar tidak tersentuh penyapu');
end $$;

-- T-1: bukan anggota tidak boleh menyapu; input tidak valid ditolak.
select public._set_user('d8f599e3-0618-483b-9205-ac1a0e095c81', 'mative-e2e-3@example.com');
do $$
declare
  v_result jsonb;
begin
  select public.sweep_stale_asset_uploads('d8000000-0000-0000-0000-000000000001', 60) into v_result;
  perform ok(not (v_result->>'ok')::boolean and v_result->>'code' = 'forbidden', 'T-1: bukan anggota ditolak penyapu (forbidden)');
end $$;
select public._set_user('094e8752-eef4-4f0e-b6ae-2d5813445018', 'mative-test-a@example.com');
do $$
declare
  v_result jsonb;
begin
  select public.sweep_stale_asset_uploads('d8000000-0000-0000-0000-000000000001', 0) into v_result;
  perform ok(not (v_result->>'ok')::boolean and v_result->>'code' = 'invalid_input', 'T-1: batas umur tidak valid ditolak (invalid_input)');
end $$;

-- ---------------------------------------------------------------------------
-- T-3: restore_asset_version
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  select public.restore_asset_version(
    'd8000000-0000-0000-0000-000000000001',
    'a8000000-0000-0000-0000-000000000001',
    'b8000000-0000-0000-0000-000000000001'
  ) into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-3: pulihkan v1 berhasil');
  perform ok((v_result->>'version_number')::integer = 3, 'T-3: pulihan tercatat sebagai v3 (baru)');
  perform ok(
    (select object_key from public.assets where id = 'a8000000-0000-0000-0000-000000000001')
      = 'd8000000-0000-0000-0000-000000000001/a8000000-0000-0000-0000-000000000001/v1.png',
    'T-3: aset mengarah kembali ke object_key v1');
  perform ok(
    (select processing_status from public.assets where id = 'a8000000-0000-0000-0000-000000000001') = 'ready',
    'T-3: aset hasil pulihan berstatus ready');
  perform ok(
    (select count(*) from public.asset_versions where asset_id = 'a8000000-0000-0000-0000-000000000001') = 3,
    'T-3: riwayat bertambah menjadi 3 versi (v1/v2 tetap ada)');
  perform ok(
    (select storage_object_key from public.asset_versions
     where asset_id = 'a8000000-0000-0000-0000-000000000001' and version_number = 3)
      = 'd8000000-0000-0000-0000-000000000001/a8000000-0000-0000-0000-000000000001/v1.png',
    'T-3: v3 menyimpan object_key v1 (append-only, bisa dipulihkan lagi)');
end $$;

-- T-3: versi tidak ada / bukan anggota / aset sedang diunggah ditolak.
do $$
declare
  v_result jsonb;
begin
  select public.restore_asset_version(
    'd8000000-0000-0000-0000-000000000001',
    'a8000000-0000-0000-0000-000000000001',
    'b8000000-0000-0000-0000-000000000099'
  ) into v_result;
  perform ok(not (v_result->>'ok')::boolean and v_result->>'code' = 'not_found', 'T-3: versi yang tidak ada ditolak (not_found)');
end $$;
select public._set_user('d8f599e3-0618-483b-9205-ac1a0e095c81', 'mative-e2e-3@example.com');
do $$
declare
  v_result jsonb;
begin
  select public.restore_asset_version(
    'd8000000-0000-0000-0000-000000000001',
    'a8000000-0000-0000-0000-000000000001',
    'b8000000-0000-0000-0000-000000000001'
  ) into v_result;
  perform ok(not (v_result->>'ok')::boolean and v_result->>'code' = 'forbidden', 'T-3: bukan anggota ditolak memulihkan versi (forbidden)');
end $$;
select public._set_user('094e8752-eef4-4f0e-b6ae-2d5813445018', 'mative-test-a@example.com');
update public.assets set processing_status = 'uploading' where id = 'a8000000-0000-0000-0000-000000000001';
do $$
declare
  v_result jsonb;
begin
  select public.restore_asset_version(
    'd8000000-0000-0000-0000-000000000001',
    'a8000000-0000-0000-0000-000000000001',
    'b8000000-0000-0000-0000-000000000002'
  ) into v_result;
  perform ok(not (v_result->>'ok')::boolean and v_result->>'code' = 'asset_uploading', 'T-3: aset yang sedang diunggah tidak bisa dipulihkan (asset_uploading)');
  perform ok(
    (select count(*) from public.asset_versions where asset_id = 'a8000000-0000-0000-0000-000000000001') = 3,
    'T-3: penolakan tidak menambah baris versi');
end $$;
update public.assets set processing_status = 'ready' where id = 'a8000000-0000-0000-0000-000000000001';

-- T-3: workspace lain tidak bisa memulihkan (aset tidak ditemukan di sana).
do $$
declare
  v_result jsonb;
begin
  select public.restore_asset_version(
    'd8000000-0000-0000-0000-000000000002',
    'a8000000-0000-0000-0000-000000000001',
    'b8000000-0000-0000-0000-000000000001'
  ) into v_result;
  perform ok(not (v_result->>'ok')::boolean and v_result->>'code' = 'not_found', 'T-3: workspace lain tidak bisa memulihkan aset ini (not_found)');
end $$;

-- ---------------------------------------------------------------------------
-- Skema 0029
-- ---------------------------------------------------------------------------
select ok(
  exists(select 1 from pg_constraint where conname = 'notifications_type_check'
    and pg_get_constraintdef(oid) like '%comment_created%'),
  'Skema: notifications_type_check mengizinkan comment_created');
select ok(
  exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'asset_versions' and column_name = 'mime_type'),
  'Skema: asset_versions memiliki kolom mime_type');
select ok(
  exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'asset_versions' and column_name = 'byte_size'),
  'Skema: asset_versions memiliki kolom byte_size');
select ok(
  exists(select 1 from pg_proc where proname = 'sweep_stale_asset_uploads'),
  'Skema: fungsi sweep_stale_asset_uploads ada');
select ok(
  exists(select 1 from pg_proc where proname = 'restore_asset_version'),
  'Skema: fungsi restore_asset_version ada');

select * from finish();
rollback;
