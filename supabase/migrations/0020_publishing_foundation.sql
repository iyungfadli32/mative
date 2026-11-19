-- MaTive Phase 6 — Publishing Foundation (migrasi 0020)
-- ADR-0012. Manual-only (Keputusan #3): TIDAK ADA adapter provider di fase
-- ini; satu-satunya jalan ke Published adalah konfirmasi manual eksplisit.
--
-- Isi:
--   (1) CHECK content_placements: remote_post_id tetap null; published_url
--       kini BOLEH diisi konfirmasi manual (CHECK lama dicabut, sesuai
--       komentar 0007: "CHECK dicabut migrasi Phase 6").
--   (2) Tabel baru: publishing_jobs, publishing_attempts, published_posts.
--   (3) RLS + policy (baca: member / shared; tulis: HANYA lewat RPC —
--       pola visual_orders 0017) + grant select saja.
--   (4) RPC (SECURITY DEFINER, {ok, code, message}, TIDAK melempar):
--       publishing_preflight, create_publishing_job, claim_publishing_job,
--       process_publishing_jobs, retry_publishing_job, cancel_publishing_job,
--       confirm_publishing_job + publishing_backoff_minutes.
--   (5) ASUMSI-6.2: idempotency_key unik per placement + scheduled_at UTC,
--       indeks partial (job cancelled membebaskan slotnya — ADR-0012 §4).
--   (6) ASUMSI-6.4: provider_job_id / provider_post_id selalu null (CHECK).
--
-- Aturan keras (pelajaran Phase 5): policy INSERT TIDAK BOLEH memeriksa
-- baris yang sedang di-INSERT di tabelnya sendiri; policy INSERT hanya
-- memakai WITH CHECK (bukan USING); pglast OK bukan berarti Postgres
-- menerima — jalankan pgTAP 06 sebelum klaim lolos.

-- ============================================================================
-- (1) CHECK placements: remote_post_id tetap null, published_url boleh diisi
-- ============================================================================
alter table public.content_placements
  drop constraint if exists content_placements_remote_post_id_null_check;
alter table public.content_placements
  add constraint content_placements_remote_post_id_null_check
  check (remote_post_id is null);

comment on constraint content_placements_remote_post_id_null_check on public.content_placements is
  'Phase 6 (0020): remote_post_id tetap null — belum ada provider. published_url kini BOLEH diisi konfirmasi manual (CHECK lama yang melarang keduanya dicabut). Phase 7 melonggarkan CHECK ini saat adapter pertama ada.';

-- ============================================================================
-- (2) Tabel baru
-- ============================================================================

-- --- publishing_jobs ---------------------------------------------------------
-- Satu job = satu rencana publikasi untuk satu placement. Status mengikuti
-- 9 label Dok 08 §6 (uploaded_or_draft_created tidak pernah tercapai di
-- Phase 6 — tidak ada provider). placement_version_id = snapshot versi
-- placement saat job dibuat (preflight saat proses menolak bila placement
-- diedit sesudahnya — ADR-0012 §9).
create table if not exists public.publishing_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  placement_id uuid not null references public.content_placements (id) on delete cascade,
  placement_version_id uuid references public.placement_versions (id) on delete set null,
  scheduled_at timestamptz,
  timezone text not null default 'Asia/Jakarta',
  status text not null default 'ready'
    constraint publishing_jobs_status_check
    check (status in (
      'ready', 'scheduled_locally', 'sending', 'needs_manual_action',
      'failed', 'published', 'cancelled'
    )),
  idempotency_key text not null,
  provider_job_id text
    constraint publishing_jobs_provider_job_id_null_check
    check (provider_job_id is null),
  next_attempt_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner uuid references auth.users (id) on delete set null,
  lease_until timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.publishing_jobs is 'Antrean publishing lokal (Phase 6, ADR-0012): satu job per placement + jadwal. Status = 9 label Dok 08 §6. provider_job_id SELALU null di fase ini (ASUMSI-6.4, CHECK). Tulis HANYA lewat RPC 0020.';
comment on column public.publishing_jobs.idempotency_key is 'Unik per placement + scheduled_at UTC (ASUMSI-6.2): pub:<placement_id>:<scheduled_at ISO atau immediate>. Indeks partial — job cancelled membebaskan slotnya.';
comment on column public.publishing_jobs.placement_version_id is 'Snapshot versi placement saat job dibuat; preflight saat proses menolak (PLACEMENT_CHANGED) bila versi terbaru sudah berbeda.';
comment on column public.publishing_jobs.lease_until is 'Lease worker lokal 5 menit (ASUMSI-6.3). Claim kadaluarsa boleh direbut proses berikutnya.';

-- --- publishing_attempts ------------------------------------------------------
-- Riwayat pemrosesan per job (append-only). provider_response_safe SELALU
-- null di Phase 6 (tidak ada respons provider); error_code/error_message_safe
-- hanya berisi kode + pesan aman buatan sendiri (TANPA secret/token).
create table if not exists public.publishing_attempts (
  id uuid primary key default gen_random_uuid(),
  publishing_job_id uuid not null references public.publishing_jobs (id) on delete cascade,
  attempt_number integer not null check (attempt_number >= 1),
  result_status text not null
    constraint publishing_attempts_result_status_check
    check (result_status in (
      'handoff_manual', 'failed', 'published', 'cancelled',
      'recovered_ready', 'retry_scheduled'
    )),
  provider_response_safe text,
  error_code text,
  error_message_safe text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (publishing_job_id, attempt_number)
);

comment on table public.publishing_attempts is 'Riwayat attempts per job (Phase 6): satu baris per kejadian pemrosesan (handoff manual, gagal, terbit, batal, pulih, retry). Append-only — TIDAK ADA update/delete lewat RLS.';

-- --- published_posts -----------------------------------------------------------
-- Bukti publikasi. Satu placement = maksimal satu baris (0..1, Dok 05 §5).
-- confirmation_source HANYA manual di Phase 6 (CHECK); provider_post_id
-- SELALU null (ASUMSI-6.4).
create table if not exists public.published_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  placement_id uuid not null unique references public.content_placements (id) on delete cascade,
  provider_post_id text
    constraint published_posts_provider_post_id_null_check
    check (provider_post_id is null),
  canonical_url text not null constraint published_posts_canonical_url_check check (btrim(canonical_url) <> ''),
  published_at timestamptz not null,
  confirmation_source text not null default 'manual_user_confirmation'
    constraint published_posts_confirmation_source_check
    check (confirmation_source in ('manual_user_confirmation')),
  raw_metadata_reference text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.published_posts is 'Bukti publikasi (Phase 6): satu baris per placement yang terbit. Hanya dari konfirmasi manual (confirmation_source manual_user_confirmation, provider_post_id null). Phase 7 memperluas CHECK saat adapter pertama ada.';
comment on column public.published_posts.raw_metadata_reference is 'Referensi bukti, bukan payload: publishing_job:<uuid job> (manual). Tidak berisi secret/token.';

-- ============================================================================
-- (3) Indeks
-- ============================================================================
create index if not exists idx_publishing_jobs_workspace_status
  on public.publishing_jobs (workspace_id, status);
create index if not exists idx_publishing_jobs_sched
  on public.publishing_jobs (scheduled_at);
create index if not exists idx_publishing_jobs_placement
  on public.publishing_jobs (placement_id);
-- ASUMSI-6.2 (partial): hanya job aktif yang mengunci slot; job cancelled
-- membebaskan slotnya sehingga waktu yang sama bisa dijadwalkan ulang.
create unique index if not exists idx_publishing_jobs_idempotency_active
  on public.publishing_jobs (placement_id, scheduled_at)
  where status <> 'cancelled';
create index if not exists idx_publishing_attempts_job
  on public.publishing_attempts (publishing_job_id, attempt_number);
create index if not exists idx_published_posts_workspace
  on public.published_posts (workspace_id);

-- ============================================================================
-- (4) RLS — aktif + policy + helper
-- ============================================================================
alter table public.publishing_jobs enable row level security;
alter table public.publishing_attempts enable row level security;
alter table public.published_posts enable row level security;

-- Helper RLS untuk attempts (pola is_campaign_template_member 0017):
-- policy TIDAK BOLEH memindai tabel lain — hanya helper + kolom baris.
create or replace function public.is_publishing_job_member(p_job_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.publishing_jobs j
    where j.id = p_job_id
      and (
        public.is_ws_member(j.workspace_id, p_roles)
        or public.is_placement_shared_with_me(j.placement_id)
      )
  );
$$;

comment on function public.is_publishing_job_member(uuid, text[]) is 'Helper RLS (0020): apakah pemanggil member workspace pemilik job ATAU placement job itu dibagikan eksplisit ke pemanggil. SECURITY DEFINER — hanya boolean.';

-- publishing_jobs — baca: member workspace (8 peran non-klien) ATAU placement
-- dibagikan eksplisit ke pemanggil (viewer_client, v2). Tulis: TIDAK (hanya
-- RPC 0020; pola visual_orders 0017).
create policy "publishing_jobs_select_member_or_shared"
  on public.publishing_jobs for select
  to authenticated
  using (
    public.is_ws_member(workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_placement_shared_with_me(placement_id)
  );

create policy "publishing_jobs_no_insert"
  on public.publishing_jobs for insert to authenticated with check (false);

create policy "publishing_jobs_no_update"
  on public.publishing_jobs for update to authenticated using (false);

create policy "publishing_jobs_no_delete"
  on public.publishing_jobs for delete to authenticated using (false);

-- publishing_attempts — baca: member job itu (atau shared). Tulis: TIDAK.
create policy "publishing_attempts_select_member_or_shared"
  on public.publishing_attempts for select
  to authenticated
  using (
    public.is_publishing_job_member(publishing_attempts.publishing_job_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "publishing_attempts_no_insert"
  on public.publishing_attempts for insert to authenticated with check (false);

create policy "publishing_attempts_no_update"
  on public.publishing_attempts for update to authenticated using (false);

create policy "publishing_attempts_no_delete"
  on public.publishing_attempts for delete to authenticated using (false);

-- published_posts — baca: member workspace (8 peran) ATAU placement
-- dibagikan eksplisit. Tulis: TIDAK (hanya RPC confirm).
create policy "published_posts_select_member_or_shared"
  on public.published_posts for select
  to authenticated
  using (
    public.is_ws_member(workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_placement_shared_with_me(placement_id)
  );

create policy "published_posts_no_insert"
  on public.published_posts for insert to authenticated with check (false);

create policy "published_posts_no_update"
  on public.published_posts for update to authenticated using (false);

create policy "published_posts_no_delete"
  on public.published_posts for delete to authenticated using (false);

-- --- Grant tabel baru ----------------------------------------------------------
-- Ketiga tabel: revoke all + grant select saja (tulis hanya lewat RPC).
revoke all on public.publishing_jobs from anon, authenticated;
grant select on public.publishing_jobs to authenticated;
revoke all on public.publishing_attempts from anon, authenticated;
grant select on public.publishing_attempts to authenticated;
revoke all on public.published_posts from anon, authenticated;
grant select on public.published_posts to authenticated;

revoke all on function public.is_publishing_job_member(uuid, text[]) from public;
grant execute on function public.is_publishing_job_member(uuid, text[]) to authenticated;

-- ============================================================================
-- (5) Fungsi utilitas — backoff (ASUMSI-6.3)
-- ============================================================================
create or replace function public.publishing_backoff_minutes(p_attempt_number integer)
returns integer
language sql
immutable
as $$
  select case
    when p_attempt_number <= 1 then 1
    when p_attempt_number = 2 then 5
    else 15
  end;
$$;

comment on function public.publishing_backoff_minutes(integer) is 'Backoff retry Phase 6 (ASUMSI-6.3): percobaan ke-1 → 1 menit, ke-2 → 5 menit, ke-3+ → 15 menit. Satu tempat konfigurasi — ganti di sini bila Tuan menetapkan angka lain.';

revoke all on function public.publishing_backoff_minutes(integer) from public;
grant execute on function public.publishing_backoff_minutes(integer) to authenticated;

-- ============================================================================
-- (6) Preflight — publishing_preflight
-- ============================================================================
-- Pemeriksaan kesiapan placement sebelum job dibuat / sebelum job diproses.
-- TIDAK PERNAH melempar: mengembalikan jsonb {ok, code, message, checks}.
-- checks: [{key, severity: 'block'|'warn', passed, message}].
-- "Approved/current" (ADR-0012 §9): versi konten TERBARU harus punya request
-- approval internal 'approved' (target_type content_item). Request approved
-- untuk versi lama = APPROVAL_STALE. Approval target placement TIDAK
-- diperiksa (tidak ada UI-nya di Phase 4); sebagai gantinya job menyimpan
-- snapshot placement_version_id dan proses menolak bila placement diedit
-- sesudahnya (PLACEMENT_CHANGED — diperiksa di process, bukan di sini,
-- karena preflight ini tidak menerima job id... KECUALI lewat
-- p_exclude_job_id + p_placement_version_id opsional di bawah).
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

comment on function public.publishing_preflight(uuid, timestamptz, text, uuid) is 'Preflight publishing (0020): pemeriksaan kesiapan placement sebelum job dibuat/diproses. TIDAK PERNAH melempar — mengembalikan {ok, code, message, checks}. Blokir: FORBIDDEN / TIMEZONE_INVALID / ALREADY_PUBLISHED / APPROVAL_REQUIRED / APPROVAL_STALE / SCHEDULE_PAST / DUPLICATE_JOB. Peringatan: koneksi (selalu manual di Phase 6), format kosong.';

revoke all on function public.publishing_preflight(uuid, timestamptz, text, uuid) from public;
grant execute on function public.publishing_preflight(uuid, timestamptz, text, uuid) to authenticated;

-- ============================================================================
-- (7) RPC — create_publishing_job
-- ============================================================================
-- Buat job + tulis jadwal/status ke placement dalam SATU transaksi.
-- p_scheduled_at null = pakai jadwal placement (bila ada); status job
-- mengikuti jadwal efektif (masa depan → scheduled_locally, sisanya ready).
create or replace function public.create_publishing_job(
  p_placement_id uuid,
  p_scheduled_at timestamptz default null,
  p_timezone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_placement public.content_placements%rowtype;
  v_item public.content_items%rowtype;
  v_pre jsonb;
  v_tz text;
  v_sched timestamptz;
  v_status text;
  v_key text;
  v_latest_pv uuid;
  v_job_id uuid;
  v_warn jsonb;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED', 'message', 'Anda harus masuk dulu.');
  end if;

  select * into v_placement from public.content_placements where id = p_placement_id;
  if v_placement.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Placement tidak ditemukan.');
  end if;
  select * into v_item from public.content_items where id = v_placement.content_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Content item placement tidak ditemukan.');
  end if;

  -- Jadwal + zona waktu efektif (ASUMSI-6.6: placement menang).
  v_sched := coalesce(p_scheduled_at, v_placement.scheduled_at);
  v_tz := coalesce(nullif(btrim(p_timezone), ''), v_placement.timezone);

  -- Preflight (blokir + peringatan). Jadwal yang diperiksa = jadwal efektif.
  v_pre := public.publishing_preflight(p_placement_id, v_sched, v_tz, null);
  if not (v_pre ->> 'ok')::boolean then
    return v_pre;
  end if;
  v_warn := jsonb_build_object('warnings', (v_pre -> 'checks'));

  -- Snapshot versi placement terbaru (untuk deteksi PLACEMENT_CHANGED).
  select id into v_latest_pv
    from public.placement_versions
    where placement_id = p_placement_id
    order by version_number desc limit 1;
  if v_latest_pv is null then
    return jsonb_build_object('ok', false, 'code', 'PREFLIGHT_FAILED', 'message', 'Placement ini belum punya versi — tidak bisa dijadwalkan.');
  end if;

  v_status := case when v_sched is not null and v_sched > now() then 'scheduled_locally' else 'ready' end;
  v_key := 'pub:' || p_placement_id::text || ':' || coalesce(to_char(v_sched at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'immediate');

  begin
    insert into public.publishing_jobs (
      workspace_id, placement_id, placement_version_id, scheduled_at, timezone,
      status, idempotency_key, provider_job_id, created_by
    ) values (
      v_item.workspace_id, p_placement_id, v_latest_pv, v_sched, v_tz,
      v_status, v_key, null, v_caller
    ) returning id into v_job_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'DUPLICATE_JOB', 'message', 'Sudah ada job aktif untuk placement ini pada waktu yang sama — batalkan dulu job itu atau pilih waktu lain.');
  end;

  -- Jadwal/status placement mengikuti job (penjadwalan = pembuatan job).
  update public.content_placements
    set scheduled_at = v_sched,
        timezone = v_tz,
        distribution_status = v_status,
        updated_at = now()
    where id = p_placement_id;

  return jsonb_build_object(
    'ok', true, 'code', 'CREATED', 'job_id', v_job_id, 'status', v_status,
    'message', case when v_status = 'scheduled_locally'
      then 'Job publikasi dibuat — dijadwalkan secara lokal (bukan jadwal provider).'
      else 'Job publikasi dibuat — siap dipublikasikan manual.' end,
    'warnings', v_warn
  );
end;
$$;

comment on function public.create_publishing_job(uuid, timestamptz, text) is 'RPC Phase 6 (0020): buat job publishing + tulis jadwal/status placement, satu transaksi. Preflight dulu (blokir spesifik); p_scheduled_at null = pakai jadwal placement. SECURITY DEFINER — ditinjau.';

revoke all on function public.create_publishing_job(uuid, timestamptz, text) from public;
grant execute on function public.create_publishing_job(uuid, timestamptz, text) to authenticated;

-- ============================================================================
-- (8) RPC — claim_publishing_job (worker lokal, atomik)
-- ============================================================================
-- Klaim SATU job yang jatuh tempo (atau satu job tertentu bila p_job_id
-- diberikan — untuk periksa-ulang) + lease 5 menit (ASUMSI-6.3).
-- Mengembalikan job_id null (bukan galat) bila tidak ada yang bisa diklaim.
create or replace function public.claim_publishing_job(
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
  v_job public.publishing_jobs%rowtype;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED', 'message', 'Anda harus masuk dulu.');
  end if;
  if not public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist']) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Peran Anda tidak boleh memproses antrean publishing.');
  end if;

  update public.publishing_jobs j
    set status = 'sending',
        lease_owner = v_caller,
        lease_until = now() + interval '5 minutes',
        updated_at = now()
    where j.id = (
      select j2.id from public.publishing_jobs j2
      where j2.workspace_id = p_workspace_id
        and (
          (p_job_id is null and (
            (j2.status in ('ready', 'scheduled_locally')
              and (j2.scheduled_at is null or j2.scheduled_at <= now())
              and (j2.next_attempt_at is null or j2.next_attempt_at <= now()))
            or (j2.status = 'sending' and j2.lease_until is not null and j2.lease_until < now())
          ))
          or (p_job_id is not null and j2.id = p_job_id
            and j2.status in ('ready', 'scheduled_locally', 'needs_manual_action', 'sending')
            and (j2.status <> 'sending' or j2.lease_until is null or j2.lease_until < now()))
        )
      order by j2.scheduled_at nulls first, j2.created_at
      limit 1
      for update skip locked
    )
    returning j.* into v_job;

  if v_job.id is null then
    return jsonb_build_object('ok', true, 'code', 'NO_DUE_JOB', 'job_id', null, 'message', 'Tidak ada job yang jatuh tempo.');
  end if;
  return jsonb_build_object('ok', true, 'code', 'CLAIMED', 'job_id', v_job.id, 'placement_id', v_job.placement_id, 'message', 'Job diklaim (lease 5 menit).');
end;
$$;

comment on function public.claim_publishing_job(uuid, uuid) is 'RPC Phase 6 (0020): klaim atomik satu job jatuh tempo (FOR UPDATE SKIP LOCKED) + lease 5 menit. Mengembalikan job_id null bila tidak ada yang bisa diklaim. SECURITY DEFINER — ditinjau.';

revoke all on function public.claim_publishing_job(uuid, uuid) from public;
grant execute on function public.claim_publishing_job(uuid, uuid) to authenticated;

-- ============================================================================
-- (9) RPC — process_publishing_jobs (worker lokal)
-- ============================================================================
-- Proses job yang jatuh tempo: klaim → preflight ulang → handoff manual
-- (tidak ada provider di Phase 6) atau needs_manual_action bila preflight
-- gagal. Galat tak terduga saat memproses satu job → job itu 'failed'
-- (TRANSIENT_ERROR, bisa di-retry) dan loop lanjut ke job berikutnya.
-- Maksimal 20 job per panggilan. p_job_id = proses satu job saja
-- (periksa-ulang dari needs_manual_action — ASUMSI-6.1).
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
      else
        -- Preflight ulang (jadwal job sendiri dikecualikan dari cek duplikat).
        v_pre := public.publishing_preflight(v_job.placement_id, v_job.scheduled_at, v_job.timezone, v_job_id);
        v_pre_ok := (v_pre ->> 'ok')::boolean;
        v_pre_code := v_pre ->> 'code';
        v_pre_msg := v_pre ->> 'message';
        if v_pre_ok then
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

comment on function public.process_publishing_jobs(uuid, uuid) is 'RPC Phase 6 (0020): worker lokal — klaim job jatuh tempo → preflight ulang → handoff manual (needs_manual_action). Galat tak terduga per job → failed/TRANSIENT_ERROR, batch tetap jalan. Maks 20 job per panggilan. SECURITY DEFINER — ditinjau.';

revoke all on function public.process_publishing_jobs(uuid, uuid) from public;
grant execute on function public.process_publishing_jobs(uuid, uuid) to authenticated;

-- ============================================================================
-- (10) RPC — retry_publishing_job
-- ============================================================================
-- Retry eksplisit HANYA untuk job 'failed' dengan galat transient dan
-- percobaan gagal < 3 (ASUMSI-6.3). Tidak ada retry otomatis (A6.4).
create or replace function public.retry_publishing_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_job public.publishing_jobs%rowtype;
  v_item public.content_items%rowtype;
  v_failures integer;
  v_last_error text;
  v_backoff integer;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED', 'message', 'Anda harus masuk dulu.');
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
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Peran Anda tidak boleh me-retry job publishing.');
  end if;
  if not public.brand_in_scope(v_item.brand_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Brand job ini di luar scope Anda.');
  end if;
  if v_job.status <> 'failed' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', format('Hanya job failed yang bisa di-retry (status saat ini: %s).', v_job.status));
  end if;

  select count(*) into v_failures from public.publishing_attempts
    where publishing_job_id = p_job_id and result_status = 'failed';
  select error_code into v_last_error from public.publishing_attempts
    where publishing_job_id = p_job_id
    order by attempt_number desc limit 1;
  if v_last_error is distinct from 'TRANSIENT_ERROR' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', 'Hanya galat transient yang bisa di-retry — galat terakhir job ini bukan transient, perbaiki manual atau batalkan.');
  end if;
  if v_failures >= 3 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', 'Batas percobaan (3) tercapai — batalkan job ini atau buat job baru.');
  end if;

  v_backoff := public.publishing_backoff_minutes(v_failures + 1);
  update public.publishing_jobs
    set status = 'ready',
        next_attempt_at = now() + (v_backoff || ' minutes')::interval,
        lease_owner = null, lease_until = null,
        updated_at = now()
    where id = p_job_id;
  update public.content_placements
    set distribution_status = 'ready', updated_at = now()
    where id = v_job.placement_id;
  insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_message_safe, started_at, completed_at)
    values (p_job_id, (select coalesce(max(attempt_number), 0) + 1 from public.publishing_attempts where publishing_job_id = p_job_id),
      'retry_scheduled', format('Retry dijadwalkan sesudah backoff %s menit (percobaan gagal ke-%s dari 3).', v_backoff, v_failures + 1), now(), now());
  update public.publishing_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = p_job_id;

  return jsonb_build_object('ok', true, 'code', 'RETRY_SCHEDULED', 'job_id', p_job_id,
    'next_attempt_at', (now() + (v_backoff || ' minutes')::interval)::text,
    'message', format('Retry dijadwalkan sesudah backoff %s menit.', v_backoff));
end;
$$;

comment on function public.retry_publishing_job(uuid) is 'RPC Phase 6 (0020): retry eksplisit job failed (galat transient, < 3 percobaan gagal) → ready + next_attempt_at backoff 1→5→15 menit. SECURITY DEFINER — ditinjau.';

revoke all on function public.retry_publishing_job(uuid) from public;
grant execute on function public.retry_publishing_job(uuid) to authenticated;

-- ============================================================================
-- (11) RPC — cancel_publishing_job
-- ============================================================================
-- Batal eksplisit + alasan wajib. Dari sending (lease aktif) dan dari status
-- terminal ditolak. Placement ikut 'cancelled'; slot idempotency bebas
-- (indeks partial ASUMSI-6.2).
create or replace function public.cancel_publishing_job(p_job_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_job public.publishing_jobs%rowtype;
  v_item public.content_items%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED', 'message', 'Anda harus masuk dulu.');
  end if;
  if v_reason = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REASON', 'message', 'Alasan pembatalan wajib diisi.');
  end if;
  if length(v_reason) > 500 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REASON', 'message', 'Alasan pembatalan maksimal 500 karakter.');
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
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Peran Anda tidak boleh membatalkan job publishing.');
  end if;
  if not public.brand_in_scope(v_item.brand_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Brand job ini di luar scope Anda.');
  end if;
  if v_job.status in ('published', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', format('Job %s tidak bisa dibatalkan (status terminal).', v_job.status));
  end if;
  if v_job.status = 'sending' and v_job.lease_until is not null and v_job.lease_until > now() then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', 'Job sedang diproses (lease aktif) — tunggu sampai lease selesai, lalu batalkan.');
  end if;

  update public.publishing_jobs
    set status = 'cancelled', lease_owner = null, lease_until = null, updated_at = now()
    where id = p_job_id;
  update public.content_placements
    set distribution_status = 'cancelled', updated_at = now()
    where id = v_job.placement_id;
  insert into public.publishing_attempts (publishing_job_id, attempt_number, result_status, error_message_safe, started_at, completed_at)
    values (p_job_id, (select coalesce(max(attempt_number), 0) + 1 from public.publishing_attempts where publishing_job_id = p_job_id),
      'cancelled', v_reason, now(), now());
  update public.publishing_jobs set attempt_count = attempt_count + 1, updated_at = now() where id = p_job_id;

  return jsonb_build_object('ok', true, 'code', 'CANCELLED', 'job_id', p_job_id,
    'message', 'Job dibatalkan sebelum terkirim — tanpa efek samping. Slot jadwalnya bebas dipakai lagi.');
end;
$$;

comment on function public.cancel_publishing_job(uuid, text) is 'RPC Phase 6 (0020): batal eksplisit + alasan wajib (maks 500 karakter). Ditolak dari sending ber-lease aktif dan dari status terminal. SECURITY DEFINER — ditinjau.';

revoke all on function public.cancel_publishing_job(uuid, text) from public;
grant execute on function public.cancel_publishing_job(uuid, text) to authenticated;

-- ============================================================================
-- (12) RPC — confirm_publishing_job
-- ============================================================================
-- Konfirmasi manual: SATU-SATUNYA jalan ke Published di Phase 6.
-- Menulis published_posts + placement published_url + status, satu transaksi.
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
  if v_job.status in ('published', 'cancelled', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', format('Job %s tidak bisa dikonfirmasi terbit (status terminal/gagal — retry atau buat job baru).', v_job.status));
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

comment on function public.confirm_publishing_job(uuid, text, timestamptz) is 'RPC Phase 6 (0020): konfirmasi manual — SATU-SATUNYA jalan ke Published di fase ini. Menulis published_posts + placement published_url + status, satu transaksi. SECURITY DEFINER — ditinjau.';

revoke all on function public.confirm_publishing_job(uuid, text, timestamptz) from public;
grant execute on function public.confirm_publishing_job(uuid, text, timestamptz) to authenticated;
