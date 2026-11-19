-- MaTive Phase 4 — RLS + RPC approval tests (pgTAP) — v1.2
-- v1.1 (2026-11-19, run live pertama GAGAL 23514 di setup): nilai
-- connection_status setup 'disconnected' DITOLAK CHECK
-- social_channels_connection_status_check (0007: hanya 'not_connected' /
-- 'manual') — cacat file tes, BUKAN produk; diperbaiki ke 'not_connected'.
-- v1.2 (2026-11-19, run live v1.1 GAGAL 42703 di setup): kolom
-- resource_shares.created_by TIDAK ADA (0005: kolomnya shared_by, NOT NULL)
-- — cacat file tes, BUKAN produk; diperbaiki ke shared_by (nilai tetap A,
-- si pembagi). plan(64) + 64 asersi tidak berubah; migrasi 0001–0014
-- tidak disentuh.
-- ============================================================================
-- CARA MENJALANKAN (oleh koordinator — butuh DATABASE_URL / service role): <redacted>
--   1. Terapkan migrasi 0001–0014 ke database BERSIH (lihat
--      docs/phase-4-report.md §5; urutan: 0013 lalu 0014).
--   2. Aktifkan ekstensi pgTAP di proyek Supabase (Dashboard → Database →
--      Extensions → pgtap), atau jalankan:  create extension if not exists pgtap;
--   3. Buat 2 pengguna auth uji (mis. lewat Dashboard → Authentication →
--      Add user) dan catat UUID-nya; ganti placeholder di bawah.
--      User A = owner Workspace A/C/D. User B = approver di Workspace A,
--      admin di Workspace B, creator di Workspace C, viewer_client di
--      Workspace D (satu user boleh punya role berbeda per workspace).
--   4. Jalankan:  psql "$DATABASE_URL" -v user_a='<UUID-USER-A>' \
--        -v user_b='<UUID-USER-B>' \
--        -f supabase/tests/04_rls_phase4.sql
--   Hasil yang diharapkan: semua tes ok (tidak ada "not ok").
--   DI SQL EDITOR (tanpa psql): hapus kedua baris \set, ganti setiap :'user_a'
--   dengan literal UUID-A dan setiap :'user_b' dengan literal UUID-B, lalu
--   jalankan seluruh file sebagai satu query (begin ... rollback di akhir
--   membersihkan data uji; GRANT untuk T15 ikut rollback).
--   PENTING: SQL Editor TIDAK mempertahankan transaksi antar-Run (tiap Run
--   sesi baru) — tempel SELURUH file ke editor lalu Run SEKALI (bukti live
--   2026-11-19: run per bagian gagal FK 23503 di BAGIAN 2, pgTAP 03 v1.0).
--
-- CATATAN: tes ini TIDAK BOLEH dijalankan di database produksi berisi data
-- nyata — hanya database bersih/preview. Tes memakai JWT claims palsu lewat
-- set_config('request.jwt.claims') untuk mensimulasikan tiap pengguna.
--
-- POLA YANG DIIKUTI (pelajaran file 01 v2.2 + 02 v1.2 + 03 v1.4):
--   - Setup sebagai postgres (bypass RLS), baru `set local role authenticated`.
--   - RPC mengembalikan jsonb {ok, code, message} (TIDAK melempar) — asersi
--     memakai is(->>'ok', 'true'/'false') dan is(->>'code', 'FORBIDDEN' /
--     'INVALID_STATE_TRANSITION' / 'APPROVAL_REQUIRED'), BUKAN throws_ok.
--     throws_ok HANYA untuk exception DB sungguhan (trigger P0001 di T5c).
--   - UPDATE/DELETE di bawah RLS tidak melempar exception: pakai asersi
--     jumlah baris terpengaruh (CTE UPDATE/DELETE + is(count, N)).
--   - Placeholder :'user_a'/:'user_b' TIDAK BOLEH di dalam string $$...$$ —
--     SQL dinamis dibangun lewat format($f$...$f$, :'user_b').
--   - UUID palsu 1111.../2222... HANYA di dua baris \set.
--   - Insert baris uji di tengah tes (versi v2 pemicu trigger) memakai
--     `reset role;` (postgres) lalu `set local role authenticated;` lagi.
--   - Cleanup TIDAK menghapus brief_templates (tidak ada di file ini) —
--     tidak ada risiko P0001 template default (pelajaran pgTAP 03 v1.2/v1.3).
-- ============================================================================

begin;
select plan(64);

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

-- Pengguna uji (GANTI dengan UUID auth user nyata dari database uji).
\set user_a '11111111-1111-1111-1111-111111111111'
\set user_b '22222222-2222-2222-2222-222222222222'

