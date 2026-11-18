-- MaTive Phase 2 — Migrasi 0007: Planning Core (P2-02 + P2-03)
-- ============================================================================
-- SUMBER: Dok 05 §3 (kolom) + §4 (dua status terpisah) + §6 (constraint)
--   + §7 (index); Dok 06 §2/§3 (matriks RBAC) + §5 (RLS eksplisit per operasi);
--   Rencana-MaTive-Lengkap-v2 (14 keputusan) + rencana detail Phase 2
--   (P2-A1 s.d. P2-A10); ADR-0007 (semua keputusan/interpretasi fase ini).
--
-- SATU FILE (bukan 0007 + 0008): tabel + trigger + helper + RLS dalam satu
--   migrasi mengikuti preseden 0002/0003. 0006 terpisah hanya karena menulis
--   ulang policy lama. Satu file = satu langkah apply untuk koordinator.
--
-- 14 TABEL FASE INI (dan TIDAK ADA tabel lain): brands, social_channels,
--   content_pillars, audiences, campaigns, campaign_brands, ideas,
--   content_items, content_placements, content_versions, placement_versions,
--   content_status_events, tags, content_tags.
--   TIDAK dibuat di sini: brief_templates, assets, tasks, comments,
--   approval_*, publishing_*, analytics, AI (fase 3+).
--
-- ATURAN KERAS (pelajaran Phase 1, 0006):
--   (a) TIDAK ADA policy yang merujuk tabelnya sendiri atau membentuk siklus:
--       semua pengecekan keanggotaan lewat 5 helper 0006 + 12 helper baru
--       di bawah (STABLE, SECURITY DEFINER, search_path terkunci, grant
--       hanya ke authenticated, hanya boolean). Policy TIDAK berisi
--       FROM/JOIN ke tabel lain — graf dependensi asiklik (terverifikasi
--       statis; lihat docs/phase-2-report.md).
--   (b) TIDAK ADA forward-reference antar file: policy hanya merujuk tabel
--       yang dibuat di migrasi ini atau lebih awal. Satu-satunya ketergantungan
--       sirkular (ideas.converted_content_item_id <-> content_items.
--       origin_idea_id) dipecah dengan ALTER TABLE ... ADD CONSTRAINT
--       SETELAH kedua tabel dibuat — semua di dalam file ini.
--   (c) Semua tabel: UUID PK, created_at/updated_at UTC (timestamptz),
--       FK + constraint di DB, JSONB hanya metadata dengan bentuk yang
--       didokumentasikan di ADR-0007 §5. Pengecualian: tabel append-only
--       (content_versions, placement_versions, content_status_events)
--       hanya created_at — mengikuti preseden activity_logs (0004).
--
-- KOREKSI PENTING (ADR-0007 §2, Keputusan #8 menang atas P2-A10):
--   `client_review` BUKAN nilai production_status. CHECK
--   content_items_production_status_check TIDAK memuat 'client_review'.
--
-- CATATAN: database live TIDAK disentuh dari VM (lihat
--   docs/phase-2-report.md §5). Terapkan lewat docs/apply-migrations.md.
-- ============================================================================

-- ============================================================================
-- BAGIAN 1 — Tabel (urutan dependensi FK; tanpa forward-reference)
-- ============================================================================

-- --- brands ---------------------------------------------------------------
-- Dok 05 §3: workspace_id, name, slug, description, logo_asset_id, status,
-- brand_settings. slug unik PER workspace (bukan global seperti organizations).
-- logo_asset_id TANPA FK: tabel assets baru ada di Phase 3 — FK ditambahkan
-- oleh migrasi Phase 3. Nilai null = logo kosong (P2-04).
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  logo_asset_id uuid,
  status text not null default 'active',
  brand_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

comment on table public.brands is 'Brand = identitas bisnis/konten dalam satu workspace. slug unik per workspace. logo_asset_id tanpa FK sampai assets ada (Phase 3). brand_settings: lihat ADR-0007 §5.';
comment on column public.brands.logo_asset_id is 'ID aset logo (tabel assets, Phase 3). TANPA foreign key di fase ini — FK ditambahkan migrasi Phase 3.';

-- --- social_channels --------------------------------------------------------
-- Dok 05 §3: brand_id, platform, account_name, handle, provider_account_id,
-- connection_status, capability_snapshot, timezone. METADATA SAJA (P2-A2):
-- TIDAK ada OAuth, TIDAK ada token, TIDAK ada klaim terhubung.
-- connection_status awal HANYA 'not_connected'/'manual' (R2-05).
-- capability_snapshot = '{}' ("belum diperiksa") sampai Phase 7.
create table if not exists public.social_channels (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  platform text not null,
  account_name text,
  handle text,
  provider_account_id text,
  connection_status text not null default 'not_connected'
    constraint social_channels_connection_status_check
    check (connection_status in ('not_connected', 'manual')),
  capability_snapshot jsonb not null default '{}'::jsonb,
  timezone text not null default 'Asia/Jakarta',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.social_channels is 'Channel registry — METADATA SAJA (P2-A2). Tanpa OAuth/token; connection_status awal not_connected/manual; capability_snapshot {} = belum diperiksa (Phase 7).';

-- --- content_pillars --------------------------------------------------------
-- Dok 05 §3: workspace_id, brand_id nullable, name, description,
-- color_token, active.
create table if not exists public.content_pillars (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete cascade,
  name text not null,
  description text,
  color_token text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, brand_id, name)
);

comment on table public.content_pillars is 'Pilar konten per workspace; brand_id nullable = pilar berlaku untuk seluruh workspace. (Catatan: unique menganggap NULL berbeda — dua pilar tanpa brand boleh bernama sama; penegakan nama unik untuk pilar tanpa brand menjadi tugas aplikasi P2-06.)';

-- --- audiences --------------------------------------------------------------
-- Dok 05 §3: workspace_id, name, description, attributes.
-- attributes: JSONB objek, bentuk didokumentasikan di ADR-0007 §5.
create table if not exists public.audiences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.audiences is 'Audiens dasar per workspace. attributes: JSONB objek — lihat ADR-0007 §5.';

-- --- campaigns --------------------------------------------------------------
-- Dok 05 §3: workspace_id, name, objective, audience_id, start_at, end_at,
-- status, owner_user_id, target_metrics.
-- status: enum SEMENTARA P2-A3 (draft/active/completed/archived/cancelled).
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  objective text,
  audience_id uuid references public.audiences (id) on delete set null,
  start_at timestamptz,
  end_at timestamptz,
  status text not null default 'draft'
    constraint campaigns_status_check
    check (status in ('draft', 'active', 'completed', 'archived', 'cancelled')),
  owner_user_id uuid references auth.users (id),
  target_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_end_after_start_check
    check (end_at is null or start_at is null or end_at >= start_at)
);

