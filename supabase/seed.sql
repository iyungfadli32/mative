-- MaTive Phase 1 — Seed demo (SAMPLE / DEMO ONLY)
-- ============================================================================
-- ATURAN: file ini HANYA untuk environment local/preview. JANGAN PERNAH
-- dijalankan di database produksi. Semua baris berlabel sample/demo dan
-- memakai UUID sample yang jelas-jelas bukan data nyata.
-- Seed TIDAK membuat pengguna auth (itu lewat Supabase Auth / Dashboard).
-- Setelah membuat 2 pengguna auth uji, ganti placeholder user UUID di bawah
-- dengan UUID mereka, lalu jalankan file ini.
-- Perintah (oleh koordinator, butuh DATABASE_URL):
--   psql "$DATABASE_URL" -v owner_user='<UUID-OWNER>' -v member_user='<UUID-MEMBER>' \
--     -f supabase/seed.sql
-- ============================================================================

begin;

-- 1 organisasi contoh (sample).
insert into public.organizations (id, name, slug, status, owner_user_id)
values (
  'e0000000-0000-0000-0000-000000000001',
  'Contoh Studio (sample)',
  'contoh-studio-sample',
  'active',
  :'owner_user'
) on conflict (slug) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at)
values (
  'e0000000-0000-0000-0000-000000000001',
  :'owner_user', 'owner', 'active', now()
) on conflict (organization_id, user_id) do nothing;

-- 1 workspace contoh (sample), timezone Asia/Jakarta.
insert into public.workspaces (id, organization_id, name, slug, timezone, default_locale)
values (
  'e0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000001',
  'Workspace Contoh (sample)',
  'workspace-contoh-sample',
  'Asia/Jakarta',
  'id'
) on conflict (organization_id, slug) do nothing;

-- 2 anggota contoh (sample): owner + creator.
insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
values
  ('e0000000-0000-0000-0000-000000000002', :'owner_user', 'owner', 'active', now()),
  ('e0000000-0000-0000-0000-000000000002', :'member_user', 'creator', 'active', now())
on conflict (workspace_id, user_id) do nothing;

-- Pengaturan contoh (sample): undangan 7 hari (P1-A5).
insert into public.workspace_settings (workspace_id, key, value_json)
values (
  'e0000000-0000-0000-0000-000000000002',
  'invitation_ttl_days',
  '7'::jsonb
) on conflict (workspace_id, key) do nothing;

commit;

-- Verifikasi (baca saja): harus menampilkan 1 organisasi + 1 workspace sample.
select 'seed organizations (sample)' as cek, count(*) from public.organizations where slug = 'contoh-studio-sample';
select 'seed workspaces (sample)' as cek, count(*) from public.workspaces where slug = 'workspace-contoh-sample';
select 'seed workspace members (sample)' as cek, count(*) from public.workspace_members where workspace_id = 'e0000000-0000-0000-0000-000000000002';