-- ---------------------------------------------------------------------------
-- Setup: org + workspace + member + brand + item + versi + placement +
-- workflow/step + request awal (sebagai postgres, bypass RLS).
-- User B empat peran: approver di WS-A, admin di WS-B, creator di WS-C,
-- viewer_client di WS-D.
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, owner_user_id)
values ('a0000000-0000-0000-0000-000000000001', 'Org A (sample test)', 'org-a-test', :'user_a'),
       ('a0000000-0000-0000-0000-000000000002', 'Org B (sample test)', 'org-b-test', :'user_b')
on conflict (slug) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at)
values ('a0000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('a0000000-0000-0000-0000-000000000002', :'user_b', 'owner', 'active', now())
on conflict (organization_id, user_id) do nothing;

insert into public.workspaces (id, organization_id, name, slug, timezone)
values ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Workspace A (sample test)', 'ws-a-test', 'Asia/Jakarta'),
       ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Workspace B (sample test)', 'ws-b-test', 'Asia/Jakarta'),
       ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Workspace C (sample test)', 'ws-c-test', 'Asia/Jakarta'),
       ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Workspace D (sample test)', 'ws-d-test', 'Asia/Jakarta')
on conflict (organization_id, slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
values ('b0000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('b0000000-0000-0000-0000-000000000001', :'user_b', 'approver', 'active', now()),
       ('b0000000-0000-0000-0000-000000000002', :'user_b', 'admin', 'active', now()),
       ('b0000000-0000-0000-0000-000000000003', :'user_a', 'owner', 'active', now()),
       ('b0000000-0000-0000-0000-000000000003', :'user_b', 'creator', 'active', now()),
       ('b0000000-0000-0000-0000-000000000004', :'user_a', 'owner', 'active', now()),
       ('b0000000-0000-0000-0000-000000000004', :'user_b', 'viewer_client', 'active', now())
on conflict (workspace_id, user_id) do nothing;

insert into public.brands (id, workspace_id, name, slug, status)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Brand A (sample test)', 'brand-a-test', 'active'),
       ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Brand B (sample test)', 'brand-b-test', 'active'),
       ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'Brand C (sample test)', 'brand-c-test', 'active'),
       ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'Brand D (sample test)', 'brand-d-test', 'active')
on conflict (workspace_id, slug) do nothing;

insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone)
values ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Item A1 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Item A2 (sample test)', 'internal_review', :'user_a', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Item A3 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Item A4 (sample test)', 'internal_review', :'user_a', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Item A5 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Item A6 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Item A7 (sample test)', 'internal_review', :'user_a', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Item A8 (sample test)', 'internal_review', :'user_a', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Item A9 (sample test)', 'internal_review', :'user_a', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000101', 'b0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', 'Item B1 (sample test)', 'approved', :'user_b', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000102', 'b0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', 'Item B2 (sample test)', 'editing', :'user_b', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000201', 'b0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000003', 'Item C1 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000301', 'b0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000004', 'Item D1 (sample test)', 'editing', :'user_a', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by)
values ('d1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 1, 'Skrip v1 A1', 'Caption v1 A1', 'CTA v1 A1', :'user_a'),
       ('d1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 1, 'Skrip v1 A2', 'Caption v1 A2', 'CTA v1 A2', :'user_a'),
       ('d1000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 1, 'Skrip v1 A3', 'Caption v1 A3', 'CTA v1 A3', :'user_a'),
       ('d1000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 1, 'Skrip v1 A4', 'Caption v1 A4', 'CTA v1 A4', :'user_a'),
       ('d1000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000005', 1, 'Skrip v1 A5', 'Caption v1 A5', 'CTA v1 A5', :'user_a'),
       ('d1000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000006', 1, 'Skrip v1 A6', 'Caption v1 A6', 'CTA v1 A6', :'user_a'),
       ('d1000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000007', 1, 'Skrip v1 A7', 'Caption v1 A7', 'CTA v1 A7', :'user_a'),
       ('d1000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000008', 1, 'Skrip v1 A8', 'Caption v1 A8', 'CTA v1 A8', :'user_a'),
       ('d1000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000009', 1, 'Skrip v1 A9', 'Caption v1 A9', 'CTA v1 A9', :'user_a'),
       ('d1000000-0000-0000-0000-000000000101', 'd0000000-0000-0000-0000-000000000101', 1, 'Skrip v1 B1', 'Caption v1 B1', 'CTA v1 B1', :'user_b'),
       ('d1000000-0000-0000-0000-000000000102', 'd0000000-0000-0000-0000-000000000102', 1, 'Skrip v1 B2', 'Caption v1 B2', 'CTA v1 B2', :'user_b'),
       ('d1000000-0000-0000-0000-000000000201', 'd0000000-0000-0000-0000-000000000201', 1, 'Skrip v1 C1', 'Caption v1 C1', 'CTA v1 C1', :'user_a'),
       ('d1000000-0000-0000-0000-000000000301', 'd0000000-0000-0000-0000-000000000301', 1, 'Skrip v1 D1', 'Caption v1 D1', 'CTA v1 D1', :'user_a')
on conflict (content_item_id, version_number) do nothing;

insert into public.social_channels (id, brand_id, platform, account_name, connection_status)
values ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'instagram', 'Akun A (sample test)', 'not_connected')
on conflict (id) do nothing;

insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, platform_caption, distribution_status)
values ('c1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'reel', 'Caption placement v1', 'draft')
on conflict (id) do nothing;

insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by)
values ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 1,
  '{"platform_format": "reel", "platform_caption": "Caption placement v1", "scheduled_at": null, "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a')
on conflict (placement_id, version_number) do nothing;

-- Workflow default per workspace (1 step, assignee_role approver, quorum 1).
insert into public.approval_workflows (id, workspace_id, name, is_default, created_by)
values ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Workflow Default', true, :'user_a'),
       ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Workflow Default', true, :'user_b'),
       ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'Workflow Default', true, :'user_a'),
       ('f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'Workflow Default', true, :'user_a'),
       ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'Workflow Penugasan Eksplisit', false, :'user_a'),
       ('f0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 'Workflow 2 Step Sekuensial', false, :'user_a'),
       ('f0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000001', 'Workflow 2 Step Paralel', false, :'user_a'),
       ('f0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000001', 'Workflow Quorum 2', false, :'user_a')
on conflict (id) do nothing;

insert into public.approval_steps (id, workflow_id, step_order, step_type, assignee_role, assignee_user_id, required_count)
values ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 1, 'sequential', 'approver', null, 1),
       ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 1, 'sequential', 'approver', null, 1),
       ('f1000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000003', 1, 'sequential', 'approver', null, 1),
       ('f1000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000004', 1, 'sequential', 'approver', null, 1),
       ('f1000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000005', 1, 'sequential', null, :'user_a', 1),
       ('f1000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000006', 1, 'sequential', 'approver', null, 1),
       ('f1000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000006', 2, 'sequential', null, :'user_a', 1),
       ('f1000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000007', 1, 'parallel', 'approver', null, 1),
       ('f1000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-000000000007', 1, 'parallel', null, :'user_a', 1),
       ('f1000000-0000-0000-0000-000000000010', 'f0000000-0000-0000-0000-000000000008', 1, 'sequential', 'approver', null, 2)
