-- pgTAP Batch S-1 (temuan S-8, migrasi 0034): accept_invitation() menolak
-- bila invited_by bukan lagi owner/admin aktif, dan menolak bila penerima
-- sudah menjadi anggota aktif. Pemeriksaan lama (hash, pending,
-- kedaluwarsa, email) tetap diuji. Satu workspace per kasus, karena
-- unique(workspace_id, email, status) hanya mengizinkan satu undangan
-- pending per email di tiap workspace.
-- Dijalankan:
--   psql "$DATABASE_URL" -v user_a='094e8752-eef4-4f0e-b6ae-2d5813445018' -v user_b='aabb1dab-77c1-4659-af0e-c703c9de279c' -f supabase/tests/18_batch_s1_invitation_checks.sql
-- user_a = owner A (pengundang); user_b = creator B; user C =
-- 'b2e98541-1162-4cc7-9835-603a217e0d1b' (pola yang sama seperti test 13).

begin;
select plan(17);

create or replace function _set_user(p_user uuid, p_email text default 'test@example.com')
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email)::text, true);
$$;

-- Helper SECURITY DEFINER (dibuat di dalam transaksi, ikut rollback):
-- membaca status undangan / keanggotaan tanpa peduli RLS pemanggil.
create or replace function inv_status(p_id uuid)
returns text language sql stable security definer
set search_path = public, pg_temp
as $$ select status::text from public.workspace_invitations where id = p_id; $$;

create or replace function member_exists(p_ws uuid, p_user uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$ select exists (select 1 from public.workspace_members where workspace_id = p_ws and user_id = p_user and membership_status = 'active'); $$;

create or replace function demote_to_viewer(p_ws uuid, p_user uuid)
returns void language sql security definer
set search_path = public, pg_temp
as $$ update public.workspace_members set workspace_role = 'viewer_client' where workspace_id = p_ws and user_id = p_user; $$;

-- Log hasil accept: satu panggilan RPC per kasus, hasilnya dicek dari log.
create table accept_log (case_name text primary key, ok boolean, message text, workspace_id uuid);
grant all on accept_log to authenticated;

-- RPC menerima hash sha256 hex dari token dan mengembalikan jsonb.
create or replace function do_accept(p_case text, p_token text)
returns void language plpgsql as $$
declare
  v_res jsonb;
begin
  v_res := public.accept_invitation(encode(sha256(p_token::bytea), 'hex'));
  insert into accept_log values (p_case, (v_res ->> 'ok')::boolean, v_res ->> 'message', (v_res ->> 'workspace_id')::uuid);
exception
  when others then
    insert into accept_log values (p_case, false, 'ERROR: ' || sqlerrm, null);
end
$$;

-- Fixtures (postgres, bypass RLS).
insert into public.organizations (id, name, slug, owner_user_id) values
  ('a7000000-0000-0000-0000-000000000002', 'Org Batch S1 Inv', 'org-batch-s1-inv', :'user_a')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at) values
  ('a7000000-0000-0000-0000-000000000002', :'user_a', 'owner', 'active', now());

insert into public.workspaces (id, organization_id, name, slug, timezone) values
  ('b7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000002', 'WS S1 Demoted', 'ws-s1-demoted', 'Asia/Jakarta'),
  ('b7000000-0000-0000-0000-000000000003', 'a7000000-0000-0000-0000-000000000002', 'WS S1 Member', 'ws-s1-member', 'Asia/Jakarta'),
  ('b7000000-0000-0000-0000-000000000004', 'a7000000-0000-0000-0000-000000000002', 'WS S1 Valid', 'ws-s1-valid', 'Asia/Jakarta'),
  ('b7000000-0000-0000-0000-000000000005', 'a7000000-0000-0000-0000-000000000002', 'WS S1 Expired', 'ws-s1-expired', 'Asia/Jakarta'),
  ('b7000000-0000-0000-0000-000000000006', 'a7000000-0000-0000-0000-000000000002', 'WS S1 Wrong', 'ws-s1-wrong', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at) values
  ('b7000000-0000-0000-0000-000000000002', :'user_a', 'owner', 'active', now()),
  ('b7000000-0000-0000-0000-000000000003', :'user_a', 'owner', 'active', now()),
  ('b7000000-0000-0000-0000-000000000003', :'user_b', 'creator', 'active', now()),
  ('b7000000-0000-0000-0000-000000000004', :'user_a', 'owner', 'active', now()),
  ('b7000000-0000-0000-0000-000000000005', :'user_a', 'owner', 'active', now()),
  ('b7000000-0000-0000-0000-000000000006', :'user_a', 'owner', 'active', now());

