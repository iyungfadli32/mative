-- MaTive Phase 7 — RLS + RPC analytics foundation (pgTAP) — v1.4
-- v1.4 (2026-11-20): perbaiki abort 42501 Run 5 (v1.3): DELETE cleanup
--   atas channel_credentials melempar 42501 karena cleanup berjalan
--   sebagai authenticated (T12a v1.2 menegaskan lagi role authenticated
--   dan tidak ada yang mengembalikannya) — authenticated memang TANPA
--   grant atas channel_credentials (server-only, sesuai desain 0021).
--   `reset role;` kini ditegaskan sebelum blok cleanup agar cleanup
--   berjalan sebagai postgres (seperti v1.1/diagnostik). Abort terjadi
--   SESUDAH TES 14 — ke-77 asersi kemungkinan sudah tereksekusi, tapi
--   hasilnya tidak terlihat karena finish() tidak tercapai. Migrasi 0021
--   TIDAK berubah.
-- v1.3 (2026-11-20): perbaiki abort 21000 Run 4 (v1.2): subquery skalar
--   T13b atas campaign_metrics tanpa filter periode mengembalikan 2 baris
--   (Nov 1500 + Okt 3000 dari impor multi-brand T4h) — agregat RPC memang
--   PER PERIODE (DELETE + re-INSERT period-scoped; baris Okt sah). Semua
--   5 subquery skalar campaign_metrics (T2e, T2f, T13b, T13c, T14b) kini
--   difilter period_start/period_end Nov 2026. Migrasi 0021 TIDAK berubah.
--   Akarnya: di Run 3, T10f sebagai postgres MENGHAPUS semua snapshot
--   WS-A7 sehingga campaign_metrics ikut terhapus CASCADE lewat
--   snapshot_id — baris Okt tidak ada saat T13b; di v1.2 T10f benar
--   ditolak 42501 sehingga baris Okt selamat dan T13b abort.
-- v1.2 (2026-11-20): perbaiki 16 kegagalan Run 3 (diagnostik _tap_out):
--   (a) _set_user HANYA mengubah klaim JWT, BUKAN role — sesudah tiap
--   `reset role;`, tegaskan lagi `set local role authenticated;` sebelum
--   _set_user (T6d, T7b, T7e, T8b, T12a); tanpanya tes berjalan sebagai
--   postgres (RLS/privilege bypass) — 11 dari 16 gagal karenanya.
--   (b) T2g 4->5 (impor T2a juga membawa impressions); T13d 2->3 (T2b juga
--   menyimpan satu baris reach); T8b: subquery dipatok ke snapshot yang
--   dituakan (bukan "latest" — sesudah update, yang dituakan bukan lagi
--   yang terbaru). Migrasi 0021 TIDAK berubah: agregasi RPC sudah benar.
-- v1.1 (2026-11-20): T6a/T6d pakai throws_ok 42501 (SELECT tanpa grant
-- melempar 42501, bukan 0 baris — pelajaran 10). Selain itu identik v1.0.
-- File baru untuk migrasi 0021 v1.0 (metric_definitions, analytics_snapshots,
-- content_metrics, campaign_metrics, integration_events, channel_credentials
-- + RPC import_analytics_snapshot + backoff + TTL snapshot).
-- 77 asersi. Menguji: seed 14 definisi metrik, impor RPC (happy path +
-- validasi + atomik), RLS baca (member + brand scope + multi-brand +
-- viewer_client TIDAK melihat), channel_credentials deny-all, CHECK
-- connection_status 'disabled' + capability snapshot, TTL snapshot 24 jam,
-- backoff 60/300/900, tulis langsung ditolak (42501), CHECK tabel baru,
-- insert integration_events pola actor, impor ulang menimpa (latest wins),
-- agregat campaign multi-subject.
-- ============================================================================
-- CARA MENJALANKAN (oleh koordinator — butuh DATABASE_URL / service role): <redacted>
--   1. Terapkan migrasi 0001–0021 ke database BERSIH (lihat
--      docs/phase-7-report.md §8; urutan: 0016, 0017, 0018, 0019, 0020,
--      lalu 0021).
--   2. Aktifkan ekstensi pgTAP di proyek Supabase (Dashboard → Database →
--      Extensions → pgtap), atau jalankan:  create extension if not exists pgtap;
--   3. Buat 2 pengguna auth uji (mis. lewat Dashboard → Authentication →
--      Add user) dan catat UUID-nya; ganti placeholder di bawah.
--      User A = owner Workspace A. User B = manager di Workspace A dengan
--      brand_scope = [Brand A] (TERBATAS), admin di Workspace B (tanpa scope).
--      A juga terdaftar sebagai viewer_client di Workspace B (untuk TES 5).
--   4. Jalankan:  psql "$DATABASE_URL" -v user_a='<UUID-USER-A>'
--        -v user_b='<UUID-USER-B>' \
--        -f supabase/tests/07_rls_phase7.sql
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
-- POLA YANG DIIKUTI (pelajaran file 01 v2.2 + 02 v1.2 + 03 v1.4 + 04 v1.4 + 05 v1.2 + 06 v1.1):
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
--   - Subquery skalar atas campaign_metrics (dan agregat per-periode lain)
--     WAJIB difilter periode (period_start + period_end): agregat dihitung
--     PER PERIODE — impor periode lain (mis. Okt T4h) sah menambah baris
--     untuk (campaign, metrik) yang sama; tanpa filter periode, subquery
--     mengembalikan >1 baris dan seluruh skrip abort 21000 (pelajaran 38,
--     pgTAP 07 Run 4 v1.2: T13b abort — baris Okt selamat karena T10f kini
--     benar ditolak 42501, sedangkan di Run 3 baris itu ikut terhapus
--     CASCADE lewat snapshot_id saat T10f menghapus snapshot).
--   - Cleanup defensif HARUS berjalan sebagai postgres: tegaskan `reset
--     role;` sebelum blok cleanup. Authenticated TIDAK PUNYA grant atas
--     channel_credentials (server-only) dan hanya SELECT atas tabel
--     analytics — DELETE cleanup sebagai authenticated abort 42501
--     sebelum finish() (pelajaran 39, pgTAP 07 Run 5 v1.3). Di v1.1
--     cleanup berjalan sebagai postgres karena T12a belum menegaskan
--     ulang role authenticated.
--   - Pola throws_ok = pesan galat lengkap (nama constraint terpotong 63
--     byte bila perlu); pola pendek GAGAL walau galatnya benar (pelajaran 05).
--   - Cleanup defensif diurutkan daun → akar (pelajaran 06 v1.0: brands
--     TIDAK BOLEH dihapus sebelum content_items — RESTRICT).
-- ============================================================================

