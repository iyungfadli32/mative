-- psql "$DATABASE_URL" -v user_a='094e8752-eef4-4f0e-b6ae-2d5813445018' -v user_b='aabb1dab-77c1-4659-af0e-c703c9de279c' -f supabase/tests/19_batch_s2_fixes.sql
-- user_a = owner workspace; user_b = creator di workspace yang sama.
-- Batch S-2: S-1 jendela bentrok reschedule +/-15 menit; S-5 create-from-template
-- atomik (tanpa konten yatim); S-6 trigger pilar satu brand dengan konten.

begin;
select plan(12);

create or replace function _set_user(p_user uuid, p_email text default 'test@example.com')
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email)::text, true);
$$;

-- Helper SECURITY DEFINER (dibuat di dalam transaksi, ikut rollback):
-- Log hasil RPC per kasus; hasilnya dicek dari log.
create table resched_log (case_name text primary key, ok boolean, collision boolean, message text);
grant all on resched_log to authenticated;

create table tpl_log (case_name text primary key, ok boolean, message text, content_item_id uuid);
grant all on tpl_log to authenticated;

create table item_log (case_name text primary key, ok boolean, message text);
grant all on item_log to authenticated;

create or replace function try_reschedule(p_case text, p_user uuid, p_placement uuid, p_at timestamptz, p_force boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
begin
  perform _set_user(p_user);
  select public.reschedule_placement(p_placement, p_at, 'Asia/Jakarta', p_force) into v_res;
  insert into resched_log values (p_case, (v_res ->> 'ok')::boolean, (v_res ->> 'collision')::boolean, v_res ->> 'message');
exception when others then
  insert into resched_log values (p_case, false, null, 'ERROR: ' || sqlerrm);
end
$$;

create or replace function try_create_from_template(p_case text, p_user uuid, p_ws uuid, p_tpl uuid, p_title text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res jsonb;
begin
  perform _set_user(p_user);
  select public.create_content_from_template(p_ws, p_tpl, p_title, 'Asia/Jakarta') into v_res;
  insert into tpl_log values (p_case, (v_res ->> 'ok')::boolean, v_res ->> 'message', (v_res ->> 'content_item_id')::uuid);
exception when others then
  insert into tpl_log values (p_case, false, 'ERROR: ' || sqlerrm, null);
end
$$;

create or replace function try_insert_item(p_case text, p_user uuid, p_ws uuid, p_brand uuid, p_pillar uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.content_items (workspace_id, brand_id, pillar_id, title, production_status, owner_user_id)
  values (p_ws, p_brand, p_pillar, 'Konten S2 Trigger ' || p_case, 'idea', p_user);
  insert into item_log values (p_case, true, 'insert ok');
exception when others then
  insert into item_log values (p_case, false, 'ERROR: ' || sqlerrm);
end
$$;

-- Fixtures (postgres, bypass RLS).
insert into public.organizations (id, name, slug, owner_user_id) values
  ('c9000000-0000-0000-0000-000000000001', 'Org Batch S2', 'org-batch-s2', :'user_a')
  on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at) values
  ('c9000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now());

insert into public.workspaces (id, organization_id, name, slug, timezone) values
  ('c9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000001', 'Workspace Batch S2', 'ws-batch-s2', 'Asia/Jakarta')
  on conflict (organization_id, slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at) values
  ('c9000000-0000-0000-0000-000000000002', :'user_a', 'owner', 'active', now()),
  ('c9000000-0000-0000-0000-000000000002', :'user_b', 'creator', 'active', now());

insert into public.brands (id, workspace_id, name, slug, status) values
  ('c9000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000002', 'Brand A S2', 'brand-a-s2', 'active'),
  ('c9000000-0000-0000-0000-000000000004', 'c9000000-0000-0000-0000-000000000002', 'Brand B S2', 'brand-b-s2', 'active')
  on conflict (workspace_id, slug) do nothing;

insert into public.content_pillars (id, workspace_id, brand_id, name) values
  ('c9000000-0000-0000-0000-000000000005', 'c9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000003', 'Pilar A S2'),
  ('c9000000-0000-0000-0000-000000000006', 'c9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000004', 'Pilar B S2'),
  ('c9000000-0000-0000-0000-000000000007', 'c9000000-0000-0000-0000-000000000002', null, 'Pilar Umum S2')
  on conflict (id) do nothing;

insert into public.social_channels (id, brand_id, platform) values
  ('c9000000-0000-0000-0000-000000000008', 'c9000000-0000-0000-0000-000000000003', 'instagram'),
  ('c9000000-0000-0000-0000-000000000009', 'c9000000-0000-0000-0000-000000000003', 'tiktok')
  on conflict (id) do nothing;

insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id) values
  ('c9000000-0000-0000-0000-000000000010', 'c9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000003', 'Konten S2-1', 'idea', :'user_a'),
  ('c9000000-0000-0000-0000-000000000011', 'c9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000003', 'Konten S2-2', 'idea', :'user_a')
  on conflict (id) do nothing;

insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, distribution_status, timezone, scheduled_at) values
  ('c9000000-0000-0000-0000-000000000012', 'c9000000-0000-0000-0000-000000000010', 'c9000000-0000-0000-0000-000000000008', 'feed', 'draft', 'Asia/Jakarta', '2026-12-01 09:00:00+07'),
  ('c9000000-0000-0000-0000-000000000013', 'c9000000-0000-0000-0000-000000000011', 'c9000000-0000-0000-0000-000000000008', 'feed', 'draft', 'Asia/Jakarta', '2026-12-01 10:00:00+07'),
  ('c9000000-0000-0000-0000-000000000014', 'c9000000-0000-0000-0000-000000000011', 'c9000000-0000-0000-0000-000000000009', 'feed', 'draft', 'Asia/Jakarta', '2026-12-01 09:00:00+07')
  on conflict (id) do nothing;

insert into public.content_templates (id, workspace_id, name, source_content_item_id, title, brand_id, pillar_id, script, caption, created_by) values
  ('c9000000-0000-0000-0000-000000000015', 'c9000000-0000-0000-0000-000000000002', 'Template S2 OK', 'c9000000-0000-0000-0000-000000000010', 'Konten dari Template S2 OK', 'c9000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000005', 'Skrip S2', 'Caption S2', :'user_a'),
  ('c9000000-0000-0000-0000-000000000016', 'c9000000-0000-0000-0000-000000000002', 'Template S2 Bad', 'c9000000-0000-0000-0000-000000000010', 'Konten dari Template S2 Bad', 'c9000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000006', 'Skrip S2', 'Caption S2', :'user_a')
  on conflict (id) do nothing;

insert into public.content_template_placements (template_id, social_channel_id, platform_format) values
  ('c9000000-0000-0000-0000-000000000015', 'c9000000-0000-0000-0000-000000000008', 'feed'),
  ('c9000000-0000-0000-0000-000000000015', 'c9000000-0000-0000-0000-000000000009', 'reel'),
  ('c9000000-0000-0000-0000-000000000016', 'c9000000-0000-0000-0000-000000000008', 'feed')
  on conflict do nothing;

-- S-1: jendela bentrok reschedule +/-15 menit (channel yang sama).
select try_reschedule('s1-collision-5min', :'user_a', 'c9000000-0000-0000-0000-000000000013', '2026-12-01 09:05:00+07');
select try_reschedule('s1-ok-20min', :'user_a', 'c9000000-0000-0000-0000-000000000013', '2026-12-01 09:20:00+07');
select try_reschedule('s1-ok-other-channel', :'user_a', 'c9000000-0000-0000-0000-000000000014', '2026-12-01 09:05:00+07');
select try_reschedule('s1-force-bypass', :'user_a', 'c9000000-0000-0000-0000-000000000013', '2026-12-01 09:05:00+07', true);

select is((select ok from resched_log where case_name = 's1-collision-5min'), false, 'S-1: reschedule 5 menit dari placement lain di channel sama ditolak (collision).');
select is((select ok from resched_log where case_name = 's1-ok-20min'), true, 'S-1: reschedule 20 menit dari placement lain di channel sama diizinkan.');
select is((select ok from resched_log where case_name = 's1-ok-other-channel'), true, 'S-1: reschedule di channel berbeda pada jam sama diizinkan.');
select is((select ok from resched_log where case_name = 's1-force-bypass'), true, 'S-1: reschedule bentrok dengan p_force=true diizinkan (bypass).');

-- S-5: create-from-template atomik.
select try_create_from_template('s5-ok', :'user_a', 'c9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000015', 'Konten dari Template S2 OK');
select try_create_from_template('s5-bad-pillar', :'user_a', 'c9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000016', 'Konten dari Template S2 Bad');

select is((select ok from tpl_log where case_name = 's5-ok'), true, 'S-5: create-from-template dengan channel valid berhasil.');
select is((select count(*) from public.content_placements where content_item_id = (select content_item_id from tpl_log where case_name = 's5-ok')), 2::bigint, 'S-5: create-from-template membuat 2 placement (satu per channel template).');
select is((select brand_id = 'c9000000-0000-0000-0000-000000000003' and pillar_id = 'c9000000-0000-0000-0000-000000000005' from public.content_items where id = (select content_item_id from tpl_log where case_name = 's5-ok')), true, 'S-5: konten dari template memakai brand + pilar template.');
select is((select ok from tpl_log where case_name = 's5-bad-pillar'), false, 'S-5: create-from-template dengan pilar template beda brand ditolak.');
select is((select count(*) from public.content_items where title = 'Konten dari Template S2 Bad'), 0::bigint, 'S-5: template gagal tidak meninggalkan konten yatim.');

-- S-6: trigger pilar satu brand dengan konten.
select try_insert_item('s6-cross-brand', :'user_a', 'c9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000006');
select try_insert_item('s6-same-brand', :'user_a', 'c9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000005');
select try_insert_item('s6-unbranded-pillar', :'user_a', 'c9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000007');

select is((select ok from item_log where case_name = 's6-cross-brand'), false, 'S-6: konten Brand A dengan pilar Brand B ditolak trigger.');
select is((select ok from item_log where case_name = 's6-same-brand'), true, 'S-6: konten Brand A dengan pilar Brand A diizinkan.');
select is((select ok from item_log where case_name = 's6-unbranded-pillar'), true, 'S-6: konten Brand A dengan pilar tanpa brand diizinkan.');

select * from finish();
rollback;
