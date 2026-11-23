-- 0032_batch6_analytics_fixes.sql
-- Batch 6 (analitik): perbaikan F-2, F-3, F-4 (skema + RPC impor).
--
-- F-2: impor dengan periode yang tumpang-tindih untuk subjek + metrik yang sama
--   sekarang ditolak RPC (kode OVERLAP_PERIOD). Impor ulang periode yang SAMA
--   PERSIS tetap diizinkan (menimpa lewat agregasi snapshot-terbaru).
-- F-3: metrik yang sama untuk konten yang sama di level lain (content_item /
--   placement / published_post) sekarang ditolak RPC (kode CROSS_LEVEL_METRIC),
--   baik terhadap impor sebelumnya maupun terhadap baris lain di file yang sama.
-- F-4: followers_net_change boleh negatif; metrik lain tetap tidak boleh negatif.
--   CHECK di content_metrics dan campaign_metrics dilonggarkan hanya untuk kunci
--   itu, dan regex nilai di RPC mengizinkan tanda minus hanya untuk kunci itu.
--
-- F-1, F-5, F-6 diperbaiki di kode aplikasi (queries, halaman laporan, export,
--   komponen dashboard/laporan) dan tidak butuh perubahan skema - lihat commit.
--
-- Idempotent: CHECK di-drop lalu dibuat ulang dengan nama yang sama; fungsi RPC
-- ditulis ulang utuh (disalin dari 0021 dengan edit bertarget, lihat bawah).

-- F-4: longgarkan CHECK nilai agar followers_net_change boleh negatif.
-- Negatif tetap dilarang untuk semua metrik lain (syarat OR di bawah).
alter table public.content_metrics
  drop constraint if exists content_metrics_value_check;
alter table public.content_metrics
  add constraint content_metrics_value_check
  check (value >= 0 or metric_key = 'followers_net_change');

alter table public.campaign_metrics
  drop constraint if exists campaign_metrics_value_check;
alter table public.campaign_metrics
  add constraint campaign_metrics_value_check
  check (value >= 0 or metric_key = 'followers_net_change');

