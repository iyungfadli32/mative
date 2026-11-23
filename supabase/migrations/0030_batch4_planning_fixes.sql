-- MaTive -- 0030: Perbaikan (b) T-1..T-8 Batch 4 (perencanaan).
-- T-3: trigger trg_content_placements_initial_status melarang INSERT placement
--   langsung berstatus 'published'/'uploaded_or_draft_created' (status itu hanya
--   diisi lewat alur publishing; lih. 0028) dan mewajibkan scheduled_at bila
--   status awal 'ready'. Lapisan aplikasi (placementSchema + createPlacementAction)
--   lebih ketat lagi: hanya 'draft'/'ready'.
--   Catatan: trigger ini sengaja TIDAK membatasi INSERT berstatus lain
--   (mis. 'sending'/'failed') karena fixture pgTAP lama (02, 04, 05, 06, 07,
--   10, 12) menyisipkan placement langsung dengan status itu.
-- T-6: soft-delete konten (deleted_at/deleted_by) + RPC soft_delete_content_item
--   dan duplicate_content_item; arsip dari status apa pun (dengan alasan)
--   diberlakukan di transition_content_item_status di bawah.
-- T-7: transition_content_item_status kini menolak internal_review -> approved
--   bila tidak ada approval request berstatus 'approved' untuk versi terbaru.
-- Tidak ada tabel baru: RLS tidak berubah (lihat tests/migrations.test.ts:
--   0030 masuk daftar migrasi RPC-only).

alter table public.content_items
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null,
  add column if not exists archived_reason text;

create index if not exists idx_content_items_deleted_at
  on public.content_items (workspace_id, deleted_at);

-- T-3: status awal placement. 'published' dan 'uploaded_or_draft_created' hanya
-- boleh diisi lewat alur publishing (perubahan status via RPC), bukan INSERT.
create or replace function public.trg_content_placements_initial_status()
returns trigger
language plpgsql
as $$
begin
  if new.distribution_status in ('published', 'uploaded_or_draft_created') then
    raise exception 'Status distribusi % tidak boleh ditulis langsung saat membuat placement. Status ini hanya diisi lewat alur publishing.', new.distribution_status
      using errcode = 'check_violation';
  end if;
  if new.distribution_status = 'ready' and new.scheduled_at is null then
    raise exception 'Placement dengan status ready wajib memiliki scheduled_at.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_content_placements_initial_status on public.content_placements;
create trigger trg_content_placements_initial_status
  before insert on public.content_placements
  for each row execute function public.trg_content_placements_initial_status();

