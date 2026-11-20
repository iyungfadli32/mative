-- MaTive Phase 8 — RLS + RPC AI Assistant (pgTAP) — v1.3
-- v1.1: T3c/T3d dilewat helper _try_insert_log (tangkap 42501)
-- (Run 1 v1.0 abort 42501 di T3c — INSERT pelanggar RLS melempar, bukan
-- ditolak diam-diam). plan tetap 52, asersi tetap 52.
-- v1.2: T3d dihitung sebagai B (A viewer_client melihat 0, bukan 2);
-- T4b membaca max(version_number) — JANGAN panggil RPC dua kali
-- (Run 2 v1.1: 48/52; T3d/T4b/T4e/T4o gagal, semuanya bug asersi,
-- bukan cacat migrasi 0022). plan tetap 52, asersi tetap 52.
-- v1.3 (Phase 9): T3f baru — INSERT ... RETURNING (regresi 0023:
-- policy SELECT 0022 pakai helper self-lookup membuat RETURNING gagal
-- 42501, log AI tidak tersimpan; INSERT biasa lolos sehingga pgTAP
-- v1.2 52/52 tidak menangkapnya; e2e A8.4 yang menemukan). plan 52→53.
-- File baru untuk migrasi 0022 v1.0 (ai_generations + kolom
-- ai_assisted/ai_generation_id di content_versions + RPC
-- insert_ai_draft_version + retensi + pemakaian harian).
-- 53 asersi. Menguji: tabel + RLS + grant, RLS baca log (member 8 peran
-- non-klien + viewer_client TIDAK melihat + anon ditolak), tulis log
-- pola actor, RPC insert versi AI (happy path + validasi + atomik
-- nomor versi), retensi 90 hari + pemakaian harian (zona Asia/Jakarta),
-- CHECK tabel baru, update/delete langsung ditolak (42501).
-- ============================================================================
-- CARA MENJALANKAN (oleh koordinator — butuh DATABASE_URL / service role): <redacted>
--   1. Terapkan migrasi 0001–0022 ke database BERSIH (lihat
--      docs/phase-8-report.md §8; urutan: 0016, 0017, 0018, 0019, 0020,
--      0021, lalu 0022).
--   2. Aktifkan ekstensi pgTAP di proyek Supabase (Dashboard → Database →
--      Extensions → pgtap), atau jalankan:  create extension if not exists pgtap;
--   3. Buat 2 pengguna auth uji (mis. lewat Dashboard → Authentication →
--      Add user) dan catat UUID-nya; ganti placeholder di bawah.
--      User A = owner Workspace A. User B = manager di Workspace A dengan
--      brand_scope = [Brand A] (TERBATAS), admin di Workspace B (tanpa scope).
--      A juga terdaftar sebagai viewer_client di Workspace B (untuk TES 2/4).
--   4. Jalankan:  psql "$DATABASE_URL" -v user_a='<UUID-USER-A>'
--        -v user_b='<UUID-USER-B>' \
--        -f supabase/tests/08_rls_phase8.sql
--   Hasil yang diharapkan: semua tes ok (tidak ada "not ok").
--   DI SQL EDITOR (tanpa psql): hapus kedua baris \\set, ganti setiap :'user_a'
--   dengan literal UUID-A dan setiap :'user_b' dengan literal UUID-B, lalu
--   jalankan seluruh file sebagai satu query (begin ... rollback di akhir
--   membersihkan data uji).
--   PENTING: SQL Editor TIDAK mempertahankan transaksi antar-Run (tiap Run
--   sesi baru) — tempel SELURUH file ke editor lalu Run SEKALI (pelajaran
--   pgTAP 03 v1.0 / 04 v1.4).
--
-- CATATAN: tes ini TIDAK BOLEH dijalankan di database produksi berisi data
-- nyata — hanya database bersih/preview. Tes memakai JWT claims palsu lewat
-- set_config('request.jwt.claims') untuk mensimulasikan tiap pengguna.
--
-- POLA YANG DIIKUTI (pelajaran file 01 v2.2 + 02 v1.2 + 03 v1.4 + 04 v1.4 +
-- 05 v1.2 + 06 v1.1 + 07 v1.5):
--   - Setup sebagai postgres (bypass RLS), baru `set local role authenticated`.
--   - RPC mengembalikan jsonb {ok, code, message} (TIDAK melempar) — asersi
--     memakai is(->>'ok', 'true'/'false') dan is(->>'code', ...), BUKAN
--     throws_ok. throws_ok HANYA untuk exception DB sungguhan (CHECK 23514,
--     unique 23505, privilege 42501).
--   - UPDATE/DELETE di bawah RLS tidak melempar exception: pakai asersi
--     jumlah baris terpengaruh (count(*) ... ::int).
--   - Placeholder :'user_a'/:'user_b' TIDAK BOLEH di dalam string $$...$$ —
--     SQL dinamis dibangun lewat format($f$...$f$, :'user_b').
--   - UUID palsu 1111.../2222... HANYA di dua baris \\set.
--   - Insert baris uji di tengah tes memakai `reset role;` (postgres) lalu
--     `set local role authenticated;` lagi — WAJIB: _set_user HANYA mengubah
--     klaim JWT, BUKAN role (pelajaran 36, pgTAP 07 Run 3: 11 dari 16 gagal
--     karena _set_user sesudah reset role tetap berjalan sebagai postgres).
--   - Pola throws_ok = pesan galat lengkap (nama constraint terpotong 63
--     byte bila perlu); pola pendek GAGAL walau galatnya benar (pelajaran 05).
--   - Cleanup defensif HARUS berjalan sebagai postgres: tegaskan `reset
--     role;` sebelum blok cleanup. Authenticated TIDAK PUNYA grant
--     update/delete atas ai_generations — DELETE cleanup sebagai
--     authenticated abort 42501 sebelum finish() (pelajaran 39, pgTAP 07
--     Run 5 v1.3).
--   - Cleanup defensif diurutkan daun → akar (pelajaran 06 v1.0: brands
--     TIDAK BOLEH dihapus sebelum content_items — RESTRICT).
--   - INSERT telanjang yang melanggar RLS WITH CHECK melempar 42501 dan
--     meng-abort SELURUH transaksi (bukan penolakan diam-diam seperti
--     UPDATE/DELETE) — INSERT yang HARUS ditolak dilewat helper
--     _try_insert_log (tangkap insufficient_privilege); asersi hitungan
--     sesudahnya tetap membuktikan penolakan (Run 1 v1.0 abort di T3c).
--   - Asersi hitungan HARUS dihitung sebagai pengguna yang BISA melihat
--     barisnya: viewer_client melihat 0 baris (T2c) sehingga hitungan
--     sebagai dia tidak membuktikan apa-apa — hitung sebagai member yang
--     melihat (T3d: B, admin WS-B8) (Run 2 v1.1: T3d have 0 want 2).
--   - RPC yang menyisipkan TIDAK BOLEH dipanggil dua kali untuk membaca
--     hasilnya: panggilan kedua menyisipkan baris baru (T4b: v2 jadi v3,
--     merembet ke T4e v4 dan T4o 4 versi) — baca dari tabel (Run 2 v1.1).
--   - Postgres TIDAK punya max/min(uuid) — nomor versi memakai
--     max(version_number integer) (aman); jangan pernah max(uuid).
-- ============================================================================

