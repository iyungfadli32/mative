-- 0031_batch5_approval_fixes.sql - Batch 5 (d) F-02..F-05: pemulihan reapproval + SoD + langkah paralel + tukar aset.
--
-- Temuan (audit 2026-11-21 atas commit 797fce6; diverifikasi masih ada di HEAD 7c61e28):
--   F-02: Pemulihan reapproval_required jalan buntu - dari approved tidak ada jalan ke
--         editing (0014:190 memerintahkan transisi ilegal; ApprovalTab tanpa panduan).
--         Perbaikan: transition_content_item_status mengizinkan approved -> editing bila
--         ada request approval berstatus reapproval_required untuk konten itu; ApprovalTab
--         menampilkan panduan pemulihan + tombol "Pindahkan ke Editing".
--   F-03: Self-approval penuh - decide_approval_request tidak memeriksa submitted_by.
--         Perbaikan: guard SoD di decide_approval_request; workspace satu orang bisa
--         mengizinkan self-approval lewat setelan workspace approval.allow_self_approval
--         (default: mati). assignWorkflowStepAction juga menolak menugaskan submitter
--         request aktif ke langkah workflow itu.
--   F-04: Deadlock langkah paralel - decide selalu memilih langkah cocok paling awal.
--         Perbaikan: lewati step yang sudah diputuskan untuk request ini.
--   F-05: Tukar aset di tempat (UPDATE content_assets.asset_id) melewati reapproval.
--         Perbaikan: trigger diperluas ke UPDATE OF asset_id (dengan guard no-op bila
--         asset_id tidak berubah).
--
-- Perubahan ini hanya mendefinisikan ulang fungsi yang sudah ada + satu trigger; tidak
-- ada tabel, kolom, policy, atau CHECK baru.

-- F-03 + F-04: decide_approval_request (definisi penuh berbasis 0025, hanya blok
-- bertanda Batch 5 (0031) yang berubah).

