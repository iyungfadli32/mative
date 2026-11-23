-- MaTive -- pgTAP 14: Perbaikan (b) T-1..T-8 Batch 4 (0030).
-- T-3: trigger INSERT placement menolak 'published'/'uploaded_or_draft_created'
--   dan 'ready' tanpa scheduled_at; 'draft'/'sending' tetap boleh disisipkan.
-- T-6: arsip dari status apa pun (dengan alasan); soft-delete; duplikasi konten.
-- T-7: internal_review -> approved hanya bila ada approval request yang disetujui
--   untuk versi terbaru; transisi lain tidak ikut digerbang.
-- Pola mengikuti 13_asset_upload_versioning_comment_notifications.sql: begin...
-- rollback, _set_user(), fixture di dalam transaksi, plan() eksplisit.
-- Penolakan lewat RPC diuji dari jsonb {ok:false}; penolakan trigger lewat helper
-- _try_insert_placement (menangkap check_violation/insufficient_privilege).
begin;
select plan(31);

create or replace function _set_user(p_user uuid, p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email)::text, true);
$$;
create or replace function _as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{}', true);
$$;
-- Baca baris konten tanpa RLS (security definer), untuk asersi pasca-RPC.
create or replace function _item_json(p_id uuid) returns jsonb language sql security definer as $$
  select to_jsonb(ci) from public.content_items ci where ci.id = p_id;
$$;
create or replace function _version_script(p_item uuid, p_num integer) returns text language sql security definer as $$
  select cv.script from public.content_versions cv where cv.content_item_id = p_item and cv.version_number = p_num;
$$;
-- Coba sisip placement sebagai pemanggil (hak invoker: RLS + trigger berlaku).
create or replace function _try_insert_placement(
  p_id uuid, p_item uuid, p_channel uuid, p_status text, p_scheduled timestamptz
) returns text language plpgsql as $$
begin
  insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, distribution_status, scheduled_at, timezone)
  values (p_id, p_item, p_channel, 'reel', p_status, p_scheduled, 'Asia/Jakarta');
  return 'inserted';
exception
  when check_violation then
  return 'check_violation';
  when insufficient_privilege then
  return 'insufficient_privilege';
end;
$$;

