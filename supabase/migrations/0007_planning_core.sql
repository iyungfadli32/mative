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
