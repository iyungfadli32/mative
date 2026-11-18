-- MaTive Phase 2 — Migrasi 0008: RPC transaksional Planning Core (P2-09/P2-12/P2-14)
-- ============================================================================
-- MENGAPA RPC (bukan insert berurutan dari aplikasi):
--   PostgREST (Supabase JS) tidak mendukung transaksi multi-statement dari
--   klien. Operasi yang menurut rencana HARUS atomik — buat content + v1 +
--   event + log; konversi ide; transisi status + event + log; reschedule +
--   placement version — karena itu dijalankan sebagai SATU fungsi database
--   (satu transaksi Postgres: semua langkah berhasil atau semua rollback).
--   Aplikasi TIDAK PERNAH menulis content_status_events / activity_logs
--   untuk operasi ini secara langsung; hanya lewat RPC di bawah.
--
-- PENGAMAN (pola accept_invitation/0003 + helper 0006/0007):
--   (1) Semua fungsi SECURITY DEFINER dengan search_path dikunci
--       (public, pg_temp) + semua objek di-qualify skema.
--   (2) Setiap fungsi memeriksa keanggotaan + role pemanggil SENDIRI lewat
--       is_ws_member() — TIDAK PERNAH percaya role/owner dari parameter.
--       creator/editor hanya boleh atas content yang owner-nya = dirinya.
--   (3) Validasi transisi + alasan wajib ditegakkan DI DALAM fungsi
--       (cermin tabel transisi features/planning/transitions.ts — bila
--       keduanya berbeda, yang DI DATABASE yang menang dan aplikasi
--       harus diperbaiki).
--   (4) Fungsi mengembalikan jsonb {ok, message, ...} — TIDAK melempar
--       exception untuk penolakan bisnis (agar server action bisa
--       menampilkan pesan Bahasa Indonesia yang aman). Exception hanya
--       untuk kegagalan tak terduga (constraint/trigger).
--   (5) Grant EXECUTE hanya ke authenticated; revoke dari public.
--   (6) TIDAK ADA token/kredensial yang dibaca atau ditulis di sini.
--
-- CATATAN: migrasi ini BELUM diterapkan ke database live (seperti 0007).
--   Terapkan SETELAH 0007, urutan 0001 → 0008. Verifikasi sintaks hanya
--   statis (pglast) sampai parent menjalankannya di live.
--   TIDAK ADA tabel baru di file ini — hanya fungsi.
-- ============================================================================

-- ============================================================================
-- Fungsi 1 — create_content_item_with_version
-- Buat content item + content_versions v1 + content_status_events (awal)
-- + activity_logs dalam SATU transaksi. production_status awal selalu
-- 'idea' (alur produksi dimulai dari ide; transisi lewat fungsi 3).
-- ============================================================================
create or replace function public.create_content_item_with_version(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_title text,
  p_campaign_id uuid default null,
  p_pillar_id uuid default null,
  p_audience_id uuid default null,
  p_internal_description text default null,
  p_objective text default null,
  p_funnel_stage text default null,
  p_priority text default null,
  p_due_at timestamptz default null,
  p_timezone text default 'Asia/Jakarta',
  p_origin_idea_id uuid default null,
  p_script text default null,
  p_caption text default null,
  p_cta text default null,
  p_creative_notes text default null,
  p_brief_snapshot jsonb default '{}'::jsonb,
  p_change_summary text default 'Versi awal (v1)'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_brand_ws uuid;
  v_item_id uuid;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if p_title is null or btrim(p_title) = '' then
    return jsonb_build_object('ok', false, 'message', 'Judul konten wajib diisi.');
  end if;
  if p_priority is not null and p_priority not in ('low', 'medium', 'high', 'urgent') then
    return jsonb_build_object('ok', false, 'message', 'Prioritas tidak dikenal.');
  end if;
  if p_funnel_stage is not null and p_funnel_stage not in ('awareness', 'consideration', 'conversion', 'retention', 'advocacy') then
    return jsonb_build_object('ok', false, 'message', 'Funnel stage tidak dikenal.');
  end if;
  -- Brand harus milik workspace yang sama (trigger scope juga memeriksa).
  select workspace_id into v_brand_ws from public.brands where id = p_brand_id;
  if v_brand_ws is null then
    return jsonb_build_object('ok', false, 'message', 'Brand tidak ditemukan.');
  end if;
  if v_brand_ws <> p_workspace_id then
    return jsonb_build_object('ok', false, 'message', 'Brand milik workspace lain.');
  end if;
  -- Izin: tulis-penuh, atau creator/editor (owner otomatis = pemanggil).
  if not (
    public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or public.is_ws_member(p_workspace_id, array['creator', 'editor'])
  ) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak membuat konten di workspace ini.');
  end if;

  insert into public.content_items (
    workspace_id, brand_id, campaign_id, pillar_id, title,
    internal_description, objective, audience_id, funnel_stage,
    production_status, priority, owner_user_id, due_at, timezone, origin_idea_id
  ) values (
    p_workspace_id, p_brand_id, p_campaign_id, p_pillar_id, btrim(p_title),
    p_internal_description, p_objective, p_audience_id, p_funnel_stage,
    'idea', p_priority, v_caller, p_due_at, p_timezone, p_origin_idea_id
  ) returning id into v_item_id;

  insert into public.content_versions (
    content_item_id, version_number, brief_snapshot, script, caption,
    cta, creative_notes, change_summary, created_by
  ) values (
    v_item_id, 1, coalesce(p_brief_snapshot, '{}'::jsonb), p_script, p_caption,
    p_cta, p_creative_notes, p_change_summary, v_caller
  );

  insert into public.content_status_events (
    content_item_id, from_status, to_status, actor_user_id, reason
  ) values (
    v_item_id, null, 'idea', v_caller, 'Dibuat (v1)'
  );

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action, after_snapshot
  ) values (
    p_workspace_id, v_caller, 'content_item', v_item_id, 'content_created',
    jsonb_build_object('title', btrim(p_title), 'production_status', 'idea')
  );

  return jsonb_build_object('ok', true, 'content_item_id', v_item_id, 'version_number', 1);