comment on table public.campaigns is 'Campaign dasar. status = enum sementara P2-A3. target_metrics: JSONB objek kunci-metrik -> angka target (ADR-0007 §5).';

-- --- campaign_brands (tautan campaign <-> brand) ----------------------------
create table if not exists public.campaign_brands (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, brand_id)
);

comment on table public.campaign_brands is 'Tautan campaign-brand. Campaign dan brand WAJIB satu workspace (trigger validate_campaign_brand_scope).';

-- --- ideas (tangkap minimal, P2-08) ----------------------------------------
-- Dok 05 §3: workspace_id, brand_id nullable, title, source_type, notes,
-- tags, status, owner_user_id, converted_content_item_id.
-- converted_content_item_id: FK ke content_items DITAMBAHKAN lewat ALTER
-- TABLE setelah content_items dibuat (ketergantungan sirkular dengan
-- content_items.origin_idea_id — lihat bawah). Kolomnya dibuat di sini
-- sebagai uuid polos dulu.
create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete set null,
  title text not null,
  source_type text,
  notes text,
  tags text[] not null default '{}',
  status text,
  owner_user_id uuid references auth.users (id),
  converted_content_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ideas is 'Ide — tangkap minimal (P2-08). Konversi penuh ke content adalah Phase 3; di fase ini konversi hanya membuat content item dengan origin_idea_id + menandai ide converted. tags: text[] label sederhana; tag ternormalisasi ada di tags/content_tags.';
comment on column public.ideas.converted_content_item_id is 'FK ke content_items — ditambahkan lewat ALTER TABLE setelah content_items dibuat (sirkular dengan content_items.origin_idea_id).';