begin;
select plan(53);

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

-- Helper: coba insert log AI dan telan penolakan RLS 42501 (T3c/T3d).
-- INSERT yang melanggar RLS WITH CHECK melempar 42501 dan meng-abort
-- transaksi (bukan penolakan diam-diam seperti UPDATE/DELETE) — tanpa
-- helper ini, asersi hitungan sesudahnya tidak pernah jalan (Run 1 v1.0
-- abort di T3c). Actor dilewat sebagai parameter: placeholder :'user_x'
-- TIDAK BOLEH di dalam $$...$$ (aturan file ini).
create or replace function _try_insert_log(p_id uuid, p_ws uuid, p_actor uuid, p_feature text, p_ref text)
returns void language plpgsql as $$
begin
  insert into public.ai_generations (id, workspace_id, actor_user_id, feature, input_reference)
  values (p_id, p_ws, p_actor, p_feature, p_ref);
exception when insufficient_privilege then
  null;
end;
$$;

-- Pengguna uji (GANTI dengan UUID auth user nyata dari database uji).
\set user_a '11111111-1111-1111-1111-111111111111'
\set user_b '22222222-2222-2222-2222-222222222222'

-- ---------------------------------------------------------------------------
-- Setup: org + workspace + member + brand + campaign + item + versi v1 +
-- log ai_generations fixture (sebagai postgres, bypass RLS). User B =
-- manager WS-A dengan brand_scope [Brand A]; admin WS-B (tanpa scope).
-- User A = viewer_client di WS-B (untuk TES 2/4).
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, owner_user_id)
values ('a8000000-0000-0000-0000-000000000001', 'Org A8 (sample test)', 'org-a8-test', :'user_a'),
       ('a8000000-0000-0000-0000-000000000002', 'Org B8 (sample test)', 'org-b8-test', :'user_b')