-- Fixture: org + workspace + anggota (A owner, B/C creator).
insert into public.organizations (id, name, slug, owner_user_id) values
  ('c9000000-0000-4000-8000-000000000001', 'Org C9', 'org-c9-pgtap14', '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.workspaces (id, organization_id, name, slug, timezone) values
  ('d9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'WS C9', 'ws-c9-pgtap14', 'Asia/Jakarta');
insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at) values
  ('d9000000-0000-4000-8000-000000000001', '094e8752-eef4-4f0e-b6ae-2d5813445018', 'owner', 'active', now()),
  ('d9000000-0000-4000-8000-000000000001', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'creator', 'active', now());
insert into public.brands (id, workspace_id, name, slug, status) values
  ('e9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 'Brand C9', 'brand-c9-pgtap14', 'active');
insert into public.social_channels (id, brand_id, platform, account_name, connection_status) values
  ('f9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'instagram', 'IG C9', 'manual');
insert into public.approval_workflows (id, workspace_id, name, is_default, created_by) values
  ('a9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 'Internal default', true, '094e8752-eef4-4f0e-b6ae-2d5813445018');
insert into public.approval_steps (id, workflow_id, step_order, step_type, assignee_role, assignee_user_id, required_count) values
  ('b9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 1, 'sequential', 'manager', null, 1);

-- Fixture konten. Semua milik B (creator) agar can_edit_content_item terpenuhi.
insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone) values
  ('e9000000-0000-4000-8000-000000000101', 'd9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'Konten T3', 'approved', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'Asia/Jakarta'),
  ('e9000000-0000-4000-8000-000000000102', 'd9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'Konten Y', 'idea', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'Asia/Jakarta'),
  ('e9000000-0000-4000-8000-000000000103', 'd9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'Konten S', 'scripting', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'Asia/Jakarta'),
  ('e9000000-0000-4000-8000-000000000104', 'd9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'Konten Z', 'approved', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'Asia/Jakarta'),
  ('e9000000-0000-4000-8000-000000000105', 'd9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'Konten W', 'editing', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'Asia/Jakarta'),
  ('e9000000-0000-4000-8000-000000000106', 'd9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'Konten X', 'internal_review', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'Asia/Jakarta'),
  ('e9000000-0000-4000-8000-000000000107', 'd9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'Konten X2', 'internal_review', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'Asia/Jakarta'),
  ('e9000000-0000-4000-8000-000000000108', 'd9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'Konten X3', 'internal_review', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'Asia/Jakarta'),
  ('e9000000-0000-4000-8000-000000000109', 'd9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'Konten X4', 'internal_review', 'b2e98541-1162-4cc7-9835-603a217e0d1b', 'Asia/Jakarta');
update public.content_items set due_at = '2026-12-01T09:00:00Z' where id = 'e9000000-0000-4000-8000-000000000105';
insert into public.content_versions (id, content_item_id, version_number, brief_snapshot, script, caption, created_by) values
  ('e9100000-0000-4000-8000-000000000105', 'e9000000-0000-4000-8000-000000000105', 1, '{}', 'naskah W', 'caption W', 'b2e98541-1162-4cc7-9835-603a217e0d1b'),
  ('e9100000-0000-4000-8000-000000000106', 'e9000000-0000-4000-8000-000000000106', 1, '{}', 'naskah X', 'caption X', 'b2e98541-1162-4cc7-9835-603a217e0d1b'),
  ('e9100000-0000-4000-8000-000000000107', 'e9000000-0000-4000-8000-000000000107', 1, '{}', 'naskah X2', 'caption X2', 'b2e98541-1162-4cc7-9835-603a217e0d1b'),
  ('e9100000-0000-4000-8000-000000000108', 'e9000000-0000-4000-8000-000000000108', 1, '{}', 'naskah X3', 'caption X3', 'b2e98541-1162-4cc7-9835-603a217e0d1b'),
  ('e9100000-0000-4000-8000-000000000118', 'e9000000-0000-4000-8000-000000000108', 2, '{}', 'naskah X3 revisi', 'caption X3 revisi', 'b2e98541-1162-4cc7-9835-603a217e0d1b'),
  ('e9100000-0000-4000-8000-000000000109', 'e9000000-0000-4000-8000-000000000109', 1, '{}', 'naskah X4', 'caption X4', 'b2e98541-1162-4cc7-9835-603a217e0d1b');
-- Approval: X disetujui untuk v1 (terbaru); X3 disetujui hanya untuk v1 (v2 terbaru).
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order) values
  ('c9100000-0000-4000-8000-000000000106', 'd9000000-0000-4000-8000-000000000001', 'content_item', 'e9000000-0000-4000-8000-000000000106', 'e9100000-0000-4000-8000-000000000106', 'a9000000-0000-4000-8000-000000000001', 'internal', 'approved', 'b2e98541-1162-4cc7-9835-603a217e0d1b', now(), now(), 1),
  ('c9100000-0000-4000-8000-000000000108', 'd9000000-0000-4000-8000-000000000001', 'content_item', 'e9000000-0000-4000-8000-000000000108', 'e9100000-0000-4000-8000-000000000108', 'a9000000-0000-4000-8000-000000000001', 'internal', 'approved', 'b2e98541-1162-4cc7-9835-603a217e0d1b', now(), now(), 1);

select public._set_user('b2e98541-1162-4cc7-9835-603a217e0d1b', 'mative-test-c@example.com');
set local role authenticated;

-- Struktur baru 0030.
select has_column('public', 'content_items', 'deleted_at', 'T-6: kolom deleted_at ada di content_items');
select has_column('public', 'content_items', 'archived_reason', 'T-6: kolom archived_reason ada di content_items');
select has_function('public', 'soft_delete_content_item', ARRAY['uuid', 'text'], 'T-6: RPC soft_delete_content_item ada');

-- T-3: trigger status awal placement.
select is(public._try_insert_placement('c9100000-0000-4000-8000-000000000201', 'e9000000-0000-4000-8000-000000000101', 'f9000000-0000-4000-8000-000000000001', 'draft', null), 'inserted', 'T-3: INSERT placement draft tanpa jadwal diizinkan');
select is(public._try_insert_placement('c9100000-0000-4000-8000-000000000202', 'e9000000-0000-4000-8000-000000000101', 'f9000000-0000-4000-8000-000000000001', 'ready', '2026-12-05T10:00:00Z'), 'inserted', 'T-3: INSERT placement ready + scheduled_at diizinkan');
select is(public._try_insert_placement('c9100000-0000-4000-8000-000000000203', 'e9000000-0000-4000-8000-000000000101', 'f9000000-0000-4000-8000-000000000001', 'ready', null), 'check_violation', 'T-3: INSERT placement ready tanpa scheduled_at ditolak');
select is(public._try_insert_placement('c9100000-0000-4000-8000-000000000204', 'e9000000-0000-4000-8000-000000000101', 'f9000000-0000-4000-8000-000000000001', 'published', '2026-12-05T10:00:00Z'), 'check_violation', 'T-3: INSERT placement published ditolak');
select is(public._try_insert_placement('c9100000-0000-4000-8000-000000000205', 'e9000000-0000-4000-8000-000000000101', 'f9000000-0000-4000-8000-000000000001', 'uploaded_or_draft_created', '2026-12-05T10:00:00Z'), 'check_violation', 'T-3: INSERT placement uploaded_or_draft_created ditolak');
select is(public._try_insert_placement('c9100000-0000-4000-8000-000000000206', 'e9000000-0000-4000-8000-000000000101', 'f9000000-0000-4000-8000-000000000001', 'sending', null), 'inserted', 'T-3: INSERT placement sending tetap diizinkan (bukan jalur pembuatan awal)');

-- T-6: arsip dari status apa pun, dengan alasan.
do $$
declare v_result jsonb;
begin
  select public.transition_content_item_status('e9000000-0000-4000-8000-000000000102', 'archived', null) into v_result;
  perform ok(not (v_result->>'ok')::boolean, 'T-6: arsip tanpa alasan ditolak');
end $$;
do $$
declare v_result jsonb;
begin
  select public.transition_content_item_status('e9000000-0000-4000-8000-000000000102', 'archived', 'Alasan arsip Y') into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-6: arsip dari idea dengan alasan diizinkan');
end $$;
select is(public._item_json('e9000000-0000-4000-8000-000000000102')->>'production_status', 'archived', 'T-6: status Y menjadi archived');
select is(public._item_json('e9000000-0000-4000-8000-000000000102')->>'archived_reason', 'Alasan arsip Y', 'T-6: archived_reason Y tercatat');
select ok((public._item_json('e9000000-0000-4000-8000-000000000102')->>'archived_at') is not null, 'T-6: archived_at Y terisi');
do $$
declare v_result jsonb;
begin
  select public.transition_content_item_status('e9000000-0000-4000-8000-000000000103', 'archived', 'Arsip dari scripting') into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-6: arsip dari scripting (bukan approved) diizinkan');
end $$;
do $$
declare v_result jsonb;
begin
  select public.transition_content_item_status('e9000000-0000-4000-8000-000000000102', 'idea', 'Kembali aktif') into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-6: archived -> idea tetap diizinkan');
end $$;

-- T-6: soft-delete.
do $$
declare v_result jsonb;
begin
  select public.soft_delete_content_item('e9000000-0000-4000-8000-000000000104', 'Tidak jadi dipakai') into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-6: soft-delete konten diizinkan');
end $$;
select ok((public._item_json('e9000000-0000-4000-8000-000000000104')->>'deleted_at') is not null, 'T-6: deleted_at Z terisi');
do $$
declare v_result jsonb;
begin
  select public.soft_delete_content_item('e9000000-0000-4000-8000-000000000104', null) into v_result;
  perform ok(not (v_result->>'ok')::boolean, 'T-6: soft-delete kedua kalinya ditolak');
end $$;

-- T-6: duplikasi.
do $$
declare v_result jsonb; v_new uuid;
begin
  select public.duplicate_content_item('e9000000-0000-4000-8000-000000000105') into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-6: duplikasi konten diizinkan');
  v_new := (v_result->>'content_item_id')::uuid;
  perform is(public._item_json(v_new)->>'title', 'Konten W (salinan)', 'T-6: judul salinan W');
  perform is(public._item_json(v_new)->>'production_status', 'idea', 'T-6: status salinan W adalah idea');
  perform is(public._version_script(v_new, 1), 'naskah W', 'T-6: salinan W membawa versi 1 dari naskah terbaru');
end $$;
do $$
declare v_result jsonb;
begin
  select public.duplicate_content_item('e9000000-0000-4000-8000-000000000104') into v_result;
  perform ok(not (v_result->>'ok')::boolean, 'T-6: duplikasi konten yang sudah dihapus ditolak');
end $$;

-- T-6: izin — outsider bukan anggota workspace.
select public._set_user('c1111111-1111-4111-8111-111111111111', 'outsider@example.com');
do $$
declare v_result jsonb;
begin
  select public.soft_delete_content_item('e9000000-0000-4000-8000-000000000105', null) into v_result;
  perform ok(not (v_result->>'ok')::boolean, 'T-6: soft-delete oleh bukan anggota ditolak');
end $$;
do $$
declare v_result jsonb;
begin
  select public.transition_content_item_status('e9000000-0000-4000-8000-000000000105', 'internal_review', null) into v_result;
  perform ok(not (v_result->>'ok')::boolean, 'T-6: transisi oleh bukan anggota ditolak');
end $$;
select public._set_user('b2e98541-1162-4cc7-9835-603a217e0d1b', 'mative-test-c@example.com');

-- T-7: gerbang approval untuk internal_review -> approved.
do $$
declare v_result jsonb;
begin
  select public.transition_content_item_status('e9000000-0000-4000-8000-000000000107', 'approved', null) into v_result;
  perform ok(not (v_result->>'ok')::boolean, 'T-7: internal_review -> approved tanpa approval request ditolak');
end $$;
do $$
declare v_result jsonb;
begin
  select public.transition_content_item_status('e9000000-0000-4000-8000-000000000106', 'approved', null) into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-7: internal_review -> approved dengan approval untuk versi terbaru diizinkan');
end $$;
select is(public._item_json('e9000000-0000-4000-8000-000000000106')->>'production_status', 'approved', 'T-7: status X menjadi approved');
do $$
declare v_result jsonb;
begin
  select public.transition_content_item_status('e9000000-0000-4000-8000-000000000108', 'approved', null) into v_result;
  perform ok(not (v_result->>'ok')::boolean, 'T-7: internal_review -> approved dengan approval hanya untuk versi lama ditolak');
end $$;
do $$
declare v_result jsonb;
begin
  select public.transition_content_item_status('e9000000-0000-4000-8000-000000000109', 'editing', null) into v_result;
  perform ok((v_result->>'ok')::boolean, 'T-7: internal_review -> editing tanpa approval tetap diizinkan');
end $$;

select * from finish();
rollback;
