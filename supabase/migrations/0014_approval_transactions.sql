-- MaTive Phase 4 — Review & Approval: migrasi 0014 (transaksi)
-- ============================================================================
-- RPC SECURITY DEFINER (transaksional, satu transaksi Postgres):
--   get_or_create_default_workflow, create_approval_request,
--   decide_approval_request, submit_content_for_client_review,
--   create_client_comment.
-- Trigger critical-change (ADR-0010 §3): versi konten / versi placement /
--   lampiran aset / placement baru / reschedule sesudah approval →
--   request 'reapproval_required' + notifikasi + activity log.
-- Guard anti-bypass (ADR-0010 §7): DROP + CREATE OR REPLACE
--   transition_content_item_status (salinan 0008 byte-identik KECUALI
--   guard internal_review → approved).
--
-- ATURAN KERAS (pola 0008/0010):
--   (1) SECURITY DEFINER + search_path terkunci (public, pg_temp);
--       revoke dari public, grant EXECUTE hanya ke authenticated.
--   (2) TIDAK ADA organisasi/workspace/user/role yang diterima dari
--       client sebagai identitas tepercaya — semua dibaca dari sesi
--       (auth.uid()) + membership (Dok 06 §4).
--   (3) Setiap penulisan state ditemani content_status_events (bila
--       production berubah) + activity_logs + notifications, dalam
--       SATU transaksi yang sama.
--   (4) JANGAN ubah file 0001–0012 — fungsi 0008 diganti lewat
--       DROP + CREATE OR REPLACE di file ini (pola migrasi 0012).
--   (5) Kode error memakai Dok 07 §6: FORBIDDEN /
--       INVALID_STATE_TRANSITION / APPROVAL_REQUIRED (kolom 'code'
--       di objek jsonb; pesan Bahasa Indonesia yang bisa ditampilkan).
-- ============================================================================

