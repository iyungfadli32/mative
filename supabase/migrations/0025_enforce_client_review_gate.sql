-- 0025_enforce_client_review_gate.sql — MaTive (perbaikan temuan audit Kritis (d) F-01).
--
-- Latar: audit super-detail 2026-11-21, Area (d) F-01 — gerbang
-- client_review tidak ditegakkan di publishing: konten bisa terbit walau
-- klien menolak. Janji ADR-0010 §5 ("bila gerbang aktif dan request
-- client belum approved, placement BELUM siap dijadwalkan — penegakan
-- di Phase 6") tidak pernah diimplementasikan: publishing_preflight
-- (0020) hanya memeriksa approval INTERNAL; kata `client` tidak muncul
-- sama sekali di file 0020 kecuali komentar `viewer_client`.
--
-- Akar masalah (dua sisi):
--   (1) publishing_preflight memeriksa approval_requests internal
--       'approved' untuk versi terbaru saja — request client tidak
--       pernah dibaca, sehingga create_publishing_job (yang memanggil
--       preflight) dan process_publishing_jobs (yang memanggil preflight
--       ulang) sama-sama lolos walau klien menolak.
--   (2) decide_approval_request (0014:432) cabang changes_requested /
--       rejected hanya mengembalikan produksi ke 'editing' bila
--       production_status = 'internal_review'. Untuk request client,
--       produksi sedang 'approved', jadi penolakan klien tidak mengubah
--       apa-apa — catatan tanpa gigi.
--
-- Perbaikan (pola 0014: salinan fungsi byte-identik KECUALI blok yang
-- ditandai "0025, F-01" di bawah; 0020 dan 0014 TIDAK diubah):
--   (1) publishing_preflight: bila workspace_settings
--       approval.client_review_enabled = {"enabled": true}, blokir bila
--       tidak ada request client 'approved' untuk versi konten terbaru:
--       request client terakhir changes_requested/rejected →
--       CLIENT_REJECTED; belum ada / masih in_review →
--       CLIENT_APPROVAL_REQUIRED. Bila gerbang mati, perilaku lama
--       tidak berubah (blok dilewati seluruhnya).
--       create_publishing_job + process_publishing_jobs ikut tertutup
--       otomatis karena keduanya memanggil preflight ini.
--   (2) decide_approval_request: bila request CLIENT diputuskan
--       changes_requested/rejected dan produksi sedang 'approved',
--       produksi → 'changes_requested' (bukan 'editing': 'approved' →
--       'editing' BUKAN transisi legal — matriks 0008/0014: dari
--       approved hanya archived/changes_requested/cancelled/blocked;
--       cermin TS features/planning/transitions.ts: status exception
--       boleh dimasuki dari status normal mana pun) + status event +
--       activity log, dengan komentar keputusan sebagai alasan.
--       Perilaku request INTERNAL tidak berubah.
--
-- Yang TIDAK ditutup (celah sisa, di luar cakupan F-01):
--   confirm_publishing_job (0020) TIDAK memanggil preflight sama sekali,
--   sehingga konfirmasi manual bisa menerbitkan job yang preflight-nya
--   gagal (temuan audit (e) T-5). Perbaikan itu butuh keputusan sendiri.
--
-- ATURAN KERAS (pola 0008/0010/0014/0020):
--   (1) SECURITY DEFINER + search_path terkunci (public, pg_temp);
--       revoke dari public, grant EXECUTE hanya ke authenticated.
--   (2) TIDAK ADA organisasi/workspace/user/role yang diterima dari
--       client sebagai identitas tepercaya — semua dibaca dari sesi
--       (auth.uid()) + membership (Dok 06 §4).
--   (3) Setiap penulisan state ditemani content_status_events (bila
--       production berubah) + activity_logs, dalam SATU transaksi yang
--       sama (pola 0014).
-- ============================================================================

-- ============================================================================
-- (1) publishing_preflight — tambah gerbang client (0025, F-01)
-- Salinan 0020 byte-identik KECUALI: 3 variabel baru (v_client_*) +
-- blok gerbang client sesudah cek approval internal lolos + komentar
-- fungsi (kode blokir baru). create_publishing_job + process_publishing_jobs
-- TIDAK disentuh — keduanya memanggil preflight ini, jadi ikut tertutup.
-- ============================================================================
create or replace function public.publishing_preflight(
  p_placement_id uuid,
  p_scheduled_at timestamptz default null,
  p_timezone text default null,
  p_exclude_job_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_placement public.content_placements%rowtype;
  v_item public.content_items%rowtype;
  v_tz text;
  v_latest_cv uuid;
  v_latest_cv_number integer;
  v_approved boolean := false;
  v_any_approved boolean := false;
  v_client_enabled boolean := false;
  v_latest_client_status text;
  v_checks jsonb := '[]'::jsonb;
  v_block jsonb;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED', 'message', 'Anda harus masuk dulu.', 'checks', v_checks);
  end if;

  select * into v_placement from public.content_placements where id = p_placement_id;
  if v_placement.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Placement tidak ditemukan.', 'checks', v_checks);
  end if;
  select * into v_item from public.content_items where id = v_placement.content_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Content item placement tidak ditemukan.', 'checks', v_checks);
  end if;

  -- Peran + scope (FORBIDDEN hanya untuk peran/scope — pola Phase 5).
  if not public.is_ws_member(v_item.workspace_id, array['owner', 'admin', 'manager', 'strategist']) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Peran Anda tidak boleh menjadwalkan publikasi.', 'checks', v_checks);
  end if;
  if not public.brand_in_scope(v_item.brand_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Brand placement ini di luar scope Anda.', 'checks', v_checks);
  end if;

  -- Zona waktu efektif = override (bila diberikan) atau timezone placement
  -- (ASUMSI-6.6: placement menang atas item). Validasi IANA lewat katalog
  -- Postgres — bukan tebak-tebakan string.
  v_tz := coalesce(nullif(btrim(p_timezone), ''), v_placement.timezone);
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_checks := v_checks || jsonb_build_object('key', 'timezone', 'severity', 'block', 'passed', false, 'message', format('Zona waktu "%s" bukan IANA valid.', v_tz));
    return jsonb_build_object('ok', false, 'code', 'TIMEZONE_INVALID', 'message', format('Zona waktu "%s" bukan IANA valid.', v_tz), 'checks', v_checks);
  end if;
  v_checks := v_checks || jsonb_build_object('key', 'timezone', 'severity', 'block', 'passed', true, 'message', format('Zona waktu %s valid (sumber: placement).', v_tz));

  -- Sudah terbit? Satu placement = maksimal satu published_posts (0..1).
  if exists (select 1 from public.published_posts where placement_id = p_placement_id) then
    v_checks := v_checks || jsonb_build_object('key', 'already_published', 'severity', 'block', 'passed', false, 'message', 'Placement ini sudah terbit — tidak bisa dijadwalkan lagi.');
    return jsonb_build_object('ok', false, 'code', 'ALREADY_PUBLISHED', 'message', 'Placement ini sudah terbit — tidak bisa dijadwalkan lagi.', 'checks', v_checks);
  end if;

  -- Approval: versi konten TERBARU harus approved (internal). Request
  -- approved untuk versi lama = basi.
  select id, version_number into v_latest_cv, v_latest_cv_number
    from public.content_versions
    where content_item_id = v_item.id
    order by version_number desc limit 1;
  if v_latest_cv is null then
    v_checks := v_checks || jsonb_build_object('key', 'approval', 'severity', 'block', 'passed', false, 'message', 'Konten ini belum punya versi — tidak bisa dijadwalkan.');
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_REQUIRED', 'message', 'Konten ini belum punya versi — tidak bisa dijadwalkan.', 'checks', v_checks);
  end if;
  select exists (
    select 1 from public.approval_requests
    where target_type = 'content_item' and request_type = 'internal' and status = 'approved'
      and content_version_id = v_latest_cv
  ) into v_approved;
  select exists (
    select 1 from public.approval_requests ar
    where ar.target_type = 'content_item' and ar.request_type = 'internal' and ar.status = 'approved'
      and ar.content_version_id in (select id from public.content_versions where content_item_id = v_item.id)
  ) into v_any_approved;
  if not v_approved then
    if v_any_approved then
      v_checks := v_checks || jsonb_build_object('key', 'approval', 'severity', 'block', 'passed', false, 'message', format('Versi terbaru konten (v%s) belum disetujui — approval lama menunjuk versi yang sudah basi.', v_latest_cv_number));
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_STALE', 'message', format('Versi terbaru konten (v%s) belum disetujui — ajukan dan setujui dulu versi terbarunya.', v_latest_cv_number), 'checks', v_checks);
    end if;
    v_checks := v_checks || jsonb_build_object('key', 'approval', 'severity', 'block', 'passed', false, 'message', format('Versi terbaru konten (v%s) belum disetujui.', v_latest_cv_number));
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_REQUIRED', 'message', format('Konten ini belum disetujui (versi terbaru v%s belum approved). Ajukan dan setujui dulu di tab Approval.', v_latest_cv_number), 'checks', v_checks);
  end if;
  v_checks := v_checks || jsonb_build_object('key', 'approval', 'severity', 'block', 'passed', true, 'message', format('Versi terbaru konten (v%s) sudah disetujui.', v_latest_cv_number));

  -- Gerbang client (0025, F-01 / ADR-0010 §5): bila workspace mengaktifkan
  -- review klien, versi konten TERBARU juga harus disetujui klien.
  -- Semantik "request TERBARU yang menang": status request client terbaru
  -- untuk versi ini yang menentukan — 'approved' → lolos; 'changes_requested' /
  -- 'rejected' → CLIENT_REJECTED; belum ada / masih berjalan / reapproval →
  -- CLIENT_APPROVAL_REQUIRED. Hanya request target content_item yang
  -- diperiksa (sama seperti cek internal di atas; aplikasi hanya membuat
  -- request client target content_item, lihat submit_content_for_client_review).
  -- Bila gerbang mati, blok ini dilewati seluruhnya dan perilaku lama
  -- tidak berubah.
  select coalesce((value_json ->> 'enabled')::boolean, false) into v_client_enabled
    from public.workspace_settings
    where workspace_id = v_item.workspace_id and key = 'approval.client_review_enabled';
  if coalesce(v_client_enabled, false) then
    select status into v_latest_client_status
      from public.approval_requests
      where target_type = 'content_item' and request_type = 'client'
        and content_version_id = v_latest_cv
      order by created_at desc, id desc limit 1;
    if v_latest_client_status = 'approved' then
      v_checks := v_checks || jsonb_build_object('key', 'client_approval', 'severity', 'block', 'passed', true, 'message', format('Review klien untuk versi terbaru (v%s) sudah disetujui.', v_latest_cv_number));
    elsif v_latest_client_status in ('changes_requested', 'rejected') then
      v_checks := v_checks || jsonb_build_object('key', 'client_approval', 'severity', 'block', 'passed', false, 'message', format('Review klien untuk versi terbaru (v%s) %s — konten belum bisa dijadwalkan.', v_latest_cv_number, case when v_latest_client_status = 'rejected' then 'ditolak' else 'minta revisi' end));
      return jsonb_build_object('ok', false, 'code', 'CLIENT_REJECTED', 'message', format('Review klien untuk versi terbaru (v%s) %s — konten belum bisa dijadwalkan sampai klien menyetujui versi terbaru.', v_latest_cv_number, case when v_latest_client_status = 'rejected' then 'ditolak' else 'minta revisi' end), 'checks', v_checks);
    else
      v_checks := v_checks || jsonb_build_object('key', 'client_approval', 'severity', 'block', 'passed', false, 'message', format('Versi terbaru konten (v%s) belum disetujui klien.', v_latest_cv_number));
      return jsonb_build_object('ok', false, 'code', 'CLIENT_APPROVAL_REQUIRED', 'message', format('Versi terbaru konten (v%s) belum disetujui klien — ajukan client review dan tunggu persetujuan klien sebelum menjadwalkan.', v_latest_cv_number), 'checks', v_checks);
    end if;
  end if;

  -- Jadwal: bila diberikan, harus di masa depan.
  if p_scheduled_at is not null and p_scheduled_at <= now() then
    v_checks := v_checks || jsonb_build_object('key', 'schedule', 'severity', 'block', 'passed', false, 'message', 'Jadwal harus di masa depan.');
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_PAST', 'message', 'Jadwal harus di masa depan — pilih waktu yang belum lewat.', 'checks', v_checks);
  end if;
  if p_scheduled_at is not null then
    v_checks := v_checks || jsonb_build_object('key', 'schedule', 'severity', 'block', 'passed', true, 'message', 'Jadwal di masa depan.');
  end if;

  -- Duplikat: job aktif (bukan cancelled) untuk placement + waktu yang sama.
  if exists (
    select 1 from public.publishing_jobs j
    where j.placement_id = p_placement_id
      and j.scheduled_at is not distinct from p_scheduled_at
      and j.status <> 'cancelled'
      and (p_exclude_job_id is null or j.id <> p_exclude_job_id)
  ) then
    v_checks := v_checks || jsonb_build_object('key', 'duplicate', 'severity', 'block', 'passed', false, 'message', 'Sudah ada job aktif untuk placement ini pada waktu yang sama.');
    return jsonb_build_object('ok', false, 'code', 'DUPLICATE_JOB', 'message', 'Sudah ada job aktif untuk placement ini pada waktu yang sama — batalkan dulu job itu atau pilih waktu lain.', 'checks', v_checks);
  end if;

  -- Peringatan (tidak memblokir): belum ada koneksi → manual; format kosong.
  v_checks := v_checks || jsonb_build_object('key', 'connection', 'severity', 'warn', 'passed', true, 'message', 'Belum ada koneksi provider — publikasi dilakukan manual di luar MaTive.');
  if v_placement.platform_format is null or btrim(v_placement.platform_format) = '' then
    v_checks := v_checks || jsonb_build_object('key', 'format', 'severity', 'warn', 'passed', false, 'message', 'Format media belum diisi — lengkapi sebelum publikasi manual.');
  else
    v_checks := v_checks || jsonb_build_object('key', 'format', 'severity', 'warn', 'passed', true, 'message', format('Format media: %s.', v_placement.platform_format));
  end if;

  return jsonb_build_object('ok', true, 'code', 'READY', 'message', 'Preflight lolos — job siap dibuat/diproses.', 'checks', v_checks);
end;
$$;

comment on function public.publishing_preflight(uuid, timestamptz, text, uuid) is 'Preflight publishing (0020 + gerbang client 0025, F-01 / ADR-0010 §5): pemeriksaan kesiapan placement sebelum job dibuat/diproses. TIDAK PERNAH melempar — mengembalikan {ok, code, message, checks}. Blokir: FORBIDDEN / TIMEZONE_INVALID / ALREADY_PUBLISHED / APPROVAL_REQUIRED / APPROVAL_STALE / CLIENT_APPROVAL_REQUIRED / CLIENT_REJECTED / SCHEDULE_PAST / DUPLICATE_JOB. Peringatan: koneksi (selalu manual di Phase 6), format kosong.';

revoke all on function public.publishing_preflight(uuid, timestamptz, text, uuid) from public;
grant execute on function public.publishing_preflight(uuid, timestamptz, text, uuid) to authenticated;

-- ============================================================================
-- (2) decide_approval_request — penolakan client mengembalikan produksi (0025, F-01)
-- Salinan 0014 byte-identik KECUALI: cabang elsif baru di blok
-- changes_requested/rejected (produksi 'approved' → 'changes_requested'
-- untuk request CLIENT saja) + komentar fungsi. Perilaku request
-- INTERNAL tidak berubah.
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