on conflict (slug) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at)
values ('a8000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('a8000000-0000-0000-0000-000000000002', :'user_b', 'owner', 'active', now())
on conflict (organization_id, user_id) do nothing;

insert into public.workspaces (id, organization_id, name, slug, timezone)
values ('b8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000001', 'Workspace A8 (sample test)', 'ws-a8-test', 'Asia/Jakarta'),
       ('b8000000-0000-0000-0000-000000000002', 'a8000000-0000-0000-0000-000000000002', 'Workspace B8 (sample test)', 'ws-b8-test', 'Asia/Jakarta')
on conflict (organization_id, slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
values ('b8000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('b8000000-0000-0000-0000-000000000001', :'user_b', 'manager', 'active', now()),
       ('b8000000-0000-0000-0000-000000000002', :'user_b', 'admin', 'active', now()),
       ('b8000000-0000-0000-0000-000000000002', :'user_a', 'viewer_client', 'active', now())
on conflict (workspace_id, user_id) do nothing;

-- B di WS-A dibatasi hanya Brand A (P1-A7).
update public.workspace_members
set brand_scope = '["e8000000-0000-0000-0000-000000000001"]'::jsonb
where workspace_id = 'b8000000-0000-0000-0000-000000000001' and user_id = :'user_b';

insert into public.brands (id, workspace_id, name, slug, status)
values ('e8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001', 'Brand A8 (sample test)', 'brand-a8-test', 'active'),
       ('e8000000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000001', 'Brand A2-8 (sample test)', 'brand-a2-8-test', 'active'),
       ('e8000000-0000-0000-0000-000000000003', 'b8000000-0000-0000-0000-000000000002', 'Brand B8 (sample test)', 'brand-b8-test', 'active')
on conflict (workspace_id, slug) do nothing;

insert into public.campaigns (id, workspace_id, name, status, owner_user_id)
values ('f8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001', 'Campaign A8 (sample test)', 'active', :'user_a')
on conflict (id) do nothing;

insert into public.campaign_brands (campaign_id, brand_id)
values ('f8000000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-000000000001')
on conflict (campaign_id, brand_id) do nothing;

insert into public.content_items (id, workspace_id, brand_id, campaign_id, title, production_status, owner_user_id, timezone)
values ('d8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001', 'Item A8-1 (sample test)', 'approved', :'user_a', 'Asia/Jakarta'),
       ('d8000000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-000000000001', null, 'Item A8-2 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d8000000-0000-0000-0000-000000000003', 'b8000000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-000000000002', null, 'Item A2-8-1 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d8000000-0000-0000-0000-000000000004', 'b8000000-0000-0000-0000-000000000002', 'e8000000-0000-0000-0000-000000000003', null, 'Item B8-1 (sample test)', 'editing', :'user_b', 'Asia/Jakarta')
on conflict (id) do nothing;

-- Versi v1 baseline untuk item A8-1 dan item B8-1 (append-only sejak 0007).
insert into public.content_versions (id, content_item_id, version_number, brief_snapshot, script, caption, cta, change_summary, created_by, ai_assisted)
values ('a8200000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001', 1, '{}'::jsonb, 'Skrip v1', 'Caption v1', null, 'Versi awal', :'user_a', false),
       ('a8200000-0000-0000-0000-000000000002', 'd8000000-0000-0000-0000-000000000004', 1, '{}'::jsonb, 'Skrip B8 v1', 'Caption B8 v1', null, 'Versi awal', :'user_b', false)
on conflict (content_item_id, version_number) do nothing;

-- Log ai_generations fixture (sebagai postgres):
--   g1 WS-A8/A/brief/completed (hari ini) — insert happy path T4a.
--   g2 WS-A8/B/content_draft/completed (hari ini) — insert B T4d + actor-mismatch T4e.
--   g3 WS-A8/A/feedback_summary/completed — fitur bukan penghasil versi (T4f).
--   g4 WS-A8/A/brief/not_configured — belum selesai (T4g).
--   g5 WS-B8/B/brief/completed — lintas workspace (T4h).
--   g6 WS-A8/A/brief/completed, 100 hari lalu — retensi: dihapus (T5e/f).
--   g7 WS-A8/A/brief/completed, 10 hari lalu — retensi: dipertahankan (T5g).
--   g8 WS-A8/A/brief/failed — tidak memakan kuota (T5a).
--   g9 WS-B8/B/brief/completed — viewer_client: A melihat 0 (T2c).
--   g10 WS-A8/A/content_draft/completed (hari ini) — pemakaian harian (T5a).
insert into public.ai_generations (id, workspace_id, actor_user_id, feature, provider, model, input_reference, output_reference, status, error_category, created_at)
values ('a8100000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001', :'user_a', 'brief', 'none', null, 'content_item:d8000000-0000-0000-0000-000000000001', 'ai-draft:g1', 'completed', 'none', now()),
       ('a8100000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000001', :'user_b', 'content_draft', 'none', null, 'content_item:d8000000-0000-0000-0000-000000000001', 'ai-draft:g2', 'completed', 'none', now()),
       ('a8100000-0000-0000-0000-000000000003', 'b8000000-0000-0000-0000-000000000001', :'user_a', 'feedback_summary', 'none', null, 'content_item:d8000000-0000-0000-0000-000000000001', 'ai-draft:g3', 'completed', 'none', now()),
       ('a8100000-0000-0000-0000-000000000004', 'b8000000-0000-0000-0000-000000000001', :'user_a', 'brief', 'none', null, 'content_item:d8000000-0000-0000-0000-000000000001', 'ai-draft:g4', 'not_configured', 'provider_not_configured', now()),
       ('a8100000-0000-0000-0000-000000000005', 'b8000000-0000-0000-0000-000000000002', :'user_b', 'brief', 'none', null, 'content_item:d8000000-0000-0000-0000-000000000004', 'ai-draft:g5', 'completed', 'none', now()),
       ('a8100000-0000-0000-0000-000000000006', 'b8000000-0000-0000-0000-000000000001', :'user_a', 'brief', 'none', null, 'content_item:d8000000-0000-0000-0000-000000000001', 'ai-draft:g6', 'completed', 'none', now() - interval '100 days'),
       ('a8100000-0000-0000-0000-000000000007', 'b8000000-0000-0000-0000-000000000001', :'user_a', 'brief', 'none', null, 'content_item:d8000000-0000-0000-0000-000000000001', 'ai-draft:g7', 'completed', 'none', now() - interval '10 days'),
       ('a8100000-0000-0000-0000-000000000008', 'b8000000-0000-0000-0000-000000000001', :'user_a', 'brief', 'none', null, 'content_item:d8000000-0000-0000-0000-000000000001', 'ai-draft:g8', 'failed', 'provider_error', now()),
       ('a8100000-0000-0000-0000-000000000009', 'b8000000-0000-0000-0000-000000000002', :'user_b', 'brief', 'none', null, 'content_item:d8000000-0000-0000-0000-000000000004', 'ai-draft:g9', 'completed', 'none', now()),
       ('a8100000-0000-0000-0000-000000000010', 'b8000000-0000-0000-0000-000000000001', :'user_a', 'content_draft', 'none', null, 'content_item:d8000000-0000-0000-0000-000000000001', 'ai-draft:g10', 'completed', 'none', now())
on conflict (id) do nothing;

-- ============================================================================
-- TES 1 — tabel + kolom + RLS + retensi default. (6)
-- ============================================================================
select is(
  (select count(*)::int from pg_class where relname = 'ai_generations' and relrowsecurity),
  1,
  'T1a tabel ai_generations ada + RLS aktif'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'ai_generations'),
  4,
  'T1b ai_generations punya 4 policy (select + insert actor + no update + no delete)'
);
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'content_versions' and column_name in ('ai_assisted', 'ai_generation_id')),
  2,
  'T1c content_versions punya kolom ai_assisted + ai_generation_id'
);
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'ai_generations' and column_name in ('input_text', 'output_text', 'raw_input', 'raw_output', 'prompt', 'system_prompt')),
  0,
  'T1d ai_generations TIDAK PUNYA kolom payload mentah (hanya referensi)'
);
select is(
  public.ai_retention_days(),
  90,
  'T1e retensi log AI = 90 hari (ASUMSI-8D)'
);
select is(
  (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'content_versions' and column_name = 'ai_assisted'),
  'false',
  'T1f ai_assisted default false (versi non-AI)'
);