on conflict (id) do nothing;

-- Request awal WS-B (approved, dengan 1 keputusan) — untuk T1/T1b/T9.
insert into public.approval_requests (id, workspace_id, target_type, target_id, content_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order)
values ('f2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'content_item', 'd0000000-0000-0000-0000-000000000101', 'd1000000-0000-0000-0000-000000000101', 'f0000000-0000-0000-0000-000000000002', 'internal', 'approved', :'user_b', now(), now(), 1),
       ('f2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000005', 'internal', 'in_review', :'user_a', now(), null, 1),
       ('f2000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000006', 'internal', 'in_review', :'user_a', now(), null, 1),
       ('f2000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000008', 'd1000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000007', 'internal', 'in_review', :'user_a', now(), null, 1),
       ('f2000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000009', 'd1000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-000000000008', 'internal', 'in_review', :'user_a', now(), null, 1)
on conflict (id) do nothing;

insert into public.approval_decisions (id, approval_request_id, step_id, approver_user_id, decision, comment)
values ('f3000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', :'user_b', 'approved', null)
on conflict (approval_request_id, step_id, approver_user_id) do nothing;

-- Share D1 ke B (viewer_client WS-D) + setting gerbang klien WS-A aktif.
insert into public.resource_shares (id, workspace_id, resource_type, resource_id, shared_with_user_id, shared_by)
values ('f4000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000004', 'content_item', 'd0000000-0000-0000-0000-000000000301', :'user_b', :'user_a')
on conflict (id) do nothing;

insert into public.workspace_settings (workspace_id, key, value_json)
values ('b0000000-0000-0000-0000-000000000001', 'approval.client_review_enabled', '{"enabled": true}'::jsonb),
       ('b0000000-0000-0000-0000-000000000004', 'approval.client_can_comment', '{"allowed": false}'::jsonb)
on conflict (workspace_id, key) do nothing;

-- Simulasikan peran authenticated untuk semua pemeriksaan RLS di bawah.
set local role authenticated;

-- ============================================================================
-- TES 1 (Dok 06 §8 tes 1): cross-tenant deny — request + decision WS-B.
-- User A (bukan member Workspace B) menebak UUID request/decision WS-B.
-- ============================================================================
select _set_user(:'user_a');
select is_empty(
  $$ select 1 from public.approval_requests where id = 'f2000000-0000-0000-0000-000000000001' $$,
  'T1 DENY: user A tidak bisa membaca approval request Workspace B meski menebak UUID'
);
select is_empty(
  $$ select 1 from public.approval_decisions where approval_request_id = 'f2000000-0000-0000-0000-000000000001' $$,
  'T1b DENY: user A tidak bisa membaca keputusan approval Workspace B meski menebak UUID'
);

-- ============================================================================
-- TES 2 (langkah 4.11a): creator mencoba memutuskan → ditolak (FORBIDDEN).
-- B adalah creator di WS-C; request C1 diajukan A (owner WS-C).
-- ============================================================================
select _set_user(:'user_a');
select is(
  (select (public.create_approval_request('d0000000-0000-0000-0000-000000000201', 'd1000000-0000-0000-0000-000000000201') ->> 'ok')),
  'true',
  'T2 SETUP: submit C1 v1 oleh A mengembalikan ok=true'
);
select _set_user(:'user_b');
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000201' order by created_at desc limit 1),
    'approved') ->> 'ok')),
  'false',
  'T2 DENY: creator (B, WS-C) tidak bisa menyetujui request'
);
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000201' order by created_at desc limit 1),
    'approved') ->> 'code')),
  'FORBIDDEN',
  'T2b DENY: penolakan creator memakai kode FORBIDDEN (Dok 07 §6)'
);

