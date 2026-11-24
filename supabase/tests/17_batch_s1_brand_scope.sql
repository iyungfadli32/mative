-- pgTAP Batch S-1 (temuan S-6, migrasi 0033): brand scope ditegakkan pada
-- campaigns, tasks, task_checklist_items, assets, comments, notifications.
-- Dijalankan:
--   psql "$DATABASE_URL" -v user_a='094e8752-eef4-4f0e-b6ae-2d5813445018' -v user_b='aabb1dab-77c1-4659-af0e-c703c9de279c' -f supabase/tests/17_batch_s1_brand_scope.sql
-- user_a = owner A (tanpa scope); user_b = creator B (tanpa scope);
-- user D = creator dengan brand_scope [Brand A] memakai UUID member C
-- 'b2e98541-1162-4cc7-9835-603a217e0d1b' (pola yang sama seperti test 13).

begin;
select plan(28);

create or replace function _set_user(p_user uuid, p_email text default 'test@example.com')
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email)::text, true);
$$;

-- Helper "must be rejected": insert task sebagai pemanggil saat ini.
create or replace function try_insert_task(p_ws uuid, p_parent_type text, p_parent_id uuid, p_title text)
returns boolean language plpgsql as $$
begin
  insert into public.tasks (id, workspace_id, title, parent_type, parent_id, assignee_user_id, created_by)
  values (gen_random_uuid(), p_ws, p_title, p_parent_type, p_parent_id, auth.uid(), auth.uid());
  return true;
exception
  when insufficient_privilege or check_violation then return false;
end
$$;

-- Helper "must be rejected": insert comment sebagai pemanggil saat ini.
create or replace function try_insert_comment(p_ws uuid, p_target_type text, p_target_id uuid, p_body text)
returns boolean language plpgsql as $$
begin
  insert into public.comments (id, workspace_id, target_type, target_id, body, author_user_id)
  values (gen_random_uuid(), p_ws, p_target_type, p_target_id, p_body, auth.uid());
  return true;
exception
  when insufficient_privilege or check_violation then return false;
end
$$;

-- Fixtures (postgres, bypass RLS).
insert into public.organizations (id, name, slug, owner_user_id) values
  ('a7000000-0000-0000-0000-000000000001', 'Org Batch S1', 'org-batch-s1-test', :'user_a')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at) values
  ('a7000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now());

insert into public.workspaces (id, organization_id, name, slug, timezone) values
  ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 'WS Batch S1', 'ws-batch-s1-test', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, brand_scope, joined_at) values
  ('b7000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', null, now()),
  ('b7000000-0000-0000-0000-000000000001', :'user_b', 'creator', 'active', null, now()),
  ('b7000000-0000-0000-0000-000000000001', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'creator', 'active', '["e7000000-0000-0000-0000-000000000001"]'::jsonb, now());