-- ============================================================================
-- TES 2 — RLS baca log (member 8 peran non-klien; viewer_client 0;
-- anon ditolak; helper visibilitas). (7)
-- ============================================================================
set local role authenticated;
select _set_user(:'user_a');
select is(
  (select count(*) from public.ai_generations where workspace_id = 'b8000000-0000-0000-0000-000000000001')::int,
  8,
  'T2a A (owner WS-A8) melihat 8 baris log WS-A8'
);
select _set_user(:'user_b');
select is(
  (select count(*) from public.ai_generations where workspace_id = 'b8000000-0000-0000-0000-000000000001')::int,
  8,
  'T2b B (manager WS-A8, scope Brand A) melihat 8 baris log WS-A8 — log ter-scope workspace, bukan brand'
);
select _set_user(:'user_a');
select is(
  (select count(*) from public.ai_generations where workspace_id = 'b8000000-0000-0000-0000-000000000002')::int,
  0,
  'T2c A sebagai viewer_client di WS-B8 melihat 0 baris log WS-B8'
);
select _set_user(:'user_b');
select is(
  (select count(*) from public.ai_generations where workspace_id = 'b8000000-0000-0000-0000-000000000002')::int,
  2,
  'T2d B (admin WS-B8) melihat 2 baris log WS-B8'
);
set local role anon;
select _as_anon();
select throws_ok(
  $$ select * from public.ai_generations $$,
  '42501',
  'permission denied for table ai_generations',
  'T2e anon SELECT log AI ditolak 42501 (tanpa grant)'
);
reset role;
set local role authenticated;
select _set_user(:'user_a');
select is(
  public.is_ai_generation_visible('a8100000-0000-0000-0000-000000000001', array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst']),
  true,
  'T2f helper: g1 terlihat oleh A (owner WS-A8)'
);
select is(
  public.is_ai_generation_visible('a8100000-0000-0000-0000-000000000009', array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst']),
  false,
  'T2g helper: g9 TIDAK terlihat oleh A sebagai viewer_client WS-B8'
);

-- ============================================================================
-- TES 3 — tulis log pola actor (insert sendiri lolos; aktor lain /
-- viewer_client 0 baris; INSERT ... RETURNING lolos). (6)
-- ============================================================================
select _set_user(:'user_a');
insert into public.ai_generations (id, workspace_id, actor_user_id, feature, input_reference, status, error_category)
values ('a8100000-0000-0000-0000-000000000011', 'b8000000-0000-0000-0000-000000000001', :'user_a', 'brief', 'content_item:d8000000-0000-0000-0000-000000000001', 'blocked', 'prompt_injection');
select is(
  (select count(*) from public.ai_generations where workspace_id = 'b8000000-0000-0000-0000-000000000001')::int,
  9,
  'T3a A insert log sendiri (blocked/injeksi) lolos — 9 baris WS-A8'
);
reset role;
delete from public.ai_generations where id = 'a8100000-0000-0000-0000-000000000011';
set local role authenticated;
select _set_user(:'user_a');
select is(
  (select count(*) from public.ai_generations where workspace_id = 'b8000000-0000-0000-0000-000000000001')::int,
  8,
  'T3b baris uji T3a sudah dihapus (postgres) — kembali 8 baris WS-A8'
);
select _set_user(:'user_b');
-- INSERT pelanggar RLS (actor bukan pemanggil) melempar 42501 — helper
-- _try_insert_log menangkapnya supaya transaksi tetap jalan.
select _try_insert_log('a8100000-0000-0000-0000-000000000012', 'b8000000-0000-0000-0000-000000000001', :'user_a', 'brief', 'content_item:d8000000-0000-0000-0000-000000000001');
select is(
  (select count(*) from public.ai_generations where workspace_id = 'b8000000-0000-0000-0000-000000000001')::int,
  8,
  'T3c B insert dengan actor=A (bukan diri sendiri) ditolak — tetap 8 baris'
);
select _set_user(:'user_a');
-- Sama seperti T3c: INSERT pelanggar RLS lewat helper penangkap 42501.
select _try_insert_log('a8100000-0000-0000-0000-000000000013', 'b8000000-0000-0000-0000-000000000002', :'user_a', 'brief', 'content_item:d8000000-0000-0000-0000-000000000004');
-- A sebagai viewer_client TIDAK melihat baris WS-B8 (T2c: 0) — hitung
-- sebagai B (admin WS-B8, melihat 2) untuk membuktikan tidak ada baris baru.
select _set_user(:'user_b');
select is(
  (select count(*) from public.ai_generations where workspace_id = 'b8000000-0000-0000-0000-000000000002')::int,
  2,
  'T3d A insert di WS-B8 (viewer_client) ditolak — tetap 2 baris'
);
select _set_user(:'user_b');
insert into public.ai_generations (id, workspace_id, actor_user_id, feature, input_reference)
values ('a8100000-0000-0000-0000-000000000014', 'b8000000-0000-0000-0000-000000000001', :'user_b', 'brief', 'content_item:d8000000-0000-0000-0000-000000000001');
select is(
  (select count(*) from public.ai_generations where workspace_id = 'b8000000-0000-0000-0000-000000000001')::int,
  9,
  'T3e B insert log sendiri (manager WS-A8) lolos — 9 baris WS-A8'
);
reset role;
delete from public.ai_generations where id = 'a8100000-0000-0000-0000-000000000014';
set local role authenticated;

-- Regresi 0023 (Phase 9): INSERT ... RETURNING (pola PostgREST
-- .insert().select() di logGeneration) HARUS lolos — policy SELECT 0022
-- yang memakai helper self-lookup membuat RETURNING gagal 42501 dan
-- log tidak pernah tersimpan, padahal INSERT biasa lolos (pgTAP 08
-- v1.2 52/52 tidak menangkapnya; e2e A8.4 yang menemukan).
-- Baris uji dihapus sesudah asersi (pola T3a/T3e) supaya hitungan
-- TES 5 tidak berubah.
select _set_user(:'user_a');
with ins as (
  insert into public.ai_generations (id, workspace_id, actor_user_id, feature, input_reference, status, error_category)
  values ('a8100000-0000-0000-0000-000000000015', 'b8000000-0000-0000-0000-000000000001', :'user_a', 'brief', 'content_item:d8000000-0000-0000-0000-000000000001', 'completed', 'none')
  returning id
)
select is(
  (select count(*) from ins)::int,
  1,
  'T3f INSERT ... RETURNING log sendiri lolos (regresi 0023)'
);
reset role;
delete from public.ai_generations where id = 'a8100000-0000-0000-0000-000000000015';
set local role authenticated;

-- ============================================================================
-- TES 4 — RPC insert_ai_draft_version (happy path + validasi + nomor versi).
-- (15)
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.insert_ai_draft_version(
    'd8000000-0000-0000-0000-000000000001', 'Skrip AI v2', 'Caption AI v2', null, '{}'::jsonb, 'Draft AI: brief g1', 'a8100000-0000-0000-0000-000000000001'
  ) ->> 'ok'),
  'true',
  'T4a A insert versi AI untuk item A8-1 dengan g1 (brief, completed) lolos'
);
-- JANGAN panggil RPC dua kali untuk membaca nomor versi: tiap panggilan
-- menyisipkan versi BARU (T4a sudah membuat v2; panggilan kedua membuat
-- v3 — Run 2 v1.1: T4b have 3, T4e have 4, T4o have 4). Baca langsung
-- dari tabel.
select is(
  (select max(version_number) from public.content_versions where content_item_id = 'd8000000-0000-0000-0000-000000000001')::int,
  2,
  'T4b versi baru bernomor v2 (max + 1)'
);
select is(
  (select count(*) from public.content_versions where content_item_id = 'd8000000-0000-0000-0000-000000000001' and version_number = 2 and ai_assisted = true and ai_generation_id = 'a8100000-0000-0000-0000-000000000001')::int,
  1,
  'T4c v2 tercatat ai_assisted=true + ai_generation_id=g1'
);
select is(
  (select script from public.content_versions where content_item_id = 'd8000000-0000-0000-0000-000000000001' and version_number = 1),
  'Skrip v1',
  'T4d v1 tidak berubah (snapshot yang disetujui tidak pernah dimutasi)'
);
select _set_user(:'user_b');
select is(
  (public.insert_ai_draft_version(
    'd8000000-0000-0000-0000-000000000001', 'Skrip AI v3', 'Caption AI v3', 'CTA v3', '{}'::jsonb, 'Draft AI: content_draft g2', 'a8100000-0000-0000-0000-000000000002'
  ) ->> 'version_number'),
  '3',
  'T4e B insert versi AI (manager, brand dalam scope, generasi sendiri) lolos — v3'
);
select _set_user(:'user_a');
select is(
  (public.insert_ai_draft_version(
    'd8000000-0000-0000-0000-000000000001', 'x', 'x', null, '{}'::jsonb, 'Coba generasi B', 'a8100000-0000-0000-0000-000000000002'
  ) ->> 'code'),
  'FORBIDDEN',
  'T4f A insert dengan generasi milik B ditolak FORBIDDEN (aktor harus = pemanggil)'
);
select is(
  (public.insert_ai_draft_version(
    'd8000000-0000-0000-0000-000000000001', 'x', 'x', null, '{}'::jsonb, 'Coba fitur feedback', 'a8100000-0000-0000-0000-000000000003'
  ) ->> 'code'),
  'INVALID_GENERATION',
  'T4g generasi feedback_summary ditolak — bukan penghasil versi konten'
);
select is(
  (public.insert_ai_draft_version(
    'd8000000-0000-0000-0000-000000000001', 'x', 'x', null, '{}'::jsonb, 'Coba belum selesai', 'a8100000-0000-0000-0000-000000000004'
  ) ->> 'code'),
  'INVALID_GENERATION',
  'T4h generasi not_configured ditolak — belum selesai'
);
select is(
  (public.insert_ai_draft_version(
    'd8000000-0000-0000-0000-000000000001', 'x', 'x', null, '{}'::jsonb, 'Coba lintas workspace', 'a8100000-0000-0000-0000-000000000005'
  ) ->> 'code'),
  'FORBIDDEN',
  'T4i generasi WS-B8 untuk item WS-A8 ditolak FORBIDDEN (lintas workspace)'
);
select _set_user(:'user_b');
select is(
  (public.insert_ai_draft_version(
    'd8000000-0000-0000-0000-000000000003', 'x', 'x', null, '{}'::jsonb, 'Coba brand di luar scope', 'a8100000-0000-0000-0000-000000000002'
  ) ->> 'code'),
  'FORBIDDEN',
  'T4j B insert untuk item Brand A2 (di luar scope Brand A) ditolak FORBIDDEN'
);
select _set_user(:'user_a');
select is(
  (public.insert_ai_draft_version(
    'd8000000-0000-0000-0000-000000000001', 'x', 'x', null, '{}'::jsonb, '', 'a8100000-0000-0000-0000-000000000001'
  ) ->> 'code'),
  'INVALID_INPUT',
  'T4k change_summary kosong ditolak INVALID_INPUT'
);
select is(
  (public.insert_ai_draft_version(
    'd8000000-0000-0000-0000-000000000001', 'x', 'x', null, '{}'::jsonb, 'Tanpa generasi', null
  ) ->> 'code'),
  'INVALID_GENERATION',
  'T4l generasi null ditolak — insert versi AI wajib punya provenance'
);
select is(
  (public.insert_ai_draft_version(
    '99999999-9999-9999-9999-999999999999', 'x', 'x', null, '{}'::jsonb, 'Item tidak ada', 'a8100000-0000-0000-0000-000000000001'
  ) ->> 'code'),
  'INVALID_ITEM',
  'T4m item tidak ditemukan ditolak INVALID_ITEM'
);
select is(
  (public.insert_ai_draft_version(
    'd8000000-0000-0000-0000-000000000004', 'x', 'x', null, '{}'::jsonb, 'Coba viewer_client', 'a8100000-0000-0000-0000-000000000009'
  ) ->> 'code'),
  'FORBIDDEN',
  'T4n A sebagai viewer_client WS-B8 insert versi item B8-1 ditolak FORBIDDEN'
);
select is(
  (select count(*) from public.content_versions where content_item_id = 'd8000000-0000-0000-0000-000000000001')::int,
  3,
  'T4o item A8-1 punya tepat 3 versi (v1 + v2 + v3) — semua penolakan tidak menulis versi'
);

