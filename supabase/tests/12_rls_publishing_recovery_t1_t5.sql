-- MaTive — pgTAP: Batch (e) T-1..T-5 (pemulihan job + reschedule atomik + gerbang distribusi).
-- File: supabase/tests/12_rls_publishing_recovery_t1_t5.sql
-- Cara pakai: tempel SELURUH isi file ini ke SQL Editor Supabase, lalu Run SEKALI.
--   (SQL Editor tidak mempertahankan transaksi antar-Run.)
--   Lolos = select * from finish() mengembalikan 0 baris.
-- PERINGATAN: jalankan hanya di database bersih/preview, atau di database live
--   DALAM transaksi begin...rollback seperti di bawah (semua fixture dihapus
--   lagi sebelum rollback; tidak ada residu).
-- Mengikuti konvensi supabase/tests/06_rls_phase6.sql: begin...rollback,
--   helper _set_user(), fixture di dalam transaksi, UUID literal.
-- Prasyarat: migrasi 0028 sudah diterapkan di database target.
-- Catatan: pemanggilan RPC yang mengubah keadaan dilakukan SEKALI per asersi
--   (hasilnya dibaca lewat keadaan tabel), agar tidak ada efek ganda.

begin;
select plan(70);

create or replace function public._set_user(p_user uuid, p_email text default 'test@example.com')
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email)::text, true);
$$;

create or replace function public._as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{}', true);
$$;

-- Helper T-4: mencoba hapus placement dan mengembalikan true bila berhasil.
-- Pengecualian trigger (check_violation) ditangkap di sini agar transaksi
-- pgTAP tidak batal (pola yang sama seperti helper penolakan 42501 di tes lain).
create or replace function public._try_delete_placement(p_id uuid) returns boolean
language plpgsql as $$
begin
  delete from public.content_placements where id = p_id;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public._reapprove(p_cv uuid) returns void
language plpgsql security definer as $$
begin
  update public.approval_requests
  set status = 'approved', completed_at = now()
  where workspace_id = 'b7000000-0000-0000-0000-000000000001'
    and request_type = 'internal'
    and content_version_id = p_cv
    and status = 'reapproval_required';
end;
$$;

