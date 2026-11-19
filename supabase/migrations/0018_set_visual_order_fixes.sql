-- 0018_set_visual_order_fixes.sql — MaTive Phase 5 (perbaikan cacat RPC).
--
-- Latar: diagnosis pgTAP 05 live 2026-11-19 (Run 2: 47/59; diagnosis
-- _tap_out: 12 gagal) membuktikan 2 cacat produk di set_visual_order
-- (0017) — BUKAN cacat file tes:
--   (1) posisi ditulis 0-based (v_pos mulai 0) — T10c/T10d: posisi 1
--       berisi placement kedua, posisi 2 kosong. Posisi adalah nomor
--       urutan yang dibaca manusia ("urutan ke-1, ke-2"), jadi 1-based.
--       count ikut diperbaiki: v_pos seusai loop akan bernilai N+1 bila
--       mulai dari 1, jadi count kini = array_length daftar.
--   (2) placement yang bukan milik (workspace, brand, channel) yang
--       diminta ditolak dengan kode FORBIDDEN — T11a2/T11c2: seharusnya
--       INVALID_STATE_TRANSITION (kegagalan validasi permintaan, sama
--       seperti duplikat; FORBIDDEN hanya untuk peran/scope pemanggil).
--   + CHECK visual_orders.position diperketat 0 -> 1 (menegakkan 1-based
--     di level DB; tidak ada baris position 0 di live — pgTAP rollback,
--     e2e belum jalan — jadi ALTER aman).
-- 0017 TIDAK diubah (sudah live); perbaikan ini menimpa fungsinya lewat
-- create or replace (grant + kepemilikan dipertahankan).
-- RPC tetap TIDAK PERNAH menulis scheduled_at (R5.1).

alter table public.visual_orders drop constraint if exists visual_orders_position_check;
alter table public.visual_orders add constraint visual_orders_position_check check (position >= 1);

create or replace function public.set_visual_order(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_channel_id uuid,
  p_placement_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_pid uuid;
  v_pos int := 1;
  v_brand_ws uuid;
  v_channel_brand uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if not public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist']) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Hanya owner/admin/manager/strategist yang boleh mengubah urutan visual.');
  end if;
  if not public.brand_in_scope(p_brand_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Brand di luar cakupan Anda.');
  end if;
  select workspace_id into v_brand_ws from public.brands where id = p_brand_id;
  if v_brand_ws is null or v_brand_ws <> p_workspace_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Brand tidak ditemukan di workspace ini.');
  end if;
  select brand_id into v_channel_brand from public.social_channels where id = p_channel_id;
  if v_channel_brand is null or v_channel_brand <> p_brand_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Channel tidak ditemukan untuk brand ini.');
  end if;
  if exists (
    select 1 from unnest(coalesce(p_placement_ids, '{}'::uuid[])) as x(id)
    group by id having count(*) > 1
  ) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', 'Daftar placement mengandung duplikat.');
  end if;
  for v_pid in select unnest(coalesce(p_placement_ids, '{}'::uuid[])) loop
    if not exists (
      select 1 from public.content_placements pl
      join public.content_items ci on ci.id = pl.content_item_id
      where pl.id = v_pid
        and ci.workspace_id = p_workspace_id
        and ci.brand_id = p_brand_id
        and pl.social_channel_id = p_channel_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', 'Placement tidak ditemukan di workspace/brand/channel ini.');
    end if;
  end loop;
  delete from public.visual_orders
   where workspace_id = p_workspace_id
     and brand_id = p_brand_id
     and social_channel_id = p_channel_id;
  foreach v_pid in array coalesce(p_placement_ids, '{}'::uuid[]) loop
    insert into public.visual_orders (workspace_id, brand_id, social_channel_id, placement_id, position)
    values (p_workspace_id, p_brand_id, p_channel_id, v_pid, v_pos);
    v_pos := v_pos + 1;
  end loop;
  insert into public.activity_logs (workspace_id, actor_user_id, entity_type, entity_id, action, after_snapshot)
  values (p_workspace_id, v_caller, 'visual_order', p_channel_id, 'visual_order.set',
    jsonb_build_object('brand_id', p_brand_id, 'channel_id', p_channel_id, 'placement_ids', to_jsonb(coalesce(p_placement_ids, '{}'::uuid[]))));
  return jsonb_build_object('ok', true, 'count', coalesce(array_length(p_placement_ids, 1), 0));
end;
$$;

comment on function public.set_visual_order(uuid, uuid, uuid, uuid[]) is 'RPC Phase 5 (0017, diperbaiki 0018): tulis ulang urutan visual satu (workspace, brand, channel) dalam satu transaksi + jejak audit. Posisi 1-based; placement di luar scope -> INVALID_STATE_TRANSITION. TIDAK PERNAH menulis scheduled_at. SECURITY DEFINER — ditinjau.';

revoke all on function public.set_visual_order(uuid, uuid, uuid, uuid[]) from public;
grant execute on function public.set_visual_order(uuid, uuid, uuid, uuid[]) to authenticated;