-- ============================================================================
-- TES 5 — retensi 90 hari + pemakaian harian (zona Asia/Jakarta). (9)
-- ============================================================================
select _set_user(:'user_a');
select is(
  public.ai_daily_usage_count('b8000000-0000-0000-0000-000000000001'),
  4,
  'T5a pemakaian WS-A8 hari ini = 4 (g1, g2, g3, g10 completed hari ini; g4 not_configured + g8 failed tidak dihitung)'
);
select _set_user(:'user_b');
select is(
  public.ai_daily_usage_count('b8000000-0000-0000-0000-000000000002'),
  2,
  'T5b pemakaian WS-B8 hari ini = 2 (g5, g9)'
);
select _set_user(:'user_a');
select is(
  public.ai_daily_usage_count('b8000000-0000-0000-0000-000000000002'),
  -1,
  'T5c pemakaian WS-B8 oleh A (viewer_client) = -1 (bukan member yang boleh memakai AI)'
);
select _set_user(:'user_b');
select is(
  public.cleanup_ai_generations('b8000000-0000-0000-0000-000000000001', 90),
  -1,
  'T5d cleanup oleh B (manager, bukan owner/admin) ditolak -1'
);
select is(
  (select count(*) from public.ai_generations where id = 'a8100000-0000-0000-0000-000000000006')::int,
  1,
  'T5e baris g6 (100 hari) masih ada sesudah cleanup yang ditolak'
);
select _set_user(:'user_a');
select is(
  public.cleanup_ai_generations('b8000000-0000-0000-0000-000000000001', 90),
  1,
  'T5f cleanup oleh A (owner) menghapus 1 baris (g6, 100 hari)'
);
select is(
  (select count(*) from public.ai_generations where id = 'a8100000-0000-0000-0000-000000000006')::int,
  0,
  'T5g g6 sudah terhapus'
);
select is(
  (select count(*) from public.ai_generations where id = 'a8100000-0000-0000-0000-000000000007')::int,
  1,
  'T5h g7 (10 hari) dipertahankan — masih dalam retensi 90 hari'
);
select is(
  public.cleanup_ai_generations('b8000000-0000-0000-0000-000000000001', 90),
  0,
  'T5i cleanup kedua menghapus 0 baris (tidak ada lagi yang kedaluwarsa)'
);