create or replace function public.transition_content_item_status(
  p_content_item_id uuid,
  p_to_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.content_items%rowtype;
  v_allowed boolean := false;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  select * into v_item from public.content_items where id = p_content_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'message', 'Content item tidak ditemukan.');
  end if;
  if p_to_status is null or p_to_status not in (
    'idea', 'brief', 'scripting', 'ready_for_production', 'in_production',
    'editing', 'internal_review', 'approved', 'archived',
    'changes_requested', 'blocked', 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'message', 'Status tujuan tidak dikenal.');
  end if;
  if v_item.production_status = p_to_status then
    return jsonb_build_object('ok', false, 'message', 'Konten sudah berada di status tersebut.');
  end if;
  if not public.can_edit_content_item(p_content_item_id) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak mengubah status konten ini.');
  end if;

  -- Aturan exception didahulukan: dari exception HANYA ke editing/idea.
  if v_item.production_status in ('changes_requested', 'blocked', 'cancelled') then
    v_allowed := p_to_status in ('editing', 'idea');
  else
    v_allowed := case v_item.production_status
      when 'idea' then p_to_status in ('brief', 'cancelled', 'blocked', 'changes_requested')
      when 'brief' then p_to_status in ('scripting', 'idea', 'cancelled', 'blocked', 'changes_requested')
      when 'scripting' then p_to_status in ('ready_for_production', 'brief', 'cancelled', 'blocked', 'changes_requested')
      when 'ready_for_production' then p_to_status in ('in_production', 'scripting', 'cancelled', 'blocked', 'changes_requested')
      when 'in_production' then p_to_status in ('editing', 'ready_for_production', 'cancelled', 'blocked', 'changes_requested')
      when 'editing' then p_to_status in ('internal_review', 'in_production', 'cancelled', 'blocked', 'changes_requested')
      when 'internal_review' then p_to_status in ('approved', 'editing', 'changes_requested', 'cancelled', 'blocked')
      when 'approved' then p_to_status in ('archived', 'changes_requested', 'cancelled', 'blocked')
      when 'archived' then p_to_status in ('idea', 'cancelled', 'blocked', 'changes_requested')
      else false
    end;
  end if;

  -- Batch 4 (0030) T-6: arsip dari status apa pun (selain archived).
  if p_to_status = 'archived' and v_item.production_status <> 'archived' then
    v_allowed := true;
  end if;
  if not v_allowed then
    return jsonb_build_object('ok', false, 'message', format('Transisi %s → %s tidak diizinkan.', v_item.production_status, p_to_status));
  end if;
  -- Batch 4 (0030) T-7: internal_review -> approved hanya bila ada approval
  -- request yang disetujui (status 'approved') untuk versi terbaru konten ini.
  if v_item.production_status = 'internal_review' and p_to_status = 'approved' then
    if not exists (
      select 1
      from public.approval_requests ar
      where ar.target_type = 'content_item'
        and ar.target_id = p_content_item_id
        and ar.status = 'approved'
        and ar.content_version_id = (
          select cv.id
          from public.content_versions cv
          where cv.content_item_id = p_content_item_id
          order by cv.version_number desc, cv.created_at desc
          limit 1
        )
    ) then
      return jsonb_build_object('ok', false, 'message', 'Konten ini belum memiliki persetujuan untuk versi terbaru. Minta persetujuan dulu sebelum menyetujui.');
    end if;
  end if;
  -- Alasan WAJIB bila masuk ATAU keluar dari status exception.
  if (p_to_status in ('changes_requested', 'blocked', 'cancelled', 'archived')
      or v_item.production_status in ('changes_requested', 'blocked', 'cancelled')
      or (v_item.production_status = 'archived' and p_to_status = 'idea'))
     and (p_reason is null or btrim(p_reason) = '') then
    return jsonb_build_object('ok', false, 'message', 'Alasan wajib diisi untuk transisi ini.');
  end if;

  update public.content_items set
    production_status = p_to_status,
    archived_at = case when p_to_status = 'archived' then now()
                       when v_item.production_status = 'archived' then null
                       else archived_at end,
    archived_reason = case when p_to_status = 'archived' then nullif(btrim(coalesce(p_reason, '')), '')
      when v_item.production_status = 'archived' then null
      else archived_reason end,
    updated_at = now()
  where id = p_content_item_id;

  insert into public.content_status_events (
    content_item_id, from_status, to_status, actor_user_id, reason
  ) values (
    p_content_item_id, v_item.production_status, p_to_status, v_caller,
    nullif(btrim(coalesce(p_reason, '')), '')
  );

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action,
    before_snapshot, after_snapshot
  ) values (
    v_item.workspace_id, v_caller, 'content_item', p_content_item_id, 'status_changed',
    jsonb_build_object('production_status', v_item.production_status),
    jsonb_build_object('production_status', p_to_status)
  );

  return jsonb_build_object('ok', true, 'from_status', v_item.production_status, 'to_status', p_to_status);
end;
$$;

