-- 11_rls_member_owner_guard.sql
-- pgTAP: guard eskalasi owner pada workspace_members & organization_members
-- (migrasi 0027 - T-1/T-2/T-3 Batch 1 Putaran Tinggi MaTive).
--
-- Menjalankan:
--   - psql: psql "$DATABASE_URL" -v user_a=11111111-1111-1111-1111-111111111111 \
--           -v user_b=22222222-2222-2222-2222-222222222222 \
--           -v user_c=33333333-3333-3333-3333-333333333333 \
--           -v user_d=44444444-4444-4444-4444-444444444444 \
--           -v user_e=55555555-5555-5555-5555-555555555555 \
--           -f supabase/tests/11_rls_member_owner_guard.sql
--   - SQL Editor Supabase: hapus 5 baris \set di bawah, ganti :'user_a' dst
--     dengan UUID literal yang sama, tempel seluruh isi, Ctrl+A, Run sekali.
--   - File ini berjalan dalam begin...rollback: tidak ada residu.
--   - JANGAN jalankan di database produksi berisi data nyata; hanya di
--     database bersih/preview (membuat fixture G1 lalu menghapusnya).
--
-- Konvensi (diikuti dari 09_rls_critical_k1.sql):
--   - JANGAN pakai :'user_x' di dalam blok $$...$$ - teruskan UUID sebagai
--     parameter fungsi (format $f$...$f$ dengan %L, atau pemakaian langsung
--     :'user_x' di SQL biasa di luar $$).
--   - Asersi penolakan memakai throws_ok dengan errcode '42501': trigger
--     guard di 0027 memakai ERRCODE '42501' supaya tampak seperti
--     penolakan RLS. Pesan yang diharapkan ditulis TANPA titik akhir
--     (pgTAP mencocokkan pesan sebagai pola).
--   - Semua perbandingan count di-cast ke int (count mengembalikan bigint).
--   - Cleanup HARUS sebagai postgres (reset role), urutan daun -> akar.

\set user_a 11111111-1111-1111-1111-111111111111
\set user_b 22222222-2222-2222-2222-222222222222
\set user_c 33333333-3333-3333-3333-333333333333
\set user_d 44444444-4444-4444-4444-444444444444
\set user_e 55555555-5555-5555-5555-555555555555

begin;
select plan(53);

-- Helper: berpura-pura menjadi user (meniru klaim JWT), seperti di 09.
create or replace function _set_user(p_user uuid, p_email text default 'test@example.com')
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email)::text, true);
$$;

