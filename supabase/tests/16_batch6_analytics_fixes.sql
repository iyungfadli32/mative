-- pgTAP Batch 6: perbaikan analitik F-2/F-3/F-4 (migrasi 0032).
-- Jalankan: psql "$DATABASE_URL" -f supabase/tests/16_batch6_analytics_fixes.sql
-- (database TEST, bukan produksi; semua di dalam transaksi + rollback.)
begin;
select plan(24);

-- user_a: diambil dari database (pemilik seed org), BUKAN hardcode.
-- UUID akun uji di file 15 (094e8752-ee4f-...) ternyata salah ketik
-- untuk live: yang benar 094e8752-eef4-... (karakter ke-12/13
-- tertukar, 'ee4f' vs 'eef4'). gset membaca UUID yang benar
-- langsung dari auth.users, jadi tes ini jalan di live maupun di DB tes.
select owner_user_id as user_a from public.organizations where slug = 'contoh-studio-sample' \gset

create or replace function _set_user(p_user uuid, p_email text default 'test@example.com')
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'email', p_email)::text, true);
$$;

-- Helper F-4: coba insert langsung ke content_metrics; true bila berhasil,
-- false bila ditolak CHECK (value). Exception ditangkap di dalam fungsi
-- (subtransaksi) sehingga transaksi pgTAP tidak batal.
create or replace function _try_insert_content_metric(
  p_snapshot uuid, p_ws uuid, p_brand uuid, p_subject_type text,
  p_subject_id uuid, p_key text, p_value numeric, p_unit text,
  p_start date, p_end date
) returns boolean language plpgsql as $$
begin
  insert into public.content_metrics
    (snapshot_id, workspace_id, brand_id, subject_type, subject_id, metric_key, value, unit, period_start, period_end)
  values
    (p_snapshot, p_ws, p_brand, p_subject_type, p_subject_id, p_key, p_value, p_unit, p_start, p_end);
  return true;
exception when check_violation then
  return false;
end $$;

create or replace function _try_insert_campaign_metric(
  p_snapshot uuid, p_ws uuid, p_campaign uuid, p_key text, p_value numeric,
  p_unit text, p_start date, p_end date
) returns boolean language plpgsql as $$
begin
  insert into public.campaign_metrics
    (snapshot_id, workspace_id, campaign_id, metric_key, value, unit, aggregation_rule, period_start, period_end)
  values
    (p_snapshot, p_ws, p_campaign, p_key, p_value, p_unit, 'sum', p_start, p_end);
  return true;
exception when check_violation then
  return false;
end $$;

-- Helper RPC: impor satu periode untuk workspace + brand fixture.
create or replace function _import(p_start date, p_end date, p_ref text, p_metrics jsonb)
returns jsonb language sql as $$
  select public.import_analytics_snapshot(
    'b6000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000001',
    p_start, p_end, p_ref, p_metrics);
$$;