-- ============================================================================
-- TES 3 (langkah 4.11b): approver yang TIDAK ditugaskan → ditolak.
-- Request r-a2 memakai workflow W2 (step menugaskan user A eksplisit);
-- B (approver WS-A) bukan assignee step itu.
-- ============================================================================
select _set_user(:'user_b');
select is(
  (select (public.decide_approval_request('f2000000-0000-0000-0000-000000000002', 'approved') ->> 'ok')),
  'false',
  'T3 DENY: approver yang tidak ditugaskan (B) tidak bisa memutuskan r-a2'
);
select is(
  (select (public.decide_approval_request('f2000000-0000-0000-0000-000000000002', 'approved') ->> 'code')),
  'FORBIDDEN',
  'T3b DENY: penolakan approver tak-ditugaskan memakai kode FORBIDDEN'
);

-- ============================================================================
-- TES 3c (R4.3, pengecualian): owner yang ditugaskan EKSPLISIT boleh
-- memutuskan (step W2 assignee_user_id = A). Keputusan tercatat + request
-- approved + produksi approved.
-- ============================================================================
select _set_user(:'user_a');
select is(
  (select (public.decide_approval_request('f2000000-0000-0000-0000-000000000002', 'approved') ->> 'ok')),
  'true',
  'T3c ALLOW: owner yang ditugaskan eksplisit (A) boleh menyetujui r-a2'
);
select is(
  (select status from public.approval_requests where id = 'f2000000-0000-0000-0000-000000000002'),
  'approved',
  'T3d ALLOW: request r-a2 berstatus approved setelah keputusan A'
);
select is(
  (select production_status from public.content_items where id = 'd0000000-0000-0000-0000-000000000002'),
  'approved',
  'T3e ALLOW: produksi A2 menjadi approved setelah keputusan A'
);

-- ============================================================================
-- TES 4 (A4.5 / R4.1): approve versi basi DITOLAK dengan pesan + versi terbaru.
-- Submit A1 v1 → buat v2 (sebagai postgres) → B mencoba approve request v1.
-- ============================================================================
select _set_user(:'user_a');
select is(
  (select (public.create_approval_request('d0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001') ->> 'ok')),
  'true',
  'T4 SETUP: submit A1 v1 oleh A mengembalikan ok=true'
);
reset role;
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by)
values ('d2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 2, 'Skrip v2 A1', 'Caption v2 A1', 'CTA v2 A1', :'user_a')
on conflict (content_item_id, version_number) do nothing;
set local role authenticated;
select _set_user(:'user_b');
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000001' order by created_at desc limit 1),
    'approved') ->> 'ok')),
  'false',
  'T4 DENY: approve versi basi (v1 sesudah v2 dibuat) ditolak'
);
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000001' order by created_at desc limit 1),
    'approved') ->> 'code')),
  'INVALID_STATE_TRANSITION',
  'T4b DENY: penolakan versi basi memakai kode INVALID_STATE_TRANSITION'
);