insert into public.brands (id, workspace_id, name, slug, status) values
  ('e7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'Brand S1 A', 'brand-s1-a', 'active'),
  ('e7000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001', 'Brand S1 B', 'brand-s1-b', 'active')
on conflict (id) do nothing;

insert into public.campaigns (id, workspace_id, name) values
  ('c7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'Kampanye Tanpa Brand'),
  ('c7000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001', 'Kampanye Brand A'),
  ('c7000000-0000-0000-0000-000000000003', 'b7000000-0000-0000-0000-000000000001', 'Kampanye Brand B')
on conflict (id) do nothing;

insert into public.campaign_brands (campaign_id, brand_id) values
  ('c7000000-0000-0000-0000-000000000002', 'e7000000-0000-0000-0000-000000000001'),
  ('c7000000-0000-0000-0000-000000000003', 'e7000000-0000-0000-0000-000000000002')
on conflict (campaign_id, brand_id) do nothing;

insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values
  ('d7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten Brand A', 'idea', :'user_a', 'Asia/Jakarta'),
  ('d7000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000002', 'Konten Brand B', 'idea', :'user_a', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.tasks (id, workspace_id, title, parent_type, parent_id, created_by) values
  ('f7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'Task Konten A', 'content_item', 'd7000000-0000-0000-0000-000000000001', :'user_a'),
  ('f7000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001', 'Task Konten B', 'content_item', 'd7000000-0000-0000-0000-000000000002', :'user_a'),
  ('f7000000-0000-0000-0000-000000000003', 'b7000000-0000-0000-0000-000000000001', 'Task Kampanye A', 'campaign', 'c7000000-0000-0000-0000-000000000002', :'user_a'),
  ('f7000000-0000-0000-0000-000000000004', 'b7000000-0000-0000-0000-000000000001', 'Task Kampanye B', 'campaign', 'c7000000-0000-0000-0000-000000000003', :'user_a')
on conflict (id) do nothing;

insert into public.task_checklist_items (id, task_id, title) values
  ('a7000000-0000-0000-0000-000000000011', 'f7000000-0000-0000-0000-000000000001', 'Checklist A'),
  ('a7000000-0000-0000-0000-000000000012', 'f7000000-0000-0000-0000-000000000002', 'Checklist B')
on conflict (id) do nothing;

insert into public.assets (id, workspace_id, object_key, original_filename, mime_type, byte_size, uploaded_by, processing_status, created_at) values
  ('a7000000-0000-0000-0000-000000000021', 'b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001/a7000000-0000-0000-0000-000000000021/a.png', 'a.png', 'image/png', 1024, :'user_a', 'ready', now()),
  ('a7000000-0000-0000-0000-000000000022', 'b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001/a7000000-0000-0000-0000-000000000022/b.png', 'b.png', 'image/png', 1024, :'user_a', 'ready', now()),
  ('a7000000-0000-0000-0000-000000000023', 'b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001/a7000000-0000-0000-0000-000000000023/c.png', 'c.png', 'image/png', 1024, :'user_a', 'ready', now())
on conflict (id) do nothing;

insert into public.content_assets (id, content_item_id, asset_id, usage_role) values
  ('a7000000-0000-0000-0000-000000000031', 'd7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000021', 'primary'),
  ('a7000000-0000-0000-0000-000000000032', 'd7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000022', 'primary')
on conflict (id) do nothing;

insert into public.comments (id, workspace_id, target_type, target_id, body, author_user_id) values
  ('a7000000-0000-0000-0000-000000000041', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000001', 'Komentar konten A', :'user_a'),
  ('a7000000-0000-0000-0000-000000000042', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000002', 'Komentar konten B', :'user_a'),
  ('a7000000-0000-0000-0000-000000000043', 'b7000000-0000-0000-0000-000000000001', 'task', 'f7000000-0000-0000-0000-000000000001', 'Komentar task A', :'user_a')
on conflict (id) do nothing;

insert into public.notifications (id, workspace_id, recipient_user_id, type, title, target_type, target_id) values
  ('a7000000-0000-0000-0000-000000000051', 'b7000000-0000-0000-0000-000000000001', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'mention', 'Notif konten A', 'content_item', 'd7000000-0000-0000-0000-000000000001'),
  ('a7000000-0000-0000-0000-000000000052', 'b7000000-0000-0000-0000-000000000001', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'mention', 'Notif konten B', 'content_item', 'd7000000-0000-0000-0000-000000000002'),
  ('a7000000-0000-0000-0000-000000000053', 'b7000000-0000-0000-0000-000000000001', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'mention', 'Notif kampanye A', 'campaign', 'c7000000-0000-0000-0000-000000000002'),
  ('a7000000-0000-0000-0000-000000000054', 'b7000000-0000-0000-0000-000000000001', :'user_a', 'mention', 'Notif konten B untuk A', 'content_item', 'd7000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

-- Sebagai D (creator, brand_scope = [Brand A]).
select _set_user('b2e98541-1162-4cc7-9835-603a217e0d1b', 'mative-test-c@example.com');
set local role authenticated;

select is((select count(*) from public.campaigns where id = 'c7000000-0000-0000-0000-000000000002'), 1::bigint, 'D melihat campaign Brand A');
select is((select count(*) from public.campaigns where id = 'c7000000-0000-0000-0000-000000000001'), 1::bigint, 'D melihat campaign tanpa brand');
select is((select count(*) from public.campaigns where id = 'c7000000-0000-0000-0000-000000000003'), 0::bigint, 'D TIDAK melihat campaign Brand B');
select is((select count(*) from public.tasks where id = 'f7000000-0000-0000-0000-000000000001'), 1::bigint, 'D melihat task konten Brand A');
select is((select count(*) from public.tasks where id = 'f7000000-0000-0000-0000-000000000003'), 1::bigint, 'D melihat task campaign Brand A');
select is((select count(*) from public.tasks where id = 'f7000000-0000-0000-0000-000000000002'), 0::bigint, 'D TIDAK melihat task konten Brand B');
select is((select count(*) from public.tasks where id = 'f7000000-0000-0000-0000-000000000004'), 0::bigint, 'D TIDAK melihat task campaign Brand B');
select is((select count(*) from public.task_checklist_items where id = 'a7000000-0000-0000-0000-000000000011'), 1::bigint, 'D melihat checklist task Brand A');
select is((select count(*) from public.task_checklist_items where id = 'a7000000-0000-0000-0000-000000000012'), 0::bigint, 'D TIDAK melihat checklist task Brand B');
select is((select count(*) from public.assets where id = 'a7000000-0000-0000-0000-000000000021'), 1::bigint, 'D melihat asset Brand A');
select is((select count(*) from public.assets where id = 'a7000000-0000-0000-0000-000000000023'), 1::bigint, 'D melihat asset tanpa tautan');
select is((select count(*) from public.assets where id = 'a7000000-0000-0000-0000-000000000022'), 0::bigint, 'D TIDAK melihat asset Brand B');
select is((select count(*) from public.comments where id = 'a7000000-0000-0000-0000-000000000041'), 1::bigint, 'D melihat komentar konten Brand A');
select is((select count(*) from public.comments where id = 'a7000000-0000-0000-0000-000000000043'), 1::bigint, 'D melihat komentar task Brand A');
select is((select count(*) from public.comments where id = 'a7000000-0000-0000-0000-000000000042'), 0::bigint, 'D TIDAK melihat komentar konten Brand B');
select is((select count(*) from public.notifications where id = 'a7000000-0000-0000-0000-000000000051'), 1::bigint, 'D melihat notifikasi konten Brand A');
select is((select count(*) from public.notifications where id = 'a7000000-0000-0000-0000-000000000053'), 1::bigint, 'D melihat notifikasi campaign Brand A');
select is((select count(*) from public.notifications where id = 'a7000000-0000-0000-0000-000000000052'), 0::bigint, 'D TIDAK melihat notifikasi konten Brand B');
select is(try_insert_task('b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000002', 'Task S1 terlarang'), false, 'D TIDAK bisa membuat task di konten Brand B');
select is(try_insert_task('b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000001', 'Task S1 boleh'), true, 'D bisa membuat task di konten Brand A');
select is(try_insert_comment('b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000002', 'Komentar terlarang'), false, 'D TIDAK bisa berkomentar di konten Brand B');
select is(try_insert_comment('b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000001', 'Komentar boleh'), true, 'D bisa berkomentar di konten Brand A');

-- Sebagai A (owner, tanpa scope) semuanya terlihat.
select _set_user(:'user_a', 'mative-test-a@example.com');
select is((select count(*) from public.campaigns where id = 'c7000000-0000-0000-0000-000000000003'), 1::bigint, 'A melihat campaign Brand B');
select is((select count(*) from public.tasks where id = 'f7000000-0000-0000-0000-000000000002'), 1::bigint, 'A melihat task konten Brand B');
select is((select count(*) from public.task_checklist_items where id = 'a7000000-0000-0000-0000-000000000012'), 1::bigint, 'A melihat checklist task Brand B');
select is((select count(*) from public.assets where id = 'a7000000-0000-0000-0000-000000000022'), 1::bigint, 'A melihat asset Brand B');
select is((select count(*) from public.comments where id = 'a7000000-0000-0000-0000-000000000042'), 1::bigint, 'A melihat komentar konten Brand B');
select is((select count(*) from public.notifications where id = 'a7000000-0000-0000-0000-000000000054'), 1::bigint, 'A melihat notifikasi konten Brand B');

select * from finish();
rollback;