-- Fixture (postgres, bypass RLS). UUID prefix 6 = Batch 6.
insert into public.organizations (id, name, slug, owner_user_id) values
  ('a6000000-0000-0000-0000-000000000001', 'Org Batch6', 'org-batch6-test', :'user_a')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, organization_role, membership_status, joined_at) values
  ('a6000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now())
on conflict do nothing;

insert into public.workspaces (id, organization_id, name, slug, timezone) values
  ('b6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'WS Batch6', 'ws-batch6-test', 'Asia/Jakarta')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at) values
  ('b6000000-0000-0000-0000-000000000001', :'user_a', 'owner', 'active', now())
on conflict do nothing;

insert into public.brands (id, workspace_id, name, slug, status) values
  ('e6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'Brand Batch6', 'brand-batch6', 'active')
on conflict (id) do nothing;

insert into public.social_channels (id, brand_id, platform) values
  ('f6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'instagram')
on conflict (id) do nothing;

insert into public.campaigns (id, workspace_id, name) values
  ('86000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'Kampanye Batch6 K1'),
  ('86000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000001', 'Kampanye Batch6 K2'),
  ('86000000-0000-0000-0000-000000000003', 'b6000000-0000-0000-0000-000000000001', 'Kampanye Batch6 K3')
on conflict (id) do nothing;

insert into public.campaign_brands (campaign_id, brand_id) values
  ('86000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001'),
  ('86000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000001'),
  ('86000000-0000-0000-0000-000000000003', 'e6000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.content_items (id, workspace_id, brand_id, title, production_status, owner_user_id, timezone, campaign_id) values
  ('d6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'Item Batch6 C1', 'approved', :'user_a', 'Asia/Jakarta', '86000000-0000-0000-0000-000000000001'),
  ('d6000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'Item Batch6 C2', 'approved', :'user_a', 'Asia/Jakarta', '86000000-0000-0000-0000-000000000002'),
  ('d6000000-0000-0000-0000-000000000003', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'Item Batch6 C3', 'approved', :'user_a', 'Asia/Jakarta', '86000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into public.content_placements (id, content_item_id, social_channel_id) values
  ('c6000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000001'),
  ('c6000000-0000-0000-0000-000000000002', 'd6000000-0000-0000-0000-000000000002', 'f6000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.published_posts (id, workspace_id, placement_id, canonical_url, published_at) values
  ('96000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', 'https://example.invalid/batch6-pp1', '2026-11-05 10:00:00+07')
on conflict (id) do nothing;

-- Snapshot khusus Oktober untuk tes CHECK langsung (periode tidak
-- bersinggungan dengan periode RPC Nov/Des/Jan, supaya baris CHECK tidak
-- memengaruhi asersi F-2/F-3).
insert into public.analytics_snapshots (id, workspace_id, brand_id, source, period_start, period_end, raw_payload_reference) values
  ('56000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 'manual', '2026-10-01', '2026-10-31', 'pgTAP-16-fixture-okt')
on conflict (id) do nothing;

-- ============ F-4: CHECK langsung (sebagai postgres) ============
select is(_try_insert_content_metric(
  '56000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001',
  'e6000000-0000-0000-0000-000000000001', 'content_item', 'd6000000-0000-0000-0000-000000000003',
  'followers_net_change', -5, 'akun', '2026-10-01', '2026-10-31'),
  true, 'F-4.6 CHECK: followers_net_change -5 langsung lolos');
select is(_try_insert_content_metric(
  '56000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001',
  'e6000000-0000-0000-0000-000000000001', 'content_item', 'd6000000-0000-0000-0000-000000000003',
  'reach', -5, 'akun', '2026-10-01', '2026-10-31'),
  false, 'F-4.7 CHECK: reach -5 langsung ditolak');
select is(_try_insert_content_metric(
  '56000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001',
  'e6000000-0000-0000-0000-000000000001', 'content_item', 'd6000000-0000-0000-0000-000000000003',
  'reach', 100, 'akun', '2026-10-01', '2026-10-31'),
  true, 'F-4.8 CHECK: reach 100 langsung lolos');
select is(_try_insert_campaign_metric(
  '56000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000003', 'followers_net_change', -5, 'akun', '2026-10-01', '2026-10-31'),
  true, 'F-4.9 CHECK: campaign followers_net_change -5 langsung lolos');
select is(_try_insert_campaign_metric(
  '56000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000003', 'reach', -5, 'akun', '2026-10-01', '2026-10-31'),
  false, 'F-4.10 CHECK: campaign reach -5 langsung ditolak');
select is(_try_insert_campaign_metric(
  '56000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000003', 'reach', 100, 'akun', '2026-10-01', '2026-10-31'),
  true, 'F-4.11 CHECK: campaign reach 100 langsung lolos');

-- ============ F-2 / F-3 / F-4: RPC import_analytics_snapshot ============
set local role authenticated;
select _set_user(:'user_a');

-- F-2.1 impor pertama berhasil.
select is((_import('2026-11-01', '2026-11-30', 'pgTAP-16-F21',
  '[{"subject_type":"content_item","subject_id":"d6000000-0000-0000-0000-000000000001","metric_key":"reach","value":"1000","unit":"akun"}]'::jsonb) ->> 'ok'),
  'true', 'F-2.1 impor pertama C1 reach Nov berhasil');

-- F-2.2 periode tumpang-tindih sebagian ditolak.
select is((_import('2026-11-15', '2026-12-15', 'pgTAP-16-F22',
  '[{"subject_type":"content_item","subject_id":"d6000000-0000-0000-0000-000000000001","metric_key":"reach","value":"500","unit":"akun"}]'::jsonb) ->> 'code'),
  'OVERLAP_PERIOD', 'F-2.2 impor C1 reach 15 Nov-15 Des ditolak OVERLAP_PERIOD');

-- F-2.3 impor ulang periode SAMA PERSIS diizinkan (menimpa, ASUMSI-7E).
select is((_import('2026-11-01', '2026-11-30', 'pgTAP-16-F23',
  '[{"subject_type":"content_item","subject_id":"d6000000-0000-0000-0000-000000000001","metric_key":"reach","value":"1200","unit":"akun"}]'::jsonb) ->> 'ok'),
  'true', 'F-2.3 impor ulang C1 reach Nov (periode sama persis) berhasil');

-- F-2.4 nilai terbaru yang menang.
select is((select value::text from public.content_metrics cm
  join public.analytics_snapshots s on s.id = cm.snapshot_id
  where cm.subject_type = 'content_item' and cm.subject_id = 'd6000000-0000-0000-0000-000000000001'
    and cm.metric_key = 'reach' and s.period_start = '2026-11-01' and s.period_end = '2026-11-30'
  order by s.retrieved_at desc limit 1),
  '1200', 'F-2.4 impor ulang menimpa: nilai terbaru C1 reach Nov = 1200');

-- F-2.5 periode tidak tumpang-tindih diizinkan.
select is((_import('2026-12-01', '2026-12-31', 'pgTAP-16-F25',
  '[{"subject_type":"content_item","subject_id":"d6000000-0000-0000-0000-000000000001","metric_key":"reach","value":"700","unit":"akun"}]'::jsonb) ->> 'ok'),
  'true', 'F-2.5 impor C1 reach Des (tidak tumpang-tindih) berhasil');

-- F-2.6 subjek berbeda, periode sama, diizinkan.
select is((_import('2026-11-01', '2026-11-30', 'pgTAP-16-F26',
  '[{"subject_type":"content_item","subject_id":"d6000000-0000-0000-0000-000000000002","metric_key":"reach","value":"800","unit":"akun"}]'::jsonb) ->> 'ok'),
  'true', 'F-2.6 impor C2 reach Nov (subjek berbeda) berhasil');

-- F-2.7 metrik berbeda, subjek + periode sama, diizinkan.
select is((_import('2026-11-01', '2026-11-30', 'pgTAP-16-F27',
  '[{"subject_type":"content_item","subject_id":"d6000000-0000-0000-0000-000000000001","metric_key":"engagements","value":"90","unit":"interaksi"}]'::jsonb) ->> 'ok'),
  'true', 'F-2.7 impor C1 engagements Nov (metrik berbeda) berhasil');

-- F-3.1 metrik sama di level placement ditolak.
select is((_import('2026-11-01', '2026-11-30', 'pgTAP-16-F31',
  '[{"subject_type":"placement","subject_id":"c6000000-0000-0000-0000-000000000001","metric_key":"reach","value":"400","unit":"akun"}]'::jsonb) ->> 'code'),
  'CROSS_LEVEL_METRIC', 'F-3.1 impor P1 reach Nov ditolak CROSS_LEVEL_METRIC');

-- F-3.2 metrik sama di level published_post ditolak.
select is((_import('2026-11-01', '2026-11-30', 'pgTAP-16-F32',
  '[{"subject_type":"published_post","subject_id":"96000000-0000-0000-0000-000000000001","metric_key":"reach","value":"400","unit":"akun"}]'::jsonb) ->> 'code'),
  'CROSS_LEVEL_METRIC', 'F-3.2 impor PP1 reach Nov ditolak CROSS_LEVEL_METRIC');

-- F-3.3 metrik sama di dua level dalam SATU file ditolak.
select is((_import('2026-12-01', '2026-12-31', 'pgTAP-16-F33',
  '[{"subject_type":"content_item","subject_id":"d6000000-0000-0000-0000-000000000002","metric_key":"engagements","value":"50","unit":"interaksi"},{"subject_type":"placement","subject_id":"c6000000-0000-0000-0000-000000000002","metric_key":"engagements","value":"50","unit":"interaksi"}]'::jsonb) ->> 'code'),
  'CROSS_LEVEL_METRIC', 'F-3.3 impor C2+P2 engagements Des dalam satu file ditolak CROSS_LEVEL_METRIC');

-- F-3.3b impor yang ditolak tidak menulis apa pun.
select is((select count(*) from public.content_metrics cm
  join public.analytics_snapshots s on s.id = cm.snapshot_id
  where cm.subject_id = 'd6000000-0000-0000-0000-000000000002'
    and cm.metric_key = 'engagements' and s.period_start = '2026-12-01'),
  0::bigint, 'F-3.3b impor lintas level yang ditolak tidak menulis baris engagements Des');

-- F-3.4 level berbeda di periode yang TIDAK tumpang-tindih diizinkan.
select is((_import('2027-01-01', '2027-01-31', 'pgTAP-16-F34',
  '[{"subject_type":"placement","subject_id":"c6000000-0000-0000-0000-000000000001","metric_key":"reach","value":"300","unit":"akun"}]'::jsonb) ->> 'ok'),
  'true', 'F-3.4 impor P1 reach Jan 2027 (periode tidak tumpang-tindih) berhasil');

-- F-4.1 followers_net_change negatif via RPC diizinkan.
select is((_import('2026-11-01', '2026-11-30', 'pgTAP-16-F41',
  '[{"subject_type":"content_item","subject_id":"d6000000-0000-0000-0000-000000000002","metric_key":"followers_net_change","value":"-5","unit":"akun"}]'::jsonb) ->> 'ok'),
  'true', 'F-4.1 impor C2 followers_net_change -5 Nov berhasil');

-- F-4.2 nilai negatif tersimpan.
select is((select value::text from public.content_metrics cm
  join public.analytics_snapshots s on s.id = cm.snapshot_id
  where cm.subject_type = 'content_item' and cm.subject_id = 'd6000000-0000-0000-0000-000000000002'
    and cm.metric_key = 'followers_net_change' and s.period_start = '2026-11-01'),
  '-5', 'F-4.2 followers_net_change -5 tersimpan di content_metrics');

-- F-4.5 agregat campaign ikut negatif.
select is((select value::text from public.campaign_metrics
  where campaign_id = '86000000-0000-0000-0000-000000000002'
    and metric_key = 'followers_net_change'
    and period_start = '2026-11-01' and period_end = '2026-11-30'),
  '-5', 'F-4.5 agregat campaign K2 followers_net_change Nov = -5');

-- F-4.3 followers_net_change desimal negatif di periode lain diizinkan.
select is((_import('2026-12-01', '2026-12-31', 'pgTAP-16-F43',
  '[{"subject_type":"content_item","subject_id":"d6000000-0000-0000-0000-000000000002","metric_key":"followers_net_change","value":"-5.5","unit":"akun"}]'::jsonb) ->> 'ok'),
  'true', 'F-4.3 impor C2 followers_net_change -5.5 Des berhasil');

-- F-4.5b agregat campaign Des ikut negatif.
select is((select value::text from public.campaign_metrics
  where campaign_id = '86000000-0000-0000-0000-000000000002'
    and metric_key = 'followers_net_change'
    and period_start = '2026-12-01' and period_end = '2026-12-31'),
  '-5.5', 'F-4.5b agregat campaign K2 followers_net_change Des = -5.5');

-- F-4.4 metrik lain tetap menolak negatif.
select is((_import('2027-01-01', '2027-01-31', 'pgTAP-16-F44',
  '[{"subject_type":"content_item","subject_id":"d6000000-0000-0000-0000-000000000002","metric_key":"reach","value":"-5","unit":"akun"}]'::jsonb) ->> 'code'),
  'INVALID_ROW', 'F-4.4 impor C2 reach -5 Jan 2027 ditolak INVALID_ROW');

select * from finish();
rollback;