insert into public.workspace_invitations (id, workspace_id, email, role, token_hash, status, expires_at, invited_by) values
  ('d7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002', 'mative-test-b@example.com', 'creator', encode(sha256('s1-token-demoted'::bytea), 'hex'), 'pending', now() + interval '7 days', :'user_a'),
  ('d7000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000003', 'mative-test-b@example.com', 'creator', encode(sha256('s1-token-member'::bytea), 'hex'), 'pending', now() + interval '7 days', :'user_a'),
  ('d7000000-0000-0000-0000-000000000003', 'b7000000-0000-0000-0000-000000000004', 'mative-test-c@example.com', 'creator', encode(sha256('s1-token-valid'::bytea), 'hex'), 'pending', now() + interval '7 days', :'user_a'),
  ('d7000000-0000-0000-0000-000000000004', 'b7000000-0000-0000-0000-000000000005', 'mative-test-c@example.com', 'creator', encode(sha256('s1-token-expired'::bytea), 'hex'), 'pending', now() - interval '1 day', :'user_a'),
  ('d7000000-0000-0000-0000-000000000005', 'b7000000-0000-0000-0000-000000000006', 'mative-test-c@example.com', 'creator', encode(sha256('s1-token-wrong'::bytea), 'hex'), 'pending', now() + interval '7 days', :'user_a')
on conflict (id) do nothing;

set local role authenticated;

-- Kasus valid: pengundang masih owner, penerima bukan anggota.
select _set_user('b2e98541-1162-4cc7-9835-603a217e0d1b', 'mative-test-c@example.com');
select do_accept('valid', 's1-token-valid');
select is((select ok from accept_log where case_name = 'valid'), true, 'accept valid: ok=true');
select is((select message from accept_log where case_name = 'valid'), 'Undangan diterima.', 'accept valid: pesan sukses');
select is(member_exists('b7000000-0000-0000-0000-000000000004', 'b2e98541-1162-4cc7-9835-603a217e0d1b'), true, 'accept valid: penerima menjadi anggota aktif');
select is(inv_status('d7000000-0000-0000-0000-000000000003'), 'accepted', 'accept valid: status undangan accepted');

-- Kasus sudah anggota: B sudah anggota aktif, undangan ditujukan ke B.
select _set_user(:'user_b', 'mative-test-b@example.com');
select do_accept('member', 's1-token-member');
select is((select ok from accept_log where case_name = 'member'), false, 'accept sudah-anggota: ok=false');
select is((select message from accept_log where case_name = 'member'), 'Anda sudah menjadi anggota aktif workspace ini.', 'accept sudah-anggota: pesan sudah anggota');
select is(inv_status('d7000000-0000-0000-0000-000000000002'), 'pending', 'accept sudah-anggota: undangan tetap pending');

-- Kasus kedaluwarsa: pemeriksaan lama tetap bekerja.
select _set_user('b2e98541-1162-4cc7-9835-603a217e0d1b', 'mative-test-c@example.com');
select do_accept('expired', 's1-token-expired');
select is((select ok from accept_log where case_name = 'expired'), false, 'accept kedaluwarsa: ok=false');
select is((select message from accept_log where case_name = 'expired'), 'Undangan sudah kedaluwarsa (7 hari).', 'accept kedaluwarsa: pesan kedaluwarsa');
select is(inv_status('d7000000-0000-0000-0000-000000000004'), 'pending', 'accept kedaluwarsa: undangan tetap pending (fungsi tidak menandai expired)');

-- Kasus email salah: B menerima undangan yang ditujukan ke C.
select _set_user(:'user_b', 'mative-test-b@example.com');
select do_accept('wrong', 's1-token-wrong');
select is((select ok from accept_log where case_name = 'wrong'), false, 'accept email-salah: ok=false');
select is((select message from accept_log where case_name = 'wrong'), 'Undangan ini ditujukan ke email lain.', 'accept email-salah: pesan email lain');
select is(inv_status('d7000000-0000-0000-0000-000000000005'), 'pending', 'accept email-salah: undangan tetap pending');

-- Kasus pengundang dicabut: A (owner) menurunkan dirinya sendiri jadi
-- viewer_client (trigger workspace_members hanya mengizinkan owner yang
-- bersangkutan mengubah baris owner), lalu B menerima.
select _set_user(:'user_a', 'mative-test-a@example.com');
select demote_to_viewer('b7000000-0000-0000-0000-000000000002', :'user_a');
select _set_user(:'user_b', 'mative-test-b@example.com');
select do_accept('demoted', 's1-token-demoted');
select is((select ok from accept_log where case_name = 'demoted'), false, 'accept pengundang-dicabut: ok=false');
select is((select message from accept_log where case_name = 'demoted'), 'Undangan ini tidak lagi berlaku karena pengundang bukan lagi owner atau admin workspace.', 'accept pengundang-dicabut: pesan pengundang');
select is(inv_status('d7000000-0000-0000-0000-000000000001'), 'pending', 'accept pengundang-dicabut: undangan tetap pending');
select is(member_exists('b7000000-0000-0000-0000-000000000002', :'user_b'), false, 'accept pengundang-dicabut: tidak ada baris member baru');

select * from finish();
rollback;
