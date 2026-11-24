-- 0036_batch_s2_create_content_from_template.sql
-- Batch S-2, temuan S-5: pembuatan konten dari template konten kini atomik dalam
-- satu RPC/transaksi. Sebelumnya action membuat konten via RPC lalu insert placement
-- terpisah: bila insert placement gagal (mis. channel sumber sudah dihapus), konten
-- sudah tercipta (orphan) dan action mengembalikan gagal.
-- Fungsi ini memvalidasi SEMUA channel placement template lebih dulu (dan kecocokan
-- brand pilar template), lalu membuat konten via create_content_item_with_version
-- + placement template dalam satu transaksi. Zona waktu berasal dari p_timezone
-- (diisi action dari workspaces.timezone, bukan hardcode).

create or replace function public.create_content_from_template(
  p_workspace_id uuid,
  p_template_id uuid,
  p_title text,
  p_timezone text default 'Asia/Jakarta'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tpl record;
  v_result jsonb;
  v_content_id uuid;
  v_new_placement_id uuid;
  v_placement_ids uuid[] := '{}';
  v_pl record;
  v_missing_channel boolean;
begin
  -- Izin: anggota workspace dengan hak membuat konten (sama seperti create_content_item_with_version).
  if not (
    public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or public.is_ws_member(p_workspace_id, array['creator', 'editor'])
  ) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak membuat konten di workspace ini.');
  end if;

  select t.id, t.workspace_id, t.brand_id, t.pillar_id, t.script, t.caption
    into v_tpl
    from public.content_templates t
    where t.id = p_template_id
      and t.workspace_id = p_workspace_id;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Template konten tidak ditemukan di workspace ini.');
  end if;

  -- Pre-validasi: pilar template harus satu brand dengan brand template (S-6 / trigger 0037).
  if v_tpl.pillar_id is not null and exists (
    select 1
    from public.content_pillars p
    where p.id = v_tpl.pillar_id
      and p.brand_id is not null
      and p.brand_id is distinct from v_tpl.brand_id
  ) then
    return jsonb_build_object('ok', false, 'message', 'Pilar template milik brand yang berbeda dengan brand template; konten tidak dibuat.');
  end if;

  -- Pre-validasi: semua channel placement template harus masih ada di workspace.
  -- Bila ada yang hilang, gagal SEBELUM konten dibuat (tanpa konten yatim).
  select exists (
    select 1
    from public.content_template_placements tp
    where tp.template_id = p_template_id
      and not exists (
        select 1
        from public.social_channels sc
        join public.brands b
          on b.id = sc.brand_id
         and b.workspace_id = p_workspace_id
        where sc.id = tp.social_channel_id
      )
  ) into v_missing_channel;
  if v_missing_channel then
    return jsonb_build_object('ok', false, 'message', 'Template memakai channel yang sudah tidak ada; konten tidak dibuat.');
  end if;

  -- Buat konten via RPC existing (satu versi awal + log aktivitas).
  select public.create_content_item_with_version(
    p_workspace_id => p_workspace_id,
    p_brand_id => v_tpl.brand_id,
    p_title => p_title,
    p_campaign_id => null,
    p_pillar_id => v_tpl.pillar_id,
    p_audience_id => null,
    p_internal_description => null,
    p_objective => null,
    p_funnel_stage => null,
    p_priority => null,
    p_due_at => null,
    p_timezone => p_timezone,
    p_origin_idea_id => null,
    p_script => v_tpl.script,
    p_caption => v_tpl.caption,
    p_cta => null,
    p_creative_notes => null,
    p_brief_snapshot => '{}'::jsonb,
    p_change_summary => 'Dibuat dari template konten'
  ) into v_result;
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    return v_result;
  end if;
  v_content_id := (v_result ->> 'content_item_id')::uuid;

  -- Placement template: satu placement per channel template (belum dijadwalkan).
  for v_pl in
    select tp.social_channel_id, tp.platform_format
      from public.content_template_placements tp
      where tp.template_id = p_template_id
  loop
    insert into public.content_placements (
      content_item_id, social_channel_id, platform_format, scheduled_at, timezone
    ) values (
      v_content_id, v_pl.social_channel_id, v_pl.platform_format, null, p_timezone
    ) returning id into v_new_placement_id;
    v_placement_ids := array_append(v_placement_ids, v_new_placement_id);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'content_item_id', v_content_id,
    'placement_ids', to_jsonb(v_placement_ids),
    'message', 'Konten dibuat dari template.'
  );
end;
$$;

comment on function public.create_content_from_template(uuid, uuid, text, text) is 'RPC transaksional (0036, Batch S-2 / S-5): buat konten dari template konten + placement template secara atomik. Pre-validasi channel & pilar-brand sebelum konten dibuat. SECURITY DEFINER — ditinjau.';

revoke all on function public.create_content_from_template(uuid, uuid, text, text) from public;

grant execute on function public.create_content_from_template(uuid, uuid, text, text) to authenticated;