begin;
select plan(77);

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
-- Setup: org + workspace + member + brand + campaign + channel + item +
-- placement + published_post (sebagai postgres, bypass RLS). User B =
-- manager WS-A dengan brand_scope [Brand A]; admin WS-B (tanpa scope).
-- User A = viewer_client di WS-B (untuk TES 5).
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, owner_user_id)
values ('a7000000-0000-0000-0000-000000000001', 'Org A7 (sample test)', 'org-a7-test', :'user_a'),
       ('a7000000-0000-0000-0000-000000000002', 'Org B7 (sample test)', 'org-b7-test', :'user_b')
on conflict (slug) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at)
values ('a7000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('a7000000-0000-0000-0000-000000000002', :'user_b', 'owner', 'active', now())
on conflict (organization_id, user_id) do nothing;

insert into public.workspaces (id, organization_id, name, slug, timezone)
values ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', 'Workspace A7 (sample test)', 'ws-a7-test', 'Asia/Jakarta'),
       ('b7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000002', 'Workspace B7 (sample test)', 'ws-b7-test', 'Asia/Jakarta')
on conflict (organization_id, slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
values ('b7000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now()),
       ('b7000000-0000-0000-0000-000000000001', :'user_b', 'manager', 'active', now()),
       ('b7000000-0000-0000-0000-000000000002', :'user_b', 'admin', 'active', now()),
       ('b7000000-0000-0000-0000-000000000002', :'user_a', 'viewer_client', 'active', now())
on conflict (workspace_id, user_id) do nothing;

-- B di WS-A dibatasi hanya Brand A (P1-A7).
update public.workspace_members
set brand_scope = '["e7000000-0000-0000-0000-000000000001"]'::jsonb
where workspace_id = 'b7000000-0000-0000-0000-000000000001' and user_id = :'user_b';

insert into public.brands (id, workspace_id, name, slug, status)
values ('e7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'Brand A7 (sample test)', 'brand-a7-test', 'active'),
       ('e7000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001', 'Brand A2-7 (sample test)', 'brand-a2-7-test', 'active'),
       ('e7000000-0000-0000-0000-000000000003', 'b7000000-0000-0000-0000-000000000002', 'Brand B7 (sample test)', 'brand-b7-test', 'active')
on conflict (workspace_id, slug) do nothing;

insert into public.campaigns (id, workspace_id, name, status, owner_user_id)
values ('f7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'Campaign A7 (sample test)', 'active', :'user_a')
on conflict (id) do nothing;

insert into public.campaign_brands (campaign_id, brand_id)
values ('f7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001')
on conflict (campaign_id, brand_id) do nothing;

insert into public.social_channels (id, brand_id, platform, account_name, connection_status)
values ('e7100000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'instagram', 'Akun A7 (sample test)', 'not_connected'),
       ('e7100000-0000-0000-0000-0000-000000000002', 'e7000000-0000-0000-0000-000000000002', 'instagram', 'Akun A2-7 (sample test)', 'not_connected'),
       ('e7100000-0000-0000-0000-000000000003', 'e7000000-0000-0000-0000-000000000003', 'instagram', 'Akun B7 (sample test)', 'not_connected')
on conflict (id) do nothing;

insert into public.content_items (id, workspace_id, brand_id, campaign_id, title, production_status, owner_user_id, timezone)
values ('d7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'Item A7-1 (sample test)', 'approved', :'user_a', 'Asia/Jakarta'),
       ('d7000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', null, 'Item A7-2 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d7000000-0000-0000-0000-000000000003', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000002', null, 'Item A2-7-1 (sample test)', 'editing', :'user_a', 'Asia/Jakarta'),
       ('d7000000-0000-0000-0000-000000000004', 'b7000000-0000-0000-0000-000000000002', 'e7000000-0000-0000-0000-000000000003', null, 'Item B7-1 (sample test)', 'editing', :'user_b', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.content_placements (id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, timezone)
values ('c7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000001', 'e7100000-0000-0000-0000-000000000001', 'reel', '2026-12-01T10:00:00Z', 'draft', 'Asia/Jakarta'),
       ('c7000000-0000-0000-0000-000000000002', 'd7000000-0000-0000-0000-000000000002', 'e7100000-0000-0000-0000-000000000001', 'reel', null, 'draft', 'Asia/Jakarta'),
       ('c7000000-0000-0000-0000-000000000003', 'd7000000-0000-0000-0000-000000000003', 'e7100000-0000-0000-0000-000000000002', 'reel', null, 'draft', 'Asia/Jakarta'),
       ('c7000000-0000-0000-0000-000000000004', 'd7000000-0000-0000-0000-000000000004', 'e7100000-0000-0000-0000-000000000003', 'reel', null, 'draft', 'Asia/Jakarta')
on conflict (id) do nothing;

-- Satu bukti terbit manual (subject published_post untuk impor).
insert into public.published_posts (id, workspace_id, placement_id, canonical_url, published_at, confirmation_source, created_by)
values ('d7100000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000001', 'https://example.com/p/a7-1', now(), 'manual_user_confirmation', :'user_a')
on conflict (id) do nothing;

-- ============================================================================
-- TES 1 — seed 14 definisi metrik (katalog global). (6)
-- ============================================================================
set local role authenticated;
select _set_user(:'user_a');
select is(
  (select count(*) from public.metric_definitions where workspace_id is null and source_platform = 'manual')::int,
  14,
  'T1a katalog global berisi 14 definisi (sumber manual)'
);
select is(
  (select count(*) from public.metric_definitions where workspace_id is null and is_derived = true)::int,
  2,
  'T1b tepat 2 metrik turunan (engagement_rate, publishing_adherence)'
);
select is(
  (select formula from public.metric_definitions where metric_key = 'engagement_rate' and workspace_id is null),
  'engagements / reach x 100; hanya bila reach > 0 dan kedua komponen dari periode + sumber yang sama. DIHITUNG, bukan diimpor.',
  'T1c formula engagement_rate sesuai ADR-0013 §3'
);
select is(
  (select formula from public.metric_definitions where metric_key = 'publishing_adherence' and workspace_id is null),
  'published sesuai jadwal / planned eligible content x 100; toleransi ±15 menit dari scheduled_at; dihitung dari publishing_jobs + published_posts nyata. DIHITUNG, bukan diimpor.',
  'T1d formula publishing_adherence sesuai ADR-0013 §3'
);
select _set_user(:'user_b');
select is(
  (select count(*) from public.metric_definitions where workspace_id is null)::int,
  14,
  'T1e B (scope terbatas) tetap melihat 14 definisi katalog'
);
select is(
  (select count(distinct metric_key) from public.metric_definitions where workspace_id is null)::int,
  14,
  'T1f 14 kunci metrik berbeda (tidak ada duplikat kunci)'
);

-- ============================================================================
-- TES 2 — impor RPC happy path (Brand A, 4 baris, 1 campaign). (8)
-- ============================================================================
select _set_user(:'user_a');
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001',
    'e7000000-0000-0000-0000-000000000001',
    '2026-11-01', '2026-11-30',
    'csv:impor-uji-a.csv:4',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"reach","value":1000,"unit":"akun","source_notes":"laporan IG Nov"},{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"impressions","value":2500,"unit":"tayangan","source_notes":""},{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"engagements","value":120,"unit":"interaksi","source_notes":""},{"subject_type":"content_item","subject_id":"d7000000-0000-0000-0000-000000000001","metric_key":"likes","value":80,"unit":"interaksi","source_notes":""}]'::jsonb
  ) ->> 'ok'),
  'true',
  'T2a impor Brand A (4 baris) lolos'
);
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001',
    'e7000000-0000-0000-0000-000000000001',
    '2026-11-01', '2026-11-30',
    'csv:impor-uji-a.csv:4',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"reach","value":1000,"unit":"akun","source_notes":""}]'::jsonb
  ) ->> 'inserted'),
  '1',
  'T2b impor kedua (1 baris) melaporkan inserted=1'
);
select is(
  (select count(*) from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000001')::int,
  2,
  'T2c dua snapshot tercatat untuk WS-A7'
);
select is(
  (select count(*) from public.content_metrics where workspace_id = 'b7000000-0000-0000-0000-000000000001')::int,
  5,
  'T2d lima baris content_metrics tercatat (4 + 1)'
);
select is(
  (select value::text from public.campaign_metrics where campaign_id = 'f7000000-0000-0000-0000-000000000001' and metric_key = 'reach' and period_start = '2026-11-01' and period_end = '2026-11-30'),
  '1000',
  'T2e agregat campaign reach = 1000 (snapshot terbaru per subject)'
);
select is(
  (select value::text from public.campaign_metrics where campaign_id = 'f7000000-0000-0000-0000-000000000001' and metric_key = 'engagement_rate' and period_start = '2026-11-01' and period_end = '2026-11-30'),
  '12.0000',
  'T2f agregat campaign engagement_rate = 120/1000x100 = 12.0000'
);
select is(
  (select count(*) from public.campaign_metrics where campaign_id = 'f7000000-0000-0000-0000-000000000001')::int,
  5,
  'T2g lima baris campaign_metrics (reach, impressions, engagements, likes, engagement_rate)'
);
select is(
  (select count(*) from public.integration_events where workspace_id = 'b7000000-0000-0000-0000-000000000001' and event_type = 'import_completed')::int,
  2,
  'T2h dua event import_completed tercatat'
);

-- ============================================================================
-- TES 3 — validasi impor RPC (gagal = jsonb, bukan exception) + atomik. (11)
-- ============================================================================
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
    '2026-11-01', '2026-11-30', 'csv:uji.csv:1',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"engagement_rate","value":5,"unit":"persen","source_notes":""}]'::jsonb
  ) ->> 'code'),
  'INVALID_METRIC',
  'T3a metrik turunan engagement_rate ditolak (dihitung, bukan diimpor)'
);
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
    '2026-11-01', '2026-11-30', 'csv:uji.csv:1',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"foobar","value":5,"unit":"akun","source_notes":""}]'::jsonb
  ) ->> 'code'),
  'INVALID_METRIC',
  'T3b kunci metrik tidak dikenal ditolak'
);
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
    '2026-11-01', '2026-11-30', 'csv:uji.csv:1',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"reach","value":100,"unit":"tayangan","source_notes":""}]'::jsonb
  ) ->> 'code'),
  'INVALID_UNIT',
  'T3c unit salah untuk kunci reach (harus akun) ditolak'
);
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
    '2026-11-01', '2026-11-30', 'csv:uji.csv:1',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"reach","value":-5,"unit":"akun","source_notes":""}]'::jsonb
  ) ->> 'code'),
  'INVALID_ROW',
  'T3d nilai negatif ditolak'
);
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
    '2026-11-01', '2026-11-30', 'csv:uji.csv:2',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"reach","value":100,"unit":"akun","source_notes":""},{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"reach","value":200,"unit":"akun","source_notes":""}]'::jsonb
  ) ->> 'code'),
  'DUPLICATE_METRIC',
  'T3e duplikat (subject + kunci) dalam satu file ditolak'
);
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
    '2026-11-01', '2026-11-30', 'csv:uji.csv:1',
    '[{"subject_type":"placement","subject_id":"99999999-9999-9999-9999-999999999999","metric_key":"reach","value":100,"unit":"akun","source_notes":""}]'::jsonb
  ) ->> 'code'),
  'INVALID_SUBJECT',
  'T3f subject tidak ditemukan ditolak'
);
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
    '2026-11-01', '2026-11-30', 'csv:uji.csv:1',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000004","metric_key":"reach","value":100,"unit":"akun","source_notes":""}]'::jsonb
  ) ->> 'code'),
  'INVALID_SUBJECT',
  'T3g subject workspace lain ditolak'
);
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
    '2026-11-30', '2026-11-01', 'csv:uji.csv:1',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"reach","value":100,"unit":"akun","source_notes":""}]'::jsonb
  ) ->> 'code'),
  'INVALID_PERIOD',
  'T3h periode terbalik ditolak'
);
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
    '2026-11-01', '2026-11-30', 'csv:uji.csv:0', '[]'::jsonb
  ) ->> 'code'),
  'EMPTY_METRICS',
  'T3i impor tanpa baris metrik ditolak'
);
select _set_user(:'user_b');
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000002',
    '2026-11-01', '2026-11-30', 'csv:uji.csv:1',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000003","metric_key":"reach","value":100,"unit":"akun","source_notes":""}]'::jsonb
  ) ->> 'code'),
  'FORBIDDEN',
  'T3j B (scope Brand A) mengimpor Brand A2 ditolak'
);
select _set_user(:'user_a');
select is(
  ((select count(*) from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000001')
   + (select count(*) from public.content_metrics where workspace_id = 'b7000000-0000-0000-0000-000000000001'))::int,
  7,
  'T3k atomik: 10 impor gagal tidak menambah apa pun (2 snapshot + 5 metrik tetap)'
);

-- ============================================================================
-- TES 4 — RLS baca scope (0021): B (scope [Brand A]) tidak melihat
-- snapshot/metrik brand lain atau multi-brand; A melihat semua. (11)
-- ============================================================================
select _set_user(:'user_b');
select is(
  (select count(*) from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000001')::int,
  2,
  'T4a B melihat 2 snapshot WS-A7 (keduanya Brand A)'
);
select is(
  (select count(*) from public.content_metrics where workspace_id = 'b7000000-0000-0000-0000-000000000001')::int,
  5,
  'T4b B melihat 5 metrik WS-A7 (semuanya Brand A)'
);
-- Impor Brand A2 (oleh A): B tidak boleh melihatnya.
select _set_user(:'user_a');
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000002',
    '2026-11-01', '2026-11-30', 'csv:impor-uji-a2.csv:1',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000003","metric_key":"reach","value":500,"unit":"akun","source_notes":""}]'::jsonb
  ) ->> 'ok'),
  'true',
  'T4c impor Brand A2 (oleh A) lolos'
);
select _set_user(:'user_b');
select is(
  (select count(*) from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000001')::int,
  2,
  'T4d B tetap melihat 2 snapshot (snapshot Brand A2 tersembunyi)'
);
select is(
  (select count(*) from public.content_metrics where workspace_id = 'b7000000-0000-0000-0000-000000000001')::int,
  5,
  'T4e B tetap melihat 5 metrik (metrik Brand A2 tersembunyi)'
);
select _set_user(:'user_a');
select is(
  (select count(*) from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000001')::int,
  3,
  'T4f A (scope NULL) melihat 3 snapshot WS-A7'
);
select is(
  (select count(*) from public.content_metrics where workspace_id = 'b7000000-0000-0000-0000-000000000001')::int,
  6,
  'T4g A melihat 6 metrik WS-A7'
);
-- Impor multi-brand (brand_id NULL, periode Okt): B tidak boleh melihat
-- snapshot-nya, tapi tetap melihat baris metrik Brand A di dalamnya.
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', null,
    '2026-10-01', '2026-10-31', 'csv:impor-multi.csv:2',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"reach","value":3000,"unit":"akun","source_notes":""},{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000003","metric_key":"reach","value":700,"unit":"akun","source_notes":""}]'::jsonb
  ) ->> 'ok'),
  'true',
  'T4h impor multi-brand (oleh A) lolos'
);
select _set_user(:'user_b');
select is(
  (select count(*) from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000001')::int,
  2,
  'T4i B tetap melihat 2 snapshot (snapshot multi-brand tersembunyi — fail-safe)'
);
select is(
  (select count(*) from public.content_metrics where workspace_id = 'b7000000-0000-0000-0000-000000000001')::int,
  6,
  'T4j B melihat 6 metrik (5 lama + 1 baris Brand A dari impor multi-brand)'
);
select _set_user(:'user_a');
select is(
  (select count(*) from public.content_metrics where workspace_id = 'b7000000-0000-0000-0000-000000000001')::int,
  8,
  'T4k A melihat 8 metrik WS-A7 (6 lama + 2 dari impor multi-brand)'
);

-- ============================================================================
-- TES 5 — viewer_client TIDAK melihat analytics sama sekali (v2 §8). (6)
-- Impor Brand B dulu (oleh B, admin WS-B7), lalu A (viewer_client WS-B7)
-- tidak boleh melihat apa pun di WS-B7.
-- ============================================================================
select _set_user(:'user_b');
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000002', 'e7000000-0000-0000-0000-000000000003',
    '2026-11-01', '2026-11-30', 'csv:impor-uji-b.csv:1',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000004","metric_key":"reach","value":200,"unit":"akun","source_notes":""}]'::jsonb
  ) ->> 'ok'),
  'true',
  'T5a impor Brand B (oleh B, admin WS-B7) lolos'
);
select _set_user(:'user_a');
select is(
  (select count(*) from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000002')::int,
  0,
  'T5b A (viewer_client WS-B7) melihat 0 snapshot'
);
select is(
  (select count(*) from public.content_metrics where workspace_id = 'b7000000-0000-0000-0000-000000000002')::int,
  0,
  'T5c A (viewer_client WS-B7) melihat 0 metrik konten'
);
select is(
  (select count(*) from public.campaign_metrics where workspace_id = 'b7000000-0000-0000-0000-000000000002')::int,
  0,
  'T5d A (viewer_client WS-B7) melihat 0 metrik campaign'
);
select is(
  (select count(*) from public.integration_events where workspace_id = 'b7000000-0000-0000-0000-000000000002')::int,
  0,
  'T5e A (viewer_client WS-B7) melihat 0 event integrasi'
);
select _set_user(:'user_b');
select is(
  (select count(*) from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000002')::int,
  1,
  'T5f B (admin WS-B7) melihat 1 snapshot (kontrol)'
);

-- ============================================================================
-- TES 6 — channel_credentials server-only: tolak semua untuk authenticated. (4)
-- ============================================================================
select _set_user(:'user_a');
select throws_ok(
  $$ select count(*) from public.channel_credentials $$,
  '42501',
  'permission denied for table channel_credentials',
  'T6a select channel_credentials sebagai authenticated ditolak 42501 (tanpa grant — server-only)'
);
select throws_ok(
  $$ insert into public.channel_credentials (channel_id, provider, secret_reference) values ('e7100000-0000-0000-0000-000000000001', 'instagram', 'vault://uji/ref-1') $$,
  '42501',
  'permission denied for table channel_credentials',
  'T6b INSERT langsung ke channel_credentials ditolak 42501 (tanpa grant)'
);
reset role;
select lives_ok(
  $$ insert into public.channel_credentials (channel_id, provider, secret_reference) values ('e7100000-0000-0000-0000-000000000001', 'instagram', 'vault://uji/ref-1') $$,
  'T6c INSERT sebagai postgres lolos (server-only: hanya service role)'
);
set local role authenticated;
select _set_user(:'user_a');
select throws_ok(
  $$ select count(*) from public.channel_credentials $$,
  '42501',
  'permission denied for table channel_credentials',
  'T6d baris kredensial tetap tidak bisa dibaca authenticated sesudah insert postgres (42501)'
);

-- ============================================================================
-- TES 7 — connection_status CHECK + capability snapshot blocker. (5)
-- ============================================================================
reset role;
select throws_ok(
  $$ insert into public.social_channels (brand_id, platform, connection_status) values ('e7000000-0000-0000-0000-000000000001', 'instagram', 'connected') $$,
  '23514',
  'new row for relation "social_channels" violates check constraint "social_channels_connection_status_check"',
  'T7a connection_status connected ditolak (hanya not_connected/manual/disabled)'
);
set local role authenticated;
select _set_user(:'user_a');
update public.social_channels
set connection_status = 'disabled',
    capability_snapshot = '{"status":"disabled","adapter":"disabled","blocker":"platform belum dipilih + akses belum tersedia (langkah 7.1/7.3)","source":"manual-only"}'::jsonb,
    capability_checked_at = now()
where id = 'e7100000-0000-0000-0000-000000000001';
select is(
  (select count(*) from public.social_channels where id = 'e7100000-0000-0000-0000-000000000001' and connection_status = 'disabled')::int,
  1,
  'T7b owner bisa menandai channel disabled + snapshot blocker (RLS update)'
);
select is(
  (select capability_snapshot ->> 'status' from public.social_channels where id = 'e7100000-0000-0000-0000-000000000001'),
  'disabled',
  'T7c capability_snapshot berisi status disabled'
);
reset role;
select lives_ok(
  $$ insert into public.social_channels (brand_id, platform, connection_status) values ('e7000000-0000-0000-0000-000000000001', 'instagram', 'disabled') $$,
  'T7d insert channel dengan status disabled lolos (CHECK baru)'
);
set local role authenticated;
select _set_user(:'user_b');
select is(
  (select count(*) from public.social_channels where brand_id = 'e7000000-0000-0000-0000-000000000001')::int,
  2,
  'T7e B melihat 2 channel Brand A (asli + disabled baru)'
);

-- ============================================================================
-- TES 8 — TTL snapshot 24 jam (ASUMSI-7D). (2)
-- ============================================================================
select _set_user(:'user_a');
select is(
  public.analytics_snapshot_is_stale((select id from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000001' order by retrieved_at desc limit 1)),
  false,
  'T8a snapshot baru tidak kedaluwarsa'
);
reset role;
update public.analytics_snapshots
set retrieved_at = now() - interval '25 hours'
where id = (select id from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000001' order by retrieved_at desc limit 1);
set local role authenticated;
select _set_user(:'user_a');
-- (v1.2) T8b memeriksa snapshot yang DITUAKAN: subquery "latest" tidak bisa
-- dipakai lagi — sesudah update, snapshot yang dituakan bukan lagi terbaru.
select is(
  public.analytics_snapshot_is_stale((select id from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000001' and retrieved_at < now() - interval '24 hours' order by retrieved_at desc limit 1)),
  true,
  'T8b snapshot berumur 25 jam kedaluwarsa (TTL 24 jam)'
);

-- ============================================================================
-- TES 9 — backoff integrasi 60/300/900 detik (ASUMSI-7D). (3)
-- ============================================================================
select is(
  public.integration_backoff_seconds(1),
  60,
  'T9a backoff percobaan ke-1 = 60 detik'
);
select is(
  public.integration_backoff_seconds(2),
  300,
  'T9b backoff percobaan ke-2 = 300 detik'
);
select is(
  public.integration_backoff_seconds(5),
  900,
  'T9c backoff percobaan ke-3+ = 900 detik'
);

-- ============================================================================
-- TES 10 — tulis langsung ke tabel analytics ditolak 42501 (grant select
-- saja; tulis hanya lewat RPC — kecuali integration_events INSERT pola
-- actor). (6)
-- ============================================================================
select throws_ok(
  $$ insert into public.metric_definitions (metric_key, label, unit, formula, compatibility_group) values ('reach', 'Reach', 'akun', 'x', 'audiens') $$,
  '42501',
  'permission denied for table metric_definitions',
  'T10a INSERT langsung ke metric_definitions ditolak 42501'
);
select throws_ok(
  $$ insert into public.analytics_snapshots (workspace_id, period_start, period_end, raw_payload_reference) values ('b7000000-0000-0000-0000-000000000001', '2026-11-01', '2026-11-30', 'csv:x.csv:1') $$,
  '42501',
  'permission denied for table analytics_snapshots',
  'T10b INSERT langsung ke analytics_snapshots ditolak 42501'
);
select throws_ok(
  $$ insert into public.content_metrics (snapshot_id, workspace_id, brand_id, subject_type, subject_id, metric_key, value, unit, period_start, period_end) values ('00000000-0000-0000-0000-000000000000', 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'placement', 'c7000000-0000-0000-0000-000000000001', 'reach', 1, 'akun', '2026-11-01', '2026-11-30') $$,
  '42501',
  'permission denied for table content_metrics',
  'T10c INSERT langsung ke content_metrics ditolak 42501'
);
select throws_ok(
  $$ insert into public.campaign_metrics (workspace_id, campaign_id, metric_key, value, unit, aggregation_rule, period_start, period_end) values ('b7000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'reach', 1, 'akun', 'x', '2026-11-01', '2026-11-30') $$,
  '42501',
  'permission denied for table campaign_metrics',
  'T10d INSERT langsung ke campaign_metrics ditolak 42501'
);
select throws_ok(
  $$ update public.content_metrics set value = 0 where workspace_id = 'b7000000-0000-0000-0000-000000000001' $$,
  '42501',
  'permission denied for table content_metrics',
  'T10e UPDATE langsung ke content_metrics ditolak 42501'
);
select throws_ok(
  $$ delete from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000001' $$,
  '42501',
  'permission denied for table analytics_snapshots',
  'T10f DELETE langsung ke analytics_snapshots ditolak 42501'
);

-- ============================================================================
-- TES 11 — CHECK tabel baru (sebagai postgres). (5)
-- ============================================================================
reset role;
select throws_ok(
  $$ insert into public.content_metrics (snapshot_id, workspace_id, brand_id, subject_type, subject_id, metric_key, value, unit, period_start, period_end) values ((select id from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000001' limit 1), 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'placement', 'c7000000-0000-0000-0000-000000000001', 'foobar', 1, 'akun', '2026-11-01', '2026-11-30') $$,
  '23514',
  'new row for relation "content_metrics" violates check constraint "content_metrics_key_check"',
  'T11a metric_key di luar 14 kunci ditolak CHECK'
);
select throws_ok(
  $$ insert into public.content_metrics (snapshot_id, workspace_id, brand_id, subject_type, subject_id, metric_key, value, unit, period_start, period_end) values ((select id from public.analytics_snapshots where workspace_id = 'b7000000-0000-0000-0000-000000000001' limit 1), 'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'placement', 'c7000000-0000-0000-0000-000000000001', 'reach', -1, 'akun', '2026-11-01', '2026-11-30') $$,
  '23514',
  'new row for relation "content_metrics" violates check constraint "content_metrics_value_check"',
  'T11b nilai negatif ditolak CHECK'
);
select throws_ok(
  $$ insert into public.analytics_snapshots (workspace_id, period_start, period_end, raw_payload_reference) values ('b7000000-0000-0000-0000-000000000001', '2026-11-30', '2026-11-01', 'csv:x.csv:1') $$,
  '23514',
  'new row for relation "analytics_snapshots" violates check constraint "analytics_snapshots_period_check"',
  'T11c periode terbalik ditolak CHECK'
);
select throws_ok(
  $$ insert into public.integration_events (workspace_id, event_type, actor_user_id) values ('b7000000-0000-0000-0000-000000000001', 'bogus_event', 'a7000000-0000-0000-0000-000000000001') $$,
  '23514',
  'new row for relation "integration_events" violates check constraint "integration_events_type_check"',
  'T11d event_type di luar daftar ditolak CHECK'
);
select throws_ok(
  $$ insert into public.channel_credentials (channel_id, provider, secret_reference) values ('e7100000-0000-0000-0000-000000000001', 'bogus', 'vault://uji/ref-2') $$,
  '23514',
  'new row for relation "channel_credentials" violates check constraint "channel_credentials_provider_check"',
  'T11e provider di luar daftar ditolak CHECK'
);

-- ============================================================================
-- TES 12 — integration_events INSERT pola actor (activity_logs 0004). (3)
-- ============================================================================
set local role authenticated;
select _set_user(:'user_a');
select lives_ok(
  $$ insert into public.integration_events (workspace_id, event_type, actor_user_id) values ('b7000000-0000-0000-0000-000000000001', 'capability_checked', auth.uid()) $$,
  'T12a INSERT event dengan actor = pemanggil lolos'
);
select throws_ok(
  $$ insert into public.integration_events (workspace_id, event_type, actor_user_id) values ('b7000000-0000-0000-0000-000000000001', 'capability_checked', (select user_id from public.workspace_members where workspace_id = 'b7000000-0000-0000-0000-000000000001' and workspace_role = 'manager' limit 1)) $$,
  '42501',
  'new row violates row-level security policy for table "integration_events"',
  'T12b INSERT event dengan actor orang lain ditolak RLS'
);
select throws_ok(
  $$ update public.integration_events set detail = '{}'::jsonb where workspace_id = 'b7000000-0000-0000-0000-000000000001' $$,
  '42501',
  'permission denied for table integration_events',
  'T12c UPDATE event ditolak 42501 (append-only)'
);

-- ============================================================================
-- TES 13 — impor ulang slice yang sama menimpa nilai lama (latest wins). (4)
-- ============================================================================
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
    '2026-11-01', '2026-11-30', 'csv:impor-koreksi.csv:1',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"reach","value":1500,"unit":"akun","source_notes":"koreksi"}]'::jsonb
  ) ->> 'ok'),
  'true',
  'T13a impor ulang slice yang sama lolos (bukan duplikat lintas snapshot)'
);
select is(
  (select value::text from public.campaign_metrics where campaign_id = 'f7000000-0000-0000-0000-000000000001' and metric_key = 'reach' and period_start = '2026-11-01' and period_end = '2026-11-30'),
  '1500',
  'T13b agregat campaign reach = 1500 (snapshot terbaru menang)'
);
select is(
  (select value::text from public.campaign_metrics where campaign_id = 'f7000000-0000-0000-0000-000000000001' and metric_key = 'engagement_rate' and period_start = '2026-11-01' and period_end = '2026-11-30'),
  '8.0000',
  'T13c agregat campaign engagement_rate = 120/1500x100 = 8.0000 (dihitung ulang)'
);
select is(
  (select count(*) from public.content_metrics where subject_type = 'placement' and subject_id = 'c7000000-0000-0000-0000-000000000001' and metric_key = 'reach' and period_start = '2026-11-01')::int,
  3,
  'T13d tiga baris reach tersimpan (T2a + T2b + koreksi); agregasi memakai yang terbaru'
);

-- ============================================================================
-- TES 14 — agregat campaign multi-subject (impressions menyusul). (3)
-- ============================================================================
select is(
  (public.import_analytics_snapshot(
    'b7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001',
    '2026-11-01', '2026-11-30', 'csv:impor-impr.csv:1',
    '[{"subject_type":"placement","subject_id":"c7000000-0000-0000-0000-000000000001","metric_key":"impressions","value":3000,"unit":"tayangan","source_notes":""}]'::jsonb
  ) ->> 'ok'),
  'true',
  'T14a impor impressions menyusul lolos'
);
select is(
  (select value::text from public.campaign_metrics where campaign_id = 'f7000000-0000-0000-0000-000000000001' and metric_key = 'impressions' and period_start = '2026-11-01' and period_end = '2026-11-30'),
  '3000',
  'T14b agregat campaign impressions = 3000'
);
select is(
  (select count(*) from public.campaign_metrics where campaign_id = 'f7000000-0000-0000-0000-000000000001')::int,
  5,
  'T14c lima baris campaign_metrics (reach, impressions, engagements, likes, engagement_rate)'
);
-- Cleanup HARUS sebagai postgres (reset role): authenticated TIDAK PUNYA
-- grant apa pun atas channel_credentials (server-only) — DELETE cleanup
-- sebagai authenticated abort 42501 sebelum finish() (pelajaran 39,
-- pgTAP 07 Run 5 v1.3). Di v1.1 cleanup berjalan sebagai postgres karena
-- T12a belum menegaskan ulang role authenticated.
reset role;

-- ---------------------------------------------------------------------------
-- Cleanup defensif (rollback di akhir membersihkan semuanya; delete di sini
-- hanya pengaman bila file dijalankan tanpa transaksi).
-- Urutan WAJIB daun → akar (pelajaran 06 v1.0): brands TIDAK BOLEH dihapus
-- sebelum content_items (brand_id ON DELETE RESTRICT). metric_definitions
-- katalog global (seed migrasi) TIDAK dihapus.
-- ---------------------------------------------------------------------------
delete from public.channel_credentials where channel_id in
  (select id from public.social_channels where brand_id in
  (select id from public.brands where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002')));
delete from public.content_metrics where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
delete from public.campaign_metrics where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
delete from public.integration_events where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
delete from public.analytics_snapshots where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
delete from public.published_posts where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
delete from public.content_placements where content_item_id in
  (select id from public.content_items where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002'));
delete from public.campaign_brands where campaign_id in
  (select id from public.campaigns where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002'));
delete from public.campaigns where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
delete from public.content_items where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
delete from public.social_channels where brand_id in
  (select id from public.brands where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002'));
delete from public.brands where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
update public.brief_templates set is_default = false where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
delete from public.brief_templates where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
delete from public.workspace_settings where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
delete from public.workspace_members where workspace_id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
delete from public.workspaces where id in
  ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
delete from public.organization_members where organization_id in
  ('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000002');
delete from public.organizations where id in
  ('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000002');
drop function if exists _set_user(uuid, text);
drop function if exists _as_anon();

select * from finish();
rollback;