end;
$$;

comment on function public.create_content_item_with_version(uuid, uuid, text, uuid, uuid, uuid, text, text, text, text, timestamptz, text, uuid, text, text, text, text, jsonb, text) is 'RPC transaksional (0008, P2-09): buat content item + versi v1 + status event + activity log dalam satu transaksi. SECURITY DEFINER — ditinjau; cek role sendiri via is_ws_member; tanpa token.';

-- ============================================================================
-- Fungsi 2 — update_content_item_with_version
-- Edit field kunci content item + tulis content_versions BARU (bukan timpa)
-- + activity_logs dalam SATU transaksi. production_status TIDAK diubah di
-- sini — perubahan status HANYA lewat fungsi 3 (transition).
-- change_summary WAJIB diisi (versi tanpa ringkasan ditolak).
-- ============================================================================
create or replace function public.update_content_item_with_version(
  p_content_item_id uuid,
  p_title text,
  p_internal_description text default null,
  p_objective text default null,
  p_funnel_stage text default null,
  p_priority text default null,
  p_due_at timestamptz default null,
  p_campaign_id uuid default null,
  p_pillar_id uuid default null,
  p_audience_id uuid default null,
  p_script text default null,
  p_caption text default null,
  p_cta text default null,
  p_creative_notes text default null,
  p_brief_snapshot jsonb default '{}'::jsonb,
  p_change_summary text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.content_items%rowtype;
  v_next_version integer;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if p_change_summary is null or btrim(p_change_summary) = '' then
    return jsonb_build_object('ok', false, 'message', 'Ringkasan perubahan (change_summary) wajib diisi.');
  end if;
  if p_title is null or btrim(p_title) = '' then
    return jsonb_build_object('ok', false, 'message', 'Judul konten wajib diisi.');
  end if;
  if p_priority is not null and p_priority not in ('low', 'medium', 'high', 'urgent') then
    return jsonb_build_object('ok', false, 'message', 'Prioritas tidak dikenal.');
  end if;
  if p_funnel_stage is not null and p_funnel_stage not in ('awareness', 'consideration', 'conversion', 'retention', 'advocacy') then
    return jsonb_build_object('ok', false, 'message', 'Funnel stage tidak dikenal.');
  end if;

  select * into v_item from public.content_items where id = p_content_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'message', 'Content item tidak ditemukan.');
  end if;
  if not public.can_edit_content_item(p_content_item_id) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak mengedit konten ini.');
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
    from public.content_versions where content_item_id = p_content_item_id;

  update public.content_items set
    title = btrim(p_title),
    internal_description = p_internal_description,
    objective = p_objective,
    funnel_stage = p_funnel_stage,
    priority = p_priority,
    due_at = p_due_at,
    campaign_id = p_campaign_id,
    pillar_id = p_pillar_id,
    audience_id = p_audience_id,
    updated_at = now()
  where id = p_content_item_id;

  insert into public.content_versions (
    content_item_id, version_number, brief_snapshot, script, caption,
    cta, creative_notes, change_summary, created_by
  ) values (
    p_content_item_id, v_next_version, coalesce(p_brief_snapshot, '{}'::jsonb),
    p_script, p_caption, p_cta, p_creative_notes, btrim(p_change_summary), v_caller
  );

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action,
    before_snapshot, after_snapshot
  ) values (
    v_item.workspace_id, v_caller, 'content_item', p_content_item_id, 'content_updated',
    jsonb_build_object('title', v_item.title),
    jsonb_build_object('title', btrim(p_title), 'version_number', v_next_version)
  );

  return jsonb_build_object('ok', true, 'content_item_id', p_content_item_id, 'version_number', v_next_version);
