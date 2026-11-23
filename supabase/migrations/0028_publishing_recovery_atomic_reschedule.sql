-- MaTive — migrasi 0028: Batch (e) T-1..T-5 (penerbitan & penjadwalan).
--
-- T-1: process_publishing_jobs kini MEMULIHKAN job needs_manual_action bila
--   preflight ulang lolos (placement_version_id diperbarui ke versi terbaru,
--   status kembali ke ready/scheduled_locally, attempt 'recovered_ready').
--   Preflight ulang untuk job jatuh tempo memakai jadwal NULL agar tidak
--   gagal SCHEDULE_PAST atas jadwalnya sendiri.
-- T-2: (a) confirm_publishing_job kini mengizinkan konfirmasi manual dari job
--   'failed' (konfirmasi manual adalah satu-satunya jalan ke Published);
--   (c) cek duplikat publishing_preflight + indeks unik parsial slot jadwal
--   tidak lagi menganggap job 'failed' sebagai pengunci slot.
-- T-3: change_placement_distribution menolak penulisan manual ke 'published'
--   dan 'uploaded_or_draft_created' (hanya lewat alur publishing), dan
--   pengubahan manual ke 'cancelled' ikut membatalkan job aktif terkait
--   (dengan attempt 'cancelled' per job).
-- T-4: trigger BEFORE DELETE content_placements menolak hapus placement bila
--   ada published_posts atau job publishing aktif (ready/scheduled_locally/
--   sending/needs_manual_action); job failed/cancelled tidak menghalangi.
-- T-5: fungsi baru reschedule_publishing_job — penjadwalan ulang ATOMIK:
--   preflight jadwal baru dulu (job lama dikecualikan), lalu batalkan job lama
--   + buat job baru dalam satu transaksi.
--
-- Migrasi ini hanya mendefinisikan ulang fungsi dan satu indeks; tidak ada
-- tabel baru dan tidak ada baris data yang diubah. Aman dijalankan ulang
-- (create or replace / drop if exists).

