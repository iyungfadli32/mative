-- MaTive Phase 7 — First Official Integration + Analytics (migrasi 0021)
-- ADR-0013. Adapter DISABLED (Keputusan #3): TIDAK ADA platform yang
-- dipilih, TIDAK ADA akses apa pun — langkah 7.1/7.3 belum terpenuhi.
-- Yang dibangun: capability registry (di atas social_channels 0007) +
-- analytics ingestion dari record nyata + impor manual/CSV berlabel.
--
-- Isi:
--   (1) social_channels: connection_status tambah 'disabled'; kolom baru
--       capability_checked_at (kapan snapshot terakhir diperiksa).
--   (2) Tabel baru: metric_definitions (katalog global, 14 kunci seed
--       sumber 'manual'), analytics_snapshots, content_metrics,
--       campaign_metrics, integration_events, channel_credentials
--       (server-only: RLS aktif TANPA policy + tanpa grant).
--   (3) RLS + policy (baca: member + brand scope, pola 0016/0020;
--       viewer_client TIDAK ADA di daftar peran — tidak melihat analytics;
--       tulis: HANYA lewat RPC impor — pola publishing 0020; kecuali
--       integration_events INSERT pola activity_logs 0004) + grant.
--   (4) Fungsi: integration_backoff_seconds (ASUMSI-7D: 60/300/900),
--       analytics_snapshot_is_stale (TTL 24 jam), import_analytics_snapshot
--       (transaksional: snapshot + metrik + agregat campaign + event).
--   (5) ASUMSI-7C/7E: metrik turunan (engagement_rate,
--       publishing_adherence) DIHITUNG, bukan diimpor — RPC menolaknya;
--       impor atomik (satu baris tidak valid = seluruh impor gagal).
--
-- Aturan keras (pelajaran Phase 5/6): policy INSERT TIDAK BOLEH memeriksa
-- baris yang sedang di-INSERT di tabelnya sendiri; policy INSERT hanya
-- memakai WITH CHECK (bukan USING); pglast OK bukan berarti Postgres
-- menerima — jalankan pgTAP 07 sebelum klaim lolos.

-- ============================================================================
-- (1) social_channels: status 'disabled' + capability_checked_at
-- ============================================================================
-- CHECK lama (0007) hanya mengizinkan 'not_connected'/'manual'. 'disabled'
-- berarti "adapter fase ini dinonaktifkan karena blocker langkah 7.1/7.3",
-- bukan "pernah terhubung lalu putus".
alter table public.social_channels
  drop constraint if exists social_channels_connection_status_check;
alter table public.social_channels
  add constraint social_channels_connection_status_check
  check (connection_status in ('not_connected', 'manual', 'disabled'));

alter table public.social_channels
  add column if not exists capability_checked_at timestamptz;

comment on constraint social_channels_connection_status_check on public.social_channels is
  'Phase 7 (ADR-0013 §1): tambah ''disabled'' — adapter DISABLED karena platform belum dipilih + akses belum tersedia (langkah 7.1/7.3). Bukan status "pernah terhubung".';
comment on column public.social_channels.capability_checked_at is
  'Phase 7: kapan capability_snapshot terakhir diperiksa. TTL snapshot 24 jam (ASUMSI-7D) — snapshot lebih tua dari itu dianggap kedaluwarsa.';
comment on table public.social_channels is
  'Channel registry — METADATA SAJA (P2-A2) + capability registry Phase 7 (ADR-0013 §2). Tanpa OAuth/token; capability_snapshot berisi snapshot blocker (status disabled) sampai adapter pertama ada.';

-- ============================================================================
-- (2) Tabel baru
-- ============================================================================

-- --- metric_definitions ------------------------------------------------------
-- Katalog kanonis 14 kunci metrik (Dok 10 §3 + ADR-0013 §3). workspace_id
-- NULL = katalog global (dibaca semua member); baris workspace (bukan null)
-- dicadangkan untuk override per-workspace di fase berikut — TIDAK ADA di
-- fase ini. source_platform HANYA 'manual' di fase ini (platform ditambah
-- saat adapter pertama ada — ASUMSI-7F).
create table if not exists public.metric_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  source_platform text not null default 'manual',
  metric_key text not null
    constraint metric_definitions_key_check
    check (metric_key in (
      'reach', 'impressions', 'views', 'video_views', 'engagements',
      'likes', 'comments', 'shares', 'saves', 'clicks',
      'followers_net_change', 'conversions', 'engagement_rate',
      'publishing_adherence'
    )),
  label text not null,
  unit text not null,
  formula text not null,
  notes text not null default '',
  compatibility_group text not null,
  is_derived boolean not null default false,
  created_at timestamptz not null default now(),
  constraint metric_definitions_source_check
    check (source_platform in ('manual'))
);

comment on table public.metric_definitions is 'Katalog kanonis 14 kunci metrik (Phase 7, ADR-0013 §3, Dok 10 §3): definisi untuk sumber manual. is_derived=true (engagement_rate, publishing_adherence) = DIHITUNG, bukan diimpor — RPC impor menolaknya.';
comment on column public.metric_definitions.workspace_id is 'NULL = katalog global (dibaca semua member). Baris workspace dicadangkan untuk override per-workspace — tidak ada di fase ini.';