-- ============================================================================
-- TES 5 (Dok 07 §4): keputusan append-only — UPDATE/DELETE lewat RLS
-- tidak berpengaruh (0 baris); trigger menolak UPDATE langsung (T5c).
-- ============================================================================
select _set_user(:'user_a');
with upd as (
  update public.approval_decisions set comment = 'Diubah (sample test)'
  where approval_request_id = 'f2000000-0000-0000-0000-000000000002'
  returning 1
)
select is((select count(*) from upd), 0, 'T5 DENY: UPDATE keputusan lewat RLS tidak mengubah baris apa pun');
with del as (
  delete from public.approval_decisions
  where approval_request_id = 'f2000000-0000-0000-0000-000000000002'
  returning 1
)
select is((select count(*) from del), 0, 'T5b DENY: DELETE keputusan lewat RLS tidak menghapus baris apa pun');
reset role;
select throws_ok(
  $$ update public.approval_decisions set comment = 'Diubah langsung (sample test)' where id = 'f3000000-0000-0000-0000-000000000001' $$,
  'P0001',
  'approval_decisions bersifat append-only: keputusan tidak bisa diubah.',
  'T5c DENY: trigger menolak UPDATE langsung keputusan (P0001)'
);
set local role authenticated;

-- ============================================================================
-- TES 6 (prompt 05): request-changes TANPA komentar ditolak server.
-- ============================================================================
select _set_user(:'user_a');
select is(
  (select (public.create_approval_request('d0000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000003') ->> 'ok')),
  'true',
  'T6 SETUP: submit A3 v1 oleh A mengembalikan ok=true'
);
select _set_user(:'user_b');
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000003' order by created_at desc limit 1),
    'changes_requested', null) ->> 'ok')),
  'false',
  'T6 DENY: request-changes tanpa komentar ditolak'
);
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000003' order by created_at desc limit 1),
    'changes_requested', null) ->> 'code')),
  'INVALID_STATE_TRANSITION',
  'T6b DENY: penolakan tanpa komentar memakai kode INVALID_STATE_TRANSITION'
);

-- ============================================================================
-- TES 6c: request-changes DENGAN komentar → request changes_requested +
-- produksi kembali editing (ASUMSI-4.3).
-- ============================================================================
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000003' order by created_at desc limit 1),
    'changes_requested', 'Caption perlu direvisi.') ->> 'ok')),
  'true',
  'T6c ALLOW: request-changes dengan komentar mengembalikan ok=true'
);
select is(
  (select status from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000003' order by created_at desc limit 1),
  'changes_requested',
  'T6d ALLOW: request A3 v1 berstatus changes_requested'
);
select is(
  (select production_status from public.content_items where id = 'd0000000-0000-0000-0000-000000000003'),
  'editing',
  'T6e ALLOW: produksi A3 kembali editing setelah minta revisi'
);

-- ============================================================================
-- TES 7 (acceptance prompt 05, M4.2): v1 → minta revisi → v2 → setujui v2;
-- v1 UTUH (tidak ditimpa) + request approved + produksi approved.
-- ============================================================================
reset role;
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by)
values ('d2000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 2, 'Skrip v2 A3', 'Caption v2 A3', 'CTA v2 A3', :'user_a')
on conflict (content_item_id, version_number) do nothing;
set local role authenticated;
select _set_user(:'user_a');
select is(
  (select (public.create_approval_request('d0000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000003') ->> 'ok')),
  'true',
  'T7 SETUP: submit A3 v2 oleh A mengembalikan ok=true'
);
select _set_user(:'user_b');
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where content_version_id = 'd2000000-0000-0000-0000-000000000003' order by created_at desc limit 1),
    'approved') ->> 'ok')),
  'true',
  'T7 ALLOW: approver menyetujui A3 v2'
);
select is(
  (select status from public.approval_requests where content_version_id = 'd2000000-0000-0000-0000-000000000003' order by created_at desc limit 1),
  'approved',
  'T7b ALLOW: request A3 v2 berstatus approved'
);
select is(
  (select production_status from public.content_items where id = 'd0000000-0000-0000-0000-000000000003'),
  'approved',
  'T7c ALLOW: produksi A3 menjadi approved'
);
select is(
  (select count(*) from public.content_versions where content_item_id = 'd0000000-0000-0000-0000-000000000003'),
  2,
  'T7d ALLOW: A3 punya tepat 2 versi (v1 tidak ditimpa, v2 baru)'
);
select is(
  (select script from public.content_versions where id = 'd1000000-0000-0000-0000-000000000003'),
  'Skrip v1 A3',
  'T7e ALLOW: isi v1 A3 utuh (audit membuktikan revisi tidak menimpa snapshot)'
);