-- (e) T-1/T-5: izinkan status attempt 'preflight_failed' (cabang pemulihan process_publishing_jobs saat preflight ulang gagal; job tetap needs_manual_action) dan 'created' (reschedule_publishing_job mencatat job pengganti).
alter table public.publishing_attempts drop constraint if exists publishing_attempts_result_status_check;
alter table public.publishing_attempts add constraint publishing_attempts_result_status_check check (result_status in ('handoff_manual', 'failed', 'published', 'cancelled', 'recovered_ready', 'retry_scheduled', 'preflight_failed','created'));

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

  -- Duplikat: job aktif (bukan cancelled/failed) untuk placement + waktu yang sama.
  if exists (
    select 1 from public.publishing_jobs j
    where j.placement_id = p_placement_id
      and j.scheduled_at is not distinct from p_scheduled_at
      and j.status not in ('cancelled', 'failed')
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
create or replace function public.process_publishing_jobs(
  p_workspace_id uuid,
  p_job_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_claim jsonb;
  v_job_id uuid;
  v_job public.publishing_jobs%rowtype;
  v_pre jsonb;
  v_pre_ok boolean;
  v_pre_code text;
  v_pre_msg text;
  v_prior_status text;
  v_recovered_status text;
  v_latest_pv uuid;
  v_n integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_outcome text;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED', 'message', 'Anda harus masuk dulu.');
  end if;
  if not public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist']) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Peran Anda tidak boleh memproses antrean publishing.');
  end if;

  loop
    exit when v_n >= 20;
    -- Klaim satu job (p_job_id = satu job saja; null = job jatuh tempo).
    -- (e) T-1: catat status SEBELUM klaim — klaim mengubah status menjadi
    -- 'sending', sehingga jalur periksa-ulang (dari 'needs_manual_action')
    -- tidak lagi bisa dibedakan sesudah klaim.
    v_prior_status := null;
    if p_job_id is not null then
      select status into v_prior_status from public.publishing_jobs where id = p_job_id;
    end if;
    v_claim := public.claim_publishing_job(p_workspace_id, p_job_id);
    if not (v_claim ->> 'ok')::boolean then
      return v_claim;
    end if;
    v_job_id := (v_claim ->> 'job_id')::uuid;
    exit when v_job_id is null;
    -- Bila p_job_id diberikan, proses tepat satu job lalu berhenti.
    v_n := v_n + 1;

    begin
      select * into v_job from public.publishing_jobs where id = v_job_id;

      -- Placement diedit sesudah job dibuat? (snapshot versi ≠ terbaru)
      select id into v_latest_pv
        from public.placement_versions
        where placement_id = v_job.placement_id
        order by version_number desc limit 1;
      if v_latest_pv is distinct from v_job.placement_version_id then
    if v_prior_status = 'needs_manual_action' then
        -- (e) T-1 — periksa ulang: preflight ulang TANPA cek jadwal (job yang
        -- diperiksa ulang sudah jatuh tempo; SCHEDULE_PAST tidak relevan) dan
        -- TANPA cek duplikat waktu (slot job ini sendiri dikecualikan; job aktif
        -- lain tidak bisa memakai slot yang sama selama job ini masih aktif).
        v_pre := public.publishing_preflight(v_job.placement_id, null, v_job.timezone, v_job_id);
        v_pre_ok := (v_pre ->> 'ok')::boolean;
        v_pre_code := v_pre ->> 'code';
        v_pre_msg := v_pre ->> 'message';
        if v_pre_ok then
          -- Pemulihan: snapshot ke versi terbaru + kembali ke ready/scheduled_locally.
          v_recovered_status := case when v_job.scheduled_at <= now() then 'ready' else 'scheduled_locally' end;
          update public.publishing_jobs
            set status = v_recovered_status, placement_version_id = v_latest_pv, lease_owner = null, lease_until = null, next_attempt_at = null, updated_at = now()
            where id = v_job_id;
          update public.content_placements
            set distribution_status = v_recovered_status, updated_at = now()
            where id = v_job.placement_id;
          insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_message_safe, started_at, completed_at)
            values (v_job_id, (select coalesce(max(attempt_number), 0) + 1 from public.publishing_attempts where publishing_job_id = v_job_id),
              'recovered_ready', 'Periksa ulang lolos — snapshot diperbarui ke versi placement terbaru; job kembali ke ' || v_recovered_status || '.', now(), now());
          update public.publishing_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = v_job_id;
          v_results := v_results || jsonb_build_object('job_id', v_job_id, 'outcome', 'recovered_ready', 'code', 'RECOVERED_READY', 'status', v_recovered_status);
        else
          -- Masih ada penghalang nyata: tetap menunggu aksi manual, dengan alasan
          -- preflight terbaru (bukan PLACEMENT_CHANGED).
          update public.publishing_jobs
            set status = 'needs_manual_action', lease_owner = null, lease_until = null, updated_at = now()
            where id = v_job_id;
          update public.content_placements
            set distribution_status = 'needs_manual_action', updated_at = now()
            where id = v_job.placement_id;
          insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_code, error_message_safe, started_at, completed_at)
            values (v_job_id, (select coalesce(max(attempt_number), 0) + 1 from public.publishing_attempts where publishing_job_id = v_job_id),
              'preflight_failed', v_pre_code, v_pre_msg, now(), now());
          update public.publishing_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = v_job_id;
          v_results := v_results || jsonb_build_object('job_id', v_job_id, 'outcome', 'needs_manual_action', 'code', v_pre_code);
        end if;
    else
          update public.publishing_jobs
            set status = 'needs_manual_action', lease_owner = null, lease_until = null, updated_at = now()
            where id = v_job_id;
          update public.content_placements
            set distribution_status = 'needs_manual_action', updated_at = now()
            where id = v_job.placement_id;
          insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_code, error_message_safe, started_at, completed_at)
            values (v_job_id, (select coalesce(max(attempt_number), 0) + 1 from public.publishing_attempts where publishing_job_id = v_job_id),
              'handoff_manual', 'PLACEMENT_CHANGED', 'Placement diedit sesudah job dibuat — periksa ulang sebelum publikasi manual.', now(), now());
          update public.publishing_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = v_job_id;
          v_results := v_results || jsonb_build_object('job_id', v_job_id, 'outcome', 'needs_manual_action', 'code', 'PLACEMENT_CHANGED');
    end if;
      else
        -- Preflight ulang (jadwal job sendiri dikecualikan dari cek duplikat).
        v_pre := public.publishing_preflight(v_job.placement_id, v_job.scheduled_at, v_job.timezone, v_job_id);
        v_pre_ok := (v_pre ->> 'ok')::boolean;
        v_pre_code := v_pre ->> 'code';
        v_pre_msg := v_pre ->> 'message';
        if v_pre_ok then
          if v_prior_status = 'needs_manual_action' then
            -- (e) T-1 — periksa ulang lolos: job pulih ke ready/scheduled_locally
            -- (snapshot sudah sama dengan versi terbaru di cabang ini).
            v_recovered_status := case when v_job.scheduled_at <= now() then 'ready' else 'scheduled_locally' end;
            update public.publishing_jobs
              set status = v_recovered_status, lease_owner = null, lease_until = null, next_attempt_at = null, updated_at = now()
              where id = v_job_id;
            update public.content_placements
              set distribution_status = v_recovered_status, updated_at = now()
              where id = v_job.placement_id;
            insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_message_safe, started_at, completed_at)
              values (v_job_id, (select coalesce(max(attempt_number), 0) + 1 from public.publishing_attempts where publishing_job_id = v_job_id),
                'recovered_ready', 'Periksa ulang lolos — job kembali ke ' || v_recovered_status || '.', now(), now());
            update public.publishing_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = v_job_id;
            v_outcome := 'recovered_ready';
            v_pre_code := 'RECOVERED_READY';
          else
            -- Tidak ada provider: handoff ke manual (bukan 'failed').
            update public.publishing_jobs
              set status = 'needs_manual_action', lease_owner = null, lease_until = null, updated_at = now()
              where id = v_job_id;
            update public.content_placements
              set distribution_status = 'needs_manual_action', updated_at = now()
              where id = v_job.placement_id;
            insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_message_safe, started_at, completed_at)
              values (v_job_id, (select coalesce(max(attempt_number), 0) + 1 from public.publishing_attempts where publishing_job_id = v_job_id),
                'handoff_manual', 'Siap dipublikasikan manual — tidak ada provider di fase ini.', now(), now());
            update public.publishing_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = v_job_id;
            v_outcome := 'needs_manual_action';
          end if;
        else
          -- Preflight gagal → manual juga (bukan blind retry; R6.3).
          update public.publishing_jobs
            set status = 'needs_manual_action', lease_owner = null, lease_until = null, updated_at = now()
            where id = v_job_id;
          update public.content_placements
            set distribution_status = 'needs_manual_action', updated_at = now()
            where id = v_job.placement_id;
          insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_code, error_message_safe, started_at, completed_at)
            values (v_job_id, (select coalesce(max(attempt_number), 0) + 1 from public.publishing_attempts where publishing_job_id = v_job_id),
              'handoff_manual', v_pre_code, v_pre_msg, now(), now());
          update public.publishing_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = v_job_id;
          v_outcome := 'needs_manual_action';
        end if;
        v_results := v_results || jsonb_build_object('job_id', v_job_id, 'outcome', v_outcome, 'code', v_pre_code);
      end if;
    exception when others then
      -- Galat tak terduga saat memproses job ini → 'failed' (retryable),
      -- loop lanjut ke job berikutnya. TIDAK PERNAH menggagalkan seluruh batch.
      update public.publishing_jobs
        set status = 'failed', lease_owner = null, lease_until = null, updated_at = now()
        where id = v_job_id;
      update public.content_placements
        set distribution_status = 'failed', updated_at = now()
        where id = (select placement_id from public.publishing_jobs where id = v_job_id);
      insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_code, error_message_safe, started_at, completed_at)
        values (v_job_id, (select coalesce(max(attempt_number), 0) + 1 from public.publishing_attempts where publishing_job_id = v_job_id),
          'failed', 'TRANSIENT_ERROR', 'Pemrosesan job gagal (galat transient) — bisa di-retry.', now(), now());
      update public.publishing_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = v_job_id;
      v_results := v_results || jsonb_build_object('job_id', v_job_id, 'outcome', 'failed', 'code', 'TRANSIENT_ERROR');
    end;

    exit when p_job_id is not null;
  end loop;

  return jsonb_build_object('ok', true, 'code', 'PROCESSED', 'processed', v_n, 'results', v_results,
    'message', format('%s job diproses — tidak ada provider di fase ini, job yang jatuh tempo diserahkan ke publikasi manual.', v_n));