end;
$$;

comment on function public.update_content_item_with_version(uuid, text, text, text, text, text, timestamptz, uuid, uuid, uuid, text, text, text, text, jsonb, text) is 'RPC transaksional (0008, P2-09): edit field kunci + versi baru + activity log dalam satu transaksi. TIDAK mengubah production_status. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Fungsi 3 — transition_content_item_status
-- Pindah production_status + content_status_events + activity_logs dalam
-- SATU transaksi. Tabel transisi (cermin features/planning/transitions.ts):
--   idea → brief | brief → scripting | scripting → ready_for_production |
--   ready_for_production → in_production | in_production → editing |
--   editing → internal_review | internal_review → approved |
--   approved → archived; setiap tahap boleh mundur satu langkah ke
--   tahap sebelumnya; tahap normal mana pun → changes_requested/blocked/
--   cancelled (alasan WAJIB); dari changes_requested/blocked/cancelled
--   HANYA ke editing/idea (alasan WAJIB); archived → idea (alasan WAJIB).
-- ============================================================================
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

comment on function public.transition_content_item_status(uuid, text, text) is 'RPC transaksional (0008, P2-12/P2-14): transisi production_status + status event + activity log dalam satu transaksi. Alasan wajib untuk exception. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Fungsi 4 — convert_idea_to_content
-- Konversi ide → content item baru (origin_idea_id) + v1 + tandai ide
-- 'converted' + converted_content_item_id + event + log, dalam SATU
-- transaksi. Ide yang sudah converted DITOLAK (tidak bisa dikonversi ulang).
-- ============================================================================
create or replace function public.convert_idea_to_content(
  p_idea_id uuid,
  p_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_idea public.ideas%rowtype;
  v_ws_tz text;
  v_item_id uuid;
  v_title text;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  select * into v_idea from public.ideas where id = p_idea_id;
  if v_idea.id is null then
    return jsonb_build_object('ok', false, 'message', 'Ide tidak ditemukan.');
  end if;
  if v_idea.status = 'converted' or v_idea.converted_content_item_id is not null then
    return jsonb_build_object('ok', false, 'message', 'Ide ini sudah dikonversi dan tidak bisa dikonversi ulang.');
  end if;
  if not (
    public.is_ws_member(v_idea.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or (public.is_ws_member(v_idea.workspace_id, array['creator', 'editor']) and v_idea.owner_user_id = v_caller)
  ) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak mengonversi ide ini.');
  end if;

  v_title := nullif(btrim(coalesce(p_title, v_idea.title, '')), '');
  if v_title is null then
    return jsonb_build_object('ok', false, 'message', 'Judul konten wajib diisi.');
  end if;
  select timezone into v_ws_tz from public.workspaces where id = v_idea.workspace_id;

  insert into public.content_items (
    workspace_id, brand_id, title, internal_description,
    production_status, owner_user_id, timezone, origin_idea_id
  ) values (
    v_idea.workspace_id, v_idea.brand_id, v_title, v_idea.notes,
    'idea', v_caller, coalesce(v_ws_tz, 'Asia/Jakarta'), p_idea_id
  ) returning id into v_item_id;

  insert into public.content_versions (
    content_item_id, version_number, brief_snapshot, change_summary, created_by
  ) values (
    v_item_id, 1, '{}'::jsonb, 'Dibuat dari ide', v_caller
  );

  update public.ideas set
    status = 'converted',
    converted_content_item_id = v_item_id,
    updated_at = now()
  where id = p_idea_id;

  insert into public.content_status_events (
    content_item_id, from_status, to_status, actor_user_id, reason
  ) values (
    v_item_id, null, 'idea', v_caller, 'Dibuat dari ide'
  );

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action, after_snapshot
  ) values (
    v_idea.workspace_id, v_caller, 'content_item', v_item_id, 'content_created_from_idea',
    jsonb_build_object('title', v_title, 'origin_idea_id', p_idea_id)
  );

  return jsonb_build_object('ok', true, 'content_item_id', v_item_id, 'version_number', 1);
end;
$$;

comment on function public.convert_idea_to_content(uuid, text) is 'RPC transaksional (0008, P2-08): konversi ide → content item + v1 + tandai converted dalam satu transaksi; tolak konversi ulang. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Fungsi 5 — reschedule_placement
-- Jadwalkan ulang SATU placement + placement_versions baru + activity log
-- dalam SATU transaksi. Collision (P2-A5): placement lain di channel yang
-- sama pada waktu yang sama persis → DITOLAK kecuali p_force = true
-- (pengguna sudah memilih "tetap jadwalkan" setelah peringatan).
-- remote_post_id/published_url TIDAK disentuh (tetap null — CHECK 0007).
-- ============================================================================
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
      and other.scheduled_at = p_scheduled_at
  ) into v_collision;
  if v_collision and not coalesce(p_force, false) then
    return jsonb_build_object('ok', false, 'collision', true,
      'message', 'Sudah ada placement lain di channel yang sama pada waktu yang sama persis.');
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