-- T-6: soft-delete konten. Baris tetap ada (riwayat + placement tidak hilang);
-- daftar konten menyembunyikannya lewat deleted_at is null.
create or replace function public.soft_delete_content_item(
  p_content_item_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.content_items%rowtype;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  select * into v_item from public.content_items where id = p_content_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'message', 'Content item tidak ditemukan.');
  end if;
  if v_item.deleted_at is not null then
    return jsonb_build_object('ok', false, 'message', 'Konten sudah dihapus.');
  end if;
  if not public.can_edit_content_item(p_content_item_id) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak menghapus konten ini.');
  end if;

  update public.content_items set
    deleted_at = now(),
    deleted_by = v_caller,
    updated_at = now()
  where id = p_content_item_id;

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action,
    before_snapshot, after_snapshot
  ) values (
    v_item.workspace_id, v_caller, 'content_item', p_content_item_id, 'deleted',
    jsonb_build_object('production_status', v_item.production_status),
    jsonb_build_object('deleted_at', now()::text, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );

  return jsonb_build_object('ok', true, 'content_item_id', p_content_item_id);
end;
$$;

-- T-6: duplikasi konten. Salinan mulai dari status 'idea' tanpa jadwal, dengan
-- salinan versi terbaru sebagai versi 1; placement tidak ikut disalin.
create or replace function public.duplicate_content_item(
  p_content_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.content_items%rowtype;
  v_version public.content_versions%rowtype;
  v_caller uuid := auth.uid();
  v_new_id uuid := gen_random_uuid();
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  select * into v_item from public.content_items where id = p_content_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'message', 'Content item tidak ditemukan.');
  end if;
  if v_item.deleted_at is not null then
    return jsonb_build_object('ok', false, 'message', 'Konten sudah dihapus.');
  end if;
  if not public.can_edit_content_item(p_content_item_id) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak menduplikasi konten ini.');
  end if;

  insert into public.content_items (
    id, workspace_id, campaign_id, brand_id, pillar_id, title,
    internal_description, objective, audience_id, funnel_stage,
    production_status, priority, owner_user_id, due_at, timezone,
    origin_idea_id
  ) values (
    v_new_id, v_item.workspace_id, v_item.campaign_id, v_item.brand_id,
    v_item.pillar_id, v_item.title || ' (salinan)', v_item.internal_description,
    v_item.objective, v_item.audience_id, v_item.funnel_stage,
    'idea', v_item.priority, v_caller, null, v_item.timezone, v_item.origin_idea_id
  );

  select * into v_version
  from public.content_versions
  where content_item_id = p_content_item_id
  order by version_number desc, created_at desc
  limit 1;
  if v_version.id is not null then
    insert into public.content_versions (
      content_item_id, version_number, brief_snapshot, script, caption,
      cta, creative_notes, change_summary, created_by
    ) values (
      v_new_id, 1, v_version.brief_snapshot, v_version.script,
      v_version.caption, v_version.cta, v_version.creative_notes,
      'Duplikasi dari konten ' || v_item.title, v_caller
    );
  end if;

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action,
    before_snapshot, after_snapshot
  ) values (
    v_item.workspace_id, v_caller, 'content_item', v_new_id, 'created',
    jsonb_build_object('from_content_item_id', p_content_item_id),
    jsonb_build_object('title', v_item.title || ' (salinan)', 'production_status', 'idea')
  );

  return jsonb_build_object('ok', true, 'content_item_id', v_new_id, 'from_content_item_id', p_content_item_id);
end;
$$;

comment on function public.transition_content_item_status(uuid, text, text) is 'RPC transaksional (0008; diubah 0030): transisi production_status + status event + activity log dalam satu transaksi. Alasan wajib untuk exception dan arsip; arsip dari status apa pun; internal_review -> approved butuh approval request yang disetujui untuk versi terbaru. SECURITY DEFINER — ditinjau.';
comment on function public.soft_delete_content_item(uuid, text) is 'RPC transaksional (0030) T-6: soft-delete konten (deleted_at/deleted_by) + activity log. SECURITY DEFINER — ditinjau.';
comment on function public.duplicate_content_item(uuid) is 'RPC transaksional (0030) T-6: duplikasi konten + salinan versi terbaru sebagai versi 1; placement tidak disalin. SECURITY DEFINER — ditinjau.';
comment on function public.trg_content_placements_initial_status() is 'Trigger (0030) T-3: larang INSERT placement berstatus published/uploaded_or_draft_created; ready wajib scheduled_at.';

revoke all on function public.transition_content_item_status(uuid, text, text) from public;
grant execute on function public.transition_content_item_status(uuid, text, text) to authenticated;
revoke all on function public.soft_delete_content_item(uuid, text) from public;
grant execute on function public.soft_delete_content_item(uuid, text) to authenticated;
revoke all on function public.duplicate_content_item(uuid) from public;
grant execute on function public.duplicate_content_item(uuid) to authenticated;