-- --- content_items (kanonis, Dok 05 §3 + §4) -------------------------------
-- workspace_id, brand_id, campaign_id nullable, pillar_id nullable, title,
-- internal_description, objective, audience_id nullable, funnel_stage
-- nullable, production_status, priority, owner_user_id, due_at, timezone,
-- origin_idea_id nullable, archived_at.
-- production_status: DUA status terpisah (R2-02); TANPA 'client_review'
-- (Keputusan #8 — lihat ADR-0007 §2).
create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete restrict,
  campaign_id uuid references public.campaigns (id) on delete set null,
  pillar_id uuid references public.content_pillars (id) on delete set null,
  title text not null,
  internal_description text,
  objective text,
  audience_id uuid references public.audiences (id) on delete set null,
  funnel_stage text,
  production_status text not null default 'idea'
    constraint content_items_production_status_check
    check (production_status in (
      'idea', 'brief', 'scripting', 'ready_for_production', 'in_production',
      'editing', 'internal_review', 'approved', 'archived',
      'changes_requested', 'blocked', 'cancelled'
    )),
  priority text,
  owner_user_id uuid not null references auth.users (id),
  due_at timestamptz,
  timezone text not null default 'Asia/Jakarta',
  origin_idea_id uuid references public.ideas (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.content_items is 'Content item kanonis — SATU sumber kebenaran untuk kalender + board (R2-01). production_status TANPA client_review (Keputusan #8, ADR-0007 §2). Penugasan fase ini = owner_user_id (task/assignee baru Phase 3). Arsip lewat archived_at, bukan hard-delete.';
comment on column public.content_items.timezone is 'Timezone IANA untuk due date produksi (P2-A9). Penjadwalan placement memakai content_placements.timezone. Disimpan UTC; default Asia/Jakarta (Keputusan #13).';

-- FK sirkular: ideas.converted_content_item_id -> content_items(id).
-- Ditambahkan SEKARANG karena content_items sudah ada — bukan
-- forward-reference antar file (masih di dalam 0007 yang sama).
-- DO-block agar migrasi tetap idempotent bila dijalankan ulang.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ideas_converted_content_item_id_fkey'
  ) then
    alter table public.ideas
      add constraint ideas_converted_content_item_id_fkey
      foreign key (converted_content_item_id)
      references public.content_items (id) on delete set null;
  end if;
end $$;

-- --- content_placements -----------------------------------------------------
-- Dok 05 §3: content_item_id, social_channel_id, platform_format,
-- platform_caption, platform_hashtags, scheduled_at, timezone,
-- distribution_status, platform_metadata, remote_post_id nullable,
-- published_url nullable.
-- remote_post_id / published_url HARUS TETAP NULL di fase ini (belum ada
-- publishing — P2-10): ditegakkan CHECK di bawah, BUKAN hanya komentar.
-- CHECK ini DICABUT oleh migrasi Phase 6 saat publishing manual dimulai.
-- distribution_status terpisah dari production_status (R2-02, Dok 05 §4).
-- Scope channel <-> item: trigger validate_content_placement_scope.
create table if not exists public.content_placements (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  social_channel_id uuid not null references public.social_channels (id) on delete restrict,
  platform_format text,
  platform_caption text,
  platform_hashtags text[] not null default '{}',
  scheduled_at timestamptz,
  timezone text not null default 'Asia/Jakarta',
  distribution_status text not null default 'draft'
    constraint content_placements_distribution_status_check
    check (distribution_status in (
      'draft', 'ready', 'scheduled_locally', 'sending',
      'uploaded_or_draft_created', 'published', 'failed',
      'needs_manual_action', 'cancelled'
    )),
  platform_metadata jsonb not null default '{}'::jsonb,
  remote_post_id text,
  published_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_placements_remote_post_id_null_check
    check (remote_post_id is null and published_url is null)
);

comment on table public.content_placements is 'Placement multi-channel: satu content item -> banyak channel (format/caption/jadwal/status bisa berbeda). remote_post_id/published_url WAJIB null di fase ini (CHECK) — belum ada publishing; CHECK dicabut migrasi Phase 6.';
comment on column public.content_placements.timezone is 'Timezone IANA untuk penjadwalan placement ini (P2-A9). Disimpan UTC; default Asia/Jakarta (Keputusan #13).';

-- --- content_versions (baseline v1, P2-09) ---------------------------------
-- Dok 05 §3: content_item_id, version_number, brief_snapshot, script,
-- caption, CTA, creative_notes, change_summary, created_by, created_at;
-- unique(content_item_id, version_number). Append-only: TIDAK ADA
-- updated_at, TIDAK ADA UPDATE/DELETE lewat RLS (versi baru, bukan timpa).
create table if not exists public.content_versions (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  brief_snapshot jsonb not null default '{}'::jsonb,
  script text,
  caption text,
  cta text,
  creative_notes text,
  change_summary text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (content_item_id, version_number)
);

comment on table public.content_versions is 'Versi konten (baseline v1 dibuat otomatis saat create, P2-09). Append-only: edit field kunci membuat versi baru, bukan menimpa. unique(content_item_id, version_number) — Dok 05 §6.';

-- --- placement_versions (WAJIB, P2-A7 / Keputusan #7) -----------------------
-- Dok 05 §3: placement_id, version_number, payload_snapshot, created_by,
-- created_at. WAJIB (bukan "recommended") karena approval_requests.
-- placement_version_id (Phase 4) mengasumsikannya ada. Append-only.
create table if not exists public.placement_versions (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.content_placements (id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  payload_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (placement_id, version_number)
);

comment on table public.placement_versions is 'Versi placement — WAJIB (P2-A7, Keputusan #7): lineage versi per placement untuk approval Phase 4. Append-only. unique(placement_id, version_number).';

-- --- content_status_events (riwayat status, P2-14) --------------------------
-- Dok 05 §3: content_item_id, from_status, to_status, actor_user_id,
-- reason, occurred_at. Append-only: TIDAK ADA updated_at / UPDATE / DELETE.
-- from_status nullable (pembuatan pertama tidak punya "dari").
-- reason WAJIB untuk transisi exception (changes_requested/blocked/cancelled)
-- — ditegakkan di domain service (P2-12/P2-14), bukan CHECK di sini,
-- karena reason juga dipakai untuk transisi biasa yang boleh kosong.
create table if not exists public.content_status_events (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_user_id uuid references auth.users (id),
  reason text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.content_status_events is 'Riwayat status append-only (siapa, dari-ke, kapan, alasan). Ditulis bersama activity_logs dalam satu transaksi saat transisi (P2-12/P2-14).';

-- --- tags + content_tags ----------------------------------------------------
-- Dok 05 §3: tags, content_tags. Tag ternormalisasi per workspace.
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  slug text not null,
  color_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

comment on table public.tags is 'Tag ternormalisasi per workspace (slug unik per workspace).';

create table if not exists public.content_tags (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, tag_id)
);

comment on table public.content_tags is 'Tautan content item <-> tag. Tag dan item WAJIB satu workspace (trigger validate_content_tag_scope).';

-- ============================================================================
-- BAGIAN 2 — Index (Dok 05 §7 + P2-02: workspace_id, brand_id,
-- production_status, distribution_status, scheduled_at, due_at,
-- owner_user_id, assignee_user_id, campaign_id, created_at + composite
-- sesuai pola query kalender/board/search).
-- CATATAN: assignee_user_id TIDAK ADA kolomnya di fase ini (task baru
-- Phase 3) — tidak ada index untuknya di 0007 (ADR-0007 §6).
-- ============================================================================

create index if not exists idx_brands_ws on public.brands (workspace_id);
create index if not exists idx_brands_ws_status on public.brands (workspace_id, status);

create index if not exists idx_channels_brand on public.social_channels (brand_id);
create index if not exists idx_channels_brand_platform on public.social_channels (brand_id, platform);

create index if not exists idx_pillars_ws on public.content_pillars (workspace_id);
create index if not exists idx_pillars_ws_brand on public.content_pillars (workspace_id, brand_id);

create index if not exists idx_audiences_ws on public.audiences (workspace_id);

create index if not exists idx_campaigns_ws on public.campaigns (workspace_id);
create index if not exists idx_campaigns_ws_status on public.campaigns (workspace_id, status);
create index if not exists idx_campaigns_ws_start on public.campaigns (workspace_id, start_at);
create index if not exists idx_campaigns_owner on public.campaigns (owner_user_id);
create index if not exists idx_campaigns_audience on public.campaigns (audience_id);

create index if not exists idx_campaign_brands_campaign on public.campaign_brands (campaign_id);
create index if not exists idx_campaign_brands_brand on public.campaign_brands (brand_id);

create index if not exists idx_ideas_ws on public.ideas (workspace_id);
create index if not exists idx_ideas_ws_status on public.ideas (workspace_id, status);
create index if not exists idx_ideas_brand on public.ideas (brand_id);
create index if not exists idx_ideas_owner on public.ideas (owner_user_id);
create index if not exists idx_ideas_converted on public.ideas (converted_content_item_id);
create index if not exists idx_ideas_ws_created on public.ideas (workspace_id, created_at desc);

create index if not exists idx_items_ws on public.content_items (workspace_id);
create index if not exists idx_items_ws_prod on public.content_items (workspace_id, production_status);
create index if not exists idx_items_ws_brand on public.content_items (workspace_id, brand_id);
create index if not exists idx_items_brand on public.content_items (brand_id);
create index if not exists idx_items_campaign on public.content_items (campaign_id);
create index if not exists idx_items_pillar on public.content_items (pillar_id);
create index if not exists idx_items_audience on public.content_items (audience_id);
create index if not exists idx_items_owner on public.content_items (owner_user_id);
create index if not exists idx_items_ws_due on public.content_items (workspace_id, due_at);
create index if not exists idx_items_ws_created on public.content_items (workspace_id, created_at desc);
create index if not exists idx_items_origin_idea on public.content_items (origin_idea_id);
create index if not exists idx_items_ws_active on public.content_items (workspace_id) where archived_at is null;

create index if not exists idx_placements_item on public.content_placements (content_item_id);
create index if not exists idx_placements_item_channel on public.content_placements (content_item_id, social_channel_id);
create index if not exists idx_placements_channel on public.content_placements (social_channel_id);
create index if not exists idx_placements_channel_sched on public.content_placements (social_channel_id, scheduled_at);
create index if not exists idx_placements_dist on public.content_placements (distribution_status);
create index if not exists idx_placements_sched on public.content_placements (scheduled_at);
create index if not exists idx_placements_sched_dist on public.content_placements (scheduled_at, distribution_status);

create index if not exists idx_versions_item on public.content_versions (content_item_id);
create index if not exists idx_versions_created_by on public.content_versions (created_by);

create index if not exists idx_placement_versions_placement on public.placement_versions (placement_id);
create index if not exists idx_placement_versions_created_by on public.placement_versions (created_by);

create index if not exists idx_status_events_item on public.content_status_events (content_item_id);
create index if not exists idx_status_events_item_time on public.content_status_events (content_item_id, occurred_at desc);
create index if not exists idx_status_events_actor on public.content_status_events (actor_user_id);
create index if not exists idx_status_events_to on public.content_status_events (to_status);

create index if not exists idx_tags_ws on public.tags (workspace_id);

create index if not exists idx_content_tags_item on public.content_tags (content_item_id);
create index if not exists idx_content_tags_tag on public.content_tags (tag_id);

-- ============================================================================
-- BAGIAN 3 — Trigger validasi scope lintas-tabel (Dok 05 §6)
-- CHECK tidak bisa memeriksa tabel lain, jadi aturan "workspace yang cocok"
-- ditegakkan di sini. Fungsi SECURITY DEFINER (ditinjau — pola
-- accept_invitation/0003 dan helper 0006): membaca kolom scope APA ADANYA
-- (bypass RLS) agar pemeriksaan tidak tertipu hasil RLS yang terfilter,
-- dan gagal TERTUTUP (P0001) bila tidak cocok. Fungsi HANYA membaca scope
-- + melempar exception; tidak menulis, tidak mengembalikan data.
-- ============================================================================

create or replace function public.validate_content_pillar_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
begin
  if new.brand_id is null then
    return new;
  end if;
  select workspace_id into v_ws from public.brands where id = new.brand_id;
  if v_ws is null or v_ws <> new.workspace_id then
    raise exception 'scope mismatch: content_pillars.brand_id belongs to a different workspace';
  end if;
  return new;
end;
$$;

create or replace function public.validate_campaign_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
begin
  if new.audience_id is null then
    return new;
  end if;
  select workspace_id into v_ws from public.audiences where id = new.audience_id;
  if v_ws is null or v_ws <> new.workspace_id then
    raise exception 'scope mismatch: campaigns.audience_id belongs to a different workspace';
  end if;
  return new;
end;
$$;

create or replace function public.validate_campaign_brand_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign_ws uuid;
  v_brand_ws uuid;
begin
  select workspace_id into v_campaign_ws from public.campaigns where id = new.campaign_id;
  select workspace_id into v_brand_ws from public.brands where id = new.brand_id;
  if v_campaign_ws is null or v_brand_ws is null or v_campaign_ws <> v_brand_ws then
    raise exception 'scope mismatch: campaign_brands campaign and brand belong to different workspaces';
  end if;
  return new;
end;
$$;

create or replace function public.validate_idea_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
begin
  if new.brand_id is null then
    return new;
  end if;
  select workspace_id into v_ws from public.brands where id = new.brand_id;
  if v_ws is null or v_ws <> new.workspace_id then
    raise exception 'scope mismatch: ideas.brand_id belongs to a different workspace';
  end if;
  return new;
end;
$$;

create or replace function public.validate_content_item_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.brands where id = new.brand_id;
  if v_ws is null or v_ws <> new.workspace_id then
    raise exception 'scope mismatch: content_items.brand_id belongs to a different workspace';
  end if;
  if new.campaign_id is not null then
    select workspace_id into v_ws from public.campaigns where id = new.campaign_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.campaign_id belongs to a different workspace';
    end if;
  end if;
  if new.pillar_id is not null then
    select workspace_id into v_ws from public.content_pillars where id = new.pillar_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.pillar_id belongs to a different workspace';
    end if;
  end if;
  if new.audience_id is not null then
    select workspace_id into v_ws from public.audiences where id = new.audience_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.audience_id belongs to a different workspace';
    end if;
  end if;
  if new.origin_idea_id is not null then
    select workspace_id into v_ws from public.ideas where id = new.origin_idea_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.origin_idea_id belongs to a different workspace';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_content_placement_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item_brand uuid;
  v_item_ws uuid;
  v_channel_brand uuid;
  v_channel_ws uuid;
begin
  select brand_id, workspace_id into v_item_brand, v_item_ws
    from public.content_items where id = new.content_item_id;
  select sc.brand_id, b.workspace_id into v_channel_brand, v_channel_ws
    from public.social_channels sc
    join public.brands b on b.id = sc.brand_id
    where sc.id = new.social_channel_id;
  if v_item_brand is null or v_channel_brand is null then
    raise exception 'scope mismatch: content placement references a missing content item or channel';
  end if;
  -- Placement HANYA ke channel dengan brand yang SAMA dengan item
  -- (otomatis satu workspace). Reuse lintas-brand yang diotorisasi +
  -- diaudit BELUM ADA di fase ini — ditolak, bukan diizinkan diam-diam.
  if v_channel_brand <> v_item_brand or v_channel_ws <> v_item_ws then
    raise exception 'scope mismatch: placement channel belongs to a different workspace/brand than the content item';
  end if;
  return new;
end;
$$;

create or replace function public.validate_content_tag_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item_ws uuid;
  v_tag_ws uuid;
begin
  select workspace_id into v_item_ws from public.content_items where id = new.content_item_id;
  select workspace_id into v_tag_ws from public.tags where id = new.tag_id;
  if v_item_ws is null or v_tag_ws is null or v_item_ws <> v_tag_ws then
    raise exception 'scope mismatch: content_tags tag belongs to a different workspace than the content item';
  end if;
  return new;
end;
$$;

comment on function public.validate_content_pillar_scope() is 'Trigger scope (0007): pilar-brand satu workspace. SECURITY DEFINER, ditinjau — hanya baca scope + raise.';
comment on function public.validate_campaign_scope() is 'Trigger scope (0007): campaign-audience satu workspace. SECURITY DEFINER, ditinjau — hanya baca scope + raise.';
comment on function public.validate_campaign_brand_scope() is 'Trigger scope (0007): campaign-brand satu workspace. SECURITY DEFINER, ditinjau — hanya baca scope + raise.';
comment on function public.validate_idea_scope() is 'Trigger scope (0007): idea-brand satu workspace. SECURITY DEFINER, ditinjau — hanya baca scope + raise.';
comment on function public.validate_content_item_scope() is 'Trigger scope (0007): item-brand/campaign/pillar/audience/origin-idea satu workspace. SECURITY DEFINER, ditinjau — hanya baca scope + raise.';
comment on function public.validate_content_placement_scope() is 'Trigger scope (0007): placement hanya ke channel brand yang sama dengan item (Dok 05 §6). SECURITY DEFINER, ditinjau — hanya baca scope + raise.';
comment on function public.validate_content_tag_scope() is 'Trigger scope (0007): tag-item satu workspace. SECURITY DEFINER, ditinjau — hanya baca scope + raise.';

drop trigger if exists trg_content_pillar_scope on public.content_pillars;
create trigger trg_content_pillar_scope
  before insert or update on public.content_pillars
  for each row execute function public.validate_content_pillar_scope();

drop trigger if exists trg_campaign_scope on public.campaigns;
create trigger trg_campaign_scope
  before insert or update on public.campaigns
  for each row execute function public.validate_campaign_scope();

drop trigger if exists trg_campaign_brand_scope on public.campaign_brands;
create trigger trg_campaign_brand_scope
  before insert or update on public.campaign_brands
  for each row execute function public.validate_campaign_brand_scope();

drop trigger if exists trg_idea_scope on public.ideas;
create trigger trg_idea_scope
  before insert or update on public.ideas
  for each row execute function public.validate_idea_scope();

drop trigger if exists trg_content_item_scope on public.content_items;
create trigger trg_content_item_scope
  before insert or update on public.content_items
  for each row execute function public.validate_content_item_scope();

drop trigger if exists trg_content_placement_scope on public.content_placements;
create trigger trg_content_placement_scope
  before insert or update on public.content_placements
  for each row execute function public.validate_content_placement_scope();

drop trigger if exists trg_content_tag_scope on public.content_tags;
create trigger trg_content_tag_scope
  before insert or update on public.content_tags
  for each row execute function public.validate_content_tag_scope();

-- ============================================================================
-- BAGIAN 4 — Fungsi helper SECURITY DEFINER (pola 0006)
-- Melengkapi 5 helper 0006 untuk tabel Phase 2. Pengaman yang sama:
-- (1) search_path dikunci (public, pg_temp) + semua objek di-qualify skema;
-- (2) helper hanya mengembalikan BOOLEAN tentang keanggotaan/akses pemanggil
-- sendiri (auth.uid()) — TIDAK PERNAH mengembalikan baris atau data
-- pengguna lain; (3) tanpa dynamic SQL; (4) grant EXECUTE hanya ke
-- authenticated; (5) STABLE (hanya baca, tidak mutasi).
-- JANGAN ubah helper ini menjadi SECURITY INVOKER — rekursi akan kembali.
-- ============================================================================

-- Apakah pemanggil member AKTIF workspace pemilik brand ini.
create or replace function public.is_brand_member(p_brand_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.brands b
    where b.id = p_brand_id
      and public.is_ws_member(b.workspace_id, p_roles)
  );
$$;

comment on function public.is_brand_member(uuid, text[]) is 'Helper RLS anti-rekursi (0007): apakah pemanggil member aktif workspace pemilik brand. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil member AKTIF workspace pemilik channel ini (lewat brand).
create or replace function public.is_channel_member(p_channel_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.social_channels sc
    join public.brands b on b.id = sc.brand_id
    where sc.id = p_channel_id
      and public.is_ws_member(b.workspace_id, p_roles)
  );
$$;

comment on function public.is_channel_member(uuid, text[]) is 'Helper RLS anti-rekursi (0007): apakah pemanggil member aktif workspace pemilik channel. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil member AKTIF workspace pemilik campaign ini.
create or replace function public.is_campaign_member(p_campaign_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.campaigns c
    where c.id = p_campaign_id
      and public.is_ws_member(c.workspace_id, p_roles)
  );
$$;

comment on function public.is_campaign_member(uuid, text[]) is 'Helper RLS anti-rekursi (0007): apakah pemanggil member aktif workspace pemilik campaign. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil member AKTIF workspace pemilik content item ini.
create or replace function public.is_content_item_member(p_content_item_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.content_items ci
    where ci.id = p_content_item_id
      and public.is_ws_member(ci.workspace_id, p_roles)
  );
$$;

comment on function public.is_content_item_member(uuid, text[]) is 'Helper RLS anti-rekursi (0007): apakah pemanggil member aktif workspace pemilik content item. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil adalah owner (penanggung jawab) content item ini.
-- "Ditugaskan" di fase ini = owner_user_id (task/assignee baru Phase 3).
create or replace function public.is_content_item_owner(p_content_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.content_items ci
    where ci.id = p_content_item_id
      and ci.owner_user_id = auth.uid()
  );
$$;

comment on function public.is_content_item_owner(uuid) is 'Helper RLS anti-rekursi (0007): apakah pemanggil owner content item ini. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil member AKTIF workspace pemilik placement ini (lewat item).
create or replace function public.is_placement_member(p_placement_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.content_placements pl
    join public.content_items ci on ci.id = pl.content_item_id
    where pl.id = p_placement_id
      and public.is_ws_member(ci.workspace_id, p_roles)
  );
$$;

comment on function public.is_placement_member(uuid, text[]) is 'Helper RLS anti-rekursi (0007): apakah pemanggil member aktif workspace pemilik placement. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil BOLEH MEMBACA content item ini: member aktif workspace
-- dengan role baca-penuh (owner/admin/manager/strategist/approver/analyst),
-- ATAU creator/editor yang itemnya ditugaskan ke dirinya (owner).
-- viewer_client TIDAK masuk jalur ini — klien hanya lewat share (lihat
-- is_resource_shared_with_me di bawah).
create or replace function public.can_read_content_item(p_content_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_content_item_member(p_content_item_id, array['owner', 'admin', 'manager', 'strategist', 'approver', 'analyst'])
    or (
      public.is_content_item_member(p_content_item_id, array['creator', 'editor'])
      and public.is_content_item_owner(p_content_item_id)
    );
$$;

comment on function public.can_read_content_item(uuid) is 'Helper RLS anti-rekursi (0007): apakah pemanggil boleh membaca content item ini (baca-penuh, atau creator/editor atas itemnya sendiri). SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil BOLEH MENGEDIT content item ini: role tulis-penuh
-- (owner/admin/manager/strategist), ATAU creator/editor atas itemnya sendiri.
create or replace function public.can_edit_content_item(p_content_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_content_item_member(p_content_item_id, array['owner', 'admin', 'manager', 'strategist'])
    or (
      public.is_content_item_member(p_content_item_id, array['creator', 'editor'])
      and public.is_content_item_owner(p_content_item_id)
    );
$$;

comment on function public.can_edit_content_item(uuid) is 'Helper RLS anti-rekursi (0007): apakah pemanggil boleh mengedit content item ini (tulis-penuh, atau creator/editor atas itemnya sendiri). SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil BOLEH MEMBACA placement ini (aturan baca item induknya).
create or replace function public.can_read_placement(p_placement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.content_placements pl
    join public.content_items ci on ci.id = pl.content_item_id
    where pl.id = p_placement_id
      and (
        public.is_ws_member(ci.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'approver', 'analyst'])
        or (
          public.is_ws_member(ci.workspace_id, array['creator', 'editor'])
          and ci.owner_user_id = auth.uid()
        )
      )
  );
$$;

comment on function public.can_read_placement(uuid) is 'Helper RLS anti-rekursi (0007): apakah pemanggil boleh membaca placement ini (aturan baca item induknya). SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil BOLEH MENGEDIT placement ini (aturan edit item induknya).
create or replace function public.can_edit_placement(p_placement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.content_placements pl
    join public.content_items ci on ci.id = pl.content_item_id
    where pl.id = p_placement_id
      and (
        public.is_ws_member(ci.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
        or (
          public.is_ws_member(ci.workspace_id, array['creator', 'editor'])
          and ci.owner_user_id = auth.uid()
        )
      )
  );
$$;

comment on function public.can_edit_placement(uuid) is 'Helper RLS anti-rekursi (0007): apakah pemanggil boleh mengedit placement ini (aturan edit item induknya). SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah resource ini dibagikan eksplisit ke pemanggil lewat portal klien
-- (resource_shares, 0005). Satu-satunya jalur baca viewer_client.
create or replace function public.is_resource_shared_with_me(p_resource_type text, p_resource_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.resource_shares rs
    where rs.resource_type = p_resource_type
      and rs.resource_id = p_resource_id
      and rs.shared_with_user_id = auth.uid()
  );
$$;

comment on function public.is_resource_shared_with_me(text, uuid) is 'Helper RLS anti-rekursi (0007): apakah resource ini dibagikan eksplisit ke pemanggil (portal klien, Keputusan #12). SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah placement ini milik content item yang dibagikan ke pemanggil.
create or replace function public.is_placement_shared_with_me(p_placement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.content_placements pl
    where pl.id = p_placement_id
      and public.is_resource_shared_with_me('content_item', pl.content_item_id)
  );
$$;

comment on function public.is_placement_shared_with_me(uuid) is 'Helper RLS anti-rekursi (0007): apakah placement ini milik content item yang dibagikan ke pemanggil. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Grant EXECUTE hanya ke authenticated (bukan public/anon).
revoke all on function public.is_brand_member(uuid, text[]) from public;
revoke all on function public.is_channel_member(uuid, text[]) from public;
revoke all on function public.is_campaign_member(uuid, text[]) from public;
revoke all on function public.is_content_item_member(uuid, text[]) from public;
revoke all on function public.is_content_item_owner(uuid) from public;
revoke all on function public.is_placement_member(uuid, text[]) from public;
revoke all on function public.can_read_content_item(uuid) from public;
revoke all on function public.can_edit_content_item(uuid) from public;
revoke all on function public.can_read_placement(uuid) from public;
revoke all on function public.can_edit_placement(uuid) from public;
revoke all on function public.is_resource_shared_with_me(text, uuid) from public;
revoke all on function public.is_placement_shared_with_me(uuid) from public;
grant execute on function public.is_brand_member(uuid, text[]) to authenticated;
grant execute on function public.is_channel_member(uuid, text[]) to authenticated;
grant execute on function public.is_campaign_member(uuid, text[]) to authenticated;
grant execute on function public.is_content_item_member(uuid, text[]) to authenticated;
grant execute on function public.is_content_item_owner(uuid) to authenticated;
grant execute on function public.is_placement_member(uuid, text[]) to authenticated;
grant execute on function public.can_read_content_item(uuid) to authenticated;
grant execute on function public.can_edit_content_item(uuid) to authenticated;
grant execute on function public.can_read_placement(uuid) to authenticated;
grant execute on function public.can_edit_placement(uuid) to authenticated;
grant execute on function public.is_resource_shared_with_me(text, uuid) to authenticated;
grant execute on function public.is_placement_shared_with_me(uuid) to authenticated;

-- ============================================================================
-- BAGIAN 5 — RLS (P2-03): policy eksplisit per operasi, default deny.
-- Matriks: Dok 06 §3 + lib/permissions.ts; interpretasi di ADR-0007 §8.
-- TIDAK ADA policy yang memindai tabel lain (FROM/JOIN) — hanya helper
-- 0006 + helper Bagian 4 + kolom baris yang sedang dievaluasi.
-- Grant: keempat operasi diberikan ke authenticated; penegakan sepenuhnya
-- di RLS (termasuk policy using(false)) — lihat ADR-0007 §8.
-- ============================================================================

alter table public.brands enable row level security;
alter table public.social_channels enable row level security;
alter table public.content_pillars enable row level security;
alter table public.audiences enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_brands enable row level security;
alter table public.ideas enable row level security;
alter table public.content_items enable row level security;
alter table public.content_placements enable row level security;
alter table public.content_versions enable row level security;
alter table public.placement_versions enable row level security;
alter table public.content_status_events enable row level security;
alter table public.tags enable row level security;
alter table public.content_tags enable row level security;

revoke all on public.brands from anon, authenticated;
revoke all on public.social_channels from anon, authenticated;
revoke all on public.content_pillars from anon, authenticated;
revoke all on public.audiences from anon, authenticated;
revoke all on public.campaigns from anon, authenticated;
revoke all on public.campaign_brands from anon, authenticated;
revoke all on public.ideas from anon, authenticated;
revoke all on public.content_items from anon, authenticated;
revoke all on public.content_placements from anon, authenticated;
revoke all on public.content_versions from anon, authenticated;
revoke all on public.placement_versions from anon, authenticated;
revoke all on public.content_status_events from anon, authenticated;
revoke all on public.tags from anon, authenticated;
revoke all on public.content_tags from anon, authenticated;
grant select, insert, update, delete on public.brands to authenticated;
grant select, insert, update, delete on public.social_channels to authenticated;
grant select, insert, update, delete on public.content_pillars to authenticated;
grant select, insert, update, delete on public.audiences to authenticated;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, update, delete on public.campaign_brands to authenticated;
grant select, insert, update, delete on public.ideas to authenticated;
grant select, insert, update, delete on public.content_items to authenticated;
grant select, insert, update, delete on public.content_placements to authenticated;
grant select, insert, update, delete on public.content_versions to authenticated;
grant select, insert, update, delete on public.placement_versions to authenticated;
grant select, insert, update, delete on public.content_status_events to authenticated;
grant select, insert, update, delete on public.tags to authenticated;
grant select, insert, update, delete on public.content_tags to authenticated;

-- --- brands -----------------------------------------------------------------
-- Baca: member aktif workspace (semua kecuali viewer_client).
-- Tulis: owner/admin/manager. Hapus: tidak (arsip lewat status).
create policy "brands_select_member"
  on public.brands for select
  to authenticated
  using (
    public.is_ws_member(brands.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "brands_insert_owner_admin_manager"
  on public.brands for insert
  to authenticated
  with check (
    public.is_ws_member(brands.workspace_id, array['owner', 'admin', 'manager'])
  );

create policy "brands_update_owner_admin_manager"
  on public.brands for update
  to authenticated
  using (
    public.is_ws_member(brands.workspace_id, array['owner', 'admin', 'manager'])
  )
  with check (
    public.is_ws_member(brands.workspace_id, array['owner', 'admin', 'manager'])
  );

create policy "brands_no_delete"
  on public.brands for delete to authenticated using (false);

-- --- social_channels --------------------------------------------------------
-- Baca: member aktif workspace pemilik brand (semua kecuali viewer_client).
-- Tulis: owner/admin/manager. Hapus: tidak (putuskan lewat connection_status).
create policy "channels_select_member"
  on public.social_channels for select
  to authenticated
  using (
    public.is_brand_member(social_channels.brand_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "channels_insert_owner_admin_manager"
  on public.social_channels for insert
  to authenticated
  with check (
    public.is_brand_member(social_channels.brand_id, array['owner', 'admin', 'manager'])
  );

create policy "channels_update_owner_admin_manager"
  on public.social_channels for update
  to authenticated
  using (
    public.is_brand_member(social_channels.brand_id, array['owner', 'admin', 'manager'])
  )
  with check (
    public.is_brand_member(social_channels.brand_id, array['owner', 'admin', 'manager'])
  );

create policy "channels_no_delete"
  on public.social_channels for delete to authenticated using (false);

-- --- content_pillars --------------------------------------------------------
-- Baca: member aktif workspace (semua kecuali viewer_client).
-- Tulis: owner/admin/manager/strategist. Hapus: tidak (nonaktifkan).
create policy "pillars_select_member"
  on public.content_pillars for select
  to authenticated
  using (
    public.is_ws_member(content_pillars.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "pillars_insert_planners"
  on public.content_pillars for insert
  to authenticated
  with check (
    public.is_ws_member(content_pillars.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  );

create policy "pillars_update_planners"
  on public.content_pillars for update
  to authenticated
  using (
    public.is_ws_member(content_pillars.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  )
  with check (
    public.is_ws_member(content_pillars.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  );

create policy "pillars_no_delete"
  on public.content_pillars for delete to authenticated using (false);

-- --- audiences --------------------------------------------------------------
-- Baca: member aktif workspace (semua kecuali viewer_client).
-- Tulis: owner/admin/manager/strategist. Hapus: hanya owner/admin
-- (tidak ada kolom status untuk pengarsipan).
create policy "audiences_select_member"
  on public.audiences for select
  to authenticated
  using (
    public.is_ws_member(audiences.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "audiences_insert_planners"
  on public.audiences for insert
  to authenticated
  with check (
    public.is_ws_member(audiences.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  );

create policy "audiences_update_planners"
  on public.audiences for update
  to authenticated
  using (
    public.is_ws_member(audiences.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  )
  with check (
    public.is_ws_member(audiences.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  );

create policy "audiences_delete_owner_admin"
  on public.audiences for delete
  to authenticated
  using (
    public.is_ws_member(audiences.workspace_id, array['owner', 'admin'])
  );

-- --- campaigns --------------------------------------------------------------
-- Baca: member aktif workspace (semua kecuali viewer_client) ATAU klien
-- yang campaign-nya dibagikan eksplisit (portal, Keputusan #12).
-- Tulis: owner/admin/manager/strategist. Hapus: tidak (arsip lewat status).
create policy "campaigns_select_member_or_shared"
  on public.campaigns for select
  to authenticated
  using (
    public.is_ws_member(campaigns.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_resource_shared_with_me('campaign', campaigns.id)
  );

create policy "campaigns_insert_planners"
  on public.campaigns for insert
  to authenticated
  with check (
    public.is_ws_member(campaigns.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  );

create policy "campaigns_update_planners"
  on public.campaigns for update
  to authenticated
  using (
    public.is_ws_member(campaigns.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  )
  with check (
    public.is_ws_member(campaigns.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  );

create policy "campaigns_no_delete"
  on public.campaigns for delete to authenticated using (false);

-- --- campaign_brands --------------------------------------------------------
-- Baca: member campaign (semua kecuali viewer_client) ATAU klien yang
-- campaign-nya dibagikan. Tulis/hapus tautan: owner/admin/manager/strategist.
-- UPDATE: tidak (lepas + tautkan ulang).
create policy "campaign_brands_select_member_or_shared"
  on public.campaign_brands for select
  to authenticated
  using (
    public.is_campaign_member(campaign_brands.campaign_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_resource_shared_with_me('campaign', campaign_brands.campaign_id)
  );

create policy "campaign_brands_insert_planners"
  on public.campaign_brands for insert
  to authenticated
  with check (
    public.is_campaign_member(campaign_brands.campaign_id, array['owner', 'admin', 'manager', 'strategist'])
  );

create policy "campaign_brands_no_update"
  on public.campaign_brands for update to authenticated using (false);

create policy "campaign_brands_delete_planners"
  on public.campaign_brands for delete
  to authenticated
  using (
    public.is_campaign_member(campaign_brands.campaign_id, array['owner', 'admin', 'manager', 'strategist'])
  );

-- --- ideas ------------------------------------------------------------------
-- Baca: member aktif workspace (semua kecuali viewer_client).
-- Tulis: owner/admin/manager/strategist penuh; creator/editor hanya ide
-- yang owner-nya = dirinya. Hapus: tidak (arsip lewat status).
create policy "ideas_select_member"
  on public.ideas for select
  to authenticated
  using (
    public.is_ws_member(ideas.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "ideas_insert_creators"
  on public.ideas for insert
  to authenticated
  with check (
    public.is_ws_member(ideas.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or (
      public.is_ws_member(ideas.workspace_id, array['creator', 'editor'])
      and ideas.owner_user_id = auth.uid()
    )
  );

create policy "ideas_update_creators"
  on public.ideas for update
  to authenticated
  using (
    public.is_ws_member(ideas.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or (
      public.is_ws_member(ideas.workspace_id, array['creator', 'editor'])
      and ideas.owner_user_id = auth.uid()
    )
  )
  with check (
    public.is_ws_member(ideas.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or (
      public.is_ws_member(ideas.workspace_id, array['creator', 'editor'])
      and ideas.owner_user_id = auth.uid()
    )
  );

create policy "ideas_no_delete"
  on public.ideas for delete to authenticated using (false);

-- --- content_items ----------------------------------------------------------
-- Baca: baca-penuh (owner/admin/manager/strategist/approver/analyst) ATAU
-- creator/editor atas itemnya sendiri ATAU klien yang item-nya dibagikan.
-- Tulis: tulis-penuh ATAU creator/editor atas itemnya sendiri (INSERT harus
-- owner = diri; UPDATE tidak boleh mengalihkan kepemilikan ke orang lain).
-- Hapus: tidak (arsip lewat archived_at).
create policy "items_select_member_or_shared"
  on public.content_items for select
  to authenticated
  using (
    public.is_ws_member(content_items.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'approver', 'analyst'])
    or (
      public.is_ws_member(content_items.workspace_id, array['creator', 'editor'])
      and content_items.owner_user_id = auth.uid()
    )
    or public.is_resource_shared_with_me('content_item', content_items.id)
  );

create policy "items_insert_editors"
  on public.content_items for insert
  to authenticated
  with check (
    public.is_ws_member(content_items.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or (
      public.is_ws_member(content_items.workspace_id, array['creator', 'editor'])
      and content_items.owner_user_id = auth.uid()
    )
  );

create policy "items_update_editors"
  on public.content_items for update
  to authenticated
  using (
    public.is_ws_member(content_items.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or (
      public.is_ws_member(content_items.workspace_id, array['creator', 'editor'])
      and content_items.owner_user_id = auth.uid()
    )
  )
  with check (
    public.is_ws_member(content_items.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or (
      public.is_ws_member(content_items.workspace_id, array['creator', 'editor'])
      and content_items.owner_user_id = auth.uid()
    )
  );

create policy "items_no_delete"
  on public.content_items for delete to authenticated using (false);

-- --- content_placements -----------------------------------------------------
-- Baca: boleh baca item induknya ATAU klien yang item-nya dibagikan.
-- Tulis/hapus: boleh edit item induknya. Scope channel <-> item ditegakkan
-- trigger validate_content_placement_scope (Dok 05 §6).
create policy "placements_select_readable_or_shared"
  on public.content_placements for select
  to authenticated
  using (
    public.can_read_content_item(content_placements.content_item_id)
    or public.is_resource_shared_with_me('content_item', content_placements.content_item_id)
  );

create policy "placements_insert_editors"
  on public.content_placements for insert
  to authenticated
  with check (
    public.can_edit_content_item(content_placements.content_item_id)
  );

create policy "placements_update_editors"
  on public.content_placements for update
  to authenticated
  using (
    public.can_edit_content_item(content_placements.content_item_id)
  )
  with check (
    public.can_edit_content_item(content_placements.content_item_id)
  );

create policy "placements_delete_editors"
  on public.content_placements for delete
  to authenticated
  using (
    public.can_edit_content_item(content_placements.content_item_id)
  );

-- --- content_versions -------------------------------------------------------
-- Baca: boleh baca item induknya ATAU klien yang item-nya dibagikan.
-- Tulis: boleh edit item induknya. Append-only: TIDAK ADA UPDATE/DELETE.
create policy "versions_select_readable_or_shared"
  on public.content_versions for select
  to authenticated
  using (
    public.can_read_content_item(content_versions.content_item_id)
    or public.is_resource_shared_with_me('content_item', content_versions.content_item_id)
  );

create policy "versions_insert_editors"
  on public.content_versions for insert
  to authenticated
  with check (
    public.can_edit_content_item(content_versions.content_item_id)
  );

create policy "versions_no_update"
  on public.content_versions for update to authenticated using (false);

create policy "versions_no_delete"
  on public.content_versions for delete to authenticated using (false);

-- --- placement_versions -----------------------------------------------------
-- Baca: boleh baca placement-nya ATAU klien yang item-nya dibagikan.
-- Tulis: boleh edit placement-nya. Append-only: TIDAK ADA UPDATE/DELETE.
create policy "placement_versions_select_readable_or_shared"
  on public.placement_versions for select
  to authenticated
  using (
    public.can_read_placement(placement_versions.placement_id)
    or public.is_placement_shared_with_me(placement_versions.placement_id)
  );

create policy "placement_versions_insert_editors"
  on public.placement_versions for insert
  to authenticated
  with check (
    public.can_edit_placement(placement_versions.placement_id)
  );

create policy "placement_versions_no_update"
  on public.placement_versions for update to authenticated using (false);

create policy "placement_versions_no_delete"
  on public.placement_versions for delete to authenticated using (false);

-- --- content_status_events --------------------------------------------------
-- Baca: boleh baca item induknya ATAU klien yang item-nya dibagikan.
-- Tulis: boleh edit item induknya DAN actor = pemanggil. Append-only.
create policy "status_events_select_readable_or_shared"
  on public.content_status_events for select
  to authenticated
  using (
    public.can_read_content_item(content_status_events.content_item_id)
    or public.is_resource_shared_with_me('content_item', content_status_events.content_item_id)
  );

create policy "status_events_insert_editors_as_actor"
  on public.content_status_events for insert
  to authenticated
  with check (
    content_status_events.actor_user_id = auth.uid()
    and public.can_edit_content_item(content_status_events.content_item_id)
  );

create policy "status_events_no_update"
  on public.content_status_events for update to authenticated using (false);

create policy "status_events_no_delete"
  on public.content_status_events for delete to authenticated using (false);

-- --- tags -------------------------------------------------------------------
-- Baca: member aktif workspace (semua kecuali viewer_client).
-- Tulis: owner/admin/manager/strategist/creator/editor (pekerja konten
-- butuh membuat tag saat menandai). Hapus: hanya owner/admin.
create policy "tags_select_member"
  on public.tags for select
  to authenticated
  using (
    public.is_ws_member(tags.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "tags_insert_workers"
  on public.tags for insert
  to authenticated
  with check (
    public.is_ws_member(tags.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor'])
  );

create policy "tags_update_workers"
  on public.tags for update
  to authenticated
  using (
    public.is_ws_member(tags.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor'])
  )
  with check (
    public.is_ws_member(tags.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor'])
  );

create policy "tags_delete_owner_admin"
  on public.tags for delete
  to authenticated
  using (
    public.is_ws_member(tags.workspace_id, array['owner', 'admin'])
  );

-- --- content_tags -----------------------------------------------------------
-- Baca: boleh baca item induknya ATAU klien yang item-nya dibagikan.
-- Tulis/hapus tautan: boleh edit item induknya. UPDATE: tidak (lepas +
-- tautkan ulang). Scope tag <-> item ditegakkan trigger.
create policy "content_tags_select_readable_or_shared"
  on public.content_tags for select
  to authenticated
  using (
    public.can_read_content_item(content_tags.content_item_id)
    or public.is_resource_shared_with_me('content_item', content_tags.content_item_id)
  );

create policy "content_tags_insert_editors"
  on public.content_tags for insert
  to authenticated
  with check (
    public.can_edit_content_item(content_tags.content_item_id)
  );

create policy "content_tags_no_update"
  on public.content_tags for update to authenticated using (false);

create policy "content_tags_delete_editors"
  on public.content_tags for delete
  to authenticated
  using (
    public.can_edit_content_item(content_tags.content_item_id)
  );

-- ============================================================================
-- CATATAN PENERAPAN (untuk koordinator — database live TIDAK disentuh dari VM):
--   Terapkan 0007 SETELAH 0001–0006, di database yang sama:
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0007_planning_core.sql
--   atau: npx supabase db push   (dari folder repo mative/)
--   Lalu jalankan pgTAP Phase 1 (14 tes) + Phase 2 (20 tes):
--     psql "$DATABASE_URL" -v user_a='<UUID-USER-A>' \
--       -v user_b='<UUID-USER-B>' \
--       -f supabase/tests/01_rls_phase1.sql
--     psql "$DATABASE_URL" -v user_a='<UUID-USER-A>' \
--       -v user_b='<UUID-USER-B>' \
--       -f supabase/tests/02_rls_phase2.sql
--   Ekspektasi: 14/14 + 20/20 ok.
--   Verifikasi statis file ini (parse pglast + analisis graf + hitung
--   asersi) sudah dilakukan di VM — lihat docs/phase-2-report.md.
--   Uji terap ke database nyata BELUM dilakukan dari VM ini (Postgres
--   langsung diblokir) — wajib dijalankan koordinator di atas sebelum
--   P2-01 s.d. P2-03 dinyatakan selesai.
-- ============================================================================