-- F-2/F-3/F-4: tulis ulang public.import_analytics_snapshot (disalin dari 0021).
create or replace function public.import_analytics_snapshot(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_period_start date,
  p_period_end date,
  p_raw_reference text,
  p_metrics jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot_id uuid;
  v_row jsonb;
  v_row_no int := 0;
  v_subject_type text;
  v_subject_id_text text;
  v_subject_id uuid;
  v_subject_brand uuid;
  v_subject_workspace uuid;
  v_subject_campaign uuid;
  v_metric_key text;
  v_value_text text;
  v_value numeric;
  v_unit text;
  v_unit_expected text;
  v_is_derived boolean;
  v_notes text;
  v_seen text[] := '{}';
  v_dup_key text;
  v_clean jsonb := '[]'::jsonb;
  v_inserted int := 0;
  v_campaign_id uuid;
  v_campaign_brand uuid;
  v_eng_sum numeric;
  v_reach_sum numeric;
  v_campaigns int := 0;
  -- 0032: tumpang-tindih periode (F-2) + level lain (F-3).
  v_root_item_id uuid;
  v_old_start date;
  v_old_end date;
  v_x_level text;
  v_x_start date;
  v_x_end date;
begin
  -- (0) Auth + peran impor (owner/admin/manager/strategist/analyst) + scope.
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Belum masuk.');
  end if;
  if not public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist', 'analyst']) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Bukan member workspace ini atau peran tidak boleh mengimpor.');
  end if;
  if p_brand_id is not null and not public.brand_in_scope(p_brand_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Brand di luar scope Anda.');
  end if;
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PERIOD', 'message', 'Periode tidak valid: period_start harus <= period_end.');
  end if;
  if p_raw_reference is null or btrim(p_raw_reference) = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE', 'message', 'Referensi file wajib diisi.');
  end if;
  if p_metrics is null or jsonb_typeof(p_metrics) <> 'array' or jsonb_array_length(p_metrics) = 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY_METRICS', 'message', 'Tidak ada baris metrik.');
  end if;

  -- (1) Validasi SEMUA baris dulu (tanpa tulis apa pun) — impor atomik.
  for v_row in select * from jsonb_array_elements(p_metrics) loop
    v_row_no := v_row_no + 1;
    v_subject_type := v_row ->> 'subject_type';
    v_subject_id_text := v_row ->> 'subject_id';
    v_metric_key := v_row ->> 'metric_key';
    v_value_text := v_row ->> 'value';
    v_unit := nullif(btrim(coalesce(v_row ->> 'unit', '')), '');
    v_notes := coalesce(v_row ->> 'source_notes', '');

    if v_subject_type is null or v_subject_type not in ('placement', 'content_item', 'published_post') then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ROW', 'message', format('Baris %s: subject_type harus placement/content_item/published_post.', v_row_no));
    end if;
    if v_subject_id_text is null or v_subject_id_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ROW', 'message', format('Baris %s: subject_id bukan UUID yang valid.', v_row_no));
    end if;
    v_subject_id := v_subject_id_text::uuid;

    -- Subject harus ada di workspace ini + brand dalam scope (atau = p_brand_id).
    v_subject_brand := null; v_subject_workspace := null; v_subject_campaign := null;
    if v_subject_type = 'placement' then
      select ci.workspace_id, ci.brand_id, ci.campaign_id, ci.id into v_subject_workspace, v_subject_brand, v_subject_campaign, v_root_item_id
      from public.content_placements pl join public.content_items ci on ci.id = pl.content_item_id
      where pl.id = v_subject_id;
    elsif v_subject_type = 'content_item' then
      select workspace_id, brand_id, campaign_id, id into v_subject_workspace, v_subject_brand, v_subject_campaign, v_root_item_id
      from public.content_items where id = v_subject_id;
    else
      select ci.workspace_id, ci.brand_id, ci.campaign_id, ci.id into v_subject_workspace, v_subject_brand, v_subject_campaign, v_root_item_id
      from public.published_posts pp
      join public.content_placements pl on pl.id = pp.placement_id
      join public.content_items ci on ci.id = pl.content_item_id
      where pp.id = v_subject_id;
    end if;
    if v_subject_workspace is null then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SUBJECT', 'message', format('Baris %s: subject tidak ditemukan.', v_row_no));
    end if;
    if v_subject_workspace <> p_workspace_id then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SUBJECT', 'message', format('Baris %s: subject bukan milik workspace ini.', v_row_no));
    end if;
    if p_brand_id is not null and v_subject_brand <> p_brand_id then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', format('Baris %s: subject bukan brand impor ini.', v_row_no));
    end if;
    if p_brand_id is null and not public.brand_in_scope(v_subject_brand) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', format('Baris %s: brand subject di luar scope Anda.', v_row_no));
    end if;

    -- Kunci metrik: harus ada di katalog + bukan turunan.
    if v_metric_key is null then
      return jsonb_build_object('ok', false, 'code', 'INVALID_METRIC', 'message', format('Baris %s: metric_key wajib diisi.', v_row_no));
    end if;
    select unit, is_derived into v_unit_expected, v_is_derived
    from public.metric_definitions
    where workspace_id is null and source_platform = 'manual' and metric_key = v_metric_key;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'INVALID_METRIC', 'message', format('Baris %s: metric_key ''%s'' tidak dikenal.', v_row_no, v_metric_key));
    end if;
    if v_is_derived then
      return jsonb_build_object('ok', false, 'code', 'INVALID_METRIC', 'message', format('Baris %s: metric_key ''%s'' adalah metrik turunan (dihitung, bukan diimpor).', v_row_no, v_metric_key));
    end if;
    if v_unit is null or v_unit <> v_unit_expected then
      return jsonb_build_object('ok', false, 'code', 'INVALID_UNIT', 'message', format('Baris %s: unit harus ''%s'' untuk kunci ''%s''.', v_row_no, v_unit_expected, v_metric_key));
    end if;

    -- Nilai: angka >= 0, KECUALI followers_net_change yang boleh negatif (0032/F-4).
    if v_value_text is null
      or v_value_text !~ (case when v_metric_key = 'followers_net_change'
        then '^-?[0-9]+(\.[0-9]+)?$' else '^[0-9]+(\.[0-9]+)?$' end) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ROW', 'message', format('Baris %s: value harus angka >= 0 (followers_net_change boleh negatif).', v_row_no));
    end if;
    v_value := v_value_text::numeric;

    -- Duplikat dalam file yang sama.
    v_dup_key := v_subject_type || '|' || v_subject_id_text || '|' || v_metric_key;
    if v_dup_key = any (v_seen) then
      return jsonb_build_object('ok', false, 'code', 'DUPLICATE_METRIC', 'message', format('Baris %s: duplikat (subject + metric_key) dalam file yang sama.', v_row_no));
    end if;
    v_seen := v_seen || v_dup_key;

    -- (0032/F-2) Tolak periode impor yang tumpang-tindih untuk subjek +
    -- metrik yang sama. Impor ulang periode yang SAMA PERSIS tetap diizinkan
    -- (menimpa lewat agregasi snapshot-terbaru, ASUMSI-7E); yang ditolak
    -- adalah periode yang tumpang-tindih sebagian - nilainya akan dijumlah
    -- ganda di KPI dan agregat campaign.
    select s.period_start, s.period_end into v_old_start, v_old_end
      from public.content_metrics cm
      join public.analytics_snapshots s on s.id = cm.snapshot_id
     where s.workspace_id = p_workspace_id
       and cm.subject_type = v_subject_type
       and cm.subject_id = v_subject_id
       and cm.metric_key = v_metric_key
       and s.period_start <= p_period_end
       and s.period_end >= p_period_start
       and not (s.period_start = p_period_start and s.period_end = p_period_end)
     limit 1;
    if found then
      return jsonb_build_object('ok', false, 'code', 'OVERLAP_PERIOD', 'message',
        format('Baris %s: periode %s s.d. %s tumpang-tindih dengan impor %s s.d. %s untuk subjek dan metrik yang sama. Pakai periode yang sama persis (impor ulang) atau periode yang tidak tumpang-tindih.',
          v_row_no, p_period_start, p_period_end, v_old_start, v_old_end));
    end if;

    -- (0032/F-3) Tolak metrik yang sama untuk konten yang sama di level
    -- lain (content_item / placement / published_post): tanpa ini nilai yang
    -- sama dijumlah sampai 3x di agregat campaign dan KPI. Dicek terhadap
    -- impor sebelumnya (DB) dan terhadap baris lain di file yang sama.
    select cm.subject_type, s.period_start, s.period_end into v_x_level, v_x_start, v_x_end
      from public.content_metrics cm
      join public.analytics_snapshots s on s.id = cm.snapshot_id
      left join public.content_placements cp1
        on cm.subject_type = 'placement' and cm.subject_id = cp1.id
      left join public.published_posts pp1
        on cm.subject_type = 'published_post' and cm.subject_id = pp1.id
      left join public.content_placements cp2 on pp1.placement_id = cp2.id
     where s.workspace_id = p_workspace_id
       and cm.metric_key = v_metric_key
       and cm.subject_type <> v_subject_type
       and case cm.subject_type
             when 'content_item' then cm.subject_id
             when 'placement' then cp1.content_item_id
             when 'published_post' then cp2.content_item_id
           end = v_root_item_id
       and s.period_start <= p_period_end
       and s.period_end >= p_period_start
     limit 1;
    if found then
      return jsonb_build_object('ok', false, 'code', 'CROSS_LEVEL_METRIC', 'message',
        format('Baris %s: metrik %s untuk konten yang sama sudah ada di level %s (periode %s s.d. %s). Impor metrik yang sama hanya di satu level agar tidak dihitung ganda.',
          v_row_no, v_metric_key, v_x_level, v_x_start, v_x_end));
    end if;
    select (e->>'subject_type') into v_x_level
      from jsonb_array_elements(v_clean) as e
      left join public.content_placements cp1
        on (e->>'subject_type') = 'placement' and (e->>'subject_id')::uuid = cp1.id
      left join public.published_posts pp1
        on (e->>'subject_type') = 'published_post' and (e->>'subject_id')::uuid = pp1.id
      left join public.content_placements cp2 on pp1.placement_id = cp2.id
     where (e->>'metric_key') = v_metric_key
       and (e->>'subject_type') <> v_subject_type
       and case (e->>'subject_type')
             when 'content_item' then (e->>'subject_id')::uuid
             when 'placement' then cp1.content_item_id
             when 'published_post' then cp2.content_item_id
           end = v_root_item_id
     limit 1;
    if found then
      return jsonb_build_object('ok', false, 'code', 'CROSS_LEVEL_METRIC', 'message',
        format('Baris %s: metrik %s untuk konten yang sama sudah ada di level %s dalam file yang sama. Impor metrik yang sama hanya di satu level agar tidak dihitung ganda.',
          v_row_no, v_metric_key, v_x_level));
    end if;


    v_clean := v_clean || jsonb_build_object(
      'subject_type', v_subject_type, 'subject_id', v_subject_id_text,
      'brand_id', v_subject_brand::text, 'campaign_id', v_subject_campaign::text,
      'metric_key', v_metric_key, 'value', v_value_text, 'unit', v_unit, 'source_notes', v_notes
    );
  end loop;

  -- (2) Tulis: snapshot + metrik (satu transaksi).
  -- retrieved_at memakai clock_timestamp() (bukan now()): waktu ambil yang
  -- sebenarnya — penting karena DISTINCT ON agregat campaign mengurutkan
  -- snapshot terbaru; now() = awal transaksi sehingga dua impor dalam satu
  -- transaksi (mis. pgTAP begin...rollback) mendapat retrieved_at yang sama.
  insert into public.analytics_snapshots
    (workspace_id, brand_id, source, period_start, period_end, retrieved_at, raw_payload_reference, imported_by, created_by)
  values
    (p_workspace_id, p_brand_id, 'manual', p_period_start, p_period_end, clock_timestamp(), btrim(p_raw_reference), auth.uid(), auth.uid())
  returning id into v_snapshot_id;

  for v_row in select * from jsonb_array_elements(v_clean) loop
    insert into public.content_metrics
      (snapshot_id, workspace_id, brand_id, subject_type, subject_id, metric_key, value, unit, source, source_notes, period_start, period_end, created_by)
    values
      (v_snapshot_id, p_workspace_id, (v_row ->> 'brand_id')::uuid, v_row ->> 'subject_type', (v_row ->> 'subject_id')::uuid,
       v_row ->> 'metric_key', (v_row ->> 'value')::numeric, v_row ->> 'unit', 'manual', v_row ->> 'source_notes',
       p_period_start, p_period_end, auth.uid());
    v_inserted := v_inserted + 1;
  end loop;

  -- (3) Agregat campaign: untuk tiap campaign dari subject impor, hitung
  -- ulang dari content_metrics (snapshot terbaru per subject + metrik).
  for v_campaign_id in
    select distinct (c ->> 'campaign_id')::uuid
    from jsonb_array_elements(v_clean) c
    where c ->> 'campaign_id' is not null
  loop
    -- Brand agregat: satu brand bila campaign hanya punya satu brand.
    -- v1.1 (2026-11-20): max(uuid) TIDAK ADA di Postgres (42883, ketemu
    -- pgTAP 07 live T2a) — pakai subquery skalar; semantik sama persis:
    -- 1 baris -> brand itu; 0 atau >1 baris -> NULL (multi-brand).
    select case when count(*) = 1
      then (select brand_id from public.campaign_brands where campaign_id = v_campaign_id limit 1)
    end into v_campaign_brand
    from public.campaign_brands where campaign_id = v_campaign_id;

    delete from public.campaign_metrics
    where campaign_id = v_campaign_id
      and period_start = p_period_start and period_end = p_period_end and source = 'manual';

    insert into public.campaign_metrics
      (snapshot_id, workspace_id, brand_id, campaign_id, metric_key, value, unit, source, aggregation_rule, period_start, period_end, created_by)
    select
      v_snapshot_id, p_workspace_id, v_campaign_brand, v_campaign_id,
      latest.metric_key, sum(latest.value), md.unit, 'manual',
      'sum(content_metrics, snapshot terbaru per subject, periode ' || p_period_start::text || ' s.d. ' || p_period_end::text || ', sumber manual)',
      p_period_start, p_period_end, auth.uid()
    from (
      select distinct on (cm.subject_type, cm.subject_id, cm.metric_key) cm.*
      from public.content_metrics cm
      join public.analytics_snapshots s on s.id = cm.snapshot_id
      where cm.workspace_id = p_workspace_id
        and cm.source = 'manual'
        and cm.period_start = p_period_start and cm.period_end = p_period_end
        and cm.metric_key in (
          select md2.metric_key from public.metric_definitions md2
          where md2.workspace_id is null and md2.source_platform = 'manual' and md2.is_derived = false
        )
        and exists (
          select 1 from public.content_items ci2
          where ci2.campaign_id = v_campaign_id
            and (
              (cm.subject_type = 'content_item' and ci2.id = cm.subject_id)
              or (cm.subject_type = 'placement' and exists (select 1 from public.content_placements pl2 where pl2.id = cm.subject_id and pl2.content_item_id = ci2.id))
              or (cm.subject_type = 'published_post' and exists (select 1 from public.published_posts pp2 join public.content_placements pl3 on pl3.id = pp2.placement_id where pp2.id = cm.subject_id and pl3.content_item_id = ci2.id))
            )
        )
      order by cm.subject_type, cm.subject_id, cm.metric_key, s.retrieved_at desc, s.created_at desc
    ) latest
    join public.metric_definitions md
      on md.workspace_id is null and md.source_platform = 'manual' and md.metric_key = latest.metric_key
    group by latest.metric_key, md.unit;

    -- engagement_rate campaign = sum(engagements)/sum(reach) x 100.
    select sum(value) filter (where metric_key = 'engagements'),
           sum(value) filter (where metric_key = 'reach')
      into v_eng_sum, v_reach_sum
    from public.campaign_metrics
    where campaign_id = v_campaign_id
      and period_start = p_period_start and period_end = p_period_end and source = 'manual';
    if v_reach_sum is not null and v_reach_sum > 0 and v_eng_sum is not null then
      insert into public.campaign_metrics
        (snapshot_id, workspace_id, brand_id, campaign_id, metric_key, value, unit, source, aggregation_rule, period_start, period_end, created_by)
      values
        (v_snapshot_id, p_workspace_id, v_campaign_brand, v_campaign_id, 'engagement_rate',
         round(v_eng_sum / v_reach_sum * 100, 4), 'persen', 'manual',
         'sum(engagements)/sum(reach) x 100 (snapshot terbaru per subject)',
         p_period_start, p_period_end, auth.uid());
    end if;
    v_campaigns := v_campaigns + 1;
  end loop;

  insert into public.integration_events (workspace_id, event_type, platform, actor_user_id, detail)
  values (p_workspace_id, 'import_completed', 'manual', auth.uid(),
    jsonb_build_object('snapshot_id', v_snapshot_id, 'inserted', v_inserted, 'campaigns', v_campaigns,
      'period_start', p_period_start, 'period_end', p_period_end, 'raw_reference', btrim(p_raw_reference)));

  return jsonb_build_object('ok', true, 'snapshot_id', v_snapshot_id, 'inserted', v_inserted, 'campaigns', v_campaigns);
end;
$$;

comment on function public.import_analytics_snapshot(uuid, uuid, date, date, text, jsonb) is 'Impor analytics CSV/manual (Phase 7, ADR-0013 §5): atomik — validasi semua baris dulu, baru tulis snapshot + metrik + agregat campaign + event. Mengembalikan jsonb {ok, code, message, snapshot_id, inserted, campaigns}; TIDAK melempar.';

revoke all on function public.import_analytics_snapshot(uuid, uuid, date, date, text, jsonb) from public;
grant execute on function public.import_analytics_snapshot(uuid, uuid, date, date, text, jsonb) to authenticated;