-- ============================================================================
-- Fungsi 1 — get_or_create_default_workflow
-- Workflow default MVP (ASUMSI-4.4): 1 step, assignee_role 'approver',
-- required_count 1. Idempotent: bila default sudah ada, kembalikan id-nya.
-- ============================================================================
create or replace function public.get_or_create_default_workflow(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_workflow_id uuid;
  v_step_id uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if not public.is_ws_member(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Anda bukan member workspace ini.');
  end if;

  select id into v_workflow_id
  from public.approval_workflows
  where workspace_id = p_workspace_id and is_default
  order by created_at asc
  limit 1;

  if v_workflow_id is null then
    insert into public.approval_workflows (workspace_id, name, is_default, created_by)
    values (p_workspace_id, 'Workflow Default', true, v_caller)
    returning id into v_workflow_id;

    insert into public.approval_steps (workflow_id, step_order, step_type, assignee_role, required_count)
    values (v_workflow_id, 1, 'sequential', 'approver', 1)
    returning id into v_step_id;
  end if;

  return jsonb_build_object('ok', true, 'workflow_id', v_workflow_id);
end;
$$;

comment on function public.get_or_create_default_workflow(uuid) is 'RPC Phase 4 (0014, ASUMSI-4.4): workflow default MVP (1 step, assignee_role approver, quorum 1), dibuat LAZY bila belum ada. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Fungsi 2 — create_approval_request
-- Buat request approval untuk versi TERBARU sebuah content item (atau
-- placement tertentu). Request dibuat langsung 'in_review' (step 1
-- terbuka saat submit — tidak ada antrean submit terpisah di MVP).
-- Untuk tipe internal: production_status 'editing'/'internal_review' →
-- 'internal_review' + status event + activity + notifikasi ke assignee.
-- Untuk tipe client: gerbang harus aktif (workspace_settings
-- approval.client_review_enabled) DAN request internal untuk versi yang
-- sama sudah 'approved'; production TIDAK berubah (sudah 'approved').
-- ============================================================================
create or replace function public.create_approval_request(
  p_content_item_id uuid,
  p_content_version_id uuid,
  p_placement_version_id uuid default null,
  p_request_type text default 'internal'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_item public.content_items%rowtype;
  v_version public.content_versions%rowtype;
  v_pversion public.placement_versions%rowtype;
  v_placement public.content_placements%rowtype;
  v_wf jsonb;
  v_workflow_id uuid;
  v_request_id uuid;
  v_target_type text;
  v_target_id uuid;
  v_from_status text;
  v_client_enabled boolean := false;
  v_recipient uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if p_request_type is null or p_request_type not in ('internal', 'client') then
    return jsonb_build_object('ok', false, 'message', 'Tipe request tidak dikenal.');
  end if;

  select * into v_item from public.content_items where id = p_content_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'message', 'Content item tidak ditemukan.');
  end if;
  -- 7 poin Dok 06 §4 (1–6): submit = boleh edit konten ini.
  if not public.can_edit_content_item(p_content_item_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Anda tidak berhak mengajukan konten ini untuk approval.');
  end if;

  select * into v_version from public.content_versions where id = p_content_version_id;
  if v_version.id is null or v_version.content_item_id <> p_content_item_id then
    return jsonb_build_object('ok', false, 'message', 'Versi konten tidak ditemukan untuk item ini.');
  end if;
  -- Stale submit ditolak: hanya versi TERBARU yang boleh diajukan.
  if v_version.version_number <> (
    select max(version_number) from public.content_versions where content_item_id = p_content_item_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
      'message', format('Versi yang diajukan sudah basi (v%s). Ajukan versi terbaru (v%s).',
        v_version.version_number,
        (select max(version_number) from public.content_versions where content_item_id = p_content_item_id)));
  end if;

  if p_placement_version_id is not null then
    select * into v_pversion from public.placement_versions where id = p_placement_version_id;
    if v_pversion.id is null then
      return jsonb_build_object('ok', false, 'message', 'Versi placement tidak ditemukan.');
    end if;
    select * into v_placement from public.content_placements where id = v_pversion.placement_id;
    if v_placement.id is null or v_placement.content_item_id <> p_content_item_id then
      return jsonb_build_object('ok', false, 'message', 'Versi placement bukan milik konten ini.');
    end if;
    if v_pversion.version_number <> (
      select max(version_number) from public.placement_versions where placement_id = v_pversion.placement_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
        'message', 'Versi placement yang diajukan sudah basi. Ajukan versi placement terbaru.');
    end if;
    v_target_type := 'placement';
    v_target_id := v_pversion.placement_id;
  else
    v_target_type := 'content_item';
    v_target_id := p_content_item_id;
  end if;

  -- Gerbang client (ADR-0010 §5): opt-in + butuh internal approved dulu.
  if p_request_type = 'client' then
    select coalesce((value_json ->> 'enabled')::boolean, false) into v_client_enabled
    from public.workspace_settings
    where workspace_id = v_item.workspace_id and key = 'approval.client_review_enabled';
    if not coalesce(v_client_enabled, false) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN',
        'message', 'Review klien tidak diaktifkan di workspace ini. Aktifkan dulu di pengaturan approval.');
    end if;
    if not exists (
      select 1 from public.approval_requests
      where target_type = 'content_item' and target_id = p_content_item_id
        and content_version_id = p_content_version_id
        and request_type = 'internal' and status = 'approved'
    ) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
        'message', 'Review klien hanya bisa diminta setelah approval internal untuk versi ini disetujui.');
    end if;
    if v_item.production_status <> 'approved' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
        'message', 'Konten harus berstatus Disetujui (internal) sebelum review klien.');
    end if;
  else
    -- Internal: hanya dari editing / internal_review.
    if v_item.production_status not in ('editing', 'internal_review') then
      return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION',
        'message', format('Konten berstatus %s tidak bisa diajukan untuk approval. Pindahkan dulu ke Editing.', v_item.production_status));
    end if;
  end if;

  -- Satu request aktif per (target, versi, placement, tipe) — cegah dobel.
  if exists (
    select 1 from public.approval_requests
    where target_type = v_target_type and target_id = v_target_id
      and content_version_id = p_content_version_id
      and coalesce(placement_version_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_placement_version_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and request_type = p_request_type
      and status in ('submitted', 'in_review', 'reapproval_required')
  ) then
    return jsonb_build_object('ok', false, 'message', 'Sudah ada request approval aktif untuk versi ini.');
  end if;

  v_wf := public.get_or_create_default_workflow(v_item.workspace_id);
  if not (v_wf ->> 'ok')::boolean then
    return v_wf;
  end if;
  v_workflow_id := (v_wf ->> 'workflow_id')::uuid;

  insert into public.approval_requests (
    workspace_id, target_type, target_id, content_version_id,
    placement_version_id, workflow_id, request_type, status,
    submitted_by, current_step_order
  ) values (
    v_item.workspace_id, v_target_type, v_target_id, p_content_version_id,
    p_placement_version_id, v_workflow_id, p_request_type, 'in_review',
    v_caller, 1
  ) returning id into v_request_id;

  -- Internal: production → internal_review (bila belum) + event + log.
  if p_request_type = 'internal' and v_item.production_status = 'editing' then
    v_from_status := v_item.production_status;
    update public.content_items set production_status = 'internal_review', updated_at = now()
    where id = p_content_item_id;
    insert into public.content_status_events (content_item_id, from_status, to_status, actor_user_id, reason)
    values (p_content_item_id, v_from_status, 'internal_review', v_caller, 'Diajukan untuk approval');
    insert into public.activity_logs (workspace_id, actor_user_id, entity_type, entity_id, action, before_snapshot, after_snapshot)
    values (v_item.workspace_id, v_caller, 'content_item', p_content_item_id, 'submitted_for_approval',
      jsonb_build_object('production_status', v_from_status),
      jsonb_build_object('production_status', 'internal_review', 'approval_request_id', v_request_id));
  else
    insert into public.activity_logs (workspace_id, actor_user_id, entity_type, entity_id, action, before_snapshot, after_snapshot)
    values (v_item.workspace_id, v_caller, 'approval_request', v_request_id, 'submitted',
      jsonb_build_object('request_type', p_request_type),
      jsonb_build_object('status', 'in_review', 'content_version_id', p_content_version_id));
  end if;

  -- Notifikasi ke assignee step 1 (user eksplisit ATAU semua member role itu).
  for v_recipient in
    select distinct wm.user_id
    from public.approval_steps s
    join public.workspace_members wm on wm.workspace_id = v_item.workspace_id
      and wm.membership_status = 'active'
      and (s.assignee_user_id = wm.user_id
        or (s.assignee_role is not null and s.assignee_role = wm.workspace_role))
    where s.workflow_id = v_workflow_id and s.step_order = 1
  loop
    if v_recipient <> v_caller then
      insert into public.notifications (workspace_id, recipient_user_id, type, title, body, target_type, target_id)
      values (v_item.workspace_id, v_recipient,
        'approval_requested',
        case when p_request_type = 'client' then 'Review klien diminta' else 'Approval diminta' end,
        v_item.title || ' — versi v' || v_version.version_number,
        v_target_type, v_target_id);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'request_id', v_request_id,
    'request_type', p_request_type, 'status', 'in_review');