comment on function public.reschedule_placement(uuid, timestamptz, text, boolean) is 'RPC transaksional (0008, P2-11): reschedule placement + placement version + activity log. Collision channel+waktu sama ditolak kecuali p_force. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Fungsi 6 — change_placement_distribution
-- Ubah distribution_status SATU placement + content_status_events (untuk
-- content item induk) + activity_logs dalam SATU transaksi. Tabel transisi
-- (cermin features/planning/transitions.ts):
--   draft → ready | ready → scheduled_locally | scheduled_locally → sending |
--   sending → uploaded_or_draft_created | uploaded_or_draft_created →
--   published; sending/uploaded → failed / needs_manual_action;
--   failed/needs_manual_action/cancelled → ready; draft/ready/
--   scheduled_locally → cancelled; mundur satu langkah diizinkan.
-- Catatan: content_status_events mencatat nilai distribution (from/to) +
-- reason "distribusi: ..." agar tidak tertukar dengan production_status.
-- ============================================================================
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

  return jsonb_build_object('ok', true, 'from_status', v_pl.distribution_status, 'to_status', p_to_status);
end;
$$;

comment on function public.change_placement_distribution(uuid, text, text) is 'RPC transaksional (0008, P2-14): transisi distribution_status placement + status event + activity log dalam satu transaksi. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Grant — hanya authenticated (pola 0006/0007).
-- ============================================================================
revoke all on function public.create_content_item_with_version(uuid, uuid, text, uuid, uuid, uuid, text, text, text, text, timestamptz, text, uuid, text, text, text, text, jsonb, text) from public;
revoke all on function public.update_content_item_with_version(uuid, text, text, text, text, text, timestamptz, uuid, uuid, uuid, text, text, text, text, jsonb, text) from public;
revoke all on function public.transition_content_item_status(uuid, text, text) from public;
revoke all on function public.convert_idea_to_content(uuid, text) from public;
revoke all on function public.reschedule_placement(uuid, timestamptz, text, boolean) from public;
revoke all on function public.change_placement_distribution(uuid, text, text) from public;
grant execute on function public.create_content_item_with_version(uuid, uuid, text, uuid, uuid, uuid, text, text, text, text, timestamptz, text, uuid, text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.update_content_item_with_version(uuid, text, text, text, text, text, timestamptz, uuid, uuid, uuid, text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.transition_content_item_status(uuid, text, text) to authenticated;
grant execute on function public.convert_idea_to_content(uuid, text) to authenticated;
grant execute on function public.reschedule_placement(uuid, timestamptz, text, boolean) to authenticated;
grant execute on function public.change_placement_distribution(uuid, text, text) to authenticated;