-- Fixture: org/workspace/brand/channel (prefix 7, terpisah dari tes 06).
insert into public.organizations (id, name, slug, owner_user_id) values ('a7000000-0000-0000-0000-000000000001', 'Org A7 (sample test)', 'org-a7-test', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at) values ('a7000000-0000-0000-0000-000000000001', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'owner', 'active', now()), ('a7000000-0000-0000-0000-000000000001', 'aabb1dab-77c1-4659-af0e-c703c9de279c', 'member', 'active', now());
insert into public.workspaces (id, organization_id, name, slug, timezone) values ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 'Workspace A7', 'ws-a7-test', 'Asia/Jakarta');
insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at) values ('b7000000-0000-0000-0000-000000000001', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'owner', 'active', now()), ('b7000000-0000-0000-0000-000000000001', 'aabb1dab-77c1-4659-af0e-c703c9de279c', 'viewer_client', 'active', now());
insert into public.brands (id, workspace_id, name, slug, status) values ('e7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'Brand A7', 'brand-a7-test', 'active');
insert into public.social_channels (id, brand_id, platform, account_name, connection_status) values ('e7100000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'instagram', 'IG A7', 'manual');
insert into public.approval_workflows (id, workspace_id, name, is_default, created_by) values ('f7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'Internal default', true, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_steps (id, workflow_id, step_order, step_type, assignee_role, assignee_user_id, required_count) values ('f7100000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 1, 'sequential', 'manager', null, 1);
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-1', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000001', 1, 'Skrip A7-1', 'Caption A7-1', 'CTA A7-1', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000001', 'd7100000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000001', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-01T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000001', 'c7100000-0000-0000-0000-000000000001', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-2', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000002', 'd7000000-0000-0000-0000-000000000002', 1, 'Skrip A7-2', 'Caption A7-2', 'CTA A7-2', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000002', 'd7100000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000002', 'd7000000-0000-0000-0000-000000000002', 'e7100000-0000-0000-0000-000000000001', 'reel', '2027-01-01T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000002', 'c7100000-0000-0000-0000-000000000002', 1, '{"platform_format": "reel", "scheduled_at": "2027-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000003', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-3', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000003', 'd7000000-0000-0000-0000-000000000003', 1, 'Skrip A7-3', 'Caption A7-3', 'CTA A7-3', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000003', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000003', 'd7100000-0000-0000-0000-000000000003', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000003', 'd7000000-0000-0000-0000-000000000003', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-01T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000003', 'c7100000-0000-0000-0000-000000000003', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000004', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-4', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000004', 'd7000000-0000-0000-0000-000000000004', 1, 'Skrip A7-4', 'Caption A7-4', 'CTA A7-4', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000004', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000004', 'd7100000-0000-0000-0000-000000000004', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000004', 'd7000000-0000-0000-0000-000000000004', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-01T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000004', 'c7100000-0000-0000-0000-000000000004', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000005', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-5', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000005', 'd7000000-0000-0000-0000-000000000005', 1, 'Skrip A7-5', 'Caption A7-5', 'CTA A7-5', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000005', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000005', 'd7100000-0000-0000-0000-000000000005', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000005', 'd7000000-0000-0000-0000-000000000005', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-02T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000005', 'c7100000-0000-0000-0000-000000000005', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-02T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000006', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-6', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000006', 'd7000000-0000-0000-0000-000000000006', 1, 'Skrip A7-6', 'Caption A7-6', 'CTA A7-6', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000006', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000006', 'd7100000-0000-0000-0000-000000000006', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000006', 'd7000000-0000-0000-0000-000000000006', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-03T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000006', 'c7100000-0000-0000-0000-000000000006', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-03T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000007', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-7', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000007', 'd7000000-0000-0000-0000-000000000007', 1, 'Skrip A7-7', 'Caption A7-7', 'CTA A7-7', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000007', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000007', 'd7100000-0000-0000-0000-000000000007', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000007', 'd7000000-0000-0000-0000-000000000007', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-04T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000007', 'c7100000-0000-0000-0000-000000000007', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-04T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000008', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-8', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000008', 'd7000000-0000-0000-0000-000000000008', 1, 'Skrip A7-8', 'Caption A7-8', 'CTA A7-8', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000008', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000008', 'd7100000-0000-0000-0000-000000000008', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000008', 'd7000000-0000-0000-0000-000000000008', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-01T10:00:00Z', 'sending', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000008', 'c7100000-0000-0000-0000-000000000008', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "sending"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000009', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-9', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000009', 'd7000000-0000-0000-0000-000000000009', 1, 'Skrip A7-9', 'Caption A7-9', 'CTA A7-9', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000009', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000009', 'd7100000-0000-0000-0000-000000000009', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000009', 'd7000000-0000-0000-0000-000000000009', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-01T10:00:00Z', 'sending', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000009', 'c7100000-0000-0000-0000-000000000009', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "sending"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000010', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-10', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000010', 'd7000000-0000-0000-0000-000000000010', 1, 'Skrip A7-10', 'Caption A7-10', 'CTA A7-10', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000010', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000010', 'd7100000-0000-0000-0000-000000000010', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000010', 'd7000000-0000-0000-0000-000000000010', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-01T10:00:00Z', 'ready', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000010', 'c7100000-0000-0000-0000-000000000010', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "ready"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000011', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-11', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000011', 'd7000000-0000-0000-0000-000000000011', 1, 'Skrip A7-11', 'Caption A7-11', 'CTA A7-11', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000011', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000011', 'd7100000-0000-0000-0000-000000000011', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000011', 'd7000000-0000-0000-0000-000000000011', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-01T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000011', 'c7100000-0000-0000-0000-000000000011', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000012', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-12', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000012', 'd7000000-0000-0000-0000-000000000012', 1, 'Skrip A7-12', 'Caption A7-12', 'CTA A7-12', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000012', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000012', 'd7100000-0000-0000-0000-000000000012', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000012', 'd7000000-0000-0000-0000-000000000012', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-01T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000012', 'c7100000-0000-0000-0000-000000000012', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000013', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-13', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000013', 'd7000000-0000-0000-0000-000000000013', 1, 'Skrip A7-13', 'Caption A7-13', 'CTA A7-13', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000013', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000013', 'd7100000-0000-0000-0000-000000000013', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000013', 'd7000000-0000-0000-0000-000000000013', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-01T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000013', 'c7100000-0000-0000-0000-000000000013', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000014', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-14', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000014', 'd7000000-0000-0000-0000-000000000014', 1, 'Skrip A7-14', 'Caption A7-14', 'CTA A7-14', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000014', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000014', 'd7100000-0000-0000-0000-000000000014', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000014', 'd7000000-0000-0000-0000-000000000014', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-01T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000014', 'c7100000-0000-0000-0000-000000000014', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000015', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-15', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000015', 'd7000000-0000-0000-0000-000000000015', 1, 'Skrip A7-15', 'Caption A7-15', 'CTA A7-15', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000015', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000015', 'd7100000-0000-0000-0000-000000000015', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000015', 'd7000000-0000-0000-0000-000000000015', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-05T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000015', 'c7100000-0000-0000-0000-000000000015', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-05T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000016', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-16', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000016', 'd7000000-0000-0000-0000-000000000016', 1, 'Skrip A7-16', 'Caption A7-16', 'CTA A7-16', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000016', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000016', 'd7100000-0000-0000-0000-000000000016', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000016', 'd7000000-0000-0000-0000-000000000016', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-06T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000016', 'c7100000-0000-0000-0000-000000000016', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-06T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000017', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-17', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000017', 'd7000000-0000-0000-0000-000000000017', 1, 'Skrip A7-17', 'Caption A7-17', 'CTA A7-17', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000017', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000017', 'd7100000-0000-0000-0000-000000000017', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000017', 'd7000000-0000-0000-0000-000000000017', 'e7100000-0000-0000-0000-000000000001', 'reel', '2027-01-07T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000017', 'c7100000-0000-0000-0000-000000000017', 1, '{"platform_format": "reel", "scheduled_at": "2027-01-07T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000018', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-18', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000018', 'd7000000-0000-0000-0000-000000000018', 1, 'Skrip A7-18', 'Caption A7-18', 'CTA A7-18', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000018', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000018', 'd7100000-0000-0000-0000-000000000018', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000018', 'd7000000-0000-0000-0000-000000000018', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-09T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000018', 'c7100000-0000-0000-0000-000000000018', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-09T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000019', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-19', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000019', 'd7000000-0000-0000-0000-000000000019', 1, 'Skrip A7-19', 'Caption A7-19', 'CTA A7-19', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000019', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000019', 'd7100000-0000-0000-0000-000000000019', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000019', 'd7000000-0000-0000-0000-000000000019', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-10T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000019', 'c7100000-0000-0000-0000-000000000019', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-10T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values ('d7000000-0000-0000-0000-000000000020', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'Konten A7-20', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'Asia/Jakarta');
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-000000000020', 'd7000000-0000-0000-0000-000000000020', 1, 'Skrip A7-20', 'Caption A7-20', 'CTA A7-20', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values ('f7200000-0000-0000-0000-000000000020', 'b7000000-0000-0000-0000-000000000001', 'content_item', 'd7000000-0000-0000-0000-000000000020', 'd7100000-0000-0000-0000-000000000020', 'f7000000-0000-0000-0000-000000000001', 'internal', 'approved', '094e8752-eef4-4f0e-b6ae-2d5813445018', now(), now(), 1);
insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone) values ('c7100000-0000-0000-0000-000000000020', 'd7000000-0000-0000-0000-000000000020', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-01-11T10:00:00Z', 'draft', 'Asia/Jakarta');
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-000000000020', 'c7100000-0000-0000-0000-000000000020', 1, '{"platform_format": "reel", "scheduled_at": "2026-01-11T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');

-- Re-approve: pemicu placement menandai approval 'reapproval_required' saat placement ditambahkan; setujui ulang agar preflight lolos.
update public.approval_requests set status='approved', completed_at=now() where workspace_id='b7000000-0000-0000-0000-000000000001' and request_type='internal' and status='reapproval_required';
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
-- T-1a: job needs_manual_action (PLACEMENT_CHANGED) pulih ke ready saat periksa ulang.
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000001', '2027-01-01T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-1a: buat job jadwal lampau berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000001');
reset role;
update public.publishing_jobs set scheduled_at='2026-01-01T10:00:00Z', status='ready' where placement_id='c7100000-0000-0000-0000-000000000001';
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000001')), 'ready', 'T-1a: job awal berstatus ready');
reset role;
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-0000000000a1', 'c7100000-0000-0000-0000-000000000001', 2, '{"platform_format": "reel", "scheduled_at": "2026-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "ready"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
update public.approval_requests set status='approved', completed_at=now() where content_version_id='d7100000-0000-0000-0000-000000000001' and request_type='internal';
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
select public.process_publishing_jobs('b7000000-0000-0000-0000-000000000001', (select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000001'));
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000001')), 'needs_manual_action', 'T-1a: proses pertama -> needs_manual_action (PLACEMENT_CHANGED)');
select public.process_publishing_jobs('b7000000-0000-0000-0000-000000000001', (select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000001'));
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000001')), 'ready', 'T-1a: periksa ulang memulihkan job ke ready');
select is(((select placement_version_id::text from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000001')), 'c7200000-0000-0000-0000-0000000000a1', 'T-1a: snapshot placement_version_id diperbarui ke versi terbaru');
select ok((exists(select 1 from public.publishing_attempts where publishing_job_id = (select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000001') and result_status = 'recovered_ready')), 'T-1a: attempt recovered_ready tercatat');
-- T-1b: job dengan jadwal masa depan pulih ke scheduled_locally.
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000002', '2027-01-01T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-1b: buat job jadwal masa depan berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000002');
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000002')), 'scheduled_locally', 'T-1b: job awal berstatus scheduled_locally');
reset role;
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-0000000000a2', 'c7100000-0000-0000-0000-000000000002', 2, '{"platform_format": "reel", "scheduled_at": "2027-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "scheduled_locally"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
select public.process_publishing_jobs('b7000000-0000-0000-0000-000000000001', (select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000002'));
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000002')), 'needs_manual_action', 'T-1b: proses pertama -> needs_manual_action');
select public.process_publishing_jobs('b7000000-0000-0000-0000-000000000001', (select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000002'));
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000002')), 'scheduled_locally', 'T-1b: periksa ulang memulihkan ke scheduled_locally');
select ok((exists(select 1 from public.publishing_attempts where publishing_job_id = (select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000002') and result_status = 'recovered_ready')), 'T-1b: attempt recovered_ready tercatat');
-- T-1c: preflight masih gagal (approval basi) -> job tetap needs_manual_action.
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000003', '2027-01-01T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-1c: buat job berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000003');
reset role;
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by) values ('c7200000-0000-0000-0000-0000000000a3', 'c7100000-0000-0000-0000-000000000003', 2, '{"platform_format": "reel", "scheduled_at": "2026-01-01T10:00:00Z", "timezone": "Asia/Jakarta", "distribution_status": "ready"}'::jsonb, '094e8752-eef4-4f0e-b6ae-2d5813445018');
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
select public.process_publishing_jobs('b7000000-0000-0000-0000-000000000001', (select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000003'));
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000003')), 'needs_manual_action', 'T-1c: proses pertama -> needs_manual_action');
reset role;
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-0000000000a3', 'd7000000-0000-0000-0000-000000000003', 2, 'Skrip v2 belum approve', 'Caption v2', 'CTA v2', '094e8752-eef4-4f0e-b6ae-2d5813445018');
update public.approval_requests set status='approved', completed_at=now() where content_version_id='d7100000-0000-0000-0000-000000000003' and request_type='internal';
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
select public.process_publishing_jobs('b7000000-0000-0000-0000-000000000001', (select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000003'));
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000003')), 'needs_manual_action', 'T-1c: approval basi -> job tetap needs_manual_action');
select ok((exists(select 1 from public.publishing_attempts where publishing_job_id = (select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000003') and result_status = 'preflight_failed' and error_code = 'APPROVAL_STALE')), 'T-1c: attempt preflight_failed APPROVAL_STALE tercatat');
-- T-1d: job jatuh tempo normal (tanpa perubahan versi) tetap handoff manual, tanpa pemulihan palsu.
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000004', '2027-01-01T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-1d: buat job berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000004');
select public.process_publishing_jobs('b7000000-0000-0000-0000-000000000001', (select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000004'));
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000004')), 'needs_manual_action', 'T-1d: job jatuh tempo tanpa perubahan versi tetap handoff manual');
select ok((not exists(select 1 from public.publishing_attempts where publishing_job_id = (select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000004') and result_status = 'recovered_ready')), 'T-1d: tidak ada attempt recovered_ready (tanpa regresi)');
-- T-2a: konfirmasi manual dari job failed (3x gagal) diizinkan.
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000005', '2027-01-02T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-2a: buat job berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000005');
reset role;
update public.publishing_jobs set status = 'failed' where placement_id = 'c7100000-0000-0000-0000-000000000005';
insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_message_safe, started_at, completed_at) select id, g, 'failed', 'Gagal simulasi ' || g, now(), now() from public.publishing_jobs, generate_series(1, 3) g where placement_id = 'c7100000-0000-0000-0000-000000000005';
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
select is((public.confirm_publishing_job((select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000005'), 'https://www.instagram.com/p/a7test5/', now()) ->> 'ok'), 'true', 'T-2a: konfirmasi manual dari job failed berhasil');
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000005')), 'published', 'T-2a: job menjadi published');
select is(((select distribution_status from public.content_placements where id = 'c7100000-0000-0000-0000-000000000005')), 'published', 'T-2a: placement menjadi published');
select ok((exists(select 1 from public.published_posts where placement_id = 'c7100000-0000-0000-0000-000000000005' and canonical_url = 'https://www.instagram.com/p/a7test5/')), 'T-2a: baris published_posts tercatat');
-- T-2b: job failed tidak lagi mengunci slot jadwal.
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000006', '2027-01-03T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-2b: buat job pertama berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000006');
reset role;
update public.publishing_jobs set status = 'failed' where placement_id = 'c7100000-0000-0000-0000-000000000006';
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000006', '2027-01-03T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-2b: job baru di waktu sama setelah failed tidak diblokir');
select _reapprove('d7100000-0000-0000-0000-000000000006');
select is(((select count(*)::text from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000006')), '2', 'T-2b: kini ada 2 job (lama failed + baru)');
-- T-2c: job aktif di waktu sama tetap memblokir duplikat.
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000007', '2027-01-04T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-2c: buat job aktif berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000007');
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000007', '2027-01-04T10:00:00Z', 'Asia/Jakarta') ->> 'code'), 'DUPLICATE_JOB', 'T-2c: job aktif di waktu sama tetap DUPLICATE_JOB');
select _reapprove('d7100000-0000-0000-0000-000000000007');
select is(((select count(*)::text from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000007')), '1', 'T-2c: tetap 1 job');
-- T-3a: tulis manual ke published ditolak.
select is((public.change_placement_distribution('c7100000-0000-0000-0000-000000000008', 'published') ->> 'code'), 'DISTRIBUTION_MANUAL_PUBLISH_FORBIDDEN', 'T-3a: tulis manual ke published ditolak');
select is(((select distribution_status from public.content_placements where id = 'c7100000-0000-0000-0000-000000000008')), 'sending', 'T-3a: status placement tidak berubah');
-- T-3b: tulis manual ke uploaded_or_draft_created ditolak.
select is((public.change_placement_distribution('c7100000-0000-0000-0000-000000000009', 'uploaded_or_draft_created') ->> 'code'), 'DISTRIBUTION_MANUAL_PUBLISH_FORBIDDEN', 'T-3b: tulis manual ke uploaded_or_draft_created ditolak');
select is(((select distribution_status from public.content_placements where id = 'c7100000-0000-0000-0000-000000000009')), 'sending', 'T-3b: status placement tidak berubah');
-- T-3c: ubah manual ke cancelled ikut membatalkan job aktif terkait.
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000010', '2027-01-01T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-3c: buat job aktif berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000010');
select is((public.change_placement_distribution('c7100000-0000-0000-0000-000000000010', 'cancelled') ->> 'ok'), 'true', 'T-3c: ubah manual ke cancelled berhasil');
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000010')), 'cancelled', 'T-3c: job aktif ikut dibatalkan');
select ok((exists(select 1 from public.publishing_attempts where publishing_job_id = (select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000010') and result_status = 'cancelled')), 'T-3c: attempt cancelled tercatat untuk job');
select is(((select distribution_status from public.content_placements where id = 'c7100000-0000-0000-0000-000000000010')), 'cancelled', 'T-3c: placement menjadi cancelled');
-- T-3d: transisi manual normal tetap diizinkan (kontrol).
select is((public.change_placement_distribution('c7100000-0000-0000-0000-000000000011', 'ready') ->> 'ok'), 'true', 'T-3d: transisi manual normal draft -> ready tetap berhasil');
select is(((select distribution_status from public.content_placements where id = 'c7100000-0000-0000-0000-000000000011')), 'ready', 'T-3d: placement menjadi ready');
-- T-4a: hapus placement berbukti terbit (published_posts) ditolak trigger.
reset role;
insert into public.published_posts (id, workspace_id, placement_id, canonical_url, published_at, confirmation_source, created_by) values ('f7300000-0000-0000-0000-000000000012', 'b7000000-0000-0000-0000-000000000001', 'c7100000-0000-0000-0000-000000000012', 'https://www.instagram.com/p/a7test12/', now(), 'manual_user_confirmation', '094e8752-eef4-4f0e-b6ae-2d5813445018');
select is((_try_delete_placement('c7100000-0000-0000-0000-000000000012')), 'false', 'T-4a: hapus placement berbukti terbit ditolak');
select ok((exists(select 1 from public.content_placements where id = 'c7100000-0000-0000-0000-000000000012')), 'T-4a: placement berbukti tetap ada');
-- T-4b: hapus placement ber-job aktif ditolak trigger.
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000013', '2027-01-01T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-4b: buat job aktif berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000013');
reset role;
select is((_try_delete_placement('c7100000-0000-0000-0000-000000000013')), 'false', 'T-4b: hapus placement ber-job aktif ditolak');
select ok((exists(select 1 from public.content_placements where id = 'c7100000-0000-0000-0000-000000000013')), 'T-4b: placement ber-job aktif tetap ada');
-- T-4c: hapus placement yang hanya ber-job failed/cancelled tetap diizinkan.
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000014', '2027-01-01T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-4c: buat job berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000014');
reset role;
update public.publishing_jobs set status = 'failed' where placement_id = 'c7100000-0000-0000-0000-000000000014';
select is((_try_delete_placement('c7100000-0000-0000-0000-000000000014')), 'true', 'T-4c: hapus placement yang hanya ber-job failed berhasil');
select ok((not exists(select 1 from public.content_placements where id = 'c7100000-0000-0000-0000-000000000014')), 'T-4c: placement terhapus');
-- T-5a: reschedule valid bersifat atomik (batal lama + buat baru).
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000015', '2027-01-05T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-5a: buat job berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000015');
select is((public.reschedule_publishing_job((select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000015'), '2027-02-01T10:00:00Z', 'Asia/Jakarta') ->> 'code'), 'RESCHEDULED', 'T-5a: reschedule valid mengembalikan RESCHEDULED');
select is(((select count(*)::text from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000015' and status = 'cancelled')), '1', 'T-5a: job lama dibatalkan');
select ok((exists(select 1 from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000015' and status = 'scheduled_locally' and scheduled_at = '2027-02-01T10:00:00Z'::timestamptz)), 'T-5a: job baru dengan jadwal baru ada');
select ok((exists(select 1 from public.content_placements where id = 'c7100000-0000-0000-0000-000000000015' and scheduled_at = '2027-02-01T10:00:00Z'::timestamptz and distribution_status = 'scheduled_locally')), 'T-5a: placement memakai jadwal + status baru');
-- T-5b: reschedule ke waktu lampau ditolak, job lama utuh.
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000016', '2027-01-06T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-5b: buat job berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000016');
select is((public.reschedule_publishing_job((select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000016'), '2026-01-01T10:00:00Z', 'Asia/Jakarta') ->> 'code'), 'SCHEDULE_PAST', 'T-5b: reschedule ke waktu lampau ditolak SCHEDULE_PAST');
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000016')), 'scheduled_locally', 'T-5b: job lama utuh (masih scheduled_locally)');
select is(((select count(*)::text from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000016')), '1', 'T-5b: tidak ada job baru');
-- T-5c: reschedule ke waktu job lain ditolak, job lama utuh.
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000017', '2027-01-07T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-5c: buat job pertama berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000017');
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000017', '2027-01-08T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-5c: buat job kedua berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000017');
select is((public.reschedule_publishing_job((select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000017' and scheduled_at = '2027-01-07T10:00:00Z'), '2027-01-08T10:00:00Z', 'Asia/Jakarta') ->> 'code'), 'DUPLICATE_JOB', 'T-5c: reschedule ke waktu job lain ditolak DUPLICATE_JOB');
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000017' and scheduled_at = '2027-01-07T10:00:00Z')), 'scheduled_locally', 'T-5c: job lama utuh (masih scheduled_locally)');
select is(((select count(*)::text from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000017')), '2', 'T-5c: tetap 2 job');
-- T-5d: reschedule dengan approval basi ditolak, job lama utuh.
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000018', '2027-01-09T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-5d: buat job berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000018');
reset role;
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values ('d7100000-0000-0000-0000-0000000000a8', 'd7000000-0000-0000-0000-000000000018', 2, 'Skrip v2 belum approve', 'Caption v2', 'CTA v2', '094e8752-eef4-4f0e-b6ae-2d5813445018');
select _reapprove('d7100000-0000-0000-0000-000000000018');
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
select is((public.reschedule_publishing_job((select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000018'), '2027-02-01T10:00:00Z', 'Asia/Jakarta') ->> 'code'), 'APPROVAL_STALE', 'T-5d: reschedule dengan approval basi ditolak APPROVAL_STALE');
select is(((select status from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000018')), 'scheduled_locally', 'T-5d: job lama utuh (masih scheduled_locally)');
select is(((select count(*)::text from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000018')), '1', 'T-5d: tidak ada job baru');
-- T-5e: reschedule job terminal (published/cancelled) ditolak.
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000019', '2027-01-10T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-5e: buat job pertama berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000019');
select is((public.create_publishing_job('c7100000-0000-0000-0000-000000000020', '2027-01-11T10:00:00Z', 'Asia/Jakarta') ->> 'ok'), 'true', 'T-5e: buat job kedua berhasil');
select _reapprove('d7100000-0000-0000-0000-000000000020');
reset role;
update public.publishing_jobs set status = 'published' where placement_id = 'c7100000-0000-0000-0000-000000000019';
update public.publishing_jobs set status = 'cancelled' where placement_id = 'c7100000-0000-0000-0000-000000000020';
set local role authenticated;
select _set_user('094e8752-eef4-4f0e-b6ae-2d5813445018');
select is((public.reschedule_publishing_job((select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000019'), '2027-02-01T10:00:00Z', 'Asia/Jakarta') ->> 'code'), 'INVALID_STATE_TRANSITION', 'T-5e: reschedule job published ditolak');
select is((public.reschedule_publishing_job((select id from public.publishing_jobs where placement_id = 'c7100000-0000-0000-0000-000000000020'), '2027-02-01T10:00:00Z', 'Asia/Jakarta') ->> 'code'), 'INVALID_STATE_TRANSITION', 'T-5e: reschedule job cancelled ditolak');

-- Cleanup (sebagai postgres): hapus bukti/job dulu agar trigger T-4 tidak
-- menghalangi penghapusan placement fixture; lalu hapus sisanya berurutan.
reset role;
delete from public.published_posts where workspace_id = 'b7000000-0000-0000-0000-000000000001';
delete from public.publishing_attempts where publishing_job_id in (select id from public.publishing_jobs where workspace_id = 'b7000000-0000-0000-0000-000000000001');
delete from public.publishing_jobs where workspace_id = 'b7000000-0000-0000-0000-000000000001';
delete from public.placement_versions where placement_id in (select id from public.content_placements where content_item_id in (select id from public.content_items where workspace_id = 'b7000000-0000-0000-0000-000000000001'));
delete from public.content_placements where content_item_id in (select id from public.content_items where workspace_id = 'b7000000-0000-0000-0000-000000000001');
delete from public.approval_requests where workspace_id = 'b7000000-0000-0000-0000-000000000001';
delete from public.approval_steps where workflow_id in (select id from public.approval_workflows where workspace_id = 'b7000000-0000-0000-0000-000000000001');
delete from public.approval_workflows where workspace_id = 'b7000000-0000-0000-0000-000000000001';
delete from public.content_versions where content_item_id in (select id from public.content_items where workspace_id = 'b7000000-0000-0000-0000-000000000001');
delete from public.content_items where workspace_id = 'b7000000-0000-0000-0000-000000000001';
delete from public.social_channels where brand_id in (select id from public.brands where workspace_id = 'b7000000-0000-0000-0000-000000000001');
delete from public.brands where workspace_id = 'b7000000-0000-0000-0000-000000000001';
delete from public.workspace_members where workspace_id = 'b7000000-0000-0000-0000-000000000001';
delete from public.workspaces where id = 'b7000000-0000-0000-0000-000000000001';
delete from public.organization_members where organization_id = 'a7000000-0000-0000-0000-000000000001';
delete from public.organizations where id = 'a7000000-0000-0000-0000-000000000001';
drop function if exists public._set_user(uuid, text);
drop function if exists public._as_anon();
drop function if exists public._try_delete_placement(uuid);
select * from finish();
rollback;