end;
$$;

comment on function public.create_approval_request(uuid, uuid, uuid, text) is 'RPC Phase 4 (0014): buat request approval untuk versi TERBARU (stale ditolak) + transisi internal_review + notifikasi assignee, satu transaksi. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Fungsi 3 — decide_approval_request
-- Keputusan approver atas request (approve / request-changes / reject).
-- Validasi 7 poin Dok 06 §4 (ADR-0010 §6) + quorum per step (ASUMSI-4.7):
-- step selesai bila approver berbeda yang menyetujui mencapai
-- required_count; step paralel (step_order sama) semuanya harus selesai
-- sebelum lanjut; reject/changes_requested menutup request + konten
-- kembali ke 'editing'; approve terakhir menutup request 'approved' +
-- production 'approved' (internal) — client tidak mengubah production.
-- Keputusan append-only (unique per approver per step; TIDAK ADA UPDATE).
-- ============================================================================
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

  -- Step aktif: step di current_step_order yang menugaskan pemanggil
  -- (penting untuk step paralel: tiap step punya assignee sendiri).
  -- Bila tidak ada step yang menugaskan pemanggil, beri galat yang jelas.
  select * into v_step from public.approval_steps
  where workflow_id = v_req.workflow_id and step_order = v_req.current_step_order
    and (assignee_user_id = v_caller
      or (assignee_role is not null and assignee_role = v_caller_role))
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

