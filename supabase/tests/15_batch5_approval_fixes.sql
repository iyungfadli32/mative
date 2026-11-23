-- 15_batch5_approval_fixes.sql - Batch 5 (d) F-02..F-05: pemulihan reapproval + SoD + langkah paralel + tukar aset.
--
-- F-02: approved -> editing legal bila ada request reapproval_required (0031), lalu ajukan ulang.
-- F-03: pengaju tidak boleh memutuskan request-nya sendiri (SoD), kecuali setelan workspace
--       approval.allow_self_approval = {"enabled": true} (default: mati).
-- F-04: dua langkah paralel dengan role/user yang sama harus bisa diputuskan satu per satu.
-- F-05: UPDATE content_assets.asset_id (tukar aset di tempat) menandai reapproval_required;
--       UPDATE yang tidak mengubah asset_id tidak menandai apa-apa.
--
-- Cara menjalankan (database KHUSUS tes, BUKAN database produksi berisi data nyata):
--   psql "$DATABASE_URL" -f supabase/tests/15_batch5_approval_fixes.sql
-- File ini memakai JWT claims palsu lewat set_config('request.jwt.claims') seperti 04.
-- Setup sebagai postgres (bypass RLS), baru 'set local role authenticated'.
-- RPC mengembalikan jsonb {ok, code, message} - TIDAK melempar - asersi memakai
-- is((... ->> 'ok'), 'true'/'false') dan is((... ->> 'code'), 'FORBIDDEN'), BUKAN throws_ok.
-- UPDATE di bawah RLS tidak melempar exception: pakai asersi jumlah baris terpengaruh
-- (CTE UPDATE + is(count, N)).
-- Placeholder :'user_a' / :'user_b' / :'user_c' TIDAK BOLEH di dalam blok $$...$$ -
-- teruskan UUID sebagai parameter fungsi.
-- PERHATIAN (pelajaran pgTAP 12): tes ini TIDAK mengubah scheduled_at placement, supaya
-- tidak ada efek samping reapproval di luar yang diuji.

begin;
select plan(30);

\set user_a '094e8752-eef4-4f0e-b6ae-2d5813445018'
\set user_b 'aabb1dab-77c1-4659-af0e-c703c9de279c'
\set user_c 'b2e98541-1162-4cc7-9835-603a217e0d1b'
-- Catatan: user_a/b/c memakai akun uji yang sudah ada di auth.users
-- (mative-test-a, mative-test-b, mative-e2e) karena organizations.owner_user_id
-- adalah FK ke auth.users(id); UUID palsu ditolak FK tersebut.

create or replace function _set_user(p_user uuid, p_email text default 'test@example.com')
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email)::text, true);
$$;