create or replace function public.decide_approval_request(
  p_request_id uuid,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_req public.approval_requests%rowtype;
  v_item public.content_items%rowtype;
  v_version public.content_versions%rowtype;
  v_caller_role text;
  v_step public.approval_steps%rowtype;
  v_allow_self_approval boolean;
  v_approved_count integer;
  v_steps_open integer;
  v_next_order integer;
  v_current_version_id uuid;
  v_current_version_number integer;
  v_recipient uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if p_decision is null or p_decision not in ('approved', 'changes_requested', 'rejected') then
    return jsonb_build_object('ok', false, 'message', 'Keputusan tidak dikenal.');
  end if;
  -- Non-approval WAJIB komentar (Dok 07 §4, prompt 05).
  if p_decision <> 'approved' and (p_comment is null or btrim(p_comment) = '') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
      'message', 'Minta revisi / tolak wajib disertai komentar (alasan).');
  end if;

  select * into v_req from public.approval_requests where id = p_request_id;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'message', 'Request approval tidak ditemukan.');
  end if;

  -- 7 poin (2–3): member aktif workspace pemilik request.
  if not public.is_ws_member(v_req.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Anda bukan member workspace ini.');
  end if;
  select workspace_role into v_caller_role
  from public.workspace_members
  where workspace_id = v_req.workspace_id and user_id = v_caller and membership_status = 'active';
  if v_caller_role is null then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Membership Anda tidak aktif di workspace ini.');
  end if;

  -- 7 poin (7): request harus 'in_review'.
  if v_req.status <> 'in_review' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
      'message', format('Request ini sudah %s — tidak bisa diputuskan lagi.', v_req.status));
  end if;

  -- Batch 5 (0031) F-03: pemisahan tugas (SoD) - pengaju tidak boleh memutuskan
  -- request approval yang dia ajukan sendiri. Workspace satu orang bisa mengizinkan
  -- self-approval lewat setelan workspace approval.allow_self_approval (default: mati).
  if v_req.submitted_by = v_caller then
    select coalesce((value_json ->> 'enabled')::boolean, false) into v_allow_self_approval
    from public.workspace_settings
    where workspace_id = v_req.workspace_id and key = 'approval.allow_self_approval';
    if not coalesce(v_allow_self_approval, false) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN',
        'message', 'Pengaju tidak boleh memutuskan approval request yang dia ajukan sendiri. Minta approver lain yang memutuskan.');
    end if;
  end if;

  -- Step aktif: step di current_step_order yang menugaskan pemanggil
  -- (penting untuk step paralel: tiap step punya assignee sendiri).
  -- Bila tidak ada step yang menugaskan pemanggil, beri galat yang jelas.
  -- Batch 5 (0031) F-04: lewati step yang sudah diputuskan untuk request ini. Pada
  -- langkah paralel (step_order sama) dengan assignee yang sama - role atau user -
  -- pemanggil harus mendapat step berikutnya yang belum diputuskan, bukan step yang
  -- sama dua kali.
  select * into v_step from public.approval_steps
  where workflow_id = v_req.workflow_id and step_order = v_req.current_step_order
    and (assignee_user_id = v_caller
      or (assignee_role is not null and assignee_role = v_caller_role))
    and not exists (
      select 1 from public.approval_decisions d
      where d.approval_request_id = v_req.id
        and d.step_id = approval_steps.id
    )
  order by created_at asc limit 1;
  if v_step.id is null then
    if exists (
      select 1 from public.approval_steps
      where workflow_id = v_req.workflow_id and step_order = v_req.current_step_order
    ) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN',
        'message', 'Anda tidak ditugaskan memutuskan di step ini.');
    end if;
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
      'message', 'Step approval untuk request ini tidak ditemukan.');
  end if;

  -- 7 poin (4–5): kapabilitas + penugasan step.
  -- approver penuh; owner/admin/manager HANYA bila ditugaskan eksplisit
  -- sebagai assignee_user_id (matriks "limited", R4.3).
  if v_caller_role = 'approver' then
    if not (v_step.assignee_user_id = v_caller
      or (v_step.assignee_role is not null and v_step.assignee_role = 'approver')) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Anda tidak ditugaskan memutuskan di step ini.');
    end if;
  elsif v_caller_role in ('owner', 'admin', 'manager') then
    if v_step.assignee_user_id is distinct from v_caller then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN',
        'message', 'Peran Anda hanya boleh memutuskan bila ditugaskan eksplisit di step ini.');
    end if;
  else
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Peran Anda tidak boleh memutuskan approval.');
  end if;

  -- Stale check (R4.1 / A4.5): versi yang ditinjau harus versi TERBARU.
  select * into v_version from public.content_versions where id = v_req.content_version_id;
  select * into v_item from public.content_items where id = v_version.content_item_id;
  select id, version_number into v_current_version_id, v_current_version_number
  from public.content_versions
  where content_item_id = v_item.id
  order by version_number desc limit 1;
  if v_req.content_version_id <> v_current_version_id then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
      'message', format('Versi yang ditinjau sudah basi (v%s). Versi terbaru adalah v%s — minta re-review eksplisit atas versi terbaru.',
        v_version.version_number, v_current_version_number));
  end if;
  if v_req.placement_version_id is not null then
    if v_req.placement_version_id <> (
      select id from public.placement_versions
      where placement_id = (select placement_id from public.placement_versions where id = v_req.placement_version_id)
      order by version_number desc limit 1
    ) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
        'message', 'Versi placement yang ditinjau sudah basi. Minta re-review atas versi placement terbaru.');
    end if;
  end if;

  -- Produksi harus masih dalam review untuk approve internal.
  if p_decision = 'approved' and v_req.request_type = 'internal'
    and v_item.production_status <> 'internal_review' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
      'message', format('Konten sudah tidak lagi dalam review internal (sekarang %s). Ajukan ulang bila perlu.', v_item.production_status));
  end if;
  if p_decision = 'approved' and v_req.request_type = 'client'
    and v_item.production_status <> 'approved' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
      'message', 'Konten harus berstatus Disetujui (internal) sebelum review klien disetujui.');
  end if;

  -- Tulis keputusan (append-only; unique melarang dobel per step).
  begin
    insert into public.approval_decisions (approval_request_id, step_id, approver_user_id, decision, comment)
    values (p_request_id, v_step.id, v_caller, p_decision, nullif(btrim(coalesce(p_comment, '')), ''));
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
      'message', 'Anda sudah memutuskan di step ini. Satu approver = satu keputusan per step.');
  end;

  insert into public.activity_logs (workspace_id, actor_user_id, entity_type, entity_id, action, before_snapshot, after_snapshot)
  values (v_req.workspace_id, v_caller, 'approval_request', p_request_id, 'decided',
    jsonb_build_object('status', 'in_review', 'step_order', v_req.current_step_order),
    jsonb_build_object('decision', p_decision, 'step_id', v_step.id,
      'comment', nullif(btrim(coalesce(p_comment, '')), '')));

  -- Evaluasi hasil.
  if p_decision in ('changes_requested', 'rejected') then
    update public.approval_requests
    set status = p_decision, completed_at = now(), updated_at = now()
    where id = p_request_id;
    -- Produksi kembali ke editing (ASUMSI-4.3) bila masih internal_review.
    if v_item.production_status = 'internal_review' then
      update public.content_items set production_status = 'editing', updated_at = now()
      where id = v_item.id;
      insert into public.content_status_events (content_item_id, from_status, to_status, actor_user_id, reason)
      values (v_item.id, 'internal_review', 'editing', v_caller,
        case when p_decision = 'changes_requested' then 'Minta revisi (approval)' else 'Ditolak (approval)' end);
      insert into public.activity_logs (workspace_id, actor_user_id, entity_type, entity_id, action, before_snapshot, after_snapshot)
      values (v_req.workspace_id, v_caller, 'content_item', v_item.id, 'status_changed',
        jsonb_build_object('production_status', 'internal_review'),
        jsonb_build_object('production_status', 'editing'));
    -- Penolakan klien (0025, F-01): request client hanya dibuat bila
    -- produksi sedang 'approved', jadi cabang di atas tidak pernah kena
    -- untuk request client — penolakan klien selama ini tidak mengubah
    -- apa-apa. Kini produksi kembali ke 'changes_requested' (BUKAN
    -- 'editing': 'approved' → 'editing' BUKAN transisi legal — matriks
    -- 0008/0014: dari approved hanya archived/changes_requested/
    -- cancelled/blocked; cermin TS features/planning/transitions.ts:
    -- status exception boleh dimasuki dari status normal mana pun).
    -- 'changes_requested' memang berarti "ada revisi diminta" — dan
    -- dari sana pemulihan legalnya ke 'editing' (lalu ajukan ulang).
    -- Komentar keputusan (wajib untuk non-approval) dipakai sebagai
    -- alasan event — JANGAN ubah perilaku request INTERNAL.
    elsif v_req.request_type = 'client' and v_item.production_status = 'approved' then
      update public.content_items set production_status = 'changes_requested', updated_at = now()
      where id = v_item.id;
      insert into public.content_status_events (content_item_id, from_status, to_status, actor_user_id, reason)
      values (v_item.id, 'approved', 'changes_requested', v_caller,
        case when p_decision = 'changes_requested' then 'Minta revisi (review klien): ' || btrim(p_comment) else 'Ditolak (review klien): ' || btrim(p_comment) end);
      insert into public.activity_logs (workspace_id, actor_user_id, entity_type, entity_id, action, before_snapshot, after_snapshot)
      values (v_req.workspace_id, v_caller, 'content_item', v_item.id, 'status_changed',
        jsonb_build_object('production_status', 'approved'),
        jsonb_build_object('production_status', 'changes_requested'));
    end if;
  else
    -- Approve: hitung quorum step ini (approver berbeda yang menyetujui).
    select count(distinct approver_user_id) into v_approved_count
    from public.approval_decisions
    where approval_request_id = p_request_id and step_id = v_step.id and decision = 'approved';
    if v_approved_count >= v_step.required_count then
      -- Apakah semua step di order ini sudah selesai? (paralel: order sama.)
      select count(*) into v_steps_open
      from public.approval_steps s
      where s.workflow_id = v_req.workflow_id and s.step_order = v_req.current_step_order
        and not exists (
          select 1 from public.approval_decisions d
          where d.approval_request_id = p_request_id and d.step_id = s.id and d.decision = 'approved'
          group by d.step_id
          having count(distinct d.approver_user_id) >= s.required_count
        );
      if v_steps_open = 0 then
        select min(step_order) into v_next_order
        from public.approval_steps
        where workflow_id = v_req.workflow_id and step_order > v_req.current_step_order;
        if v_next_order is null then
          -- Semua step selesai → request approved.
          update public.approval_requests
          set status = 'approved', completed_at = now(), updated_at = now()
          where id = p_request_id;
          if v_req.request_type = 'internal' and v_item.production_status = 'internal_review' then
            update public.content_items set production_status = 'approved', updated_at = now()
            where id = v_item.id;
            insert into public.content_status_events (content_item_id, from_status, to_status, actor_user_id, reason)
            values (v_item.id, 'internal_review', 'approved', v_caller, 'Disetujui (approval)');
            insert into public.activity_logs (workspace_id, actor_user_id, entity_type, entity_id, action, before_snapshot, after_snapshot)
            values (v_req.workspace_id, v_caller, 'content_item', v_item.id, 'status_changed',
              jsonb_build_object('production_status', 'internal_review'),
              jsonb_build_object('production_status', 'approved'));
          end if;
        else
          update public.approval_requests
          set current_step_order = v_next_order, updated_at = now()
          where id = p_request_id;
        end if;
      end if;
    end if;
  end if;

  -- Notifikasi ke pengaju (keputusan dibuat).
  if v_req.submitted_by <> v_caller then
    insert into public.notifications (workspace_id, recipient_user_id, type, title, body, target_type, target_id)
    values (v_req.workspace_id, v_req.submitted_by, 'approval_decided',
      case p_decision when 'approved' then 'Approval disetujui'
        when 'changes_requested' then 'Approval minta revisi' else 'Approval ditolak' end,
      v_item.title || ' — versi v' || v_version.version_number,
      v_req.target_type, v_req.target_id);
  end if;

  return jsonb_build_object('ok', true, 'request_id', p_request_id, 'decision', p_decision);