comment on function public.decide_approval_request(uuid, text, text) is 'RPC Phase 4 (0014): keputusan approval — 7 poin Dok 06 §4 + stale check + quorum per step + append-only. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Fungsi 4 — submit_content_for_client_review
-- Jalan pintas bernama untuk gerbang client (ADR-0010 §5): memanggil
-- create_approval_request dengan request_type 'client' (semua validasi
-- gerbang tetap berjalan di sana).
-- ============================================================================
create or replace function public.submit_content_for_client_review(
  p_content_item_id uuid,
  p_content_version_id uuid,
  p_placement_version_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.create_approval_request(
    p_content_item_id, p_content_version_id, p_placement_version_id, 'client'
  );
end;
$$;

comment on function public.submit_content_for_client_review(uuid, uuid, uuid) is 'RPC Phase 4 (0014): minta review klien untuk versi yang sudah approved internal. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Fungsi 5 — create_client_comment
-- Komentar klien di portal (langkah 4.14, Keputusan #12): HANYA lewat
-- share eksplisit + HANYA bila workspace mengizinkan
-- (workspace_settings key 'approval.client_can_comment' = {"allowed": true};
-- default TIDAK BOLEH). Komentar masuk sebagai comments biasa (ter-scope
-- tenant, tercatat di audit) dan TIDAK PERNAH menjadi keputusan approval.
-- Tanpa parsing mention untuk komentar klien (didokumentasikan).
-- ============================================================================
create or replace function public.create_client_comment(
  p_share_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_share public.resource_shares%rowtype;
  v_allowed boolean := false;
  v_comment_id uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if p_body is null or btrim(p_body) = '' then
    return jsonb_build_object('ok', false, 'message', 'Komentar tidak boleh kosong.');
  end if;
  if length(p_body) > 5000 then
    return jsonb_build_object('ok', false, 'message', 'Komentar maksimal 5000 karakter.');
  end if;

  select * into v_share from public.resource_shares where id = p_share_id;
  if v_share.id is null or v_share.shared_with_user_id <> v_caller then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Share ini bukan milik Anda.');
  end if;
  if v_share.resource_type <> 'content_item' then
    return jsonb_build_object('ok', false, 'message', 'Komentar klien hanya untuk konten.');
  end if;

  select coalesce((value_json ->> 'allowed')::boolean, false) into v_allowed
  from public.workspace_settings
  where workspace_id = v_share.workspace_id and key = 'approval.client_can_comment';
  if not coalesce(v_allowed, false) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN',
      'message', 'Workspace ini tidak mengizinkan klien berkomentar. Hubungi tim bila perlu menyampaikan masukan.');
  end if;

  insert into public.comments (workspace_id, target_type, target_id, body, author_user_id)
  values (v_share.workspace_id, 'content_item', v_share.resource_id, btrim(p_body), v_caller)
  returning id into v_comment_id;

  insert into public.activity_logs (workspace_id, actor_user_id, entity_type, entity_id, action, before_snapshot, after_snapshot)
  values (v_share.workspace_id, v_caller, 'comment', v_comment_id, 'client_commented',
    jsonb_build_object('share_id', p_share_id),
    jsonb_build_object('target_type', 'content_item', 'target_id', v_share.resource_id));

  return jsonb_build_object('ok', true, 'comment_id', v_comment_id);
end;
$$;

comment on function public.create_client_comment(uuid, text) is 'RPC Phase 4 (0014, langkah 4.14): komentar klien lewat share eksplisit + izin workspace eksplisit. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Trigger critical-change (ADR-0010 §3)
-- Bila field kritis berubah sesudah approval → request 'reapproval_required'
-- + notifikasi ke approver + activity log. Idempotent: hanya bertindak
-- bila request masih 'approved' (panggilan kedua jadi no-op).
-- Daftar kritis dibaca dari workspace_settings key 'approval.critical_fields'
-- (default ASUMSI-4.6 bila belum dikonfigurasi).
-- ============================================================================

-- Daftar field kritis workspace (default bila belum dikonfigurasi).
create or replace function public.approval_critical_fields(p_workspace_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select array_agg(f) from jsonb_array_elements_text(
      (select value_json -> 'fields' from public.workspace_settings
       where workspace_id = p_workspace_id and key = 'approval.critical_fields'))
      as f),
    array['script', 'caption', 'cta', 'asset', 'channel', 'format', 'scheduled_time']
  );
$$;

-- Tandai SATU request approved → reapproval_required + notifikasi.
create or replace function public.flag_request_reapproval(
  p_request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.approval_requests%rowtype;
  v_recipient uuid;
begin
  select * into v_req from public.approval_requests where id = p_request_id;
  if v_req.id is null or v_req.status <> 'approved' then
    return;
  end if;
  update public.approval_requests
  set status = 'reapproval_required', completed_at = null, updated_at = now()
  where id = p_request_id;

  insert into public.activity_logs (workspace_id, actor_user_id, entity_type, entity_id, action, before_snapshot, after_snapshot)
  values (v_req.workspace_id, null, 'approval_request', p_request_id, 'reapproval_required',
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'reapproval_required', 'reason', p_reason));

  -- Notifikasi ke approver yang menyetujui + pengaju (tanpa dobel).
  for v_recipient in
    select distinct approver_user_id from public.approval_decisions
    where approval_request_id = p_request_id and decision = 'approved'
    union
    select v_req.submitted_by
  loop
    insert into public.notifications (workspace_id, recipient_user_id, type, title, body, target_type, target_id)
    values (v_req.workspace_id, v_recipient, 'approval_reapproval_required',
      'Perubahan kritis — perlu approval ulang',
      p_reason, v_req.target_type, v_req.target_id);
  end loop;
end;
$$;

-- Versi konten baru: bandingkan field kritis vs versi yang disetujui.
create or replace function public.check_critical_change_on_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.content_items%rowtype;
  v_approved public.content_versions%rowtype;
  v_req public.approval_requests%rowtype;
  v_fields text[];
  v_changed boolean := false;
begin
  select * into v_item from public.content_items where id = new.content_item_id;
  if v_item.id is null then
    return new;
  end if;
  -- Request internal approved TERBARU untuk item ini (bila ada).
  select * into v_req from public.approval_requests
  where target_type = 'content_item' and target_id = new.content_item_id
    and request_type = 'internal' and status = 'approved'
  order by completed_at desc nulls last, created_at desc limit 1;
  if v_req.id is null then
    return new;
  end if;
  select * into v_approved from public.content_versions where id = v_req.content_version_id;
  if v_approved.id is null or v_approved.id = new.id then
    return new;
  end if;

  v_fields := public.approval_critical_fields(v_item.workspace_id);
  if 'script' = any (v_fields)
    and coalesce(new.script, '') is distinct from coalesce(v_approved.script, '') then
    v_changed := true;
  end if;
  if 'caption' = any (v_fields)
    and coalesce(new.caption, '') is distinct from coalesce(v_approved.caption, '') then
    v_changed := true;
  end if;
  if 'cta' = any (v_fields)
    and coalesce(new.cta, '') is distinct from coalesce(v_approved.cta, '') then
    v_changed := true;
  end if;
  if v_changed then
    perform public.flag_request_reapproval(v_req.id,
      format('Konten "%s" diubah sesudah disetujui (versi v%s) — field kritis berubah, perlu approval ulang.',
        v_item.title, new.version_number));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_critical_change_on_version on public.content_versions;
create trigger trg_check_critical_change_on_version
  after insert on public.content_versions
  for each row execute function public.check_critical_change_on_version();

-- Versi placement baru: bandingkan snapshot vs versi placement yang disetujui.
create or replace function public.check_critical_change_on_placement_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_placement public.content_placements%rowtype;
  v_item public.content_items%rowtype;
  v_req public.approval_requests%rowtype;
  v_approved public.placement_versions%rowtype;
  v_fields text[];
  v_changed boolean := false;
begin
  select * into v_placement from public.content_placements where id = new.placement_id;
  if v_placement.id is null then
    return new;
  end if;
  select * into v_item from public.content_items where id = v_placement.content_item_id;
  if v_item.id is null then
    return new;
  end if;
  select * into v_req from public.approval_requests
  where target_type = 'placement' and target_id = new.placement_id
    and status = 'approved'
  order by completed_at desc nulls last, created_at desc limit 1;
  if v_req.id is null then
    return new;
  end if;
  select * into v_approved from public.placement_versions where id = v_req.placement_version_id;
  if v_approved.id is null or v_approved.id = new.id then
    return new;
  end if;

  v_fields := public.approval_critical_fields(v_item.workspace_id);
  if 'format' = any (v_fields)
    and (new.payload_snapshot ->> 'platform_format') is distinct from (v_approved.payload_snapshot ->> 'platform_format') then
    v_changed := true;
  end if;
  if 'caption' = any (v_fields)
    and (new.payload_snapshot ->> 'platform_caption') is distinct from (v_approved.payload_snapshot ->> 'platform_caption') then
    v_changed := true;
  end if;
  if 'scheduled_time' = any (v_fields)
    and (new.payload_snapshot ->> 'scheduled_at') is distinct from (v_approved.payload_snapshot ->> 'scheduled_at') then
    v_changed := true;
  end if;
  if v_changed then
    perform public.flag_request_reapproval(v_req.id,
      format('Placement konten "%s" diubah sesudah disetujui (versi placement v%s) — field kritis berubah, perlu approval ulang.',
        v_item.title, new.version_number));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_critical_change_on_placement_version on public.placement_versions;
create trigger trg_check_critical_change_on_placement_version
  after insert on public.placement_versions
  for each row execute function public.check_critical_change_on_placement_version();

-- Lampiran aset berubah sesudah approval → reapproval ('asset' kritis).
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
  after insert or delete on public.content_assets
  for each row execute function public.check_critical_change_on_asset_link();

-- Placement baru / reschedule sesudah approval → reapproval.
-- (channel baru = placement baru; scheduled_time = UPDATE scheduled_at.)
create or replace function public.check_critical_change_on_placement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.content_items%rowtype;
  v_req public.approval_requests%rowtype;
  v_fields text[];
begin
  if tg_op = 'UPDATE' and old.scheduled_at is not distinct from new.scheduled_at then
    return new;
  end if;
  select * into v_item from public.content_items where id = new.content_item_id;
  if v_item.id is null then
    return new;
  end if;
  v_fields := public.approval_critical_fields(v_item.workspace_id);
  if tg_op = 'INSERT' and not ('channel' = any (v_fields)) then
    return new;
  end if;
  if tg_op = 'UPDATE' and not ('scheduled_time' = any (v_fields)) then
    return new;
  end if;
  select * into v_req from public.approval_requests
  where target_type = 'content_item' and target_id = new.content_item_id
    and request_type = 'internal' and status = 'approved'
  order by completed_at desc nulls last, created_at desc limit 1;
  if v_req.id is null then
    return new;
  end if;
  perform public.flag_request_reapproval(v_req.id,
    case when tg_op = 'INSERT'
      then format('Channel baru ditambahkan ke konten "%s" sesudah disetujui — perlu approval ulang.', v_item.title)
      else format('Jadwal konten "%s" diubah sesudah disetujui — perlu approval ulang.', v_item.title)
    end);
  return new;
end;
$$;

drop trigger if exists trg_check_critical_change_on_placement on public.content_placements;
create trigger trg_check_critical_change_on_placement
  after insert or update of scheduled_at on public.content_placements
  for each row execute function public.check_critical_change_on_placement();

-- ============================================================================
-- Guard anti-bypass (ADR-0010 §7)
-- transition_content_item_status (0008) diganti di sini — salinan byte-identik
-- KECUALI guard: internal_review → approved HANYA bila ada request internal
-- APPROVED untuk versi TERBARU item ini; bila tidak, kembalikan ok:false +
-- kode APPROVAL_REQUIRED + pesan pemulihan. Semua jalur lain tidak berubah.
-- ============================================================================
drop function if exists public.transition_content_item_status(uuid, text, text);
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
  if not v_allowed then
    return jsonb_build_object('ok', false, 'message', format('Transisi %s → %s tidak diizinkan.', v_item.production_status, p_to_status));
  end if;
  -- Alasan WAJIB bila masuk ATAU keluar dari status exception.
  if (p_to_status in ('changes_requested', 'blocked', 'cancelled')
      or v_item.production_status in ('changes_requested', 'blocked', 'cancelled')
      or (v_item.production_status = 'archived' and p_to_status = 'idea'))
     and (p_reason is null or btrim(p_reason) = '') then
    return jsonb_build_object('ok', false, 'message', 'Alasan wajib diisi untuk transisi ini.');
  end if;

  -- GUARD Phase 4 (0014, ADR-0010 §7): internal_review → approved hanya
  -- sah bila ada request internal APPROVED untuk versi TERBARU item ini.
  -- Tanpa itu, transisi langsung = bypass workflow → ditolak dengan kode
  -- APPROVAL_REQUIRED + pesan pemulihan (bukan diam-diam berhasil/gagal).
  if v_item.production_status = 'internal_review' and p_to_status = 'approved' then
    if not exists (
      select 1
      from public.approval_requests ar
      where ar.target_type = 'content_item'
        and ar.target_id = p_content_item_id
        and ar.request_type = 'internal'
        and ar.status = 'approved'
        and ar.content_version_id = (
          select id from public.content_versions
          where content_item_id = p_content_item_id
          order by version_number desc limit 1
        )
    ) then
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_REQUIRED',
        'message', 'Konten ini belum disetujui. Minta persetujuan dulu di Approval Center — transisi langsung ke Disetujui tidak diizinkan.');
    end if;
  end if;

  update public.content_items set
    production_status = p_to_status,
    archived_at = case when p_to_status = 'archived' then now()
                       when v_item.production_status = 'archived' then null
                       else archived_at end,
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