-- ============================================================================
-- TES 8 (langkah 4.11d / ADR-0010 §7): bypass workflow DITOLAK — transisi
-- langsung internal_review → approved tanpa request approved.
-- A4 sudah internal_review sejak setup, tanpa request apa pun.
-- ============================================================================
select _set_user(:'user_a');
select is(
  (select (public.transition_content_item_status('d0000000-0000-0000-0000-000000000004', 'approved') ->> 'ok')),
  'false',
  'T8 DENY: transisi langsung internal_review → approved tanpa approval ditolak'
);
select is(
  (select (public.transition_content_item_status('d0000000-0000-0000-0000-000000000004', 'approved') ->> 'code')),
  'APPROVAL_REQUIRED',
  'T8b DENY: penolakan bypass memakai kode APPROVAL_REQUIRED (Dok 07 §6)'
);

-- ============================================================================
-- TES 9 (langkah 4.11e): tampering — A mencoba memutuskan request WS-B
-- (rb1, f200...001) padahal bukan member workspace itu → FORBIDDEN.
-- ============================================================================
select _set_user(:'user_a');
select is(
  (select (public.decide_approval_request('f2000000-0000-0000-0000-000000000001', 'approved') ->> 'ok')),
  'false',
  'T9 DENY: user A tidak bisa memutuskan request Workspace B'
);
select is(
  (select (public.decide_approval_request('f2000000-0000-0000-0000-000000000001', 'approved') ->> 'code')),
  'FORBIDDEN',
  'T9b DENY: penolakan tampering memakai kode FORBIDDEN'
);

-- ============================================================================
-- TES 10 (M4.5 / ASUMSI-4.6 default): perubahan field kritis sesudah
-- approval → reapproval_required + notifikasi ke approver.
-- A5: submit v1 → approve → buat v2 dengan caption berubah (postgres).
-- ============================================================================
select _set_user(:'user_a');
select is(
  (select (public.create_approval_request('d0000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000005') ->> 'ok')),
  'true',
  'T10 SETUP: submit A5 v1 oleh A mengembalikan ok=true'
);
select _set_user(:'user_b');
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000005' order by created_at desc limit 1),
    'approved') ->> 'ok')),
  'true',
  'T10b SETUP: approver menyetujui A5 v1'
);
reset role;
insert into public.content_versions (id, content_item_id, version_number, script, caption, cta, created_by)
values ('d2000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000005', 2, 'Skrip v1 A5', 'Caption v2 A5 BERUBAH', 'CTA v1 A5', :'user_a')
on conflict (content_item_id, version_number) do nothing;
set local role authenticated;
select is(
  (select status from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000005' order by created_at desc limit 1),
  'reapproval_required',
  'T10c ALLOW: request A5 v1 menjadi reapproval_required setelah caption diubah'
);
select isnt_empty(
  format($f$ select 1 from public.notifications
     where recipient_user_id = %L
       and type = 'approval_reapproval_required'
       and target_id = 'd0000000-0000-0000-0000-000000000005' $f$, :'user_b'),
  'T10d ALLOW: approver menerima notifikasi reapproval_required'
);

-- ============================================================================
-- TES 11 (langkah 4.14 / Keputusan #12): gerbang client_review.
-- WS-A: setting aktif → client review bisa dibuat SETELAH internal approved.
-- WS-B: setting mati (tidak ada baris) → submit client review ditolak.
-- ============================================================================
select _set_user(:'user_a');
select is(
  (select (public.create_approval_request('d0000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000006') ->> 'ok')),
  'true',
  'T11 SETUP: submit A6 v1 oleh A mengembalikan ok=true'
);
select _set_user(:'user_b');
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000006' order by created_at desc limit 1),
    'approved') ->> 'ok')),
  'true',
  'T11b SETUP: approver menyetujui A6 v1 (internal)'
);
select _set_user(:'user_a');
select is(
  (select (public.submit_content_for_client_review('d0000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000006') ->> 'ok')),
  'true',
  'T11 ALLOW: client review A6 bisa dibuat setelah internal approved'
);
select is(
  (select count(*) from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000006' and request_type = 'client'),
  1,
  'T11b ALLOW: tepat 1 request client_review tercatat untuk A6 v1'
);
select _set_user(:'user_b');
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000006' and request_type = 'client' order by created_at desc limit 1),
    'approved') ->> 'ok')),
  'true',
  'T11c ALLOW: approver menyetujui client review A6'
);
select is(
  (select status from public.approval_requests where content_version_id = 'd1000000-0000-0000-0000-000000000006' and request_type = 'client' order by created_at desc limit 1),
  'approved',
  'T11d ALLOW: request client_review A6 berstatus approved'
);
select _set_user(:'user_b');
select is(
  (select (public.submit_content_for_client_review('d0000000-0000-0000-0000-000000000102', 'd1000000-0000-0000-0000-000000000102') ->> 'ok')),
  'false',
  'T11e DENY: client review WS-B ditolak karena gerbang client_review mati'
);
select is(
  (select (public.submit_content_for_client_review('d0000000-0000-0000-0000-000000000102', 'd1000000-0000-0000-0000-000000000102') ->> 'code')),
  'FORBIDDEN',
  'T11f DENY: penolakan client review gerbang mati memakai kode FORBIDDEN'
);