-- ============================================================================
-- TES 6 — CHECK tabel baru + default kolom. (6)
-- ============================================================================
reset role;
select throws_ok(
  $$ insert into public.ai_generations (workspace_id, feature, input_reference) values ('b8000000-0000-0000-0000-000000000001', 'foobar', 'x') $$,
  '23514',
  'new row for relation "ai_generations" violates check constraint "ai_generations_feature_check"',
  'T6a feature di luar 7 aksi ditolak CHECK'
);
select throws_ok(
  $$ insert into public.ai_generations (workspace_id, feature, input_reference, status) values ('b8000000-0000-0000-0000-000000000001', 'brief', 'x', 'pending') $$,
  '23514',
  'new row for relation "ai_generations" violates check constraint "ai_generations_status_check"',
  'T6b status di luar enum ditolak CHECK'
);
select throws_ok(
  $$ insert into public.ai_generations (workspace_id, feature, input_reference, error_category) values ('b8000000-0000-0000-0000-000000000001', 'brief', 'x', 'unknown') $$,
  '23514',
  'new row for relation "ai_generations" violates check constraint "ai_generations_error_check"',
  'T6c error_category di luar enum ditolak CHECK'
);
select throws_ok(
  $$ insert into public.ai_generations (workspace_id, feature, input_reference, usage_input_tokens) values ('b8000000-0000-0000-0000-000000000001', 'brief', 'x', -1) $$,
  '23514',
  'new row for relation "ai_generations" violates check constraint "ai_generations_input_tokens_check"',
  'T6d usage_input_tokens negatif ditolak CHECK'
);
set local role authenticated;
select _set_user(:'user_a');
insert into public.ai_generations (id, workspace_id, actor_user_id, feature, input_reference)
values ('a8100000-0000-0000-0000-000000000012', 'b8000000-0000-0000-0000-000000000001', :'user_a', 'brief', 'content_item:d8000000-0000-0000-0000-000000000001');
select is(
  (select provider from public.ai_generations where id = 'a8100000-0000-0000-0000-000000000012'),
  'none',
  'T6e provider default none (belum ada provider yang dipilih)'
);
select is(
  (select status from public.ai_generations where id = 'a8100000-0000-0000-0000-000000000012'),
  'not_configured',
  'T6f status default not_configured'
);

