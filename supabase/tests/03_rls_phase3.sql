-- MaTive Phase 3 — RLS policy tests (pgTAP) — v1.1
-- ============================================================================
-- CARA MENJALANKAN (oleh koordinator — butuh DATABASE_URL / service role):
--   1. Terapkan migrasi 0001–0012 ke database BERSIH (lihat
--      docs/phase-3-report.md §5; urutan: 0009 lalu 0010 lalu 0011 lalu 0012).
--   2. Aktifkan ekstensi pgTAP di proyek Supabase (Dashboard → Database →
--      Extensions → pgtap), atau jalankan:  create extension if not exists pgtap;
--   3. Buat 2 pengguna auth uji (mis. lewat Dashboard → Authentication →
--      Add user) dan catat UUID-nya; ganti placeholder di bawah.
--      User A = owner Workspace A. User B = admin Workspace B DAN creator
--      di Workspace A (satu user boleh punya role berbeda per workspace).
--   4. Jalankan:  psql "$DATABASE_URL" -v user_a='<UUID-USER-A>' \
--        -v user_b='<UUID-USER-B>' \
--        -f supabase/tests/03_rls_phase3.sql
--   Hasil yang diharapkan: semua tes ok (tidak ada "not ok").
--   DI SQL EDITOR (tanpa psql): hapus kedua baris \set, ganti setiap :'user_a'
--   dengan literal UUID-A dan setiap :'user_b' dengan literal UUID-B, lalu
--   jalankan seluruh file sebagai satu query (begin ... rollback di akhir
--   membersihkan data uji; GRANT untuk T16 ikut rollback).
--   PENTING: SQL Editor TIDAK mempertahankan transaksi antar-Run (tiap Run
--   sesi baru) — tempel SELURUH file ke editor lalu Run SEKALI (bukti live
--   2026-11-19: run per bagian gagal FK 23503 di BAGIAN 2).
--
-- v1.1 (2026-11-19): T15–T15c ditulis ulang jadi T15–T15d (plan 34 → 35).
-- T15 v1 SALAH (gagal live 23502): ia mengasumsikan content_items.brand_id
-- NULLABLE karena membaca komentar header 0007 baris 191. Kenyataannya
-- brand_id NOT NULL — DDL 0007 baris 200, Dok 05 §3 (tanpa penanda
-- "nullable"), ERD §5 (BRANDS ||--o{ CONTENT_ITEMS), contentItemSchema
-- (brandId wajib). Perilaku benar (migrasi 0012): konversi ide tanpa
-- brand TANPA p_brand_id ditolak bersih (ok=false + pesan); DENGAN
-- p_brand_id → berhasil dan item memakai brand itu.
--
-- v1.2 (2026-11-19): hapus baris cleanup "delete from public.brief_templates
-- where id = 'a6000000-0000-0000-0000-000000000001'" di akhir file. Baris itu
-- GAGAL live dengan P0001 ("cannot delete the default brief template: set
-- another template as default first") dan menggagalkan transaksi sebelum
-- finish() — trigger trg_prevent_default_template_delete (0009) menolak hapus
-- template is_default=true, dan DELETE polos itu tidak ditangkap exception
-- apa pun. Baris itu redundan: rollback tanpa syarat di akhir file sudah
-- membersihkan semua baris uji termasuk template itu. T11 TIDAK diubah:
-- throws_ok menangkap exception lewat subtransaction, jadi T11 bukan penyebab
-- P0001. plan TETAP 35, jumlah asersi TETAP 35.
--
-- v1.3 (2026-11-19): unset is_default template uji sebelum hapus workspace
-- di cleanup. v1.2 GAGAL live lagi dengan P0001 yang sama, tapi CONTEXT
-- error membuktikan penyebabnya CASCADE, bukan delete eksplisit: hapus
-- Workspace A men-cascade ke brief_templates (FK workspace_id ON DELETE
-- CASCADE, 0009) dan trigger trg_prevent_default_template_delete menolak
-- hapus template is_default=true. UPDATE is_default=false dulu membuat
-- cascade menghapus template non-default dan lolos. plan TETAP 35, jumlah
-- asersi TETAP 35.
--
-- v1.4 (2026-11-19): T4 ditulis ulang — ekspektasi 23514 (CHECK
-- tasks_parent_type_check) SALAH. Run diagnostik live 15:57 WIB (34/35)
-- membuktikan insert parent_type='idea' ditolak lebih dulu oleh trigger
-- BEFORE validate_task_scope() (0009 baris 317–349): tidak ada cabang IF
-- untuk 'idea' → v_ws NULL → P0001 'scope mismatch: ...'. Di PostgreSQL
-- trigger BEFORE berjalan SEBELUM CHECK dievaluasi, jadi CHECK tidak pernah
-- sempat menolak. Perilaku produk BENAR (baris tidak valid tetap ditolak);
-- hanya mekanisme penolakannya trigger, bukan CHECK. T4 kini mengharapkan
-- P0001 + pesan scope mismatch. plan TETAP 35, jumlah asersi TETAP 35.
-- CATATAN: tes ini TIDAK BOLEH dijalankan di database produksi berisi data
-- nyata — hanya database bersih/preview. Tes memakai JWT claims palsu lewat
-- set_config('request.jwt.claims') untuk mensimulasikan tiap pengguna.
--
-- POLA YANG DIIKUTI (pelajaran file 01 v2.2 + 02 v1.2):
--   - Setup sebagai postgres (bypass RLS), baru `set local role authenticated`.
--   - throws_ok bentuk 4 argumen (sql, kode SQLSTATE, pola = PESAN LENGKAP,
--     deskripsi) — pola awalan GAGAL karena pgTAP mencocokkan seluruh pesan.
--   - UPDATE/DELETE di bawah RLS tidak melempar exception: pakai asersi
--     jumlah baris terpengaruh (CTE UPDATE/DELETE + is(count, N)).
--   - Placeholder :'user_a'/:'user_b' TIDAK BOLEH di dalam string $$...$$ —
--     SQL dinamis dibangun lewat format($f$...$f$, :'user_b').
--   - UUID palsu 1111.../2222... HANYA di dua baris \set.
--   - JANGAN hardcode UUID pengguna uji nyata ke file ini.
-- ============================================================================

begin;
select plan(35);

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
-- Setup: org + workspace + member + data Phase 2 + Phase 3 (sebagai
-- postgres, bypass RLS). User B sengaja DUA peran: admin di Workspace B,
-- creator di Workspace A.
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
       ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Workspace B (sample test)', 'ws-b-test', 'Asia/Jakarta')
on conflict (organization_id, slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
values ('b0000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('b0000000-0000-0000-0000-000000000002', :'user_b', 'admin', 'active', now()),
       ('b0000000-0000-0000-0000-000000000001', :'user_b', 'creator', 'active', now())
on conflict (workspace_id, user_id) do nothing;

insert into public.brands (id, workspace_id, name, slug, status)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Brand A (sample test)', 'brand-a-test', 'active'),
       ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Brand B (sample test)', 'brand-b-test', 'active')
on conflict (workspace_id, slug) do nothing;

insert into public.campaigns (id, workspace_id, name, status, owner_user_id)
values ('90000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Campaign A (sample test)', 'draft', :'user_a')
on conflict (id) do nothing;

insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone)
values ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Item A1 (sample test)', 'idea', :'user_a', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Item A2 (sample test)', 'idea', :'user_b', 'Asia/Jakarta'),
       ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', 'Item B1 (sample test)', 'idea', :'user_b', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.tasks (id, workspace_id, parent_type, parent_id, title, assignee_user_id, created_by, status)
values ('a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000001', 'Task A1 (sample test)', :'user_b', :'user_a', 'todo'),
       ('a1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'campaign', '90000000-0000-0000-0000-000000000001', 'Task A2 (sample test)', :'user_a', :'user_a', 'todo'),
       ('a1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'content_item', 'd0000000-0000-0000-0000-000000000003', 'Task B1 (sample test)', :'user_b', :'user_b', 'todo')
on conflict (id) do nothing;

insert into public.assets (id, workspace_id, object_key, original_filename, mime_type, byte_size, uploaded_by, processing_status)
values ('a2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001/a2000000-0000-0000-0000-000000000001/foto.png', 'foto.png', 'image/png', 1024, :'user_a', 'ready'),
       ('a2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002/a2000000-0000-0000-0000-000000000002/foto-b.png', 'foto-b.png', 'image/png', 2048, :'user_b', 'ready')
on conflict (id) do nothing;

insert into public.content_assets (id, content_item_id, asset_id, usage_role)
values ('a3000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'primary')
on conflict (id) do nothing;

insert into public.comments (id, workspace_id, target_type, target_id, body, author_user_id)
values ('a4000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000001', 'Komentar A1 (sample test)', :'user_a'),
       ('a4000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'content_item', 'd0000000-0000-0000-0000-000000000003', 'Komentar B1 (sample test)', :'user_b')
on conflict (id) do nothing;

insert into public.notifications (id, workspace_id, recipient_user_id, type, title, target_type, target_id)
values ('a5000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', :'user_b', 'mention', 'Anda disebut (sample test)', 'comment', 'a4000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.brief_templates (id, workspace_id, name, schema_json, is_default)
values ('a6000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Template Default (sample test)', '{"fields": []}'::jsonb, true)
on conflict (id) do nothing;

-- Simulasikan peran authenticated untuk semua pemeriksaan RLS di bawah.
set local role authenticated;

-- ============================================================================
-- TES 1 (Dok 06 §8 tes 1): cross-tenant deny — task/aset/komentar.
-- User A (bukan member Workspace B) menebak UUID resource Workspace B.
-- ============================================================================
select _set_user(:'user_a');
select is_empty(
  $$ select 1 from public.tasks where id = 'a1000000-0000-0000-0000-000000000003' $$,
  'T1 DENY: user A tidak bisa membaca task Workspace B meski menebak UUID'
);
select is_empty(
  $$ select 1 from public.assets where id = 'a2000000-0000-0000-0000-000000000002' $$,
  'T1b DENY: user A tidak bisa membaca aset Workspace B meski menebak UUID'
);
select is_empty(
  $$ select 1 from public.comments where id = 'a4000000-0000-0000-0000-000000000002' $$,
  'T1c DENY: user A tidak bisa membaca komentar Workspace B meski menebak UUID'
);

-- ============================================================================
-- TES 2 (ALLOW): user A membaca task + aset Workspace A sendiri.
-- ============================================================================
select isnt_empty(
  $$ select 1 from public.tasks where id = 'a1000000-0000-0000-0000-000000000001' $$,
  'T2 ALLOW: user A bisa membaca task Workspace A'
);
select isnt_empty(
  $$ select 1 from public.assets where id = 'a2000000-0000-0000-0000-000000000001' $$,
  'T2b ALLOW: user A bisa membaca aset Workspace A'
);

-- ============================================================================
-- TES 3 (Dok 06 §3 + P3-A2 "limited"): creator hanya mengubah task yang
-- ditugaskan ke dirinya. User B adalah creator di Workspace A: Task A1
-- ditugaskan ke B (boleh, 1 baris); Task A2 ditugaskan ke A (0 baris).
-- ============================================================================
select _set_user(:'user_b');
with upd as (
  update public.tasks set title = 'Task A1 diubah creator'
  where id = 'a1000000-0000-0000-0000-000000000001'
  returning 1
)
select is(
  (select count(*) from upd)::int,
  1,
  'T3 ALLOW: creator bisa mengedit task yang ditugaskan ke dirinya (1 baris)'
);
with upd as (
  update public.tasks set title = 'Task A2 diubah creator'
  where id = 'a1000000-0000-0000-0000-000000000002'
  returning 1
)
select is(
  (select count(*) from upd)::int,
  0,
  'T3b DENY: creator tidak bisa mengedit task yang ditugaskan ke orang lain (0 baris)'
);

-- ============================================================================
-- TES 4 (P3-A1): parent_type task di luar (content_item, campaign) ditolak.
-- Mekanisme penolaknya trigger BEFORE validate_task_scope() (P0001), BUKAN
-- CHECK — trigger berjalan sebelum CHECK dievaluasi (v1.4).
-- Dijalankan sebagai user A (owner A).
-- ============================================================================
select _set_user(:'user_a');
select throws_ok(
  $$insert into public.tasks (workspace_id, parent_type, parent_id, title)
     values ('b0000000-0000-0000-0000-000000000001', 'idea', 'd0000000-0000-0000-0000-000000000001', 'Task Parent Salah')$$,
  'P0001',
  'scope mismatch: tasks.parent_id belongs to a different workspace or does not exist',
  'T4 DENY: parent_type task di luar (content_item, campaign) ditolak trigger scope (BEFORE CHECK)'
);

-- ============================================================================
-- TES 5 (Dok 05 §6): task tidak boleh merujuk parent workspace lain.
-- User A memasang task di Workspace A ke Item B1 (Workspace B) — ditolak
-- trigger scope (P0001).
-- ============================================================================
select throws_ok(
  $$insert into public.tasks (workspace_id, parent_type, parent_id, title)
     values ('b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000003', 'Task Lintas Workspace')$$,
  'P0001',
  'scope mismatch: tasks.parent_id belongs to a different workspace or does not exist',
  'T5 DENY: task ke parent workspace lain ditolak trigger scope'
);

-- ============================================================================
-- TES 6 (Keputusan #12, portal klien): viewer_client hanya melihat task/
-- aset/template yang parent-nya dibagikan eksplisit. Role User B di
-- Workspace A diubah sementara (sebagai postgres) menjadi viewer_client.
-- ============================================================================
reset role;
update public.workspace_members set workspace_role = 'viewer_client'
where workspace_id = 'b0000000-0000-0000-0000-000000000001' and user_id = :'user_b';
set local role authenticated;
select _set_user(:'user_b');
select is_empty(
  $$ select 1 from public.tasks where id = 'a1000000-0000-0000-0000-000000000001' $$,
  'T6 DENY: viewer_client tidak bisa membaca task yang parent-nya TIDAK dibagikan'
);
select is_empty(
  $$ select 1 from public.assets where id = 'a2000000-0000-0000-0000-000000000001' $$,
  'T6b DENY: viewer_client tidak bisa membaca aset yang TIDAK dilampirkan ke konten yang dibagikan'
);
-- Bagikan Item A1 ke User B (sebagai postgres), lalu periksa lagi.
reset role;
insert into public.resource_shares (id, workspace_id, resource_type, resource_id, shared_with_user_id, shared_by)
values ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000001', :'user_b', :'user_a')
on conflict (resource_type, resource_id, shared_with_user_id) do nothing;
set local role authenticated;
select _set_user(:'user_b');
select isnt_empty(
  $$ select 1 from public.tasks where id = 'a1000000-0000-0000-0000-000000000001' $$,
  'T6c ALLOW: viewer_client bisa membaca task yang parent-nya dibagikan ke dia'
);
select isnt_empty(
  $$ select 1 from public.assets where id = 'a2000000-0000-0000-0000-000000000001' $$,
  'T6d ALLOW: viewer_client bisa membaca aset yang dilampirkan ke konten yang dibagikan ke dia'
);
select is_empty(
  $$ select 1 from public.tasks where id = 'a1000000-0000-0000-0000-000000000002' $$,
  'T6e DENY: viewer_client tetap tidak bisa membaca task yang parent-nya (campaign) tidak dibagikan'
);
select is_empty(
  $$ select 1 from public.brief_templates where id = 'a6000000-0000-0000-0000-000000000001' $$,
  'T6f DENY: viewer_client tidak bisa membaca template brief (portal tidak punya fitur template)'
);

-- ============================================================================
-- TES 7 (P3-A4, gerbang ganda komentar klien): viewer_client boleh
-- berkomentar HANYA bila target dibagikan DAN workspace mengizinkan
-- (allow_client_comments). Setting masih TIDAK ADA → ditolak 42501.
-- Lalu setting dinyalakan (sebagai postgres) → boleh.
-- ============================================================================
select throws_ok(
  format($f$insert into public.comments (workspace_id, target_type, target_id, body, author_user_id)
     values ('b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000001', 'Komentar klien tanpa izin', %L)$f$, :'user_b'),
  '42501',
  'new row violates row-level security policy for table "comments"',
  'T7 DENY: viewer_client tidak bisa berkomentar bila workspace belum mengizinkan (setting mati)'
);
reset role;
insert into public.workspace_settings (workspace_id, key, value_json)
values ('b0000000-0000-0000-0000-000000000001', 'allow_client_comments', 'true'::jsonb)
on conflict (workspace_id, key) do nothing;
set local role authenticated;
select _set_user(:'user_b');
select lives_ok(
  format($f$insert into public.comments (id, workspace_id, target_type, target_id, body, author_user_id)
     values ('a4000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000001', 'Komentar klien diizinkan (sample test)', %L)$f$, :'user_b'),
  'T7b ALLOW: viewer_client bisa berkomentar bila target dibagikan DAN setting menyala'
);
select isnt_empty(
  $$ select 1 from public.comments where id = 'a4000000-0000-0000-0000-000000000003' $$,
  'T7c ALLOW: komentar klien yang diizinkan tersimpan dan bisa dibaca'
);
-- Bersihkan share + setting + komentar klien, kembalikan role creator.
reset role;
delete from public.comments where id = 'a4000000-0000-0000-0000-000000000003';
delete from public.workspace_settings where workspace_id = 'b0000000-0000-0000-0000-000000000001' and key = 'allow_client_comments';
delete from public.resource_shares where id = 'c0000000-0000-0000-0000-000000000001';
update public.workspace_members set workspace_role = 'creator'
where workspace_id = 'b0000000-0000-0000-0000-000000000001' and user_id = :'user_b';
set local role authenticated;

-- ============================================================================
-- TES 8 (P3-A4): TIDAK ADA hard-delete task dan komentar — DELETE sebagai
-- owner/penulis menghasilkan 0 baris (arsip lewat status / soft-delete).
-- ============================================================================
select _set_user(:'user_a');
with del as (
  delete from public.tasks where id = 'a1000000-0000-0000-0000-000000000001'
  returning 1
)
select is(
  (select count(*) from del)::int,
  0,
  'T8 DENY: owner tidak bisa hard-delete task (0 baris — arsip lewat status cancelled)'
);
with del as (
  delete from public.comments where id = 'a4000000-0000-0000-0000-000000000001'
  returning 1
)
select is(
  (select count(*) from del)::int,
  0,
  'T8b DENY: penulis tidak bisa hard-delete komentar (0 baris — hapus = soft-delete)'
);

-- ============================================================================
-- TES 9 (P3-A6): notifikasi hanya dibuat RPC — INSERT langsung ditolak;
-- penerima lain tidak bisa membaca notifikasi orang lain.
-- ============================================================================
select throws_ok(
  format($f$insert into public.notifications (workspace_id, recipient_user_id, type, title, target_type, target_id)
     values ('b0000000-0000-0000-0000-000000000001', %L, 'mention', 'Coba Langsung', 'comment', 'a4000000-0000-0000-0000-000000000001')$f$, :'user_a'),
  '42501',
  'new row violates row-level security policy for table "notifications"',
  'T9 DENY: INSERT notifikasi langsung ditolak (hanya RPC SECURITY DEFINER)'
);
select is_empty(
  $$ select 1 from public.notifications where id = 'a5000000-0000-0000-0000-000000000001' $$,
  'T9b DENY: user A tidak bisa membaca notifikasi yang ditujukan ke user B'
);

-- ============================================================================
-- TES 10 (P3-A3): aset di atas 10 MB ditolak CHECK. Dijalankan sebagai
-- postgres agar yang diuji murni CHECK.
-- ============================================================================
reset role;
select throws_ok(
  $$insert into public.assets (workspace_id, object_key, original_filename, mime_type, byte_size, processing_status)
     values ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001/x/test.bin', 'test.bin', 'image/png', 10485761, 'ready')$$,
  '23514',
  'new row for relation "assets" violates check constraint "assets_byte_size_check"',
  'T10 DENY: aset 10 MB + 1 byte ditolak CHECK (batas 10 MB)'
);
set local role authenticated;

-- ============================================================================
-- TES 11 (P3-05): template default tidak bisa dihapus. Dijalankan sebagai
-- postgres agar yang diuji murni trigger proteksi.
-- ============================================================================
reset role;
select throws_ok(
  $$delete from public.brief_templates where id = 'a6000000-0000-0000-0000-000000000001'$$,
  'P0001',
  'cannot delete the default brief template: set another template as default first',
  'T11 DENY: template default tidak bisa dihapus (ganti default dulu lewat RPC)'
);
set local role authenticated;

-- ============================================================================
-- TES 12 (P3-06, RPC 0010): create_task_with_checklist membuat task +
-- checklist dalam satu transaksi. Dijalankan sebagai user A (owner).
-- ============================================================================
select _set_user(:'user_a');
select is(
  (select (public.create_task_with_checklist(
    'b0000000-0000-0000-0000-000000000001', 'content_item', 'd0000000-0000-0000-0000-000000000001',
    'Task RPC (sample test)', null, :'user_b', null, 'medium', null,
    '[{"title": "Langkah 1"}, {"title": "Langkah 2"}]'::jsonb
  ) ->> 'ok')),
  'true',
  'T12 ALLOW: RPC create_task_with_checklist mengembalikan ok=true'
);
select is(
  (select count(*) from public.tasks where title = 'Task RPC (sample test)')::int,
  1,
  'T12b ALLOW: task hasil RPC tersimpan (1 baris)'
);
select is(
  (select count(*) from public.task_checklist_items where task_id in (select id from public.tasks where title = 'Task RPC (sample test)'))::int,
  2,
  'T12c ALLOW: 2 item checklist hasil RPC tersimpan'
);

-- ============================================================================
-- TES 13 (P3-06, RPC 0010): mesin status task — todo → done langsung
-- ditolak; todo → in_progress diizinkan. Dijalankan sebagai user A.
-- ============================================================================
select is(
  (select (public.transition_task_status('a1000000-0000-0000-0000-000000000001', 'done') ->> 'ok')),
  'false',
  'T13 DENY: transisi todo → done langsung ditolak mesin status'
);
select is(
  (select (public.transition_task_status('a1000000-0000-0000-0000-000000000001', 'in_progress') ->> 'ok')),
  'true',
  'T13b ALLOW: transisi todo → in_progress diizinkan'
);

-- ============================================================================
-- TES 14 (P3-09): mentions hanya ditulis RPC — INSERT langsung ditolak.
-- ============================================================================
select throws_ok(
  format($f$insert into public.mentions (comment_id, mentioned_user_id)
     values ('a4000000-0000-0000-0000-000000000001', %L)$f$, :'user_b'),
  '42501',
  'new row violates row-level security policy for table "mentions"',
  'T14 DENY: INSERT mention langsung ditolak (hanya RPC create_comment_with_mentions)'
);

-- ============================================================================
-- TES 15 (migrasi 0012, KOREKSI atas T15 v1): konversi ide TANPA brand
-- TANPA p_brand_id ditolak bersih — RPC convert_idea_to_content (0012)
-- mengembalikan ok=false + pesan, BUKAN crash 23502. DENGAN p_brand_id
-- (Brand A) → berhasil dan item memakai brand itu. Dijalankan sebagai
-- user A (owner Workspace A). Ide dibuat sebagai postgres (bypass RLS);
-- RPC dipanggil sebagai user A.
-- ============================================================================
reset role;
insert into public.ideas (id, workspace_id, brand_id, title, status, owner_user_id)
values ('a7000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', null, 'Ide Tanpa Brand (sample test)', 'new', :'user_a')
on conflict (id) do nothing;
set local role authenticated;
select _set_user(:'user_a');
select is(
  (select (r ->> 'ok') || '|' || (r ->> 'message')
     from (select public.convert_idea_to_content('a7000000-0000-0000-0000-000000000001') as r) s),
  'false|Ide ini belum punya brand. Pilih brand dulu sebelum dikonversi.',
  'T15 DENY: konversi ide tanpa brand tanpa p_brand_id ditolak bersih (ok=false + pesan, migrasi 0012)'
);
select is(
  (select (public.convert_idea_to_content('a7000000-0000-0000-0000-000000000001', null, 'e0000000-0000-0000-0000-000000000001') ->> 'ok')),
  'true',
  'T15b ALLOW: konversi ide tanpa brand DENGAN p_brand_id mengembalikan ok=true (migrasi 0012)'
);
select is(
  (select brand_id::text from public.content_items where origin_idea_id = 'a7000000-0000-0000-0000-000000000001'),
  'e0000000-0000-0000-0000-000000000001',
  'T15c ALLOW: content item hasil konversi memakai brand dari p_brand_id (Brand A)'
);
select is(
  (select status from public.ideas where id = 'a7000000-0000-0000-0000-000000000001'),
  'converted',
  'T15d ALLOW: ide berstatus converted setelah konversi dengan p_brand_id'
);

-- ============================================================================
-- TES 16: anon (belum login) tidak bisa membaca task.
-- GRANT SELECT ke anon diperlukan agar query is_empty bisa dieksekusi
-- (tanpa grant, error 42501 permission denied, bukan hasil RLS).
-- Grant ini DI DALAM transaksi file (ikut rollback di akhir).
-- Pola file 02 v1.1: GRANT WAJIB sebagai postgres — `reset role;` dulu.
-- ============================================================================
reset role;
grant select on public.tasks to anon;
set local role anon;
select _as_anon();
select is_empty(
  $$ select 1 from public.tasks where id = 'a1000000-0000-0000-0000-000000000001' $$,
  'T16 DENY: anon tidak bisa membaca task'
);
reset role;
set local role authenticated;

-- Bersihkan data uji (hanya baris yang dibuat file ini).
reset role;
delete from public.activity_logs where entity_type = 'content_item' and entity_id in (select id from public.content_items where origin_idea_id = 'a7000000-0000-0000-0000-000000000001');
delete from public.content_status_events where content_item_id in (select id from public.content_items where origin_idea_id = 'a7000000-0000-0000-0000-000000000001');
delete from public.content_versions where content_item_id in (select id from public.content_items where origin_idea_id = 'a7000000-0000-0000-0000-000000000001');
delete from public.content_items where origin_idea_id = 'a7000000-0000-0000-0000-000000000001';
delete from public.ideas where id = 'a7000000-0000-0000-0000-000000000001';
delete from public.tasks where title = 'Task RPC (sample test)';
delete from public.notifications where id = 'a5000000-0000-0000-0000-000000000001';
delete from public.comments where id in ('a4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000002','a4000000-0000-0000-0000-000000000003');
delete from public.content_assets where id = 'a3000000-0000-0000-0000-000000000001';
delete from public.assets where id in ('a2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000002');
delete from public.tasks where id in ('a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000003');
delete from public.content_items where id in ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000003');
delete from public.campaigns where id = '90000000-0000-0000-0000-000000000001';
delete from public.brands where id in ('e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002');
delete from public.workspace_members where workspace_id in ('b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002');
-- v1.3: unset default dulu — hapus workspace men-cascade ke brief_templates
-- (FK workspace_id ON DELETE CASCADE, 0009) dan trigger pelindung menolak
-- hapus template is_default=true (P0001). Setelah unset, cascade menghapus
-- template non-default dan lolos.
update public.brief_templates set is_default = false where id = 'a6000000-0000-0000-0000-000000000001';
delete from public.workspaces where id in ('b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002');
delete from public.organization_members where organization_id in ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002');
delete from public.organizations where id in ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002');
drop function if exists _set_user(uuid, text);
drop function if exists _as_anon();

select * from finish();
rollback;