-- ============================================================================
-- TES 12 (langkah 4.14 / Keputusan #12): komentar klien di portal.
-- Share D1 → B; setting WS-D awalnya false → komentar ditolak; setelah
-- workspace mengizinkan → komentar tercatat (tapi TIDAK pernah jadi
-- keputusan approval — keputusan hanya lewat decide_approval_request).
-- ============================================================================
select _set_user(:'user_b');
select is(
  (select (public.create_client_comment('f4000000-0000-0000-0000-000000000001', 'Komentar klien pertama.') ->> 'ok')),
  'false',
  'T12 DENY: klien tidak bisa berkomentar saat workspace melarang (default)'
);
select is(
  (select (public.create_client_comment('f4000000-0000-0000-0000-000000000001', 'Komentar klien pertama.') ->> 'code')),
  'FORBIDDEN',
  'T12b DENY: penolakan komentar klien memakai kode FORBIDDEN'
);
reset role;
update public.workspace_settings set value_json = '{"allowed": true}'::jsonb
where workspace_id = 'b0000000-0000-0000-0000-000000000004' and key = 'approval.client_can_comment';
set local role authenticated;
select _set_user(:'user_b');
select is(
  (select (public.create_client_comment('f4000000-0000-0000-0000-000000000001', 'Komentar klien pertama.') ->> 'ok')),
  'true',
  'T12c ALLOW: klien bisa berkomentar setelah workspace mengizinkan'
);
select is(
  (select count(*) from public.comments where target_type = 'content_item' and target_id = 'd0000000-0000-0000-0000-000000000301' and author_user_id = :'user_b'),
  1,
  'T12d ALLOW: tepat 1 komentar klien tercatat di D1'
);

-- ============================================================================
-- TES 13 (ASUMSI-4.7 default): 2-step SEQUENTIAL — step 1 approve →
-- request tetap in_review, current_step_order naik ke 2; step 2 approve →
-- request approved + produksi approved.
-- ============================================================================
select _set_user(:'user_b');
select is(
  (select (public.decide_approval_request('f2000000-0000-0000-0000-000000000003', 'approved') ->> 'ok')),
  'true',
  'T13 SETUP: step 1 workflow sekuensial disetujui B'
);
select is(
  (select status from public.approval_requests where id = 'f2000000-0000-0000-0000-000000000003'),
  'in_review',
  'T13b ALLOW: request tetap in_review setelah step 1 (step 2 belum diputuskan)'
);
select is(
  (select current_step_order from public.approval_requests where id = 'f2000000-0000-0000-0000-000000000003'),
  2,
  'T13c ALLOW: current_step_order naik ke 2 setelah step 1'
);
select _set_user(:'user_a');
select is(
  (select (public.decide_approval_request('f2000000-0000-0000-0000-000000000003', 'approved') ->> 'ok')),
  'true',
  'T13d ALLOW: step 2 workflow sekuensial disetujui A (assignee eksplisit)'
);
select is(
  (select status from public.approval_requests where id = 'f2000000-0000-0000-0000-000000000003'),
  'approved',
  'T13e ALLOW: request approved setelah semua step sekuensial selesai'
);
select is(
  (select production_status from public.content_items where id = 'd0000000-0000-0000-0000-000000000007'),
  'approved',
  'T13f ALLOW: produksi A7 menjadi approved'
);

-- ============================================================================
-- TES 13g (ASUMSI-4.7): 2-step PARALLEL (step_order sama) — kedua step
-- harus menyetujui; satu persetujuan saja tidak cukup.
-- ============================================================================
select _set_user(:'user_b');
select is(
  (select (public.decide_approval_request('f2000000-0000-0000-0000-000000000004', 'approved') ->> 'ok')),
  'true',
  'T13g SETUP: step paralel pertama (B) menyetujui'
);
select is(
  (select status from public.approval_requests where id = 'f2000000-0000-0000-0000-000000000004'),
  'in_review',
  'T13h ALLOW: request paralel tetap in_review setelah 1 dari 2 step'
);
select _set_user(:'user_a');
select is(
  (select (public.decide_approval_request('f2000000-0000-0000-0000-000000000004', 'approved') ->> 'ok')),
  'true',
  'T13i ALLOW: step paralel kedua (A) menyetujui'
);
select is(
  (select status from public.approval_requests where id = 'f2000000-0000-0000-0000-000000000004'),
  'approved',
  'T13j ALLOW: request paralel approved setelah kedua step menyetujui'
);

-- ============================================================================
-- TES 14 (ASUMSI-4.7): quorum 2 — 1 persetujuan belum memenuhi kuorum.
-- ============================================================================
select _set_user(:'user_b');
select is(
  (select (public.decide_approval_request('f2000000-0000-0000-0000-000000000005', 'approved') ->> 'ok')),
  'true',
  'T14 SETUP: 1 persetujuan tercatat di step kuorum 2'
);
select is(
  (select status from public.approval_requests where id = 'f2000000-0000-0000-0000-000000000005'),
  'in_review',
  'T14b ALLOW: request kuorum 2 tetap in_review setelah 1 persetujuan'
);

-- ============================================================================
-- TES 15 (Dok 06 §8): anon TIDAK bisa membaca tabel approval.
-- GRANT dijalankan sebagai postgres (setelah reset role) lalu peran anon.
-- ============================================================================
reset role;
grant select on public.approval_requests to anon;
set local role anon;
select _as_anon();
select is_empty(
  $$ select 1 from public.approval_requests $$,
  'T15 DENY: anon tidak bisa membaca approval_requests'
);
reset role;
set local role authenticated;

-- ============================================================================
-- TES 16 (A4.5 / R4.1, placement): approve versi placement basi DITOLAK.
-- Submit request placement (A1 v2 saat ini + placement v1) → buat placement
-- v2 (postgres) → B mencoba approve → INVALID_STATE_TRANSITION.
-- ============================================================================
select _set_user(:'user_a');
select is(
  (select (public.create_approval_request('d0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001') ->> 'ok')),
  'true',
  'T16 SETUP: submit request placement A1 (v2 + placement v1) mengembalikan ok=true'
);
reset role;
insert into public.placement_versions (id, placement_id, version_number, payload_snapshot, created_by)
values ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 2,
  '{"platform_format": "feed", "platform_caption": "Caption placement v2", "scheduled_at": null, "timezone": "Asia/Jakarta", "distribution_status": "draft"}'::jsonb, :'user_a')