-- ============================================================================
-- TES 7 — update/delete langsung ditolak 42501 + anon + data utuh. (4)
-- ============================================================================
select throws_ok(
  $$ update public.ai_generations set status = 'completed' where workspace_id = 'b8000000-0000-0000-0000-000000000001' $$,
  '42501',
  'permission denied for table ai_generations',
  'T7a UPDATE langsung ke ai_generations ditolak 42501 (tanpa grant)'
);
select throws_ok(
  $$ delete from public.ai_generations where workspace_id = 'b8000000-0000-0000-0000-000000000001' $$,
  '42501',
  'permission denied for table ai_generations',
  'T7b DELETE langsung ke ai_generations ditolak 42501 (tanpa grant)'
);
select _set_user(:'user_b');
select is(
  (select count(*) from public.ai_generations where workspace_id = 'b8000000-0000-0000-0000-000000000002')::int,
  2,
  'T7c data WS-B8 utuh (2 baris) sesudah DELETE yang ditolak'
);
set local role anon;
select _as_anon();
select throws_ok(
  $$ select * from public.ai_generations $$,
  '42501',
  'permission denied for table ai_generations',
  'T7d anon SELECT log AI ditolak 42501 (tanpa grant)'
);

-- ============================================================================
-- Cleanup HARUS sebagai postgres (reset role): authenticated TIDAK PUNYA
-- grant update/delete atas ai_generations — DELETE cleanup sebagai
-- authenticated abort 42501 sebelum finish() (pelajaran 39, pgTAP 07
-- Run 5 v1.3).
-- Cleanup defensif (rollback di akhir membersihkan semuanya; delete di sini
-- menjaga kebersihan bila rollback tidak jalan — urutan daun → akar).
-- ============================================================================
reset role;
delete from public.ai_generations where workspace_id in
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000002');
delete from public.content_placements where content_item_id in
  (select id from public.content_items where workspace_id in
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000002'));
delete from public.campaign_brands where campaign_id in
  (select id from public.campaigns where workspace_id in
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000002'));
delete from public.campaigns where workspace_id in
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000002');
delete from public.content_items where workspace_id in
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000002');
delete from public.brands where workspace_id in
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000002');
update public.brief_templates set is_default = false where workspace_id in
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000002');
delete from public.brief_templates where workspace_id in
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000002');
delete from public.workspace_settings where workspace_id in
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000002');
delete from public.workspace_members where workspace_id in
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000002');
delete from public.workspaces where id in
  ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000002');
delete from public.organization_members where organization_id in
  ('a8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000002');
delete from public.organizations where id in
  ('a8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000002');
drop function if exists _set_user(uuid, text);
drop function if exists _as_anon();
drop function if exists _try_insert_log(uuid, uuid, uuid, text, text);

select * from finish();
rollback;