-- --- analytics_snapshots -----------------------------------------------------
-- Satu baris = satu impor/batch: sumber, periode, retrieved_at, referensi
-- file asli, pengimpor. brand_id NULL = impor multi-brand (visibilitas
-- snapshot multi-brand hanya untuk member tanpa scope — fail-safe, lihat
-- helper is_analytics_snapshot_visible).
create table if not exists public.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete cascade,
  source text not null default 'manual'
    constraint analytics_snapshots_source_check
    check (source = 'manual'),
  provider_account text,
  period_start date not null,
  period_end date not null,
  retrieved_at timestamptz not null default now(),
  raw_payload_reference text not null,
  imported_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint analytics_snapshots_period_check
    check (period_start <= period_end)
);

comment on table public.analytics_snapshots is 'Snapshot analytics (Phase 7, Dok 10 §4): satu baris per impor/batch. raw_payload_reference = referensi file CSV asli (bukan isi file). Tulis HANYA lewat RPC import_analytics_snapshot.';
comment on column public.analytics_snapshots.raw_payload_reference is 'Referensi file impor, mis. csv:<nama-file>:<jumlah-baris>. Bukan isi file — payload mentah dipisah dari metrik ternormalisasi (Dok 10 §1).';

-- --- content_metrics ---------------------------------------------------------
-- Nilai ternormalisasi per subject (placement / content_item /
-- published_post) + snapshot + periode + sumber. brand_id didenormalisasi
-- dari subject saat impor (RPC) — TIDAK NULL — supaya visibilitas RLS
-- per-brand tidak bergantung pada subject yang mungkin sudah dihapus.
-- Impor ulang slice yang sama MENIMPA nilai lama: agregasi memakai snapshot
-- terbaru per (subject, metrik, periode, sumber); duplikat DALAM satu
-- impor ditolak indeks unik (snapshot_id, subject, metric_key).
create table if not exists public.content_metrics (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.analytics_snapshots (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  subject_type text not null
    constraint content_metrics_subject_type_check
    check (subject_type in ('placement', 'content_item', 'published_post')),
  subject_id uuid not null,
  metric_key text not null
    constraint content_metrics_key_check
    check (metric_key in (
      'reach', 'impressions', 'views', 'video_views', 'engagements',
      'likes', 'comments', 'shares', 'saves', 'clicks',
      'followers_net_change', 'conversions', 'engagement_rate',
      'publishing_adherence'
    )),
  value numeric not null
    constraint content_metrics_value_check
    check (value >= 0),
  unit text not null,
  source text not null default 'manual'
    constraint content_metrics_source_check
    check (source = 'manual'),
  source_notes text not null default '',
  period_start date not null,
  period_end date not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint content_metrics_period_check
    check (period_start <= period_end)
);

comment on table public.content_metrics is 'Metrik ternormalisasi per subject (Phase 7, Dok 10 §4): nilai dari record nyata / impor berlabel. Agregasi memakai snapshot terbaru per (subject, metrik, periode, sumber) — impor ulang menimpa nilai lama. Tulis HANYA lewat RPC import_analytics_snapshot.';
comment on column public.content_metrics.brand_id is 'Didenormalisasi dari subject saat impor (RPC) — tidak null — supaya RLS per-brand tetap berlaku walau subject sudah dihapus.';

-- --- campaign_metrics --------------------------------------------------------
-- Agregat dari content terkait + definisi + periode (Dok 10 §4). Dihitung
-- ulang oleh RPC impor setiap kali ada impor baru untuk campaign + periode
-- itu (delete + insert dalam transaksi yang sama). aggregation_rule
-- mencatat aturan yang dipakai — bukan angka tanpa asal.
create table if not exists public.campaign_metrics (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references public.analytics_snapshots (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  metric_key text not null
    constraint campaign_metrics_key_check
    check (metric_key in (
      'reach', 'impressions', 'views', 'video_views', 'engagements',
      'likes', 'comments', 'shares', 'saves', 'clicks',
      'followers_net_change', 'conversions', 'engagement_rate',
      'publishing_adherence'
    )),
  value numeric not null
    constraint campaign_metrics_value_check
    check (value >= 0),
  unit text not null,
  source text not null default 'manual'
    constraint campaign_metrics_source_check
    check (source = 'manual'),
  aggregation_rule text not null,
  period_start date not null,
  period_end date not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint campaign_metrics_period_check
    check (period_start <= period_end)
);

comment on table public.campaign_metrics is 'Agregat campaign (Phase 7, Dok 10 §4): dihitung ulang RPC impor dari content_metrics (snapshot terbaru per subject). engagement_rate campaign = sum(engagements)/sum(reach)x100. Tulis HANYA lewat RPC import_analytics_snapshot.';

-- --- integration_events ------------------------------------------------------
-- Kejadian integrasi, append-only (pola activity_logs 0004). actor =
-- pemanggil; tanpa token rahasia di detail.
create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  event_type text not null
    constraint integration_events_type_check
    check (event_type in (
      'adapter_disabled', 'capability_checked', 'snapshot_refreshed',
      'snapshot_expired', 'import_completed', 'import_failed',
      'connection_requested'
    )),
  platform text not null default 'manual',
  channel_id uuid references public.social_channels (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.integration_events is 'Kejadian integrasi, append-only (Phase 7, pola activity_logs 0004): adapter_disabled, capability_checked, snapshot_*, import_*, connection_requested. Tanpa token rahasia di detail.';

-- --- channel_credentials -----------------------------------------------------
-- Kredensial provider, SERVER-ONLY (ADR-0013 §2, R7.9): RLS aktif TANPA
-- policy apa pun + tanpa grant — tolak semua untuk authenticated. Hanya
-- service role yang bisa membaca/menulis. Kolom secret_reference adalah
-- REFERENSI ke secret manager, BUKAN secret. Tabel ini KOSONG di seluruh
-- fase — tidak ada token sebelum OAuth resmi berhasil.
create table if not exists public.channel_credentials (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.social_channels (id) on delete cascade,
  provider text not null
    constraint channel_credentials_provider_check
    check (provider in ('instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'x', 'threads', 'other')),
  secret_reference text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.channel_credentials is 'Kredensial provider, SERVER-ONLY (Phase 7, ADR-0013 §2): RLS aktif TANPA policy + tanpa grant — authenticated tidak bisa baca/tulis sama sekali. secret_reference = referensi secret manager, BUKAN secret. Kosong selama adapter DISABLED.';

-- --- Seed 14 definisi metrik (sumber manual) --------------------------------
-- Satu tempat kebenaran bersama features/analytics/metrics.ts — bila
-- keduanya berbeda, itu bug (diuji Vitest + pgTAP 07).
insert into public.metric_definitions
  (workspace_id, source_platform, metric_key, label, unit, formula, notes, compatibility_group, is_derived)
values
  (null, 'manual', 'reach', 'Reach', 'akun',
   'Jumlah akun unik yang dijangkau (angka dari sumber impor); tidak sama dengan impressions.',
   'Sumber: angka dari laporan platform yang diimpor. Bukan total pengikut.',
   'audiens', false),
  (null, 'manual', 'impressions', 'Impressions', 'tayangan',
   'Total tayangan yang ditampilkan (angka dari sumber impor); tidak sama dengan reach.',
   'Satu akun bisa menyumbang banyak impressions.',
   'audiens', false),
  (null, 'manual', 'views', 'Views', 'tayangan',
   'Jumlah tayangan menurut arti penyedia pada sumber impor; arti persis dicatat di notes impor.',
   'Arti "view" berbeda per penyedia — jangan bandingkan antar sumber tanpa notes.',
   'audiens', false),
  (null, 'manual', 'video_views', 'Video views', 'tayangan',
   'Tayangan video menurut ambang/definisi penyedia pada sumber impor; bila ambang tidak diketahui, kunci ini tidak ditampilkan.',
   'Wajib sebut ambang di source_notes bila nilai ini dipakai.',
   'audiens', false),
  (null, 'manual', 'engagements', 'Engagements', 'interaksi',
   'Jumlah interaksi yang didukung = likes + comments + shares + saves; hanya komponen yang tersedia yang dijumlahkan.',
   'Komponen yang tidak tersedia tidak dihitung (bukan dianggap 0).',
   'interaksi', false),
  (null, 'manual', 'likes', 'Likes', 'interaksi',
   'Jumlah likes (angka dari sumber impor).',
   '', 'interaksi', false),
  (null, 'manual', 'comments', 'Comments', 'interaksi',
   'Jumlah komentar (angka dari sumber impor).',
   '', 'interaksi', false),
  (null, 'manual', 'shares', 'Shares', 'interaksi',
   'Jumlah dibagikan (angka dari sumber impor).',
   '', 'interaksi', false),
  (null, 'manual', 'saves', 'Saves', 'interaksi',
   'Jumlah disimpan (angka dari sumber impor).',
   '', 'interaksi', false),
  (null, 'manual', 'clicks', 'Clicks', 'klik',
   'Jumlah klik (tautan/profil/CTA); jenis klik dicatat di notes impor; tanpa jenis klik, nilai tidak dibandingkan antar sumber.',
   'Sebut jenis klik di source_notes.',
   'interaksi', false),
  (null, 'manual', 'followers_net_change', 'Perubahan pengikut (neto)', 'akun',
   'Selisih pengikut selama periode (akhir - awal), bukan total pengikut.',
   'Bukan total pengikut — selalu selisih.',
   'audiens', false),
  (null, 'manual', 'conversions', 'Conversions', 'konversi',
   'Hanya bila ada sumber attribution/event; window/model attribution dicatat di notes impor. Tanpa sumber attribution, kunci ini tidak ditampilkan.',
   'Wajib sebut window/model attribution di source_notes bila nilai ini dipakai.',
   'hasil', false),
  (null, 'manual', 'engagement_rate', 'Engagement rate', 'persen',
   'engagements / reach x 100; hanya bila reach > 0 dan kedua komponen dari periode + sumber yang sama. DIHITUNG, bukan diimpor.',
   'Turunan — RPC impor menolak kunci ini.',
   'rasio', true),
  (null, 'manual', 'publishing_adherence', 'Kepatuhan jadwal terbit', 'persen',
   'published sesuai jadwal / planned eligible content x 100; toleransi ±15 menit dari scheduled_at; dihitung dari publishing_jobs + published_posts nyata. DIHITUNG, bukan diimpor.',
   'Turunan — RPC impor menolak kunci ini; dihitung di kode aplikasi.',
   'kepatuhan', true)
on conflict do nothing;

-- ============================================================================
-- (3) Indeks
-- ============================================================================
create unique index if not exists idx_metric_definitions_global_unique
  on public.metric_definitions (source_platform, metric_key) where workspace_id is null;
create unique index if not exists idx_metric_definitions_ws_unique
  on public.metric_definitions (workspace_id, source_platform, metric_key) where workspace_id is not null;
create index if not exists idx_analytics_snapshots_workspace
  on public.analytics_snapshots (workspace_id, retrieved_at desc);
create index if not exists idx_analytics_snapshots_brand
  on public.analytics_snapshots (brand_id, retrieved_at desc);
-- Duplikat DALAM satu impor ditolak (ASUMSI-7E); impor ulang slice yang sama
-- menimpa lewat agregasi snapshot-terbaru (bukan lewat indeks ini).
create unique index if not exists idx_content_metrics_snapshot_subject_key
  on public.content_metrics (snapshot_id, subject_type, subject_id, metric_key);
create index if not exists idx_content_metrics_workspace_subject
  on public.content_metrics (workspace_id, subject_type, subject_id, metric_key);
create index if not exists idx_content_metrics_period
  on public.content_metrics (workspace_id, period_start, period_end);
create unique index if not exists idx_campaign_metrics_slice
  on public.campaign_metrics (workspace_id, campaign_id, metric_key, period_start, period_end, source);
create index if not exists idx_integration_events_workspace
  on public.integration_events (workspace_id, created_at desc);
create unique index if not exists idx_channel_credentials_channel
  on public.channel_credentials (channel_id);

-- ============================================================================
-- (4) RLS — aktif + policy + helper
-- ============================================================================
alter table public.metric_definitions enable row level security;
alter table public.analytics_snapshots enable row level security;
alter table public.content_metrics enable row level security;
alter table public.campaign_metrics enable row level security;
alter table public.integration_events enable row level security;
alter table public.channel_credentials enable row level security;

-- Helper: apakah pemanggil punya scope TANPA batas (brand_scope NULL) di
-- workspace ini. Dipakai visibilitas snapshot/agregat multi-brand
-- (brand_id NULL): member scope-terbatas TIDAK BOLEH melihat metadata
-- impor multi-brand — fail-safe (pola 0019: yang tidak terlihat bukan
-- kebocoran, melainkan fail-safe baca).
create or replace function public.is_unlimited_scope(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.membership_status = 'active'
      and wm.brand_scope is null
  );
$$;

comment on function public.is_unlimited_scope(uuid) is 'Helper RLS (0021): apakah pemanggil member aktif workspace ini dengan brand_scope NULL (tanpa batas). SECURITY DEFINER — hanya boolean.';

-- Helper visibilitas snapshot: member (8 peran non-klien) DAN
-- (brand snapshot dalam scope) ATAU (snapshot multi-brand + pemanggil
-- tanpa batas scope). viewer_client TIDAK ADA di daftar peran.
create or replace function public.is_analytics_snapshot_visible(p_snapshot_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.analytics_snapshots s
    where s.id = p_snapshot_id
      and public.is_ws_member(s.workspace_id, p_roles)
      and (
        (s.brand_id is not null and public.brand_in_scope(s.brand_id))
        or (s.brand_id is null and public.is_unlimited_scope(s.workspace_id))
      )
  );
$$;

comment on function public.is_analytics_snapshot_visible(uuid, text[]) is 'Helper RLS (0021): apakah pemanggil boleh MELIHAT snapshot ini — member (8 peran non-klien) DAN brand dalam scope, atau snapshot multi-brand + pemanggil tanpa batas scope. SECURITY DEFINER — hanya boolean.';

-- Helper visibilitas metrik konten: member DAN brand subject (didenormalisasi
-- di content_metrics.brand_id saat impor) dalam scope pemanggil.
create or replace function public.is_content_metric_visible(p_metric_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.content_metrics cm
    where cm.id = p_metric_id
      and public.is_ws_member(cm.workspace_id, p_roles)
      and public.brand_in_scope(cm.brand_id)
  );
$$;

comment on function public.is_content_metric_visible(uuid, text[]) is 'Helper RLS (0021): apakah pemanggil boleh MELIHAT metrik konten ini — member (8 peran non-klien) DAN brand subject dalam scope. SECURITY DEFINER — hanya boolean.';

-- Helper visibilitas metrik campaign: member DAN (brand agregat dalam scope
-- ATAU agregat multi-brand + pemanggil tanpa batas scope).
create or replace function public.is_campaign_metric_visible(p_metric_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.campaign_metrics cm
    where cm.id = p_metric_id
      and public.is_ws_member(cm.workspace_id, p_roles)
      and (
        (cm.brand_id is not null and public.brand_in_scope(cm.brand_id))
        or (cm.brand_id is null and public.is_unlimited_scope(cm.workspace_id))
      )
  );
$$;

comment on function public.is_campaign_metric_visible(uuid, text[]) is 'Helper RLS (0021): apakah pemanggil boleh MELIHAT metrik campaign ini — member (8 peran non-klien) DAN brand dalam scope, atau agregat multi-brand + pemanggil tanpa batas scope. SECURITY DEFINER — hanya boolean.';

-- metric_definitions — baca: katalog global (workspace_id null) untuk semua
-- member ATAU baris workspace milik member. Tulis: TIDAK (seed migrasi).
create policy "metric_definitions_select_global_or_member"
  on public.metric_definitions for select
  to authenticated
  using (
    metric_definitions.workspace_id is null
    or public.is_ws_member(metric_definitions.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "metric_definitions_no_insert"
  on public.metric_definitions for insert to authenticated with check (false);

create policy "metric_definitions_no_update"
  on public.metric_definitions for update to authenticated using (false);

create policy "metric_definitions_no_delete"
  on public.metric_definitions for delete to authenticated using (false);

-- analytics_snapshots — baca: member + scope (helper). Tulis: TIDAK (RPC).
create policy "analytics_snapshots_select_member_or_scope"
  on public.analytics_snapshots for select
  to authenticated
  using (
    public.is_analytics_snapshot_visible(analytics_snapshots.id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "analytics_snapshots_no_insert"
  on public.analytics_snapshots for insert to authenticated with check (false);

create policy "analytics_snapshots_no_update"
  on public.analytics_snapshots for update to authenticated using (false);

create policy "analytics_snapshots_no_delete"
  on public.analytics_snapshots for delete to authenticated using (false);

-- content_metrics — baca: member + brand subject dalam scope. Tulis: TIDAK (RPC).
create policy "content_metrics_select_member_or_scope"
  on public.content_metrics for select
  to authenticated
  using (
    public.is_content_metric_visible(content_metrics.id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "content_metrics_no_insert"
  on public.content_metrics for insert to authenticated with check (false);

create policy "content_metrics_no_update"
  on public.content_metrics for update to authenticated using (false);

create policy "content_metrics_no_delete"
  on public.content_metrics for delete to authenticated using (false);

-- campaign_metrics — baca: member + scope (helper). Tulis: TIDAK (RPC).
create policy "campaign_metrics_select_member_or_scope"
  on public.campaign_metrics for select
  to authenticated
  using (
    public.is_campaign_metric_visible(campaign_metrics.id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "campaign_metrics_no_insert"
  on public.campaign_metrics for insert to authenticated with check (false);

create policy "campaign_metrics_no_update"
  on public.campaign_metrics for update to authenticated using (false);

create policy "campaign_metrics_no_delete"
  on public.campaign_metrics for delete to authenticated using (false);

-- integration_events — baca: member workspace (8 peran non-klien, tanpa
-- brand scope — event adalah log operasional workspace). Tulis: INSERT
-- hanya bila actor = pemanggil DAN member (pola activity_logs 0004).
-- Tanpa update/delete.
create policy "integration_events_select_member"
  on public.integration_events for select
  to authenticated
  using (
    public.is_ws_member(integration_events.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "integration_events_insert_member_as_actor"
  on public.integration_events for insert
  to authenticated
  with check (
    actor_user_id = auth.uid()
    and public.is_ws_member(integration_events.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "integration_events_no_update"
  on public.integration_events for update to authenticated using (false);

create policy "integration_events_no_delete"
  on public.integration_events for delete to authenticated using (false);

-- channel_credentials — SENGAJA TANPA POLICY: RLS aktif tanpa policy =
-- tolak semua untuk authenticated (server-only). Jangan tambah policy
-- tanpa ADR baru.

-- --- Grant -------------------------------------------------------------------
revoke all on public.metric_definitions from anon, authenticated;
grant select on public.metric_definitions to authenticated;
revoke all on public.analytics_snapshots from anon, authenticated;
grant select on public.analytics_snapshots to authenticated;
revoke all on public.content_metrics from anon, authenticated;
grant select on public.content_metrics to authenticated;
revoke all on public.campaign_metrics from anon, authenticated;
grant select on public.campaign_metrics to authenticated;
revoke all on public.integration_events from anon, authenticated;
grant select, insert on public.integration_events to authenticated;
revoke all on public.channel_credentials from anon, authenticated;
-- channel_credentials: TANPA grant apa pun (server-only).

revoke all on function public.is_unlimited_scope(uuid) from public;
grant execute on function public.is_unlimited_scope(uuid) to authenticated;
revoke all on function public.is_analytics_snapshot_visible(uuid, text[]) from public;
grant execute on function public.is_analytics_snapshot_visible(uuid, text[]) to authenticated;
revoke all on function public.is_content_metric_visible(uuid, text[]) from public;
grant execute on function public.is_content_metric_visible(uuid, text[]) to authenticated;
revoke all on function public.is_campaign_metric_visible(uuid, text[]) from public;
grant execute on function public.is_campaign_metric_visible(uuid, text[]) to authenticated;

-- ============================================================================
-- (5) Fungsi utilitas — backoff + TTL snapshot (ASUMSI-7D)
-- ============================================================================
create or replace function public.integration_backoff_seconds(p_attempt_number integer)
returns integer
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when p_attempt_number <= 1 then 60
    when p_attempt_number = 2 then 300
    else 900
  end;
$$;

comment on function public.integration_backoff_seconds(integer) is 'Backoff retry integrasi (ASUMSI-7D): percobaan ke-1 → 60 detik, ke-2 → 300 detik, ke-3+ → 900 detik. Satu tempat konfigurasi — ganti di sini bila Tuan menetapkan angka lain. Di fase ini hanya konstanta (tidak ada worker/cron).';

revoke all on function public.integration_backoff_seconds(integer) from public;
grant execute on function public.integration_backoff_seconds(integer) to authenticated;

-- SECURITY INVOKER (bukan definer) — RLS berlaku: pemanggil yang tidak
-- boleh melihat snapshot mendapat false (tidak bocor).
create or replace function public.analytics_snapshot_is_stale(p_snapshot_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.analytics_snapshots
    where id = p_snapshot_id and retrieved_at < now() - interval '24 hours'
  );
$$;

comment on function public.analytics_snapshot_is_stale(uuid) is 'TTL snapshot 24 jam (ASUMSI-7D): true bila retrieved_at lebih dari 24 jam lalu. SECURITY INVOKER — RLS berlaku, snapshot yang tidak terlihat pemanggil mengembalikan false.';

revoke all on function public.analytics_snapshot_is_stale(uuid) from public;
grant execute on function public.analytics_snapshot_is_stale(uuid) to authenticated;

-- ============================================================================
-- (6) RPC impor — import_analytics_snapshot (transaksional, TIDAK melempar)
-- ============================================================================
-- Satu transaksi: snapshot + content_metrics + agregat campaign_metrics +
-- event import_completed. ATOMIK: semua baris divalidasi dulu (loop 1);
-- bila satu baris tidak valid, TIDAK ADA yang ditulis dan RPC
-- mengembalikan {ok:false, code, message} (bukan exception).
-- Kode: FORBIDDEN / INVALID_PERIOD / INVALID_REFERENCE / EMPTY_METRICS /
-- INVALID_ROW / INVALID_SUBJECT / INVALID_METRIC / INVALID_UNIT /
-- DUPLICATE_METRIC.
create or replace function public.import_analytics_snapshot(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_period_start date,
  p_period_end date,
  p_raw_reference text,
  p_metrics jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot_id uuid;
  v_row jsonb;
  v_row_no int := 0;
  v_subject_type text;
  v_subject_id_text text;
  v_subject_id uuid;
  v_subject_brand uuid;
  v_subject_workspace uuid;
  v_subject_campaign uuid;
  v_metric_key text;
  v_value_text text;
  v_value numeric;
  v_unit text;
  v_unit_expected text;
  v_is_derived boolean;
  v_notes text;
  v_seen text[] := '{}';
  v_dup_key text;
  v_clean jsonb := '[]'::jsonb;
  v_inserted int := 0;
  v_campaign_id uuid;
  v_campaign_brand uuid;
  v_eng_sum numeric;
  v_reach_sum numeric;
  v_campaigns int := 0;
begin
  -- (0) Auth + peran impor (owner/admin/manager/strategist/analyst) + scope.
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Belum masuk.');
  end if;
  if not public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist', 'analyst']) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Bukan member workspace ini atau peran tidak boleh mengimpor.');
  end if;
  if p_brand_id is not null and not public.brand_in_scope(p_brand_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Brand di luar scope Anda.');
  end if;
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PERIOD', 'message', 'Periode tidak valid: period_start harus <= period_end.');
  end if;
  if p_raw_reference is null or btrim(p_raw_reference) = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE', 'message', 'Referensi file wajib diisi.');
  end if;
  if p_metrics is null or jsonb_typeof(p_metrics) <> 'array' or jsonb_array_length(p_metrics) = 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY_METRICS', 'message', 'Tidak ada baris metrik.');
  end if;

  -- (1) Validasi SEMUA baris dulu (tanpa tulis apa pun) — impor atomik.
  for v_row in select * from jsonb_array_elements(p_metrics) loop
    v_row_no := v_row_no + 1;
    v_subject_type := v_row ->> 'subject_type';
    v_subject_id_text := v_row ->> 'subject_id';
    v_metric_key := v_row ->> 'metric_key';
    v_value_text := v_row ->> 'value';
    v_unit := nullif(btrim(coalesce(v_row ->> 'unit', '')), '');
    v_notes := coalesce(v_row ->> 'source_notes', '');

    if v_subject_type is null or v_subject_type not in ('placement', 'content_item', 'published_post') then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ROW', 'message', format('Baris %s: subject_type harus placement/content_item/published_post.', v_row_no));
    end if;
    if v_subject_id_text is null or v_subject_id_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ROW', 'message', format('Baris %s: subject_id bukan UUID yang valid.', v_row_no));
    end if;
    v_subject_id := v_subject_id_text::uuid;

    -- Subject harus ada di workspace ini + brand dalam scope (atau = p_brand_id).
    v_subject_brand := null; v_subject_workspace := null; v_subject_campaign := null;
    if v_subject_type = 'placement' then
      select ci.workspace_id, ci.brand_id, ci.campaign_id into v_subject_workspace, v_subject_brand, v_subject_campaign
      from public.content_placements pl join public.content_items ci on ci.id = pl.content_item_id
      where pl.id = v_subject_id;
    elsif v_subject_type = 'content_item' then
      select workspace_id, brand_id, campaign_id into v_subject_workspace, v_subject_brand, v_subject_campaign
      from public.content_items where id = v_subject_id;
    else
      select ci.workspace_id, ci.brand_id, ci.campaign_id into v_subject_workspace, v_subject_brand, v_subject_campaign
      from public.published_posts pp
      join public.content_placements pl on pl.id = pp.placement_id
      join public.content_items ci on ci.id = pl.content_item_id
      where pp.id = v_subject_id;
    end if;
    if v_subject_workspace is null then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SUBJECT', 'message', format('Baris %s: subject tidak ditemukan.', v_row_no));
    end if;
    if v_subject_workspace <> p_workspace_id then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SUBJECT', 'message', format('Baris %s: subject bukan milik workspace ini.', v_row_no));
    end if;
    if p_brand_id is not null and v_subject_brand <> p_brand_id then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', format('Baris %s: subject bukan brand impor ini.', v_row_no));
    end if;
    if p_brand_id is null and not public.brand_in_scope(v_subject_brand) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', format('Baris %s: brand subject di luar scope Anda.', v_row_no));
    end if;

    -- Kunci metrik: harus ada di katalog + bukan turunan.
    if v_metric_key is null then
      return jsonb_build_object('ok', false, 'code', 'INVALID_METRIC', 'message', format('Baris %s: metric_key wajib diisi.', v_row_no));
    end if;
    select unit, is_derived into v_unit_expected, v_is_derived
    from public.metric_definitions
    where workspace_id is null and source_platform = 'manual' and metric_key = v_metric_key;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'INVALID_METRIC', 'message', format('Baris %s: metric_key ''%s'' tidak dikenal.', v_row_no, v_metric_key));
    end if;
    if v_is_derived then
      return jsonb_build_object('ok', false, 'code', 'INVALID_METRIC', 'message', format('Baris %s: metric_key ''%s'' adalah metrik turunan (dihitung, bukan diimpor).', v_row_no, v_metric_key));
    end if;
    if v_unit is null or v_unit <> v_unit_expected then
      return jsonb_build_object('ok', false, 'code', 'INVALID_UNIT', 'message', format('Baris %s: unit harus ''%s'' untuk kunci ''%s''.', v_row_no, v_unit_expected, v_metric_key));
    end if;

    -- Nilai: angka >= 0.
    if v_value_text is null or v_value_text !~ '^[0-9]+(\.[0-9]+)?$' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ROW', 'message', format('Baris %s: value harus angka >= 0.', v_row_no));
    end if;
    v_value := v_value_text::numeric;

    -- Duplikat dalam file yang sama.
    v_dup_key := v_subject_type || '|' || v_subject_id_text || '|' || v_metric_key;
    if v_dup_key = any (v_seen) then
      return jsonb_build_object('ok', false, 'code', 'DUPLICATE_METRIC', 'message', format('Baris %s: duplikat (subject + metric_key) dalam file yang sama.', v_row_no));
    end if;
    v_seen := v_seen || v_dup_key;

    v_clean := v_clean || jsonb_build_object(
      'subject_type', v_subject_type, 'subject_id', v_subject_id_text,
      'brand_id', v_subject_brand::text, 'campaign_id', v_subject_campaign::text,
      'metric_key', v_metric_key, 'value', v_value_text, 'unit', v_unit, 'source_notes', v_notes
    );
  end loop;

  -- (2) Tulis: snapshot + metrik (satu transaksi).
  -- retrieved_at memakai clock_timestamp() (bukan now()): waktu ambil yang
  -- sebenarnya — penting karena DISTINCT ON agregat campaign mengurutkan
  -- snapshot terbaru; now() = awal transaksi sehingga dua impor dalam satu
  -- transaksi (mis. pgTAP begin...rollback) mendapat retrieved_at yang sama.
  insert into public.analytics_snapshots
    (workspace_id, brand_id, source, period_start, period_end, retrieved_at, raw_payload_reference, imported_by, created_by)
  values
    (p_workspace_id, p_brand_id, 'manual', p_period_start, p_period_end, clock_timestamp(), btrim(p_raw_reference), auth.uid(), auth.uid())
  returning id into v_snapshot_id;

  for v_row in select * from jsonb_array_elements(v_clean) loop
    insert into public.content_metrics
      (snapshot_id, workspace_id, brand_id, subject_type, subject_id, metric_key, value, unit, source, source_notes, period_start, period_end, created_by)
    values
      (v_snapshot_id, p_workspace_id, (v_row ->> 'brand_id')::uuid, v_row ->> 'subject_type', (v_row ->> 'subject_id')::uuid,
       v_row ->> 'metric_key', (v_row ->> 'value')::numeric, v_row ->> 'unit', 'manual', v_row ->> 'source_notes',
       p_period_start, p_period_end, auth.uid());
    v_inserted := v_inserted + 1;
  end loop;

  -- (3) Agregat campaign: untuk tiap campaign dari subject impor, hitung
  -- ulang dari content_metrics (snapshot terbaru per subject + metrik).
  for v_campaign_id in
    select distinct (c ->> 'campaign_id')::uuid
    from jsonb_array_elements(v_clean) c
    where c ->> 'campaign_id' is not null
  loop
    -- Brand agregat: satu brand bila campaign hanya punya satu brand.
    select case when count(*) = 1 then max(brand_id) end into v_campaign_brand
    from public.campaign_brands where campaign_id = v_campaign_id;

    delete from public.campaign_metrics
    where campaign_id = v_campaign_id
      and period_start = p_period_start and period_end = p_period_end and source = 'manual';

    insert into public.campaign_metrics
      (snapshot_id, workspace_id, brand_id, campaign_id, metric_key, value, unit, source, aggregation_rule, period_start, period_end, created_by)
    select
      v_snapshot_id, p_workspace_id, v_campaign_brand, v_campaign_id,
      latest.metric_key, sum(latest.value), md.unit, 'manual',
      'sum(content_metrics, snapshot terbaru per subject, periode ' || p_period_start::text || ' s.d. ' || p_period_end::text || ', sumber manual)',
      p_period_start, p_period_end, auth.uid()
    from (
      select distinct on (cm.subject_type, cm.subject_id, cm.metric_key) cm.*
      from public.content_metrics cm
      join public.analytics_snapshots s on s.id = cm.snapshot_id
      where cm.workspace_id = p_workspace_id
        and cm.source = 'manual'
        and cm.period_start = p_period_start and cm.period_end = p_period_end
        and cm.metric_key in (
          select md2.metric_key from public.metric_definitions md2
          where md2.workspace_id is null and md2.source_platform = 'manual' and md2.is_derived = false
        )
        and exists (
          select 1 from public.content_items ci2
          where ci2.campaign_id = v_campaign_id
            and (
              (cm.subject_type = 'content_item' and ci2.id = cm.subject_id)
              or (cm.subject_type = 'placement' and exists (select 1 from public.content_placements pl2 where pl2.id = cm.subject_id and pl2.content_item_id = ci2.id))
              or (cm.subject_type = 'published_post' and exists (select 1 from public.published_posts pp2 join public.content_placements pl3 on pl3.id = pp2.placement_id where pp2.id = cm.subject_id and pl3.content_item_id = ci2.id))
            )
        )
      order by cm.subject_type, cm.subject_id, cm.metric_key, s.retrieved_at desc, s.created_at desc
    ) latest
    join public.metric_definitions md
      on md.workspace_id is null and md.source_platform = 'manual' and md.metric_key = latest.metric_key
    group by latest.metric_key, md.unit;

    -- engagement_rate campaign = sum(engagements)/sum(reach) x 100.
    select sum(value) filter (where metric_key = 'engagements'),
           sum(value) filter (where metric_key = 'reach')
      into v_eng_sum, v_reach_sum
    from public.campaign_metrics
    where campaign_id = v_campaign_id
      and period_start = p_period_start and period_end = p_period_end and source = 'manual';
    if v_reach_sum is not null and v_reach_sum > 0 and v_eng_sum is not null then
      insert into public.campaign_metrics
        (snapshot_id, workspace_id, brand_id, campaign_id, metric_key, value, unit, source, aggregation_rule, period_start, period_end, created_by)
      values
        (v_snapshot_id, p_workspace_id, v_campaign_brand, v_campaign_id, 'engagement_rate',
         round(v_eng_sum / v_reach_sum * 100, 4), 'persen', 'manual',
         'sum(engagements)/sum(reach) x 100 (snapshot terbaru per subject)',
         p_period_start, p_period_end, auth.uid());
    end if;
    v_campaigns := v_campaigns + 1;
  end loop;

  insert into public.integration_events (workspace_id, event_type, platform, actor_user_id, detail)
  values (p_workspace_id, 'import_completed', 'manual', auth.uid(),
    jsonb_build_object('snapshot_id', v_snapshot_id, 'inserted', v_inserted, 'campaigns', v_campaigns,
      'period_start', p_period_start, 'period_end', p_period_end, 'raw_reference', btrim(p_raw_reference)));

  return jsonb_build_object('ok', true, 'snapshot_id', v_snapshot_id, 'inserted', v_inserted, 'campaigns', v_campaigns);
end;
$$;

comment on function public.import_analytics_snapshot(uuid, uuid, date, date, text, jsonb) is 'Impor analytics CSV/manual (Phase 7, ADR-0013 §5): atomik — validasi semua baris dulu, baru tulis snapshot + metrik + agregat campaign + event. Mengembalikan jsonb {ok, code, message, snapshot_id, inserted, campaigns}; TIDAK melempar.';

revoke all on function public.import_analytics_snapshot(uuid, uuid, date, date, text, jsonb) from public;
grant execute on function public.import_analytics_snapshot(uuid, uuid, date, date, text, jsonb) to authenticated;
