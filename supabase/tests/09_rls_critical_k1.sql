-- MaTive — RLS Kritis K-1: self-promotion workspace_members (pgTAP) — v1.0
-- File baru untuk migrasi 0024 (perbaikan temuan audit (a) K-1, 2026-11-21).
-- 25 asersi. Menguji: policy INSERT baru tanpa cabang self-insert +
-- RPC create_workspace_with_owner (SECURITY DEFINER, atomik) + grant.
--
-- CACAT YANG DIPERBAIKI (0006:303-312, cabang (a) policy lama):
--   anggota org biasa bisa INSERT diri sebagai owner ke workspace mana pun
--   lewat PostgREST. Sesudah 0024: cabang (a) DIHAPUS — insert langsung
--   ke workspace_members oleh diri sendiri DITOLAK (42501) dengan role
--   apa pun; satu-satunya jalur sah membuat membership owner adalah RPC
--   create_workspace_with_owner (saat workspace baru dibuat) dan
--   accept_invitation() (0003, saat menerima undangan).
--
-- CARA MENJALANKAN (oleh koordinator — butuh DATABASE_URL / service role):
--   1. Terapkan migrasi 0001–0024 ke database BERSIH (atau preview).
--   2. Aktifkan ekstensi pgTAP di proyek Supabase (Dashboard → Database →
--      Extensions → pgtap), atau jalankan:  create extension if not exists pgtap;
--   3. Buat 3 pengguna auth uji (mis. lewat Dashboard → Authentication →
--      Add user) dan catat UUID-nya; ganti placeholder di bawah.
--      User A = owner organisasi + owner Workspace K9.
--      User B = member organisasi (role org `member`) + EDITOR di
--        Workspace K9 (role workspace RENDAH — penyerang dalam tes ini).
--      User C = member organisasi (role org `member`), BUKAN member
--        Workspace K9 (varian serangan: org-member tanpa keanggotaan
--        workspace — cabang (a) lama juga meloloskannya).
--      User D = UUID PALSU 4444... — TIDAK perlu pengguna auth nyata:
--        hanya dipakai sebagai pemanggil RPC yang BUKAN anggota org
--        (RPC menolak SEBELUM insert apa pun, jadi tidak ada FK yang
--        diperiksa) dan sebagai target insert yang ditolak RLS di T4c.
--   4. Jalankan:  psql "$DATABASE_URL" -v user_a='<UUID-USER-A>'
--        -v user_b='<UUID-USER-B>' -v user_c='<UUID-USER-C>' \
--        -f supabase/tests/09_rls_critical_k1.sql
--   Hasil yang diharapkan: semua tes ok (tidak ada "not ok").
--   DI SQL EDITOR (tanpa psql): hapus keempat baris \\set, ganti setiap
--   :'user_a' / :'user_b' / :'user_c' / :'user_d' dengan literal UUID
--   (A/B/C nyata, D = 44444444-4444-4444-4444-444444444444), lalu
--   jalankan seluruh file sebagai satu query (begin ... rollback di akhir
--   membersihkan data uji). Bagian tempel siap pakai ada di
--   ~/workspace/mative/workspace-parts-k1-pgtap09/ (sudah disubstitusi).
--
-- CATATAN: tes ini TIDAK BOLEH dijalankan di database produksi berisi data
-- nyata — hanya database bersih/preview. Tes memakai JWT claims palsu lewat
-- set_config('request.jwt.claims') untuk mensimulasikan tiap pengguna.
--
-- POLA YANG DIIKUTI (pelajaran file 01 v2.2 + 08 v1.3 + skill pgTAP):
--   - Setup sebagai postgres (bypass RLS), baru `set local role authenticated`.
--   - INSERT yang melanggar RLS WITH CHECK melempar 42501 dan meng-abort
--     SELURUH transaksi bila telanjang — penolakan dibuktikan lewat
--     throws_ok (pola 01 T3b: format($f$...$f$, :'user_x') + pesan lengkap
--     'new row violates row-level security policy for table
--     "workspace_members"') + asersi hitungan sesudahnya (baris tidak ada).
--   - Placeholder :'user_x' TIDAK BOLEH di dalam string $$...$$ — SQL
--     dinamis dibangun lewat format($f$...$f$, :'user_x').
--   - UUID palsu 1111.../2222.../3333.../4444... HANYA di empat baris \\set.
--   - Cast setiap perbandingan count ke int (count mengembalikan bigint).
--   - RPC create_workspace_with_owner TIDAK PERNAH melempar — asersi
--     memakai is(->>'ok'/'code', ...), BUKAN throws_ok.
--   - RPC yang menyisipkan TIDAK BOLEH dipanggil dua kali untuk membaca
--     hasilnya — kecuali panggilan itu TIDAK menyisipkan (T5d/T5e:
--     pemanggil non-anggota ditolak SEBELUM insert; dua panggilan aman
--     dan tidak menulis baris).
--   - Cleanup defensif HARUS berjalan sebagai postgres: tegaskan `reset
--     role;` sebelum blok cleanup (authenticated TIDAK PUNYA grant
--     delete atas workspace_members/workspaces — DELETE cleanup sebagai
--     authenticated abort 42501 sebelum finish()).
--   - Cleanup defensif diurutkan daun → akar (workspace_members →
--     workspaces → organization_members → organizations).
-- ============================================================================

begin;
select plan(25);

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

-- Pengguna uji (GANTI A/B/C dengan UUID auth user nyata dari database uji;
-- D = UUID palsu, tidak perlu pengguna nyata — lihat header).
\set user_a '11111111-1111-1111-1111-111111111111'
\set user_b '22222222-2222-2222-2222-222222222222'
\set user_c '33333333-3333-3333-3333-333333333333'
\set user_d '44444444-4444-4444-4444-444444444444'

-- ---------------------------------------------------------------------------
-- Setup: org K9 + workspace K9 + member (sebagai postgres, bypass RLS).
-- User A = owner org + owner WS-K9. User B = member org + EDITOR WS-K9.
-- User C = member org, BUKAN member WS-K9.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, owner_user_id)
values ('a9000000-0000-0000-0000-000000000001', 'Org K9 (sample test)', 'org-k9-test', :'user_a')
on conflict (slug) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at)
values ('a9000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('a9000000-0000-0000-0000-000000000001', :'user_b', 'member', 'active', now()),
       ('a9000000-0000-0000-0000-000000000001', :'user_c', 'member', 'active', now())
on conflict (organization_id, user_id) do nothing;

insert into public.workspaces (id, organization_id, name, slug, timezone)
values ('b9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 'Workspace K9 (sample test)', 'ws-k9-test', 'Asia/Jakarta')
on conflict (organization_id, slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
values ('b9000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('b9000000-0000-0000-0000-000000000001', :'user_b', 'editor', 'active', now())
on conflict (workspace_id, user_id) do nothing;

-- ============================================================================
-- TES 1 — policy baru + RPC + grant. (5)
-- ============================================================================
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'workspace_members' and policyname = 'ws_members_insert_owner_admin'),
  1,
  'T1a policy ws_members_insert_owner_admin ada (pengganti policy lama)'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'workspace_members' and policyname = 'ws_members_insert_owner_admin_or_self'),
  0,
  'T1b policy lama ws_members_insert_owner_admin_or_self sudah tidak ada'
);
select is(
  (select count(*)::int from pg_proc where proname = 'create_workspace_with_owner' and prosecdef),
  1,
  'T1c RPC create_workspace_with_owner ada + SECURITY DEFINER'
);
select is(
  has_function_privilege('authenticated', 'public.create_workspace_with_owner(uuid, text, text, text, text)', 'execute'),
  true,
  'T1d authenticated boleh mengeksekusi RPC create_workspace_with_owner'
);
select is(
  has_function_privilege('anon', 'public.create_workspace_with_owner(uuid, text, text, text, text)', 'execute'),
  false,
  'T1e anon TIDAK boleh mengeksekusi RPC create_workspace_with_owner'
);

-- ============================================================================
-- TES 2 — self-promotion DENY: anggota org TIDAK BISA insert diri sebagai
-- owner (atau role lain) ke workspace yang sudah ada. (5)
-- ============================================================================
set local role authenticated;
select _set_user(:'user_b');
select throws_ok(
  format($f$insert into public.workspace_members (workspace_id, user_id, workspace_role)
     values ('b9000000-0000-0000-0000-000000000001', %L, 'owner')$f$, :'user_b'),
  '42501',
  'new row violates row-level security policy for table "workspace_members"',
  'T2a DENY: B (editor WS-K9) tidak bisa menyisipkan diri sebagai owner WS-K9'
);
select _set_user(:'user_a');
select is(
  (select count(*) from public.workspace_members
   where workspace_id = 'b9000000-0000-0000-0000-000000000001' and user_id = :'user_b' and workspace_role = 'owner')::int,
  0,
  'T2b B tetap bukan owner WS-K9 sesudah percobaan T2a (0 baris owner)'
);
select _set_user(:'user_c');
select throws_ok(
  format($f$insert into public.workspace_members (workspace_id, user_id, workspace_role)
     values ('b9000000-0000-0000-0000-000000000001', %L, 'owner')$f$, :'user_c'),
  '42501',
  'new row violates row-level security policy for table "workspace_members"',
  'T2c DENY: C (member org, bukan member WS-K9) tidak bisa menyisipkan diri sebagai owner WS-K9'
);
select _set_user(:'user_a');
select is(
  (select count(*) from public.workspace_members
   where workspace_id = 'b9000000-0000-0000-0000-000000000001' and user_id = :'user_c')::int,
  0,
  'T2d C tetap bukan member WS-K9 sesudah percobaan T2c (0 baris)'
);
select _set_user(:'user_b');
select throws_ok(
  format($f$insert into public.workspace_members (workspace_id, user_id, workspace_role)
     values ('b9000000-0000-0000-0000-000000000001', %L, 'admin')$f$, :'user_b'),
  '42501',
  'new row violates row-level security policy for table "workspace_members"',
  'T2e DENY: B juga tidak bisa menyisipkan diri sebagai admin — cabang self-insert ditutup untuk SEMUA role, bukan hanya owner'
);

-- ============================================================================
-- TES 3 — INSERT ... RETURNING juga DENY (pola PostgREST .insert().select()
-- yang dipakai server action — regresi 0023: INSERT biasa lolos tidak
-- berarti RETURNING lolos). (2)
-- ============================================================================
select throws_ok(
  format($f$insert into public.workspace_members (workspace_id, user_id, workspace_role)
     values ('b9000000-0000-0000-0000-000000000001', %L, 'owner') returning id$f$, :'user_b'),
  '42501',
  'new row violates row-level security policy for table "workspace_members"',
  'T3a DENY: B insert diri sebagai owner + RETURNING juga ditolak 42501'
);
select _set_user(:'user_a');
select is(
  (select count(*) from public.workspace_members
   where workspace_id = 'b9000000-0000-0000-0000-000000000001' and user_id = :'user_b' and workspace_role = 'owner')::int,
  0,
  'T3b B tetap bukan owner WS-K9 sesudah percobaan T3a (0 baris owner)'
);

-- ============================================================================
-- TES 4 — owner/admin TETAP BISA menambahkan anggota (cabang (b) yang
-- dipertahankan); editor TIDAK BISA menambahkan siapa pun. (3)
-- ============================================================================
select _set_user(:'user_a');
insert into public.workspace_members (workspace_id, user_id, workspace_role)
values ('b9000000-0000-0000-0000-000000000001', :'user_c', 'editor');
select is(
  (select count(*) from public.workspace_members
   where workspace_id = 'b9000000-0000-0000-0000-000000000001' and user_id = :'user_c')::int,
  1,
  'T4a ALLOW: A (owner WS-K9) bisa menambahkan C sebagai editor'
);
select is(
  (select workspace_role from public.workspace_members
   where workspace_id = 'b9000000-0000-0000-0000-000000000001' and user_id = :'user_c'),
  'editor',
  'T4b baris C di WS-K9 ber-role editor (sesuai yang diminta owner)'
);
select _set_user(:'user_c');
select throws_ok(
  format($f$insert into public.workspace_members (workspace_id, user_id, workspace_role)
     values ('b9000000-0000-0000-0000-000000000001', %L, 'viewer_client')$f$, :'user_d'),
  '42501',
  'new row violates row-level security policy for table "workspace_members"',
  'T4c DENY: C (editor, baru ditambahkan T4a) tidak bisa menambahkan anggota — hanya owner/admin'
);

-- ============================================================================
-- TES 5 — RPC create_workspace_with_owner: pembuatan workspace baru tetap
-- menyisipkan pembuatnya sebagai owner (regresi createWorkspaceAction);
-- non-anggota ditolak; slug duplikat + input buruk ditolak bersih. (8)
-- ============================================================================
select _set_user(:'user_b');
select is(
  (public.create_workspace_with_owner('a9000000-0000-0000-0000-000000000001', 'Workspace K9 RPC', 'ws-k9-rpc', 'Asia/Jakarta', 'id') ->> 'ok'),
  'true',
  'T5a B (member org, bukan owner) membuat workspace baru lewat RPC — lolos'
);
select is(
  (select count(*) from public.workspaces where slug = 'ws-k9-rpc')::int,
  1,
  'T5b workspace baru ws-k9-rpc ada + terlihat oleh B (pembuatnya)'
);
select is(
  (select count(*) from public.workspace_members
   where workspace_id = (select id from public.workspaces where slug = 'ws-k9-rpc')
     and user_id = :'user_b' and workspace_role = 'owner')::int,
  1,
  'T5c B adalah owner workspace barunya (1 baris owner)'
);
select _set_user(:'user_d');
select is(
  (public.create_workspace_with_owner('a9000000-0000-0000-0000-000000000001', 'Workspace K9 D', 'ws-k9-d', 'Asia/Jakarta', 'id') ->> 'ok'),
  'false',
  'T5d D (bukan anggota org) membuat workspace ditolak — ok=false'
);
-- Dua panggilan untuk D AMAN (tidak menyisipkan apa pun — ditolak sebelum
-- insert), jadi kode dibaca dari panggilan kedua, bukan dari tabel.
select is(
  (public.create_workspace_with_owner('a9000000-0000-0000-0000-000000000001', 'Workspace K9 D', 'ws-k9-d', 'Asia/Jakarta', 'id') ->> 'code'),
  'FORBIDDEN',
  'T5e penolakan D berkode FORBIDDEN'
);
select _set_user(:'user_b');
select is(
  (public.create_workspace_with_owner('a9000000-0000-0000-0000-000000000001', 'Workspace K9 RPC Lagi', 'ws-k9-rpc', 'Asia/Jakarta', 'id') ->> 'code'),
  'DUPLICATE_SLUG',
  'T5f slug yang sama di org yang sama ditolak DUPLICATE_SLUG'
);
select is(
  (select count(*) from public.workspaces where slug = 'ws-k9-rpc')::int,
  1,
  'T5g tetap tepat 1 workspace berslug ws-k9-rpc sesudah percobaan duplikat'
);
select is(
  (public.create_workspace_with_owner('a9000000-0000-0000-0000-000000000001', 'Workspace K9 Buruk', 'BAD SLUG!', 'Asia/Jakarta', 'id') ->> 'code'),
  'INVALID_INPUT',
  'T5h slug buruk (huruf besar + spasi + !) ditolak INVALID_INPUT'
);

-- ============================================================================
-- TES 6 — anon ditolak (tanpa grant). (1)
-- ============================================================================
set local role anon;
select _as_anon();
select throws_ok(
  format($f$insert into public.workspace_members (workspace_id, user_id, workspace_role)
     values ('b9000000-0000-0000-0000-000000000001', %L, 'owner')$f$, :'user_a'),
  '42501',
  'permission denied for table workspace_members',
  'T6a anon INSERT workspace_members ditolak 42501 (tanpa grant)'
);

-- ============================================================================
-- TES 7 — data utuh sesudah semua serangan. (1)
-- ============================================================================
reset role;
set local role authenticated;
select _set_user(:'user_a');
select is(
  (select workspace_role from public.workspace_members
   where workspace_id = 'b9000000-0000-0000-0000-000000000001' and user_id = :'user_a'),
  'owner',
  'T7a A tetap owner WS-K9 sesudah semua percobaan serangan'
);

-- ============================================================================
-- Cleanup HARUS sebagai postgres (reset role): authenticated TIDAK PUNYA
-- grant delete atas workspace_members/workspaces — DELETE cleanup sebagai
-- authenticated abort 42501 sebelum finish().
-- Cleanup defensif (rollback di akhir membersihkan semuanya; delete di sini
-- menjaga kebersihan bila rollback tidak jalan — urutan daun → akar).
-- ============================================================================
reset role;
delete from public.workspace_members where workspace_id in
  (select id from public.workspaces where organization_id = 'a9000000-0000-0000-0000-000000000001');
delete from public.workspaces where organization_id = 'a9000000-0000-0000-0000-000000000001';
delete from public.organization_members where organization_id = 'a9000000-0000-0000-0000-000000000001';
delete from public.organizations where id = 'a9000000-0000-0000-0000-000000000001';
drop function if exists _set_user(uuid, text);
drop function if exists _as_anon();

select * from finish();
rollback;