comment on function public.transition_content_item_status(uuid, text, text) is 'RPC transaksional (0008 + guard 0014, ADR-0010 §7): transisi production_status + status event + activity log dalam satu transaksi. Guard: internal_review → approved butuh request internal APPROVED untuk versi terbaru (APPROVAL_REQUIRED bila tidak ada). SECURITY DEFINER — ditinjau.';

-- --- grants -------------------------------------------------------------------
revoke all on function public.get_or_create_default_workflow(uuid) from public;
revoke all on function public.create_approval_request(uuid, uuid, uuid, text) from public;
revoke all on function public.decide_approval_request(uuid, text, text) from public;
revoke all on function public.submit_content_for_client_review(uuid, uuid, uuid) from public;
revoke all on function public.create_client_comment(uuid, text) from public;
revoke all on function public.approval_critical_fields(uuid) from public;
revoke all on function public.flag_request_reapproval(uuid, text) from public;
revoke all on function public.transition_content_item_status(uuid, text, text) from public;
grant execute on function public.get_or_create_default_workflow(uuid) to authenticated;
grant execute on function public.create_approval_request(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.decide_approval_request(uuid, text, text) to authenticated;
grant execute on function public.submit_content_for_client_review(uuid, uuid, uuid) to authenticated;
grant execute on function public.create_client_comment(uuid, text) to authenticated;
-- approval_critical_fields + flag_request_reapproval TIDAK di-grant ke
-- authenticated: keduanya helper internal untuk trigger (SECURITY DEFINER).
-- approval_critical_fields membaca workspace_settings tanpa pemeriksaan
-- keanggotaan (pemanggilan langsung membocorkan daftar field workspace
-- lain); flag_request_reapproval mengubah status request (pemanggilan
-- langsung bisa memaksa reapproval atas konten orang lain). revoke di atas
-- (from public) sudah menutup akses langsung ke keduanya.
grant execute on function public.transition_content_item_status(uuid, text, text) to authenticated;