end;
$$;

comment on function public.decide_approval_request(uuid, text, text) is 'RPC Phase 4 (0014) + penolakan klien 0025 (F-01): keputusan approval — 7 poin Dok 06 §4 + stale check + quorum per step + append-only. Request CLIENT yang diputuskan changes_requested/rejected mengembalikan produksi approved → changes_requested (transisi legal; alasan = komentar keputusan). SECURITY DEFINER — ditinjau.';
revoke all on function public.decide_approval_request(uuid, text, text) from public;
grant execute on function public.decide_approval_request(uuid, text, text) to authenticated;

-- F-02: transition_content_item_status (definisi penuh berbasis 0030, hanya
-- arm 'approved' yang berubah).
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
      when 'approved' then p_to_status in ('archived','changes_requested','cancelled','blocked')
      -- Batch 5 (0031) F-02: pemulihan reapproval_required - konten yang sudah
      -- disetujui tetapi berubah sesudah approval boleh kembali ke editing untuk
      -- diperbaiki lalu diajukan ulang.
      or (p_to_status = 'editing' and exists (
        select 1 from public.approval_requests r
        where r.target_type = 'content_item'
          and r.target_id = v_item.id
          and r.status = 'reapproval_required'
      ))
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


-- F-05: check_critical_change_on_asset_link (definisi penuh berbasis 0014, hanya
-- guard UPDATE no-op yang berubah) + trigger diperluas ke UPDATE OF asset_id.
create or replace function public.check_critical_change_on_asset_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item_id uuid;
  v_item public.content_items%rowtype;
  v_req public.approval_requests%rowtype;
  v_fields text[];
