-- MaTive Phase 8 — AI Assistant (migrasi 0022 v1.0)
-- ADR-0014. AI NONAKTIF (Keputusan #11): TIDAK ADA provider yang dipilih,
-- TIDAK ADA akses apa pun — langkah 8.1 belum terpenuhi. Yang dibangun:
-- adapter netral (kode aplikasi, bukan SQL) + 7 aksi dengan validasi
-- output terstruktur + alur review manusia + grounding analytics +
-- trust & safety + kontrol workspace + log ai_generations.
--
-- Isi:
--   (1) Tabel baru: ai_generations (log append-only; TIDAK ADA kolom
--       payload mentah — hanya input_reference/output_reference berupa
--       referensi seperti "content_item:<uuid>").
--   (2) content_versions: kolom baru ai_assisted + ai_generation_id
--       (insert AI tercatat sebagai versi baru, bukan timpa).
--   (3) RLS + policy (baca: member 8 peran non-klien; tulis log: aktor
--       sendiri + member; update/delete: TIDAK) + grant.
--   (4) Fungsi: ai_retention_days (90 hari, ASUMSI-8D),
--       ai_daily_usage_count (pemakaian hari ini, zona Asia/Jakarta),
--       cleanup_ai_generations (retensi, owner/admin),
--       insert_ai_draft_version (insert versi AI, transaksional,
--       TIDAK melempar — jsonb {ok, code, message}).
--   (5) Helper visibilitas is_ai_generation_visible (member 8 peran
--       non-klien; viewer_client TIDAK ADA di daftar peran).
--
-- Aturan keras (pelajaran Phase 5/6/7): policy INSERT TIDAK BOLEH memeriksa
-- baris yang sedang di-INSERT di tabelnya sendiri; policy INSERT hanya
-- memakai WITH CHECK (bukan USING); pglast OK bukan berarti Postgres
-- menerima — jalankan pgTAP 08 sebelum klaim lolos; Postgres TIDAK punya
-- max/min(uuid) — pakai max(integer) untuk version_number (aman).

-- ============================================================================
-- (1) Tabel baru: ai_generations
-- ============================================================================

-- Log generasi AI (Dok 09 §6 + ADR-0014 §6). Satu baris = satu percobaan
-- aksi AI (termasuk percobaan yang berakhir not_configured — audit,
-- bukan hasil palsu). TIDAK ADA kolom untuk isi mentah input/output:
-- input_reference/output_reference HANYA referensi (mis. "content_item:
-- <uuid>", "ai-draft:<uuid>") — kebocoran payload mentah dicegah oleh
-- struktur tabel, bukan hanya oleh disiplin.
create table if not exists public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  feature text not null
    constraint ai_generations_feature_check
    check (feature in (
      'content_ideas', 'brief', 'content_draft', 'repurpose',
      'checklist', 'feedback_summary', 'campaign_summary'
    )),
  provider text not null default 'none',
  model text,
  input_reference text not null,
  output_reference text,
  usage_input_tokens integer
    constraint ai_generations_input_tokens_check
    check (usage_input_tokens is null or usage_input_tokens >= 0),
  usage_output_tokens integer
    constraint ai_generations_output_tokens_check
    check (usage_output_tokens is null or usage_output_tokens >= 0),
  status text not null default 'not_configured'
    constraint ai_generations_status_check
    check (status in ('completed', 'failed', 'blocked', 'not_configured')),
  error_category text not null default 'none'
    constraint ai_generations_error_check
    check (error_category in (
      'none', 'provider_not_configured', 'provider_error', 'rate_limited',
      'invalid_output', 'prompt_injection', 'usage_limit', 'validation'
    )),
  created_at timestamptz not null default now()
);

comment on table public.ai_generations is 'Log generasi AI (Phase 8, ADR-0014 §6, Dok 09 §6): satu baris per percobaan aksi AI. Append-only; hapus hanya lewat cleanup_ai_generations (retensi 90 hari). TIDAK ADA kolom payload mentah — hanya referensi input/output.';
comment on column public.ai_generations.input_reference is 'Referensi input, mis. "content_item:<uuid>" atau "campaign:<uuid>". BUKAN isi mentah — input mentah tidak disimpan (ASUMSI-8D).';
comment on column public.ai_generations.output_reference is 'Referensi output, mis. "content_version:<uuid>" sesudah insert, atau null bila aksi gagal/diblokir.';
comment on column public.ai_generations.provider is 'Id provider ("none" selama belum ada provider yang dipilih — ADR-0014 §0). Model/provider dapat diganti tanpa mengubah business logic.';
comment on column public.ai_generations.status is 'completed = draft dihasilkan; failed = provider/validasi gagal; blocked = injeksi terdeteksi; not_configured = belum ada provider (bukan failure — tidak memakan kuota).';

create index if not exists idx_ai_generations_workspace on public.ai_generations (workspace_id);
create index if not exists idx_ai_generations_actor on public.ai_generations (actor_user_id);
create index if not exists idx_ai_generations_created on public.ai_generations (created_at);
create index if not exists idx_ai_generations_usage on public.ai_generations (workspace_id, status, created_at);

-- ============================================================================
-- (2) content_versions: ai_assisted + ai_generation_id
-- ============================================================================

-- Insert AI tercatat sebagai versi baru (Dok 09 §4 + ADR-0014 §3):
-- ai_assisted menandai versi ini berasal dari draft AI (tetap milik dan
-- disahkan user); ai_generation_id menunjuk baris log yang membuktikan
-- provenance-nya. Kolom dibuat SEBELUM RPC insert_ai_draft_version
-- (FK ke ai_generations membutuhkan tabel itu sudah ada).
alter table public.content_versions
  add column if not exists ai_assisted boolean not null default false,
  add column if not exists ai_generation_id uuid references public.ai_generations (id) on delete set null;

comment on column public.content_versions.ai_assisted is 'Phase 8 (ADR-0014 §3): true bila versi ini berasal dari draft AI yang di-insert user (tetap milik/disahkan user). Default false.';
comment on column public.content_versions.ai_generation_id is 'Phase 8: baris ai_generations yang menjadi sumber draft versi ini (provenance). NULL untuk versi non-AI.';

create index if not exists idx_versions_ai_generation on public.content_versions (ai_generation_id);

-- ============================================================================
-- (3) RLS + policy + grant
-- ============================================================================

alter table public.ai_generations enable row level security;

-- Helper visibilitas log: member (8 peran non-klien). viewer_client
-- TIDAK ADA di daftar peran — tidak melihat log AI.
create or replace function public.is_ai_generation_visible(p_generation_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.ai_generations g
    where g.id = p_generation_id
      and public.is_ws_member(g.workspace_id, p_roles)
  );
$$;

comment on function public.is_ai_generation_visible(uuid, text[]) is 'Helper RLS (0022): apakah pemanggil boleh MELIHAT baris log AI ini — member (8 peran non-klien). SECURITY DEFINER — hanya boolean.';

-- ai_generations — baca: member 8 peran non-klien (helper). Tulis:
-- INSERT hanya aktor sendiri + member (pola activity_logs 0004 /
-- integration_events 0021). UPDATE/DELETE: TIDAK (append-only; hapus
-- hanya lewat cleanup_ai_generations).
create policy "ai_generations_select_member"
  on public.ai_generations for select
  to authenticated
  using (
    public.is_ai_generation_visible(ai_generations.id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "ai_generations_insert_member_as_actor"
  on public.ai_generations for insert
  to authenticated
  with check (
    actor_user_id = auth.uid()
    and public.is_ws_member(ai_generations.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "ai_generations_no_update"
  on public.ai_generations for update to authenticated using (false);

create policy "ai_generations_no_delete"
  on public.ai_generations for delete to authenticated using (false);

-- --- Grant -------------------------------------------------------------------
revoke all on public.ai_generations from anon, authenticated;
grant select, insert on public.ai_generations to authenticated;

revoke all on function public.is_ai_generation_visible(uuid, text[]) from public;
grant execute on function public.is_ai_generation_visible(uuid, text[]) to authenticated;

-- ============================================================================
-- (4) Fungsi utilitas — retensi + pemakaian harian (ASUMSI-8D/8E)
-- ============================================================================

-- Retensi log 90 hari (ASUMSI-8D): konstanta di satu tempat.
create or replace function public.ai_retention_days()
returns integer
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select 90;
$$;

comment on function public.ai_retention_days() is 'Retensi log AI 90 hari (ASUMSI-8D, ADR-0014 §6). Satu tempat konfigurasi — ganti di sini bila Tuan menetapkan angka lain.';

revoke all on function public.ai_retention_days() from public;
grant execute on function public.ai_retention_days() to authenticated;

-- Pemakaian hari ini (zona Asia/Jakarta, Keputusan #13): jumlah generasi
-- status completed pada hari kalender Jakarta. -1 = bukan member workspace
-- ini (termasuk viewer_client — tidak memakai AI). not_configured /
-- blocked / failed TIDAK memakan kuota (tidak menghasilkan nilai).
create or replace function public.ai_daily_usage_count(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'analyst']) then -1
    else (
      select count(*)::int
      from public.ai_generations g
      where g.workspace_id = p_workspace_id
        and g.status = 'completed'
        and g.created_at >= date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'
    )
  end;
$$;

comment on function public.ai_daily_usage_count(uuid) is 'Pemakaian AI hari ini (ADR-0014 §6): jumlah generasi completed pada hari kalender Asia/Jakarta. -1 bila pemanggil bukan member yang boleh memakai AI di workspace ini. SECURITY DEFINER — hanya angka.';

revoke all on function public.ai_daily_usage_count(uuid) from public;
grant execute on function public.ai_daily_usage_count(uuid) to authenticated;

-- Pembersihan retensi (ASUMSI-8D): hapus baris log lebih tua dari p_days
-- (default 90) di workspace ini. Hanya owner/admin. Mengembalikan jumlah
-- baris yang dihapus, atau -1 bila pemanggil bukan owner/admin workspace
-- ini / p_days tidak valid. Tanpa worker/cron, fungsi ini dipanggil
-- operator (batas jujur Phase 6/8).
create or replace function public.cleanup_ai_generations(p_workspace_id uuid, p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_days is null or p_days < 1 then
    return -1;
  end if;
  if not public.is_ws_member(p_workspace_id, array['owner', 'admin']) then
    return -1;
  end if;
  delete from public.ai_generations
  where workspace_id = p_workspace_id
    and created_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.cleanup_ai_generations(uuid, integer) is 'Pembersihan retensi log AI (ASUMSI-8D): hapus baris lebih tua dari p_days (default 90) di workspace ini. Hanya owner/admin; mengembalikan jumlah baris yang dihapus (-1 bila tidak berhak/argumen tidak valid).';

revoke all on function public.cleanup_ai_generations(uuid, integer) from public;
grant execute on function public.cleanup_ai_generations(uuid, integer) to authenticated;

-- ============================================================================
-- (5) RPC insert versi AI — insert_ai_draft_version (transaksional,
--     TIDAK melempar)
-- ============================================================================
-- Insert draft AI sebagai content_versions BARU (Dok 09 §4 + ADR-0014 §3).
-- BUKAN timpa: version_number = max + 1; snapshot yang sudah disetujui
-- tidak pernah dimutasi (tabel append-only sejak 0007).
-- Syarat (diperiksa di DALAM fungsi — bukan hanya di UI):
--   - pemanggil masuk + member workspace item (peran use_ai DAN
--     create_edit_content: owner/admin/manager/strategist/creator/
--     editor — analyst punya use_ai tapi TIDAK boleh mengedit konten;
--     approver/viewer_client tidak memakai AI);
--   - brand item dalam scope pemanggil;
--   - p_ai_generation_id WAJIB ada + milik workspace yang sama +
--     aktornya = pemanggil + status completed + fitur penghasil draft
--     (brief / content_draft);
--   - p_change_summary wajib diisi (jejak alasan versi baru).
-- Kode: FORBIDDEN / INVALID_ITEM / INVALID_GENERATION / INVALID_INPUT.
create or replace function public.insert_ai_draft_version(
  p_content_item_id uuid,
  p_script text,
  p_caption text,
  p_cta text,
  p_brief_snapshot jsonb,
  p_change_summary text,
  p_ai_generation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_item_ws uuid;
  v_item_brand uuid;
  v_gen_ws uuid;
  v_gen_actor uuid;
  v_gen_status text;
  v_gen_feature text;
  v_next_version integer;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Belum masuk.');
  end if;

  -- (0) Item harus ada.
  select workspace_id, brand_id into v_item_ws, v_item_brand
  from public.content_items where id = p_content_item_id;
  if v_item_ws is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ITEM', 'message', 'Content item tidak ditemukan.');
  end if;

  -- (1) Peran: use_ai DAN create_edit_content (irisan keduanya).
  if not public.is_ws_member(v_item_ws, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor']) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Bukan member workspace ini atau peran tidak boleh menyimpan versi konten.');
  end if;

  -- (2) Brand item dalam scope pemanggil.
  if v_item_brand is not null and not public.brand_in_scope(v_item_brand) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Brand content item di luar scope Anda.');
  end if;

  -- (3) Generasi AI wajib + provenance-nya harus cocok.
  if p_ai_generation_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_GENERATION', 'message', 'Generasi AI wajib disertakan (insert versi AI butuh provenance).');
  end if;
  select workspace_id, actor_user_id, status, feature
    into v_gen_ws, v_gen_actor, v_gen_status, v_gen_feature
  from public.ai_generations where id = p_ai_generation_id;
  if v_gen_ws is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_GENERATION', 'message', 'Generasi AI tidak ditemukan.');
  end if;
  if v_gen_ws <> v_item_ws then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Generasi AI bukan milik workspace ini.');
  end if;
  if v_gen_actor <> v_caller then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Generasi AI ini milik pengguna lain.');
  end if;
  if v_gen_status <> 'completed' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_GENERATION', 'message', format('Generasi AI belum selesai (status: %s).', v_gen_status));
  end if;
  if v_gen_feature not in ('brief', 'content_draft') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_GENERATION', 'message', 'Fitur generasi ini tidak menghasilkan versi konten (hanya brief / content_draft).');
  end if;

  -- (4) change_summary wajib (jejak alasan versi baru, pola 0008).
  if p_change_summary is null or btrim(p_change_summary) = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'change_summary wajib diisi.');
  end if;

  -- (5) Nomor versi berikutnya + insert (max(integer) — aman; Postgres
  -- TIDAK punya max(uuid) tapi max(integer) ada).
  select coalesce(max(version_number), 0) + 1 into v_next_version
  from public.content_versions where content_item_id = p_content_item_id;

  insert into public.content_versions (
    content_item_id, version_number, brief_snapshot, script, caption, cta,
    creative_notes, change_summary, created_by, ai_assisted, ai_generation_id
  ) values (
    p_content_item_id, v_next_version,
    coalesce(p_brief_snapshot, '{}'::jsonb),
    p_script, p_caption, p_cta,
    null, p_change_summary, v_caller, true, p_ai_generation_id
  );

  return jsonb_build_object('ok', true, 'version_number', v_next_version);
end;
$$;

comment on function public.insert_ai_draft_version(uuid, text, text, text, jsonb, text, uuid) is 'Insert draft AI sebagai content_versions baru (ADR-0014 §3, Dok 09 §4): version_number = max + 1, ai_assisted = true, ai_generation_id terisi. TIDAK pernah melempar — mengembalikan jsonb {ok, code, message} / {ok, version_number}. Syarat: peran use_ai + create_edit_content, brand dalam scope, generasi completed milik pemanggil dengan fitur brief/content_draft, change_summary wajib.';

revoke all on function public.insert_ai_draft_version(uuid, text, text, text, jsonb, text, uuid) from public;
grant execute on function public.insert_ai_draft_version(uuid, text, text, text, jsonb, text, uuid) to authenticated;