on conflict (placement_id, version_number) do nothing;
set local role authenticated;
select _set_user(:'user_b');
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where target_type = 'placement' and target_id = 'c1000000-0000-0000-0000-000000000001' order by created_at desc limit 1),
    'approved') ->> 'ok')),
  'false',
  'T16 DENY: approve placement versi basi (v1 sesudah v2 dibuat) ditolak'
);
select is(
  (select (public.decide_approval_request(
    (select id from public.approval_requests where target_type = 'placement' and target_id = 'c1000000-0000-0000-0000-000000000001' order by created_at desc limit 1),
    'approved') ->> 'code')),
  'INVALID_STATE_TRANSITION',
  'T16b DENY: penolakan placement versi basi memakai kode INVALID_STATE_TRANSITION'
);

-- ============================================================================
-- Cleanup: hapus semua data uji + helper.
-- Dijalankan sebagai postgres (bypass RLS). (Tidak ada brief_templates di
-- file ini, jadi tidak ada risiko trigger P0001 template default.)
-- ============================================================================
reset role;
delete from public.approval_decisions where approval_request_id in
  (select id from public.approval_requests where workspace_id in
    ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
     'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004'));
delete from public.approval_requests where workspace_id in
  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004');
delete from public.approval_steps where workflow_id in
  (select id from public.approval_workflows where workspace_id in
    ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
     'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004'));
delete from public.approval_workflows where workspace_id in
  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004');
delete from public.placement_versions where placement_id in
  (select id from public.content_placements where content_item_id in
    (select id from public.content_items where workspace_id in
      ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
       'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004')));
delete from public.content_placements where content_item_id in
  (select id from public.content_items where workspace_id in
    ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
     'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004'));
delete from public.content_versions where content_item_id in
  (select id from public.content_items where workspace_id in
    ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
     'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004'));
delete from public.content_items where workspace_id in
  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004');
delete from public.social_channels where brand_id in
  (select id from public.brands where workspace_id in
    ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
     'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004'));
delete from public.brands where workspace_id in
  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004');
delete from public.workspace_settings where workspace_id in
  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004');
delete from public.resource_shares where workspace_id in
  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004');
delete from public.workspace_members where workspace_id in
  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004');
delete from public.workspaces where id in
  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004');
delete from public.organization_members where organization_id in
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002');
delete from public.organizations where id in
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002');
drop function if exists _set_user(uuid, text);
drop function if exists _as_anon();

select * from finish();
rollback;