begin
  -- Batch 5 (0031) F-05: UPDATE yang tidak mengubah asset_id bukan pergantian aset
  -- (mis. UPDATE ... SET asset_id = asset_id) - jangan tandai reapproval.
  if tg_op = 'UPDATE' and old.asset_id is not distinct from new.asset_id then
    return new;
  end if;
  v_item_id := coalesce(new.content_item_id, old.content_item_id);
  if v_item_id is null then
    return coalesce(new, old);
  end if;
  select * into v_item from public.content_items where id = v_item_id;
  if v_item.id is null then
    return coalesce(new, old);
  end if;
  v_fields := public.approval_critical_fields(v_item.workspace_id);
  if not ('asset' = any (v_fields)) then
    return coalesce(new, old);
  end if;
  select * into v_req from public.approval_requests
  where target_type = 'content_item' and target_id = v_item_id
    and request_type = 'internal' and status = 'approved'
  order by completed_at desc nulls last, created_at desc limit 1;
  if v_req.id is null then
    return coalesce(new, old);
  end if;
  perform public.flag_request_reapproval(v_req.id,
    format('Aset konten "%s" berubah sesudah disetujui — lampiran aset diganti, perlu approval ulang.', v_item.title));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_check_critical_change_on_asset_link on public.content_assets;
create trigger trg_check_critical_change_on_asset_link
  after insert or delete or update of asset_id on public.content_assets
  for each row execute function public.check_critical_change_on_asset_link();