-- Fixture (postgres, bypass RLS). UUID prefix 5 = Batch 5, tidak bentrok dengan 04/14.
insert into public.organizations (id, name, slug, owner_user_id) values
  ('a5000000-0000-0000-0000-000000000001', 'Org Batch5', 'org-batch5-test', :'user_a')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at) values
  ('a5000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
  ('a5000000-0000-0000-0000-000000000001', :'user_b', 'member', 'active', now()),
  ('a5000000-0000-0000-0000-000000000001', :'user_c', 'member', 'active', now())
on conflict do nothing;

insert into public.workspaces (id, organization_id, name, slug, timezone) values
  ('b5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'WS Batch5', 'ws-batch5-test', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at) values
  ('b5000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
  ('b5000000-0000-0000-0000-000000000001', :'user_b', 'approver', 'active', now()),
  ('b5000000-0000-0000-0000-000000000001', :'user_c', 'approver', 'active', now())
on conflict do nothing;

insert into public.brands (id, workspace_id, name, slug, status) values
  ('e5000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000001', 'Brand Batch5', 'brand-batch5', 'active')
on conflict (id) do nothing;

insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values
  ('d5000000-0000-0000-0000-0000000000a1', 'b5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'Item R Reapproval', 'approved', :'user_a', 'Asia/Jakarta'),
  ('d5000000-0000-0000-0000-0000000000a2', 'b5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'Item S1 SoD', 'internal_review', :'user_a', 'Asia/Jakarta'),
  ('d5000000-0000-0000-0000-0000000000a3', 'b5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'Item S2 SoD', 'internal_review', :'user_a', 'Asia/Jakarta'),
  ('d5000000-0000-0000-0000-0000000000a4', 'b5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'Item S3 SoD', 'internal_review', :'user_a', 'Asia/Jakarta'),
  ('d5000000-0000-0000-0000-0000000000a5', 'b5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'Item S4 SoD', 'internal_review', :'user_a', 'Asia/Jakarta'),
  ('d5000000-0000-0000-0000-0000000000a6', 'b5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'Item P1 Paralel', 'internal_review', :'user_a', 'Asia/Jakarta'),
  ('d5000000-0000-0000-0000-0000000000a7', 'b5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'Item P2 Paralel', 'internal_review', :'user_a', 'Asia/Jakarta'),
  ('d5000000-0000-0000-0000-0000000000a8', 'b5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'Item A1 Aset', 'approved', :'user_a', 'Asia/Jakarta'),
  ('d5000000-0000-0000-0000-0000000000a9', 'b5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'Item A2 Aset', 'approved', :'user_a', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by) values
  ('d6000000-0000-0000-0000-0000000000a1', 'd5000000-0000-0000-0000-0000000000a1', 1, 'Skrip v1 R', 'Caption v1 R', 'CTA v1 R', :'user_a'),
  ('d6000000-0000-0000-0000-0000000000a2', 'd5000000-0000-0000-0000-0000000000a2', 1, 'Skrip v1 S1', 'Caption v1 S1', 'CTA v1 S1', :'user_a'),
  ('d6000000-0000-0000-0000-0000000000a3', 'd5000000-0000-0000-0000-0000000000a3', 1, 'Skrip v1 S2', 'Caption v1 S2', 'CTA v1 S2', :'user_a'),
  ('d6000000-0000-0000-0000-0000000000a4', 'd5000000-0000-0000-0000-0000000000a4', 1, 'Skrip v1 S3', 'Caption v1 S3', 'CTA v1 S3', :'user_a'),
  ('d6000000-0000-0000-0000-0000000000a5', 'd5000000-0000-0000-0000-0000000000a5', 1, 'Skrip v1 S4', 'Caption v1 S4', 'CTA v1 S4', :'user_a'),
  ('d6000000-0000-0000-0000-0000000000a6', 'd5000000-0000-0000-0000-0000000000a6', 1, 'Skrip v1 P1', 'Caption v1 P1', 'CTA v1 P1', :'user_a'),
  ('d6000000-0000-0000-0000-0000000000a7', 'd5000000-0000-0000-0000-0000000000a7', 1, 'Skrip v1 P2', 'Caption v1 P2', 'CTA v1 P2', :'user_a'),
  ('d6000000-0000-0000-0000-0000000000a8', 'd5000000-0000-0000-0000-0000000000a8', 1, 'Skrip v1 A1', 'Caption v1 A1', 'CTA v1 A1', :'user_a'),
  ('d6000000-0000-0000-0000-0000000000a9', 'd5000000-0000-0000-0000-0000000000a9', 1, 'Skrip v1 A2', 'Caption v1 A2', 'CTA v1 A2', :'user_a'),
  ('d6000000-0000-0000-0000-0000000000b1', 'd5000000-0000-0000-0000-0000000000a1', 2, 'Skrip v2 R (perbaikan)', 'Caption v2 R', 'CTA v2 R', :'user_a')
on conflict (id) do nothing;

insert into public.approval_workflows (id, workspace_id, name, is_default, created_by) values
  ('f5000000-0000-0000-0000-0000000000a1', 'b5000000-0000-0000-0000-000000000001', 'Workflow Default Batch5', true, :'user_a'),
  ('f5000000-0000-0000-0000-0000000000a2', 'b5000000-0000-0000-0000-000000000001', 'Workflow Eksplisit Batch5', false, :'user_a'),
  ('f5000000-0000-0000-0000-0000000000a3', 'b5000000-0000-0000-0000-000000000001', 'Workflow Paralel Role Sama', false, :'user_a')
on conflict (id) do nothing;

-- Langkah paralel role sama: created_at dibuat berbeda supaya urutan "paling awal" deterministik.
insert into public.approval_steps (id, workflow_id, step_order, step_type, assignee_role, assignee_user_id, required_count, created_at) values
  ('f6000000-0000-0000-0000-0000000000a1', 'f5000000-0000-0000-0000-0000000000a1', 1, 'sequential', 'approver', null, 1, now()),
  ('f6000000-0000-0000-0000-0000000000a2', 'f5000000-0000-0000-0000-0000000000a2', 1, 'sequential', null, :'user_a', 1, now()),
  ('f6000000-0000-0000-0000-0000000000a3', 'f5000000-0000-0000-0000-0000000000a3', 1, 'parallel', 'approver', null, 1, '2026-01-01 00:00:00+00'),
  ('f6000000-0000-0000-0000-0000000000a4', 'f5000000-0000-0000-0000-0000000000a3', 1, 'parallel', 'approver', null, 1, '2026-01-01 00:01:00+00')
on conflict (id) do nothing;

-- Aset ditautkan SEBELUM request approval dibuat: trigger penanda perubahan
-- kritis menandai request 'approved' menjadi reapproval_required saat aset
-- ditautkan. Bila tautan dibuat sesudah request 'approved' ada, request A1/A2
-- sudah berstatus reapproval_required sebelum asersi F02/F05 berjalan.
insert into public.assets (id, workspace_id, object_key, original_filename, mime_type, byte_size, uploaded_by, processing_status, created_at) values
  ('a8000000-0000-0000-0000-0000000000a1', 'b5000000-0000-0000-0000-000000000001', 'batch5/aset-1.png', 'aset-1.png', 'image/png', 1024, :'user_a', 'ready', now()),
  ('a8000000-0000-0000-0000-0000000000a2', 'b5000000-0000-0000-0000-000000000001', 'batch5/aset-2.png', 'aset-2.png', 'image/png', 2048, :'user_a', 'ready', now()),
  ('a8000000-0000-0000-0000-0000000000a3', 'b5000000-0000-0000-0000-000000000001', 'batch5/aset-3.png', 'aset-3.png', 'image/png', 1024, :'user_a', 'ready', now())
on conflict (id) do nothing;
insert into public.content_assets (id, content_item_id, asset_id, usage_role, sort_order) values
  ('c8000000-0000-0000-0000-0000000000a1', 'd5000000-0000-0000-0000-0000000000a8', 'a8000000-0000-0000-0000-0000000000a1', 'primary', 1),
  ('c8000000-0000-0000-0000-0000000000a2', 'd5000000-0000-0000-0000-0000000000a9', 'a8000000-0000-0000-0000-0000000000a3', 'primary', 1)
on conflict (id) do nothing;
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values
  ('f7000000-0000-0000-0000-0000000000a1', 'b5000000-0000-0000-0000-000000000001', 'content_item', 'd5000000-0000-0000-0000-0000000000a1', 'd6000000-0000-0000-0000-0000000000a1', 'f5000000-0000-0000-0000-0000000000a1', 'internal', 'reapproval_required', :'user_a', now(), null, 1),
  ('f7000000-0000-0000-0000-0000000000a2', 'b5000000-0000-0000-0000-000000000001', 'content_item', 'd5000000-0000-0000-0000-0000000000a2', 'd6000000-0000-0000-0000-0000000000a2', 'f5000000-0000-0000-0000-0000000000a2', 'internal', 'in_review', :'user_a', now(), null, 1),
  ('f7000000-0000-0000-0000-0000000000a3', 'b5000000-0000-0000-0000-000000000001', 'content_item', 'd5000000-0000-0000-0000-0000000000a3', 'd6000000-0000-0000-0000-0000000000a3', 'f5000000-0000-0000-0000-0000000000a2', 'internal', 'in_review', :'user_b', now(), null, 1),
  ('f7000000-0000-0000-0000-0000000000a4', 'b5000000-0000-0000-0000-000000000001', 'content_item', 'd5000000-0000-0000-0000-0000000000a4', 'd6000000-0000-0000-0000-0000000000a4', 'f5000000-0000-0000-0000-0000000000a2', 'internal', 'in_review', :'user_a', now(), null, 1),
  ('f7000000-0000-0000-0000-0000000000a5', 'b5000000-0000-0000-0000-000000000001', 'content_item', 'd5000000-0000-0000-0000-0000000000a5', 'd6000000-0000-0000-0000-0000000000a5', 'f5000000-0000-0000-0000-0000000000a2', 'internal', 'in_review', :'user_a', now(), null, 1),
  ('f7000000-0000-0000-0000-0000000000a6', 'b5000000-0000-0000-0000-000000000001', 'content_item', 'd5000000-0000-0000-0000-0000000000a6', 'd6000000-0000-0000-0000-0000000000a6', 'f5000000-0000-0000-0000-0000000000a3', 'internal', 'in_review', :'user_a', now(), null, 1),
  ('f7000000-0000-0000-0000-0000000000a7', 'b5000000-0000-0000-0000-000000000001', 'content_item', 'd5000000-0000-0000-0000-0000000000a7', 'd6000000-0000-0000-0000-0000000000a7', 'f5000000-0000-0000-0000-0000000000a3', 'internal', 'in_review', :'user_a', now(), null, 1),
  ('f7000000-0000-0000-0000-0000000000a8', 'b5000000-0000-0000-0000-000000000001', 'content_item', 'd5000000-0000-0000-0000-0000000000a8', 'd6000000-0000-0000-0000-0000000000a8', 'f5000000-0000-0000-0000-0000000000a1', 'internal', 'approved', :'user_a', now(), now(), 1),
  ('f7000000-0000-0000-0000-0000000000a9', 'b5000000-0000-0000-0000-000000000001', 'content_item', 'd5000000-0000-0000-0000-0000000000a9', 'd6000000-0000-0000-0000-0000000000a9', 'f5000000-0000-0000-0000-0000000000a1', 'internal', 'approved', :'user_a', now(), now(), 1)
on conflict (id) do nothing;



set local role authenticated;

-- ================= F-02: pemulihan reapproval_required =================
select _set_user(:'user_a');
select is((select (public.transition_content_item_status('d5000000-0000-0000-0000-0000000000a8', 'editing', null) ->> 'ok')), 'false', 'F02-1 TOLAK: approved -> editing tanpa request reapproval_required harus ditolak');
select is((select production_status from public.content_items where id = 'd5000000-0000-0000-0000-0000000000a8'), 'approved', 'F02-2 Item A1 tetap approved sesudah penolakan');
select is((select (public.transition_content_item_status('d5000000-0000-0000-0000-0000000000a1', 'editing', null) ->> 'ok')), 'true', 'F02-3 ALLOW: approved -> editing dengan request reapproval_required harus diizinkan');
select is((select production_status from public.content_items where id = 'd5000000-0000-0000-0000-0000000000a1'), 'editing', 'F02-4 Item R berpindah ke editing');
select is((select (public.create_approval_request('d5000000-0000-0000-0000-0000000000a1', 'd6000000-0000-0000-0000-0000000000b1') ->> 'ok')), 'true', 'F02-5 ALLOW: ajukan ulang approval untuk versi perbaikan (v2) harus berhasil');
select is((select count(*) from public.approval_requests where target_id = 'd5000000-0000-0000-0000-0000000000a1' and content_version_id = 'd6000000-0000-0000-0000-0000000000b1' and status = 'in_review'), 1::bigint, 'F02-6 Request baru untuk v2 berstatus in_review');

-- ================= F-03: pemisahan tugas (SoD) =================
select _set_user(:'user_a');
select is((select (public.decide_approval_request('f7000000-0000-0000-0000-0000000000a2', 'approved') ->> 'ok')), 'false', 'F03-1 TOLAK: pengaju (user_a) tidak boleh memutuskan request-nya sendiri (S1)');
select is((select (public.decide_approval_request('f7000000-0000-0000-0000-0000000000a2', 'approved') ->> 'code')), 'FORBIDDEN', 'F03-2 Penolakan self-approval berkode FORBIDDEN');
select is((select (public.decide_approval_request('f7000000-0000-0000-0000-0000000000a3', 'approved') ->> 'ok')), 'true', 'F03-3 ALLOW: user_a boleh memutuskan request orang lain (S2, diajukan user_b)');
reset role;
delete from public.workspace_settings where workspace_id = 'b5000000-0000-0000-0000-000000000001' and key = 'approval.allow_self_approval';
insert into public.workspace_settings (workspace_id, key, value_json) values ('b5000000-0000-0000-0000-000000000001', 'approval.allow_self_approval', '{"enabled": true}'::jsonb);
set local role authenticated;
select _set_user(:'user_a');
select is((select (public.decide_approval_request('f7000000-0000-0000-0000-0000000000a4', 'approved') ->> 'ok')), 'true', 'F03-4 ALLOW: self-approval diizinkan bila setelan allow_self_approval aktif (S3)');
reset role;
delete from public.workspace_settings where workspace_id = 'b5000000-0000-0000-0000-000000000001' and key = 'approval.allow_self_approval';
set local role authenticated;
select _set_user(:'user_a');
select is((select (public.decide_approval_request('f7000000-0000-0000-0000-0000000000a5', 'approved') ->> 'ok')), 'false', 'F03-5 TOLAK: self-approval ditolak lagi sesudah setelan dihapus (default mati, S4)');
select is((select (public.decide_approval_request('f7000000-0000-0000-0000-0000000000a5', 'approved') ->> 'code')), 'FORBIDDEN', 'F03-6 Penolakan sesudah setelan dihapus berkode FORBIDDEN');

-- ================= F-04: langkah paralel role sama =================
select _set_user(:'user_b');
select is((select (public.decide_approval_request('f7000000-0000-0000-0000-0000000000a6', 'approved') ->> 'ok')), 'true', 'F04-1 ALLOW: approver memutuskan langkah paralel role sama (P1, keputusan ke-1)');
select is((select count(*) from public.approval_decisions where approval_request_id = 'f7000000-0000-0000-0000-0000000000a6' and step_id = 'f6000000-0000-0000-0000-0000000000a3' and approver_user_id = :'user_b'), 1::bigint, 'F04-2 Keputusan ke-1 tercatat pada langkah paralel pertama');
select is((select status from public.approval_requests where id = 'f7000000-0000-0000-0000-0000000000a6'), 'in_review', 'F04-3 Request P1 tetap in_review sesudah 1 dari 2 langkah paralel');
select is((select (public.decide_approval_request('f7000000-0000-0000-0000-0000000000a6', 'approved') ->> 'ok')), 'true', 'F04-4 ALLOW: approver yang sama memutuskan langkah paralel kedua (P1, keputusan ke-2)');
select is((select count(*) from public.approval_decisions where approval_request_id = 'f7000000-0000-0000-0000-0000000000a6' and step_id = 'f6000000-0000-0000-0000-0000000000a4' and approver_user_id = :'user_b'), 1::bigint, 'F04-5 Keputusan ke-2 tercatat pada langkah paralel kedua (bukan langkah yang sama)');
select is((select status from public.approval_requests where id = 'f7000000-0000-0000-0000-0000000000a6'), 'approved', 'F04-6 Request P1 approved sesudah kedua langkah paralel menyetujui');
select is((select (public.decide_approval_request('f7000000-0000-0000-0000-0000000000a7', 'approved') ->> 'ok')), 'true', 'F04-7 ALLOW: approver B memutuskan langkah paralel pertama (P2)');
select _set_user(:'user_c');
select is((select (public.decide_approval_request('f7000000-0000-0000-0000-0000000000a7', 'approved') ->> 'ok')), 'true', 'F04-8 ALLOW: approver C (role sama, user berbeda) memutuskan langkah paralel kedua (P2)');
select is((select count(*) from public.approval_decisions where approval_request_id = 'f7000000-0000-0000-0000-0000000000a7' and step_id = 'f6000000-0000-0000-0000-0000000000a3' and approver_user_id = :'user_b'), 1::bigint, 'F04-9 Keputusan B tercatat pada langkah paralel pertama (P2)');
select is((select count(*) from public.approval_decisions where approval_request_id = 'f7000000-0000-0000-0000-0000000000a7' and step_id = 'f6000000-0000-0000-0000-0000000000a4' and approver_user_id = :'user_c'), 1::bigint, 'F04-10 Keputusan C tercatat pada langkah paralel kedua (P2)');
select is((select status from public.approval_requests where id = 'f7000000-0000-0000-0000-0000000000a7'), 'approved', 'F04-11 Request P2 approved sesudah kedua approver role sama menyetujui');

-- ================= F-05: tukar aset di tempat =================
select _set_user(:'user_a');
with u as (update public.content_assets set asset_id = 'a8000000-0000-0000-0000-0000000000a2' where id = 'c8000000-0000-0000-0000-0000000000a1' returning id)
select is((select count(*) from u), 1::bigint, 'F05-1 Tukar aset di tempat: UPDATE asset_id berhasil 1 baris (A1)');
select is((select status from public.approval_requests where id = 'f7000000-0000-0000-0000-0000000000a8'), 'reapproval_required', 'F05-2 Tukar aset menandai request A1 menjadi reapproval_required');
select is((select production_status from public.content_items where id = 'd5000000-0000-0000-0000-0000000000a8'), 'approved', 'F05-3 Item A1 tetap approved (hanya request yang ditandai)');
with u as (update public.content_assets set asset_id = asset_id where id = 'c8000000-0000-0000-0000-0000000000a2' returning id)
select is((select count(*) from u), 1::bigint, 'F05-4 UPDATE no-op (asset_id sama) berhasil 1 baris (A2)');
select is((select status from public.approval_requests where id = 'f7000000-0000-0000-0000-0000000000a9'), 'approved', 'F05-5 UPDATE no-op TIDAK menandai request A2 (tetap approved)');
with u as (update public.content_assets set sort_order = 2 where id = 'c8000000-0000-0000-0000-0000000000a2' returning id)
select is((select count(*) from u), 1::bigint, 'F05-6 UPDATE kolom lain (sort_order) berhasil 1 baris (A2)');
select is((select status from public.approval_requests where id = 'f7000000-0000-0000-0000-0000000000a9'), 'approved', 'F05-7 UPDATE kolom lain TIDAK menandai request A2 (tetap approved)');

select * from finish();
rollback;
