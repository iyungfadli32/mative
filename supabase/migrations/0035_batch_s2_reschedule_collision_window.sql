-- 0035_batch_s2_reschedule_collision_window.sql
-- Batch S-2, temuan S-1: cek bentrok reschedule memakai jendela +/-15 menit,
-- bukan hanya waktu yang sama persis. Durasi placement tidak dimodelkan, jadi
-- dua placement di channel yang sama yang berjarak < 15 menit dianggap bentrok.
-- createPlacementAction (TypeScript) memakai jendela yang sama (COLLISION_WINDOW_MINUTES),
-- sehingga create dan reschedule konsisten.
create or replace function public.reschedule_placement(
  p_placement_id uuid,
  p_scheduled_at timestamptz,
  p_timezone text default 'Asia/Jakarta',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pl public.content_placements%rowtype;
  v_item public.content_items%rowtype;
  v_next_version integer;
  v_collision boolean := false;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  select * into v_pl from public.content_placements where id = p_placement_id;
  if v_pl.id is null then
    return jsonb_build_object('ok', false, 'message', 'Placement tidak ditemukan.');
  end if;
  select * into v_item from public.content_items where id = v_pl.content_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'message', 'Content item induk tidak ditemukan.');
  end if;
  if not public.can_edit_placement(p_placement_id) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak mengubah jadwal placement ini.');
  end if;
  if p_scheduled_at is null then
    return jsonb_build_object('ok', false, 'message', 'Waktu jadwal wajib diisi.');
  end if;

  select exists (
    select 1 from public.content_placements other
    where other.social_channel_id = v_pl.social_channel_id
      and other.id <> p_placement_id
      and other.scheduled_at is not null
        and abs(extract(epoch from (other.scheduled_at - p_scheduled_at))) < 900
  ) into v_collision;
  if v_collision and not coalesce(p_force, false) then
    return jsonb_build_object('ok', false, 'collision', true,
      'message', 'Sudah ada placement lain di channel yang sama dalam 15 menit dari waktu tersebut.');
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
    from public.placement_versions where placement_id = p_placement_id;

  update public.content_placements set
    scheduled_at = p_scheduled_at,
    timezone = coalesce(p_timezone, timezone),
    updated_at = now()
  where id = p_placement_id;

  insert into public.placement_versions (
    placement_id, version_number, payload_snapshot, created_by
  ) values (
    p_placement_id, v_next_version,
    jsonb_build_object('scheduled_at', p_scheduled_at, 'timezone', coalesce(p_timezone, v_pl.timezone),
      'distribution_status', v_pl.distribution_status, 'collision_forced', coalesce(p_force, false)),
    v_caller
  );

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action,
    before_snapshot, after_snapshot
  ) values (
    v_item.workspace_id, v_caller, 'content_placement', p_placement_id, 'placement_rescheduled',
    jsonb_build_object('scheduled_at', v_pl.scheduled_at),
    jsonb_build_object('scheduled_at', p_scheduled_at, 'version_number', v_next_version)
  );

  return jsonb_build_object('ok', true, 'collision', v_collision, 'version_number', v_next_version);
end;
$$;

comment on function public.reschedule_placement(uuid, timestamptz, text, boolean) is 'RPC transaksional (0008, diubah 0035): reschedule placement + placement version + activity log. Collision channel + jendela +/-15 menit ditolak kecuali p_force. SECURITY DEFINER.';

revoke all on function public.reschedule_placement(uuid, timestamptz, text, boolean) from public;

grant execute on function public.reschedule_placement(uuid, timestamptz, text, boolean) to authenticated;