-- Setup: org G1 + workspace G1 + member (sebagai postgres, bypass RLS).
-- User A = owner org + owner WS-G1. User B = admin org + admin WS-G1.
-- User C = member org + editor WS-G1. User D = co-owner org + co-owner WS-G1
-- (role owner, BUKAN organizations.owner_user_id). User E = tanpa baris member.
insert into public.organizations (id, name, slug, owner_user_id)
values ('a1000000-0000-0000-0000-000000000001', 'Org G1 (guard test)', 'org-g1-test', :'user_a')
on conflict (slug) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at)
values ('a1000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('a1000000-0000-0000-0000-000000000001', :'user_b', 'admin', 'active', now()),
       ('a1000000-0000-0000-0000-000000000001', :'user_c', 'member', 'active', now()),
       ('a1000000-0000-0000-0000-000000000001', :'user_d', 'owner', 'active', now())
on conflict (organization_id, user_id) do nothing;

insert into public.workspaces (id, organization_id, name, slug, timezone)
values ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Workspace G1 (guard test)', 'ws-g1-test', 'Asia/Jakarta')
on conflict (organization_id, slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
values ('b1000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('b1000000-0000-0000-0000-000000000001', :'user_b', 'admin', 'active', now()),
       ('b1000000-0000-0000-0000-000000000001', :'user_c', 'editor', 'active', now()),
       ('b1000000-0000-0000-0000-000000000001', :'user_d', 'owner', 'active', now())
on conflict (workspace_id, user_id) do nothing;

-- TES 1: objek guard 0027 ada (7 asersi).
select is((select count(*)::int from pg_trigger where tgname = 'trg_guard_ws_member_update'), 1, 'T1a trigger trg_guard_ws_member_update ada');
select is((select count(*)::int from pg_trigger where tgname = 'trg_guard_ws_member_delete'), 1, 'T1b trigger trg_guard_ws_member_delete ada');
select is((select count(*)::int from pg_trigger where tgname = 'trg_guard_org_member_update'), 1, 'T1c trigger trg_guard_org_member_update ada');
select is((select count(*)::int from pg_trigger where tgname = 'trg_guard_org_member_delete'), 1, 'T1d trigger trg_guard_org_member_delete ada');
select is((select count(*)::int from pg_policies where tablename = 'workspace_members' and policyname = 'ws_members_insert_owner_admin'), 1, 'T1e policy ws_members_insert_owner_admin ada');
select is((select count(*)::int from pg_policies where tablename = 'organization_members' and policyname = 'org_members_insert_owner_or_admin'), 1, 'T1f policy org_members_insert_owner_or_admin ada');
select is((select count(*)::int from pg_policies where tablename = 'workspace_invitations' and policyname = 'ws_invitations_insert_owner_admin'), 1, 'T1g policy ws_invitations_insert_owner_admin ada');

-- TES 2: T-1 UPDATE workspace_members (13 asersi).
set local role authenticated;
select _set_user(:'user_b');
select throws_ok(format($f$update public.workspace_members set workspace_role = 'owner' where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = %L$f$, :'user_c'), '42501', 'Hanya owner workspace yang boleh memberi role owner.', 'T2a DENY admin menaikkan editor menjadi owner');
select is((select count(*)::int from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_c' and workspace_role = 'owner'), 0, 'T2a C tetap editor');
select throws_ok(format($f$update public.workspace_members set workspace_role = 'admin' where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = %L$f$, :'user_a'), '42501', 'Hanya owner yang bersangkutan yang boleh mengubah baris owner workspace.', 'T2b DENY admin menurunkan owner');
select is((select workspace_role from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_a'), 'owner', 'T2b A tetap owner');
select throws_ok(format($f$update public.workspace_members set membership_status = 'suspended' where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = %L$f$, :'user_a'), '42501', 'Hanya owner yang bersangkutan yang boleh mengubah baris owner workspace.', 'T2c DENY admin mengubah status baris owner');
select is((select membership_status from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_a'), 'active', 'T2c status A tetap active');
select throws_ok(format($f$update public.workspace_members set user_id = %L where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = %L$f$, :'user_d', :'user_c'), '42501', 'Perubahan user_id/workspace_id pada workspace_members tidak diizinkan.', 'T2d DENY admin mengubah user_id baris member');
select is((select count(*)::int from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_c'), 1, 'T2d baris C tetap milik C');
select _set_user(:'user_a');
update public.workspace_members set workspace_role = 'admin' where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_c';
select is((select workspace_role from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_c'), 'admin', 'T2e ALLOW owner mengubah editor menjadi admin');
update public.workspace_members set workspace_role = 'editor' where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_c';
select _set_user(:'user_d');
select throws_ok(format($f$update public.workspace_members set workspace_role = 'admin' where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = %L$f$, :'user_a'), '42501', 'Hanya owner yang bersangkutan yang boleh mengubah baris owner workspace.', 'T2f DENY owner lain menurunkan owner');
select is((select workspace_role from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_a'), 'owner', 'T2f A tetap owner');
select _set_user(:'user_a');
update public.workspace_members set workspace_role = 'admin' where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_a';
select is((select workspace_role from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_a'), 'admin', 'T2g ALLOW owner menurunkan role diri sendiri (sesuai desain: owner sudah memegang kuasa penuh)');
select _set_user(:'user_d');
update public.workspace_members set workspace_role = 'owner' where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_a';
select is((select workspace_role from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_a'), 'owner', 'T2g owner lain mengembalikan A menjadi owner');

-- TES 3: T-1 DELETE workspace_members (4 asersi).
select _set_user(:'user_a');
select throws_ok(format($f$delete from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = %L$f$, :'user_d'), '42501', 'Hanya owner yang bersangkutan yang boleh menghapus baris owner workspace.', 'T3a DENY owner menghapus owner lain');
select is((select count(*)::int from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_d'), 1, 'T3a D tetap member');
delete from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_c';
select is((select count(*)::int from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_c'), 0, 'T3b ALLOW owner menghapus editor');
insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at) values ('b1000000-0000-0000-0000-000000000001', :'user_c', 'editor', 'active', now());
select is((select count(*)::int from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_c'), 1, 'T3b C disisipkan kembali sebagai editor oleh owner');

-- TES 4: T-2 UPDATE organization_members (11 asersi).
select _set_user(:'user_b');
select throws_ok(format($f$update public.organization_members set organization_role = 'admin' where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = %L$f$, :'user_a'), '42501', 'Hanya owner yang bersangkutan atau owner organisasi yang boleh mengubah baris owner organisasi.', 'T4a DENY admin menurunkan owner organisasi');
select is((select organization_role from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_a'), 'owner', 'T4a A tetap owner organisasi');
select throws_ok(format($f$update public.organization_members set organization_role = 'owner' where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = %L$f$, :'user_b'), '42501', 'Hanya owner organisasi yang boleh mengubah role dari/ke owner.', 'T4b DENY admin mempromosikan diri menjadi owner organisasi');
select is((select organization_role from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_b'), 'admin', 'T4b B tetap admin organisasi');
select throws_ok(format($f$update public.organization_members set user_id = %L where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = %L$f$, :'user_d', :'user_c'), '42501', 'Perubahan user_id/organization_id pada organization_members tidak diizinkan.', 'T4c DENY admin mengubah user_id baris member organisasi');
select is((select count(*)::int from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_c'), 1, 'T4c baris C tetap milik C');
select _set_user(:'user_a');
update public.organization_members set organization_role = 'admin' where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_c';
select is((select organization_role from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_c'), 'admin', 'T4d ALLOW owner organisasi mengubah member menjadi admin');
update public.organization_members set organization_role = 'member' where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_c';
update public.organization_members set organization_role = 'owner' where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_b';
select is((select organization_role from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_b'), 'owner', 'T4e ALLOW owner organisasi mengangkat admin menjadi co-owner');
update public.organization_members set organization_role = 'admin' where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_b';
select is((select organization_role from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_b'), 'admin', 'T4e owner organisasi mendemosi co-owner kembali menjadi admin');
select _set_user(:'user_b');
select throws_ok(format($f$update public.organization_members set organization_role = 'owner' where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = %L$f$, :'user_c'), '42501', 'Hanya owner organisasi yang boleh mengubah role dari/ke owner.', 'T4f DENY admin memberi role owner ke member');
select is((select organization_role from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_c'), 'member', 'T4f C tetap member organisasi');

-- TES 5: T-2 DELETE organization_members (4 asersi).
select _set_user(:'user_d');
select throws_ok(format($f$delete from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = %L$f$, :'user_a'), '42501', 'Hanya owner yang bersangkutan atau owner organisasi yang boleh menghapus baris owner organisasi.', 'T5a DENY co-owner menghapus owner organisasi');
select is((select count(*)::int from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_a'), 1, 'T5a A tetap member organisasi');
select _set_user(:'user_a');
delete from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_c';
select is((select count(*)::int from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_c'), 0, 'T5b ALLOW owner organisasi menghapus member');
insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at) values ('a1000000-0000-0000-0000-000000000001', :'user_c', 'member', 'active', now());
select is((select count(*)::int from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_c'), 1, 'T5b C disisipkan kembali sebagai member oleh owner organisasi');

-- TES 6: T-3 INSERT workspace_invitations (4 asersi).
select _set_user(:'user_b');
select throws_ok(format($f$insert into public.workspace_invitations (workspace_id, email, role, token_hash, expires_at, invited_by) values ('b1000000-0000-0000-0000-000000000001', 'owner-invite-g1@example.com', 'owner', 'tok-g1-owner-b', now() + interval '7 days', %L)$f$, :'user_b'), '42501', 'new row violates row-level security policy for table "workspace_invitations"', 'T6a DENY admin mengundang owner');
select is((select count(*)::int from public.workspace_invitations where workspace_id = 'b1000000-0000-0000-0000-000000000001' and role = 'owner'), 0, 'T6a tidak ada undangan owner');
select _set_user(:'user_a');
insert into public.workspace_invitations (workspace_id, email, role, token_hash, expires_at, invited_by) values ('b1000000-0000-0000-0000-000000000001', 'owner-invite-g1@example.com', 'owner', 'tok-g1-owner-a', now() + interval '7 days', :'user_a');
select is((select count(*)::int from public.workspace_invitations where workspace_id = 'b1000000-0000-0000-0000-000000000001' and role = 'owner'), 1, 'T6b ALLOW owner mengundang owner');
select _set_user(:'user_b');
insert into public.workspace_invitations (workspace_id, email, role, token_hash, expires_at, invited_by) values ('b1000000-0000-0000-0000-000000000001', 'editor-invite-g1@example.com', 'editor', 'tok-g1-editor-b', now() + interval '7 days', :'user_b');
select is((select count(*)::int from public.workspace_invitations where workspace_id = 'b1000000-0000-0000-0000-000000000001' and role = 'editor'), 1, 'T6c ALLOW admin mengundang editor');

-- TES 7: T-1 INSERT workspace_members (3 asersi).
select throws_ok(format($f$insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at) values ('b1000000-0000-0000-0000-000000000001', %L, 'owner', 'active', now())$f$, :'user_e'), '42501', 'new row violates row-level security policy for table "workspace_members"', 'T7a DENY admin menyisipkan owner baru');
select is((select count(*)::int from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_e'), 0, 'T7a E belum member workspace');
select _set_user(:'user_a');
insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at) values ('b1000000-0000-0000-0000-000000000001', :'user_e', 'editor', 'active', now());
select is((select count(*)::int from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_e'), 1, 'T7b ALLOW owner menyisipkan editor baru');

-- TES 8: T-2 INSERT organization_members (3 asersi).
select _set_user(:'user_b');
select throws_ok(format($f$insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at) values ('a1000000-0000-0000-0000-000000000001', %L, 'owner', 'active', now())$f$, :'user_e'), '42501', 'new row violates row-level security policy for table "organization_members"', 'T8a DENY admin menyisipkan owner organisasi baru');
select is((select count(*)::int from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_e'), 0, 'T8a E belum member organisasi');
select _set_user(:'user_a');
insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at) values ('a1000000-0000-0000-0000-000000000001', :'user_e', 'member', 'active', now());
select is((select count(*)::int from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_e'), 1, 'T8b ALLOW owner organisasi menyisipkan member baru');

-- TES 9: data fixture utuh sesudah semua percobaan serangan (4 asersi).
select is((select workspace_role from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_a'), 'owner', 'T9a A tetap owner WS-G1');
select is((select workspace_role from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001' and user_id = :'user_b'), 'admin', 'T9b B tetap admin WS-G1');
select is((select organization_role from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_a'), 'owner', 'T9c A tetap owner Org-G1');
select is((select organization_role from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001' and user_id = :'user_b'), 'admin', 'T9d B tetap admin Org-G1');

-- Cleanup (HARUS sebagai postgres: authenticated tidak boleh DELETE
-- baris owner; urutan daun -> akar). Rollback di akhir tetap membersihkan
-- bila cleanup ini terlewat.
reset role;
-- reset role TIDAK menghapus klaim JWT lokal yang diset _set_user:
-- auth.uid() masih pengguna terakhir, sehingga trigger guard menolak
-- penghapusan baris owner lain di cleanup. Kosongkan klaim ('{}')
-- supaya auth.uid() NULL (= postgres murni / service role).
select set_config('request.jwt.claims', '{}', true);
delete from public.workspace_invitations where workspace_id = 'b1000000-0000-0000-0000-000000000001';
delete from public.workspace_members where workspace_id = 'b1000000-0000-0000-0000-000000000001';
delete from public.workspaces where id = 'b1000000-0000-0000-0000-000000000001';
delete from public.organization_members where organization_id = 'a1000000-0000-0000-0000-000000000001';
delete from public.organizations where id = 'a1000000-0000-0000-0000-000000000001';
drop function if exists _set_user(uuid, text);
select * from finish();
rollback;