end;
$$;
create or replace function public.confirm_publishing_job(
  p_job_id uuid,
  p_canonical_url text,
  p_published_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_job public.publishing_jobs%rowtype;
  v_item public.content_items%rowtype;
  v_url text := btrim(coalesce(p_canonical_url, ''));
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED', 'message', 'Anda harus masuk dulu.');
  end if;
  if v_url = '' or length(v_url) > 2048 or v_url ~ '\s' or v_url !~ '^https?://[^/]+' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_URL', 'message', 'URL publikasi tidak valid — isi URL lengkap (http:// atau https://) tanpa spasi.');
  end if;
  if p_published_at is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PUBLISHED_AT', 'message', 'Waktu publikasi wajib diisi.');
  end if;
  if p_published_at > now() + interval '5 minutes' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PUBLISHED_AT', 'message', 'Waktu publikasi tidak boleh di masa depan.');
  end if;

  select * into v_job from public.publishing_jobs where id = p_job_id for update;
  if v_job.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Job tidak ditemukan.');
  end if;
  select * into v_item from public.content_items ci
    join public.content_placements pl on pl.content_item_id = ci.id
    where pl.id = v_job.placement_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Content item job tidak ditemukan.');
  end if;
  if not public.is_ws_member(v_item.workspace_id, array['owner', 'admin', 'manager', 'strategist']) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Peran Anda tidak boleh mengonfirmasi publikasi.');
  end if;
  if not public.brand_in_scope(v_item.brand_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Brand job ini di luar scope Anda.');
  end if;
  if v_job.status in ('published', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', format('Job %s tidak bisa dikonfirmasi terbit (status terminal — buat job baru).', v_job.status));
  end if;
  if v_job.status = 'sending' and v_job.lease_until is not null and v_job.lease_until > now() then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', 'Job sedang diproses (lease aktif) — tunggu sampai lease selesai, lalu konfirmasi.');
  end if;
  if exists (select 1 from public.published_posts where placement_id = v_job.placement_id) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_PUBLISHED', 'message', 'Placement ini sudah terbit — tidak bisa dikonfirmasi dua kali.');
  end if;

  insert into public.published_posts (
    workspace_id, placement_id, provider_post_id, canonical_url, published_at,
    confirmation_source, raw_metadata_reference, created_by
  ) values (
    v_item.workspace_id, v_job.placement_id, null, v_url, p_published_at,
    'manual_user_confirmation', 'publishing_job:' || p_job_id::text, v_caller
  );
  update public.publishing_jobs
    set status = 'published', lease_owner = null, lease_until = null, updated_at = now()
    where id = p_job_id;
  update public.content_placements
    set distribution_status = 'published', published_url = v_url, updated_at = now()
    where id = v_job.placement_id;
  insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_message_safe, started_at, completed_at)
    values (p_job_id, (select coalesce(max(attempt_number), 0) + 1 from public.publishing_attempts where publishing_job_id = p_job_id),
      'published', format('Dikonfirmasi manual oleh pengguna — %s.', v_url), now(), now());
  update public.publishing_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = p_job_id;

  return jsonb_build_object('ok', true, 'code', 'PUBLISHED', 'job_id', p_job_id,
    'message', 'Publikasi dikonfirmasi manual — status Published (konfirmasi pengguna, bukan provider).');
end;
$$;
create or replace function public.change_placement_distribution(
  p_placement_id uuid,
  p_to_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pl public.content_placements%rowtype;
  v_item public.content_items%rowtype;
  v_allowed boolean := false;
  v_cancel_job record;
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
  if p_to_status is null or p_to_status not in (
    'draft', 'ready', 'scheduled_locally', 'sending',
    'uploaded_or_draft_created', 'published', 'failed',
    'needs_manual_action', 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'message', 'Status distribusi tujuan tidak dikenal.');
  end if;
  if v_pl.distribution_status = p_to_status then
    return jsonb_build_object('ok', false, 'message', 'Placement sudah berada di status distribusi tersebut.');
  end if;
  if not public.can_edit_placement(p_placement_id) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak mengubah status distribusi placement ini.');
  end if;


  -- (e) T-3: 'published' dan 'uploaded_or_draft_created' HANYA boleh ditulis
  -- RPC publishing (confirm_publishing_job / alur proses). Perubahan manual ke
  -- sana memalsukan status tanpa job dan tanpa bukti terbit.
  if p_to_status in ('published', 'uploaded_or_draft_created') then
    return jsonb_build_object('ok', false, 'code', 'DISTRIBUTION_MANUAL_PUBLISH_FORBIDDEN',
      'message', 'Status "' || p_to_status || '" hanya boleh ditulis lewat alur publishing (konfirmasi manual job) — tidak bisa diubah manual dari form distribusi.');
  end if;
  v_allowed := case v_pl.distribution_status
    when 'draft' then p_to_status in ('ready', 'cancelled')
    when 'ready' then p_to_status in ('scheduled_locally', 'draft', 'cancelled')
    when 'scheduled_locally' then p_to_status in ('sending', 'ready', 'cancelled')
    when 'sending' then p_to_status in ('uploaded_or_draft_created', 'failed', 'needs_manual_action')
    when 'uploaded_or_draft_created' then p_to_status in ('published', 'failed', 'needs_manual_action')
    when 'published' then false
    when 'failed' then p_to_status in ('ready', 'cancelled')
    when 'needs_manual_action' then p_to_status in ('ready', 'cancelled')
    when 'cancelled' then p_to_status in ('ready')
    else false
  end;
  if not v_allowed then
    return jsonb_build_object('ok', false, 'message', format('Transisi distribusi %s → %s tidak diizinkan.', v_pl.distribution_status, p_to_status));
  end if;

  update public.content_placements set
    distribution_status = p_to_status,
    updated_at = now()
  where id = p_placement_id;

  insert into public.content_status_events (
    content_item_id, from_status, to_status, actor_user_id, reason
  ) values (
    v_pl.content_item_id, v_pl.distribution_status, p_to_status, v_caller,
    'distribusi: ' || coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'perubahan status distribusi placement')
  );

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action,
    before_snapshot, after_snapshot
  ) values (
    v_item.workspace_id, v_caller, 'content_placement', p_placement_id, 'distribution_status_changed',
    jsonb_build_object('distribution_status', v_pl.distribution_status),
    jsonb_build_object('distribution_status', p_to_status)
  );

  -- (e) T-3: perubahan manual ke 'cancelled' membatalkan job aktif terkait
  -- (ready/scheduled_locally/needs_manual_action, plus 'sending' yang lease-nya
  -- sudah kedaluwarsa) dan mencatatnya di publishing_attempts, supaya job tidak
  -- lagi menimpa status placement sesudah dibatalkan manual.
  if p_to_status = 'cancelled' then
    for v_cancel_job in
      select id from public.publishing_jobs
      where placement_id = p_placement_id
        and (status in ('ready', 'scheduled_locally', 'needs_manual_action')
          or (status = 'sending' and (lease_until is null or lease_until <= now())))
    loop
      update public.publishing_jobs
        set status = 'cancelled', lease_owner = null, lease_until = null, next_attempt_at = null, updated_at = now()
        where id = v_cancel_job.id;
      insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_message_safe, started_at, completed_at)
        values (v_cancel_job.id, (select coalesce(max(attempt_number), 0) + 1 from public.publishing_attempts where publishing_job_id = v_cancel_job.id),
          'cancelled', 'Dibatalkan: status distribusi placement diubah manual menjadi cancelled.', now(), now());
      update public.publishing_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = v_cancel_job.id;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'from_status', v_pl.distribution_status, 'to_status', p_to_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- (e) T-5 — reschedule_publishing_job: penjadwalan ulang ATOMIK (satu transaksi).
-- Urutan: (1) validasi jadwal baru + preflight (dengan job lama dikecualikan)
-- SEBELUM membatalkan apa pun — bila jadwal baru tidak valid (SCHEDULE_PAST,
-- APPROVAL_STALE, DUPLICATE_JOB, gerbang client), job lama UTUH; (2) batalkan
-- job lama + buat job baru dalam transaksi yang sama — gagal di langkah mana
-- pun me-rollback semuanya, sehingga jadwal tidak pernah hilang.
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_publishing_job(
  p_job_id uuid,
  p_scheduled_at timestamptz,
  p_timezone text default 'Asia/Jakarta'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_job public.publishing_jobs%rowtype;
  v_pl public.content_placements%rowtype;
  v_item public.content_items%rowtype;
  v_pre jsonb;
  v_pre_ok boolean;
  v_latest_pv uuid;
  v_status text;
  v_key text;
  v_tz text;
  v_new_id uuid := gen_random_uuid();
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED', 'message', 'Anda harus masuk dulu.');
  end if;
  select * into v_job from public.publishing_jobs where id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND', 'message', 'Job tidak ditemukan.');
  end if;
  select * into v_pl from public.content_placements where id = v_job.placement_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PLACEMENT_NOT_FOUND', 'message', 'Placement tidak ditemukan.');
  end if;
  select * into v_item from public.content_items where id = v_pl.content_item_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONTENT_NOT_FOUND', 'message', 'Konten tidak ditemukan.');
  end if;
  if not public.is_ws_member(v_item.workspace_id, array['owner', 'admin', 'manager', 'strategist']) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Peran Anda tidak boleh menjadwalkan ulang publikasi.');
  end if;
  if not public.brand_in_scope(v_item.brand_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Brand job ini di luar scope Anda.');
  end if;
  if v_job.status in ('published', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', 'Job ' || v_job.status || ' tidak bisa dijadwalkan ulang.');
  end if;
  if v_job.status = 'sending' and v_job.lease_until is not null and v_job.lease_until > now() then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', 'Job sedang diproses (lease aktif) — tunggu sampai lease berakhir.');
  end if;
  if p_scheduled_at is null then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_PAST', 'message', 'Jadwal baru wajib diisi.');
  end if;
  v_tz := coalesce(nullif(btrim(p_timezone), ''), v_job.timezone, 'Asia/Jakarta');
  -- (1) Validasi jadwal baru + preflight SEBELUM membatalkan job lama.
  v_pre := public.publishing_preflight(v_job.placement_id, p_scheduled_at, v_tz, p_job_id);
  v_pre_ok := (v_pre ->> 'ok')::boolean;
  if not v_pre_ok then
    return v_pre;
  end if;
  -- (2) Batalkan job lama (tanpa menyentuh status placement — pembuatan job baru
  -- di bawah yang menetapkan status akhir placement).
  update public.publishing_jobs
    set status = 'cancelled', lease_owner = null, lease_until = null, next_attempt_at = null, updated_at = now()
    where id = p_job_id;
  insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_message_safe, started_at, completed_at)
    values (p_job_id, (select coalesce(max(attempt_number), 0) + 1 from public.publishing_attempts where publishing_job_id = p_job_id),
      'cancelled', 'Dijadwalkan ulang ke ' || to_char(p_scheduled_at at time zone v_tz, 'YYYY-MM-DD HH24:MI') || ' (' || v_tz || ').', now(), now());
  update public.publishing_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = p_job_id;
  -- (3) Buat job baru (cermin create_publishing_job: snapshot versi terbaru).
  select id into v_latest_pv
    from public.placement_versions
    where placement_id = v_job.placement_id
    order by version_number desc
    limit 1;
  v_status := case when p_scheduled_at <= now() then 'ready' else 'scheduled_locally' end;
  v_key := v_job.placement_id::text || '|' || to_char(p_scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  insert into public.publishing_jobs (id, workspace_id, placement_id, placement_version_id, scheduled_at, timezone, status, idempotency_key, created_by)
    values (v_new_id, v_job.workspace_id, v_job.placement_id, v_latest_pv, p_scheduled_at, v_tz, v_status, v_key, v_caller);
  insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_message_safe, started_at, completed_at)
    values (v_new_id, 1, 'created', 'Job pengganti dibuat lewat penjadwalan ulang dari job ' || p_job_id::text || '.', now(), now());
  update public.content_placements
    set scheduled_at = p_scheduled_at, timezone = v_tz, distribution_status = v_status, updated_at = now()
    where id = v_job.placement_id;
  return jsonb_build_object('ok', true, 'code', 'RESCHEDULED', 'job_id', v_new_id, 'old_job_id', p_job_id, 'status', v_status,
    'message', 'Jadwal dipindah ke ' || to_char(p_scheduled_at at time zone v_tz, 'YYYY-MM-DD HH24:MI') || ' (' || v_tz || ') — job lama dibatalkan dan job baru dibuat dalam satu transaksi.');
end;
$$;

comment on function public.reschedule_publishing_job(uuid, timestamptz, text) is 'Batch (e) T-5: penjadwalan ulang atomik — preflight jadwal baru dulu, lalu batalkan job lama + buat job baru dalam satu transaksi.';
revoke all on function public.reschedule_publishing_job(uuid, timestamptz, text) from public;
grant execute on function public.reschedule_publishing_job(uuid, timestamptz, text) to authenticated;


-- ---------------------------------------------------------------------------
-- (e) T-4 — pengaman hapus placement: tolak DELETE bila placement masih punya
-- bukti terbit (published_posts) atau job publishing aktif. Job 'failed' /
-- 'cancelled' tidak menghalangi (terminal), dan penghapusan placement TANPA
-- bukti/job aktif tetap berjalan seperti semula.
-- ---------------------------------------------------------------------------
create or replace function public.forbid_placement_delete_with_publishing_evidence()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.published_posts where placement_id = old.id) then
    raise exception 'Placement % tidak bisa dihapus: sudah ada bukti terbit (published_posts).', old.id using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.publishing_jobs
    where placement_id = old.id
      and status in ('ready', 'scheduled_locally', 'sending', 'needs_manual_action')
  ) then
    raise exception 'Placement % tidak bisa dihapus: masih ada job publishing aktif. Batalkan dulu job-nya.', old.id using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

comment on function public.forbid_placement_delete_with_publishing_evidence() is 'Batch (e) T-4: pengaman BEFORE DELETE content_placements — tolak hapus bila ada published_posts atau job publishing aktif.';

drop trigger if exists trg_forbid_placement_delete_with_publishing_evidence on public.content_placements;
create trigger trg_forbid_placement_delete_with_publishing_evidence
  before delete on public.content_placements
  for each row execute function public.forbid_placement_delete_with_publishing_evidence();


-- ---------------------------------------------------------------------------
-- (e) T-2(c) — indeks unik parsial slot jadwal: job 'failed' tidak lagi
-- mengunci slot (cermin perubahan cek duplikat di publishing_preflight).
-- Predikat baru lebih longgar (mengecualikan 'cancelled' DAN 'failed'),
-- sehingga data yang lolos predikat lama pasti lolos predikat baru.
-- ---------------------------------------------------------------------------
drop index if exists public.idx_publishing_jobs_idempotency_active;
create unique index idx_publishing_jobs_idempotency_active
  on public.publishing_jobs (placement_id, scheduled_at)
  where status not in ('cancelled', 'failed');
comment on index public.idx_publishing_jobs_idempotency_active is 'Slot jadwal aktif per placement + waktu; job cancelled/failed tidak mengunci slot (batch e T-2).';


comment on function public.publishing_preflight(uuid, timestamptz, text, uuid) is 'Batch (e) T-2(c): cek duplikat tidak lagi menganggap job failed sebagai pengunci slot.';
comment on function public.process_publishing_jobs(uuid, uuid) is 'Batch (e) T-1: pemulihan job needs_manual_action bila preflight ulang lolos (attempt recovered_ready).';
comment on function public.confirm_publishing_job(uuid, text, timestamptz) is 'Batch (e) T-2(a): konfirmasi manual diizinkan dari job failed.';
comment on function public.change_placement_distribution(uuid, text, text) is 'Batch (e) T-3: larang tulis manual ke published/uploaded_or_draft_created; manual ke cancelled ikut membatalkan job aktif.';
