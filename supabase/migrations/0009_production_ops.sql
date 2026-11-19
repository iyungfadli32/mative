-- MaTive Phase 3 — Migrasi 0009: Production Operations (P3-01 + P3-02)
-- ============================================================================
-- SUMBER: Dok 05 §3 (kolom) + §6 (constraint) + §7 (index) + §8 (retensi);
--   Dok 06 §2/§3 (matriks RBAC) + §5 (RLS); Dok 02 §3 (Asset Library,
--   Content Workspace); Rencana-MaTive-Lengkap-v2 (Keputusan #8, #9, #12)
--   + rencana detail Phase 3 (P3-A1 s.d. P3-A6); ADR-0009 (semua
--   keputusan/interpretasi fase ini).
--
-- 9 TABEL FASE INI (dan TIDAK ADA tabel lain): brief_templates, tasks,
--   task_checklist_items, assets, asset_versions, content_assets, comments,
--   mentions, notifications.
--   TIDAK dibuat di sini: approval_*, publishing_*, analytics, AI (fase 4+).
--   JUGA di sini: FK brands.logo_asset_id -> assets(id) (janji 0007) +
--   bucket Storage privat 'mative-assets' + policy storage.objects.
--
-- ATURAN KERAS (pelajaran Phase 1, 0006):
--   (a) TIDAK ADA policy yang merujuk tabelnya sendiri atau membentuk siklus:
--       semua pengecekan keanggotaan lewat helper 0006/0007 + 4 helper baru
--       di bawah (STABLE, SECURITY DEFINER, search_path terkunci, grant
--       hanya ke authenticated, hanya boolean). Policy TIDAK berisi
--       FROM/JOIN ke tabel lain — graf dependensi asiklik (terverifikasi
--       statis; lihat docs/phase-3-report.md).
--   (b) TIDAK ADA forward-reference antar file: policy hanya merujuk tabel
--       yang dibuat di migrasi ini atau lebih awal. Dependensi baru:
--       is_resource_shared_with_me (0007) dipakai ulang; helper baru 0009
--       hanya membaca tabel 0001–0009 yang sudah ada saat dipanggil.
--   (c) Semua tabel: UUID PK, created_at/updated_at UTC (timestamptz),
--       FK + constraint di DB, JSONB hanya metadata dengan bentuk yang
--       didokumentasikan di ADR-0009 §5/§6. Pengecualian: tabel append-only
--       (asset_versions, mentions) hanya created_at — mengikuti preseden
--       activity_logs (0004) dan content_versions (0007).
--   (d) updated_at TIDAK di-trigger otomatis (pola 0007/0008): server
--       action / RPC yang mengubah baris wajib mengeset updated_at = now().
--
-- KOREKSI / JANJI YANG DITEPATI DI SINI:
--   - brands.logo_asset_id kini ber-FK ke assets(id) ON DELETE SET NULL
--     (0007: "FK ditambahkan migrasi Phase 3").
--   - Komentar klien: gerbang ganda (share eksplisit + setting workspace
--     allow_client_comments, default TIDAK BOLEH) — v2 Keputusan #12.
--
-- CATATAN: database live TIDAK disentuh dari VM (lihat
--   docs/phase-3-report.md §7). Terapkan lewat docs/apply-migrations.md.
-- ============================================================================

-- ============================================================================
-- BAGIAN 1 — Tabel (urutan dependensi FK; tanpa forward-reference)
-- ============================================================================

-- --- brief_templates --------------------------------------------------------
-- Dok 05 §3: workspace_id, name, schema_json, is_default.
-- schema_json: { "fields": [{ "key", "label", "type": "text"|"list",
--   "required": bool }] } — lihat ADR-0009 §6. Satu default per workspace
-- (partial unique index di BAGIAN 2); default tidak bisa dihapus (trigger
-- BAGIAN 3); ganti default lewat RPC set_default_brief_template (0010).
create table if not exists public.brief_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null constraint brief_templates_name_check check (btrim(name) <> ''),
  schema_json jsonb not null default '{"fields": []}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.brief_templates is 'Template brief per workspace (P3-05). schema_json: daftar field {key,label,type,required} — lihat ADR-0009 §6. Satu is_default per workspace (partial unique index); default tidak bisa dihapus.';
comment on column public.brief_templates.schema_json is 'Skema field template: {"fields": [{"key","label","type":"text"|"list","required":bool}]}. Editor brief merender field ini; nilai tersimpan sebagai brief_snapshot di content_versions.';

-- --- tasks ------------------------------------------------------------------
-- Dok 05 §3: workspace_id, parent_type, parent_id, title, description,
-- assignee_user_id, created_by, due_at, priority, status, estimate_minutes.
-- parent_type dikunci P3-A1 (content_item, campaign); status + priority
-- dikunci P3-A2. "Limited" (P1-A6): INSERT hanya assignee = diri / kosong;
-- UPDATE/DELETE hanya task yang ditugaskan (lihat policy BAGIAN 5).
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_type text not null
    constraint tasks_parent_type_check check (parent_type in ('content_item', 'campaign')),
  parent_id uuid not null,
  title text not null constraint tasks_title_check check (btrim(title) <> ''),
  description text,
  assignee_user_id uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  due_at timestamptz,
  priority text not null default 'medium'
    constraint tasks_priority_check check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'todo'
    constraint tasks_status_check
    check (status in ('todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')),
  estimate_minutes integer constraint tasks_estimate_check check (estimate_minutes is null or estimate_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tasks is 'Task Center (P3-06). parent polimorfik dikunci P3-A1 (content_item, campaign) + trigger scope BAGIAN 3. Status mengikuti mesin ADR-0009 §2; transisi menulis activity_logs (RPC 0010). TIDAK ada hard-delete (arsip lewat status cancelled).';
comment on column public.tasks.assignee_user_id is 'Penanggung jawab. Peran limited hanya boleh membuat task untuk dirinya sendiri / kosong (RLS).';

-- --- task_checklist_items ---------------------------------------------------
-- Dok 05 §3: task_id, title, sort_order, is_done, completed_by, completed_at.
create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text not null constraint task_checklist_items_title_check check (btrim(title) <> ''),
  sort_order integer not null default 0,
  is_done boolean not null default false,
  completed_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.task_checklist_items is 'Checklist per task (P3-06). Menandai selesai mengisi completed_by/completed_at; membuka lagi mengosongkannya.';

-- --- assets -----------------------------------------------------------------
-- Dok 05 §3: workspace_id, storage_bucket, object_key, original_filename,
-- mime_type, byte_size, width, height, duration_ms, checksum, rights_notes,
-- license_expiry_at, uploaded_by, processing_status.
-- Batas P3-A3: maks 10 MB (CHECK), allowlist MIME (CHECK di sini + magic
-- bytes di server — CHECK ini hanya penjaga terakhir), signed URL 1 jam.
-- width/height hanya PNG/JPEG; duration_ms null di fase ini (ADR-0009 §4).
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  storage_bucket text not null default 'mative-assets',
  object_key text not null,
  original_filename text not null constraint assets_filename_check check (btrim(original_filename) <> ''),
  mime_type text not null
    constraint assets_mime_type_check
    check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'application/pdf')),
  byte_size bigint not null
    constraint assets_byte_size_check check (byte_size > 0 and byte_size <= 10485760),
  width integer constraint assets_width_check check (width is null or width > 0),
  height integer constraint assets_height_check check (height is null or height > 0),
  duration_ms integer constraint assets_duration_check check (duration_ms is null or duration_ms >= 0),
  checksum text,
  rights_notes text,
  license_expiry_at timestamptz,
  uploaded_by uuid references auth.users (id) on delete set null,
  processing_status text not null default 'uploading'
    constraint assets_processing_status_check check (processing_status in ('uploading', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, object_key)
);

comment on table public.assets is 'Pustaka aset privat (P3-07). Bucket mative-assets (privat); akses hanya signed URL 1 jam. Maks 10 MB; MIME dari isi file (server) + CHECK ini. Tanpa pemindaian virus di MVP (known limitation).';
comment on column public.assets.object_key is 'Path di bucket: <workspace_id>/<asset_id>/<nama-file-disarankan>. Folder pertama = workspace_id agar policy storage bisa memeriksa keanggotaan.';
comment on column public.assets.duration_ms is 'Durasi video (ms). NULL di fase ini — tidak ada parser durasi; jangan ditebak.';
comment on column public.assets.checksum is 'SHA-256 isi file (hex).';

-- --- asset_versions ---------------------------------------------------------
-- Dok 05 §3: asset_id, version_number, storage_object_key, uploaded_by,
-- created_at. Append-only (tanpa updated_at).
create table if not exists public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  version_number integer not null constraint asset_versions_number_check check (version_number > 0),
  storage_object_key text not null,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (asset_id, version_number)
);

comment on table public.asset_versions is 'Riwayat versi file aset (P3-07). v1 dibuat saat upload berhasil. Append-only.';

-- --- content_assets ---------------------------------------------------------
-- Dok 05 §3: content_item_id, asset_id, usage_role, sort_order.
-- Satu aset bisa dilampirkan ke banyak content item; satu pasang
-- (item, aset) hanya satu baris (usage_role tunggal per pasang).
create table if not exists public.content_assets (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  usage_role text not null default 'attachment'
    constraint content_assets_usage_role_check
    check (usage_role in ('primary', 'reference', 'thumbnail', 'attachment')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, asset_id)
);

comment on table public.content_assets is 'Lampiran aset → content item (P3-08). Menghapus lampiran TIDAK menghapus file aset. usage_role dikunci ADR-0009 §1.';

-- --- comments ---------------------------------------------------------------
-- Dok 05 §3: workspace_id, target_type, target_id, parent_comment_id
-- nullable, body, author_user_id, edited_at.
-- Ditambah (rencana P3-09): deleted_at + deleted_by untuk soft-delete.
-- target_type dikunci P3-A1 (content_item, campaign, task).
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  target_type text not null
    constraint comments_target_type_check check (target_type in ('content_item', 'campaign', 'task')),
  target_id uuid not null,
  parent_comment_id uuid references public.comments (id) on delete cascade,
  body text not null constraint comments_body_check check (btrim(body) <> ''),
  author_user_id uuid references auth.users (id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.comments is 'Thread komentar (P3-09). parent_comment_id = balasan (harus satu target dengan induknya — trigger BAGIAN 3). Edit mengisi edited_at; hapus = soft-delete (deleted_at/deleted_by), isi tampil sebagai "Komentar ini dihapus".';
comment on column public.comments.deleted_at is 'Soft-delete. Baris TIDAK pernah dihapus fisik (P3-A4).';

-- --- mentions ---------------------------------------------------------------
-- Dok 05 §3: comment_id, mentioned_user_id, notification_id.
-- notification_id nullable: notifikasi dibuat RPC yang sama (0010) dan
-- id-nya ditulis kembali ke baris mention ini.
create table if not exists public.mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete cascade,
  mentioned_user_id uuid not null references auth.users (id) on delete cascade,
  notification_id uuid references public.notifications (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (comment_id, mentioned_user_id)
);

comment on table public.mentions is 'Mention eksplisit per komentar (P3-09, ADR-0009 §5). Dipilih lewat pemilih anggota — BUKAN parsing teks. Satu mention = satu anggota per komentar.';

-- --- notifications ----------------------------------------------------------
-- Dok 05 §3: workspace_id, recipient_user_id, type, title, body,
-- target_type, target_id, read_at.
-- Dasar saja (P3-A6): mention, task_assigned, task_status_change,
-- comment_reply. TIDAK ADA email/SMS. Hanya dibuat lewat RPC (0010);
-- TIDAK ADA policy INSERT/UPDATE/DELETE untuk authenticated (BAGIAN 5).
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  type text not null
    constraint notifications_type_check
    check (type in ('mention', 'task_assigned', 'task_status_change', 'comment_reply')),
  title text not null constraint notifications_title_check check (btrim(title) <> ''),
  body text,
  target_type text not null
    constraint notifications_target_type_check
    check (target_type in ('content_item', 'campaign', 'task', 'comment')),
  target_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notifications is 'Notifikasi dasar dalam aplikasi (P3-A6). Hanya dibuat RPC SECURITY DEFINER (0010); pengguna hanya membaca miliknya + menandai read_at. Tidak ada email/SMS di fase ini.';

-- --- FK yang dijanjikan 0007 ------------------------------------------------
-- brands.logo_asset_id -> assets(id). Ditambahkan SEKARANG karena tabel
-- assets sudah ada — bukan forward-reference antar file.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brands_logo_asset_id_fkey'
  ) then
    alter table public.brands
      add constraint brands_logo_asset_id_fkey
      foreign key (logo_asset_id) references public.assets (id) on delete set null;
  end if;
end $$;

comment on column public.brands.logo_asset_id is 'ID aset logo (tabel assets, Phase 3). FK ditambahkan migrasi 0009 (janji 0007 ditepati). ON DELETE SET NULL.';

-- ============================================================================
-- BAGIAN 2 — Index (Dok 05 §7: lookup RLS + pola query fase ini)
-- ============================================================================

-- Satu template default per workspace (partial unique index).
create unique index if not exists idx_brief_templates_one_default
  on public.brief_templates (workspace_id) where is_default;
create index if not exists idx_brief_templates_ws on public.brief_templates (workspace_id);

-- Task: daftar per assignee/due date (My Tasks) + per parent.
create index if not exists idx_tasks_ws on public.tasks (workspace_id);
create index if not exists idx_tasks_assignee on public.tasks (assignee_user_id, status);
create index if not exists idx_tasks_due on public.tasks (workspace_id, due_at) where status not in ('done', 'cancelled');
create index if not exists idx_tasks_parent on public.tasks (parent_type, parent_id);
create index if not exists idx_tasks_created_by on public.tasks (created_by);
create index if not exists idx_tasks_status on public.tasks (workspace_id, status);

create index if not exists idx_task_checklist_task on public.task_checklist_items (task_id, sort_order);

-- Aset: daftar per workspace + lookup uploader + lampiran.
create index if not exists idx_assets_ws on public.assets (workspace_id, created_at desc);
create index if not exists idx_assets_uploader on public.assets (uploaded_by);
create index if not exists idx_assets_mime on public.assets (workspace_id, mime_type);
create index if not exists idx_asset_versions_asset on public.asset_versions (asset_id, version_number);
create index if not exists idx_content_assets_item on public.content_assets (content_item_id, sort_order);
create index if not exists idx_content_assets_asset on public.content_assets (asset_id);

-- Komentar: thread per target + balasan.
create index if not exists idx_comments_target on public.comments (target_type, target_id, created_at);
create index if not exists idx_comments_ws on public.comments (workspace_id, created_at desc);
create index if not exists idx_comments_parent on public.comments (parent_comment_id) where parent_comment_id is not null;
create index if not exists idx_comments_author on public.comments (author_user_id);

create index if not exists idx_mentions_comment on public.mentions (comment_id);
create index if not exists idx_mentions_user on public.mentions (mentioned_user_id);

-- Notifikasi: kotak masuk per penerima (belum dibaca dulu).
create index if not exists idx_notifications_recipient on public.notifications (recipient_user_id, read_at, created_at desc);
create index if not exists idx_notifications_ws on public.notifications (workspace_id);

-- ============================================================================
-- BAGIAN 3 — Trigger validasi scope lintas-tabel (Dok 05 §6)
-- CHECK tidak bisa memeriksa tabel lain, jadi aturan "workspace yang cocok"
-- ditegakkan di sini. Fungsi SECURITY DEFINER (pola 0007): membaca kolom
-- scope APA ADANYA (bypass RLS) agar pemeriksaan tidak tertipu hasil RLS
-- yang terfilter, dan gagal TERTUTUP (P0001) bila tidak cocok. Fungsi HANYA
-- membaca scope + melempar exception; tidak menulis, tidak mengembalikan data.
-- ============================================================================

-- Task: parent (content_item/campaign) harus satu workspace dengan task;
-- assignee (bila diisi) harus member AKTIF workspace itu.
create or replace function public.validate_task_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
begin
  if new.parent_type = 'content_item' then
    select workspace_id into v_ws from public.content_items where id = new.parent_id;
  elsif new.parent_type = 'campaign' then
    select workspace_id into v_ws from public.campaigns where id = new.parent_id;
  end if;
  if v_ws is null or v_ws <> new.workspace_id then
    raise exception 'scope mismatch: tasks.parent_id belongs to a different workspace or does not exist';
  end if;
  if new.assignee_user_id is not null and not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.assignee_user_id
      and wm.membership_status = 'active'
  ) then
    raise exception 'scope mismatch: tasks.assignee_user_id is not an active member of this workspace';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_task_scope on public.tasks;
create trigger trg_validate_task_scope
  before insert or update on public.tasks
  for each row execute function public.validate_task_scope();

-- Komentar: target (content_item/campaign/task) harus satu workspace dengan
-- komentar; balasan (parent_comment_id) harus satu target dengan induknya.
create or replace function public.validate_comment_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
  v_parent record;
begin
  if new.target_type = 'content_item' then
    select workspace_id into v_ws from public.content_items where id = new.target_id;
  elsif new.target_type = 'campaign' then
    select workspace_id into v_ws from public.campaigns where id = new.target_id;
  elsif new.target_type = 'task' then
    select workspace_id into v_ws from public.tasks where id = new.target_id;
  end if;
  if v_ws is null or v_ws <> new.workspace_id then
    raise exception 'scope mismatch: comments.target_id belongs to a different workspace or does not exist';
  end if;
  if new.parent_comment_id is not null then
    select target_type, target_id, workspace_id into v_parent
      from public.comments where id = new.parent_comment_id;
    if v_parent.target_type is null
      or v_parent.target_type <> new.target_type
      or v_parent.target_id <> new.target_id
      or v_parent.workspace_id <> new.workspace_id then
      raise exception 'scope mismatch: comments.parent_comment_id must reply to a comment on the same target';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_comment_scope on public.comments;
create trigger trg_validate_comment_scope
  before insert or update on public.comments
  for each row execute function public.validate_comment_scope();

-- Lampiran aset: aset dan content item harus satu workspace.
create or replace function public.validate_content_asset_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset_ws uuid;
  v_item_ws uuid;
begin
  select workspace_id into v_asset_ws from public.assets where id = new.asset_id;
  select workspace_id into v_item_ws from public.content_items where id = new.content_item_id;
  if v_asset_ws is null or v_item_ws is null or v_asset_ws <> v_item_ws then
    raise exception 'scope mismatch: content_assets asset and content item belong to different workspaces';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_content_asset_scope on public.content_assets;
create trigger trg_validate_content_asset_scope
  before insert or update on public.content_assets
  for each row execute function public.validate_content_asset_scope();

-- Mention: yang disebut harus member AKTIF workspace komentar itu.
create or replace function public.validate_mention_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.comments where id = new.comment_id;
  if v_ws is null then
    raise exception 'scope mismatch: mentions.comment_id does not exist';
  end if;
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = v_ws
      and wm.user_id = new.mentioned_user_id
      and wm.membership_status = 'active'
  ) then
    raise exception 'scope mismatch: mentions.mentioned_user_id is not an active member of this workspace';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_mention_scope on public.mentions;
create trigger trg_validate_mention_scope
  before insert on public.mentions
  for each row execute function public.validate_mention_scope();

-- Notifikasi: penerima harus member AKTIF workspace; target harus ada di
-- workspace yang sama (content_item/campaign/task/comment).
create or replace function public.validate_notification_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
begin
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.recipient_user_id
      and wm.membership_status = 'active'
  ) then
    raise exception 'scope mismatch: notifications.recipient_user_id is not an active member of this workspace';
  end if;
  if new.target_type = 'content_item' then
    select workspace_id into v_ws from public.content_items where id = new.target_id;
  elsif new.target_type = 'campaign' then
    select workspace_id into v_ws from public.campaigns where id = new.target_id;
  elsif new.target_type = 'task' then
    select workspace_id into v_ws from public.tasks where id = new.target_id;
  elsif new.target_type = 'comment' then
    select workspace_id into v_ws from public.comments where id = new.target_id;
  end if;
  if v_ws is null or v_ws <> new.workspace_id then
    raise exception 'scope mismatch: notifications.target_id belongs to a different workspace or does not exist';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_notification_scope on public.notifications;
create trigger trg_validate_notification_scope
  before insert on public.notifications
  for each row execute function public.validate_notification_scope();

-- Template default tidak bisa dihapus (P3-05). Ganti default dulu lewat RPC
-- set_default_brief_template (0010), baru hapus template yang lama.
create or replace function public.prevent_default_template_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.is_default then
    raise exception 'cannot delete the default brief template: set another template as default first';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_prevent_default_template_delete on public.brief_templates;
create trigger trg_prevent_default_template_delete
  before delete on public.brief_templates
  for each row execute function public.prevent_default_template_delete();

-- ============================================================================
-- BAGIAN 4 — Helper RLS baru (pola 0006/0007: STABLE, SECURITY DEFINER,
--   search_path terkunci, hanya boolean, GRANT EXECUTE hanya ke authenticated)
-- ============================================================================

-- Apakah workspace mengizinkan klien berkomentar (setting
-- workspace_settings key 'allow_client_comments', JSON boolean).
-- TIDAK ADA baris / false = TIDAK BOLEH (default, ADR-0009 §5).
create or replace function public.is_client_comment_allowed(p_ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    ((select value_json from public.workspace_settings
       where workspace_id = p_ws_id and key = 'allow_client_comments')::text = 'true'),
    false
  );
$$;

comment on function public.is_client_comment_allowed(uuid) is 'Helper RLS (0009): apakah workspace mengizinkan viewer_client berkomentar. Setting workspace_settings allow_client_comments (JSON boolean); default TIDAK BOLEH. SECURITY DEFINER — hanya boolean.';

-- Apakah target komentar (content_item/campaign/task) dibagikan eksplisit
-- ke pemanggil (viewer_client)? Task: share dilihat dari parent-nya.
create or replace function public.is_comment_target_shared(p_target_type text, p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_target_type in ('content_item', 'campaign') then
      public.is_resource_shared_with_me(p_target_type, p_target_id)
    when p_target_type = 'task' then
      exists (
        select 1 from public.tasks t
        where t.id = p_target_id
          and public.is_resource_shared_with_me(t.parent_type, t.parent_id)
      )
    else false
  end;
$$;

comment on function public.is_comment_target_shared(text, uuid) is 'Helper RLS (0009): apakah target komentar dibagikan eksplisit ke pemanggil. Task dinilai dari parent-nya (content_item/campaign). SECURITY DEFINER — hanya boolean.';

-- Apakah komentar ini (lewat target-nya) dibagikan ke pemanggil?
-- Dipakai policy mentions SELECT untuk viewer_client.
create or replace function public.is_comment_shared_with_me(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.comments c
    where c.id = p_comment_id
      and public.is_comment_target_shared(c.target_type, c.target_id)
  );
$$;

comment on function public.is_comment_shared_with_me(uuid) is 'Helper RLS (0009): apakah sebuah komentar dibagikan eksplisit ke pemanggil (lewat target-nya). SECURITY DEFINER — hanya boolean.';

-- Apakah aset ini dilampirkan ke content item yang dibagikan ke pemanggil?
create or replace function public.is_asset_shared_with_me(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.content_assets ca
    where ca.asset_id = p_asset_id
      and public.is_resource_shared_with_me('content_item', ca.content_item_id)
  );
$$;

comment on function public.is_asset_shared_with_me(uuid) is 'Helper RLS (0009): apakah aset dilampirkan ke content item yang dibagikan eksplisit ke pemanggil. SECURITY DEFINER — hanya boolean.';

-- Apakah pemanggil member AKTIF workspace pemilik aset ini (opsional: filter role)?
create or replace function public.is_asset_member(p_asset_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.assets a
    where a.id = p_asset_id
      and public.is_ws_member(a.workspace_id, p_roles)
  );
$$;

comment on function public.is_asset_member(uuid, text[]) is 'Helper RLS (0009): apakah pemanggil member aktif workspace pemilik aset. SECURITY DEFINER — hanya boolean.';

-- Apakah pemanggil member AKTIF workspace pemilik task ini (opsional: filter role)?
create or replace function public.is_task_member(p_task_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and public.is_ws_member(t.workspace_id, p_roles)
  );
$$;

comment on function public.is_task_member(uuid, text[]) is 'Helper RLS (0009): apakah pemanggil member aktif workspace pemilik task. SECURITY DEFINER — hanya boolean.';

-- Apakah pemanggil penanggung jawab task ini?
create or replace function public.is_task_assignee(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and t.assignee_user_id = auth.uid()
  );
$$;

comment on function public.is_task_assignee(uuid) is 'Helper RLS (0009): apakah pemanggil assignee task ini. SECURITY DEFINER — hanya boolean.';

-- Apakah parent task ini dibagikan eksplisit ke pemanggil (viewer_client)?
create or replace function public.is_task_shared_with_me(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and public.is_resource_shared_with_me(t.parent_type, t.parent_id)
  );
$$;

comment on function public.is_task_shared_with_me(uuid) is 'Helper RLS (0009): apakah parent task dibagikan eksplisit ke pemanggil. SECURITY DEFINER — hanya boolean.';

-- Apakah pemanggil member AKTIF workspace pemilik komentar ini (opsional: filter role)?
create or replace function public.is_comment_member(p_comment_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.comments c
    where c.id = p_comment_id
      and public.is_ws_member(c.workspace_id, p_roles)
  );
$$;

comment on function public.is_comment_member(uuid, text[]) is 'Helper RLS (0009): apakah pemanggil member aktif workspace pemilik komentar. SECURITY DEFINER — hanya boolean.';

-- Grant EXECUTE hanya ke authenticated (bukan public/anon) — pola 0006.
revoke all on function public.is_client_comment_allowed(uuid) from public;
grant execute on function public.is_client_comment_allowed(uuid) to authenticated;
revoke all on function public.is_comment_target_shared(text, uuid) from public;
grant execute on function public.is_comment_target_shared(text, uuid) to authenticated;
revoke all on function public.is_comment_shared_with_me(uuid) from public;
grant execute on function public.is_comment_shared_with_me(uuid) to authenticated;
revoke all on function public.is_asset_shared_with_me(uuid) from public;
grant execute on function public.is_asset_shared_with_me(uuid) to authenticated;
revoke all on function public.is_asset_member(uuid, text[]) from public;
grant execute on function public.is_asset_member(uuid, text[]) to authenticated;
revoke all on function public.is_task_member(uuid, text[]) from public;
grant execute on function public.is_task_member(uuid, text[]) to authenticated;
revoke all on function public.is_task_assignee(uuid) from public;
grant execute on function public.is_task_assignee(uuid) to authenticated;
revoke all on function public.is_task_shared_with_me(uuid) from public;
grant execute on function public.is_task_shared_with_me(uuid) to authenticated;
revoke all on function public.is_comment_member(uuid, text[]) from public;
grant execute on function public.is_comment_member(uuid, text[]) to authenticated;

-- ============================================================================
-- BAGIAN 5 — Row Level Security
-- Aturan: policy TIDAK berisi FROM/JOIN — hanya helper (BAGIAN 4, 0006,
--   0007) + auth.uid() + kolom baris itu sendiri. viewer_client TIDAK
--   pernah muncul di daftar role member (mereka hanya lewat helper share).
-- ============================================================================

alter table public.brief_templates enable row level security;
alter table public.tasks enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.assets enable row level security;
alter table public.asset_versions enable row level security;
alter table public.content_assets enable row level security;
alter table public.comments enable row level security;
alter table public.mentions enable row level security;
alter table public.notifications enable row level security;

revoke all on public.brief_templates from anon, authenticated;
grant select, insert, update, delete on public.brief_templates to authenticated;
revoke all on public.tasks from anon, authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
revoke all on public.task_checklist_items from anon, authenticated;
grant select, insert, update, delete on public.task_checklist_items to authenticated;
revoke all on public.assets from anon, authenticated;
grant select, insert, update, delete on public.assets to authenticated;
revoke all on public.asset_versions from anon, authenticated;
grant select, insert, update, delete on public.asset_versions to authenticated;
revoke all on public.content_assets from anon, authenticated;
grant select, insert, update, delete on public.content_assets to authenticated;
revoke all on public.comments from anon, authenticated;
grant select, insert, update, delete on public.comments to authenticated;
revoke all on public.mentions from anon, authenticated;
grant select, insert, update, delete on public.mentions to authenticated;
revoke all on public.notifications from anon, authenticated;
grant select, insert, update, delete on public.notifications to authenticated;

-- --- brief_templates --------------------------------------------------------
-- Baca: member aktif workspace (semua kecuali viewer_client — portal tidak
-- punya fitur template di fase ini). Tulis: owner/admin/manager/strategist.
-- Hapus: owner/admin/manager (trigger menolak hapus template default).
create policy "templates_select_member"
  on public.brief_templates for select
  to authenticated
  using (
    public.is_ws_member(brief_templates.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "templates_insert_managers"
  on public.brief_templates for insert
  to authenticated
  with check (
    public.is_ws_member(brief_templates.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  );

create policy "templates_update_managers"
  on public.brief_templates for update
  to authenticated
  using (
    public.is_ws_member(brief_templates.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  )
  with check (
    public.is_ws_member(brief_templates.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  );

create policy "templates_delete_managers"
  on public.brief_templates for delete
  to authenticated
  using (
    public.is_ws_member(brief_templates.workspace_id, array['owner', 'admin', 'manager'])
  );

-- --- tasks ------------------------------------------------------------------
-- Baca: member aktif workspace ATAU klien yang parent-nya dibagikan.
-- INSERT: peran penuh bebas menugaskan; peran "limited" hanya untuk diri
--   sendiri / kosong (cermin items_insert_editors, 0007).
-- UPDATE: peran penuh bebas; peran "limited" hanya task yang ditugaskan
--   kepadanya — using DAN with check sama (tidak boleh mengalihkan ke orang
--   lain, termasuk mengosongkan penugasan sendiri).
-- Hapus: tidak (arsip lewat status cancelled — P3-A4).
create policy "tasks_select_member_or_shared"
  on public.tasks for select
  to authenticated
  using (
    public.is_ws_member(tasks.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_resource_shared_with_me(tasks.parent_type, tasks.parent_id)
  );

create policy "tasks_insert_managers_or_self_assigned"
  on public.tasks for insert
  to authenticated
  with check (
    public.is_ws_member(tasks.workspace_id, array['owner', 'admin', 'manager'])
    or (
      public.is_ws_member(tasks.workspace_id, array['strategist', 'creator', 'editor', 'approver'])
      and (tasks.assignee_user_id is null or tasks.assignee_user_id = auth.uid())
    )
  );

create policy "tasks_update_managers_or_assignee"
  on public.tasks for update
  to authenticated
  using (
    public.is_ws_member(tasks.workspace_id, array['owner', 'admin', 'manager'])
    or (
      public.is_ws_member(tasks.workspace_id, array['strategist', 'creator', 'editor', 'approver'])
      and tasks.assignee_user_id = auth.uid()
    )
  )
  with check (
    public.is_ws_member(tasks.workspace_id, array['owner', 'admin', 'manager'])
    or (
      public.is_ws_member(tasks.workspace_id, array['strategist', 'creator', 'editor', 'approver'])
      and tasks.assignee_user_id = auth.uid()
    )
  );

create policy "tasks_no_delete"
  on public.tasks for delete to authenticated using (false);

-- --- task_checklist_items ---------------------------------------------------
-- Baca: member workspace pemilik task ATAU klien yang parent task-nya dibagikan.
-- Tulis: peran penuh ATAU peran "limited" yang ditugaskan task itu.
create policy "checklist_select_member_or_shared"
  on public.task_checklist_items for select
  to authenticated
  using (
    public.is_task_member(task_checklist_items.task_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_task_shared_with_me(task_checklist_items.task_id)
  );

create policy "checklist_insert_managers_or_assignee"
  on public.task_checklist_items for insert
  to authenticated
  with check (
    public.is_task_member(task_checklist_items.task_id, array['owner', 'admin', 'manager'])
    or (
      public.is_task_member(task_checklist_items.task_id, array['strategist', 'creator', 'editor', 'approver'])
      and public.is_task_assignee(task_checklist_items.task_id)
    )
  );

create policy "checklist_update_managers_or_assignee"
  on public.task_checklist_items for update
  to authenticated
  using (
    public.is_task_member(task_checklist_items.task_id, array['owner', 'admin', 'manager'])
    or (
      public.is_task_member(task_checklist_items.task_id, array['strategist', 'creator', 'editor', 'approver'])
      and public.is_task_assignee(task_checklist_items.task_id)
    )
  )
  with check (
    public.is_task_member(task_checklist_items.task_id, array['owner', 'admin', 'manager'])
    or (
      public.is_task_member(task_checklist_items.task_id, array['strategist', 'creator', 'editor', 'approver'])
      and public.is_task_assignee(task_checklist_items.task_id)
    )
  );

create policy "checklist_delete_managers_or_assignee"
  on public.task_checklist_items for delete
  to authenticated
  using (
    public.is_task_member(task_checklist_items.task_id, array['owner', 'admin', 'manager'])
    or (
      public.is_task_member(task_checklist_items.task_id, array['strategist', 'creator', 'editor', 'approver'])
      and public.is_task_assignee(task_checklist_items.task_id)
    )
  );

-- --- assets -----------------------------------------------------------------
-- Baca: member aktif workspace ATAU klien yang asetnya dilampirkan ke konten
--   yang dibagikan kepadanya.
-- INSERT/UPDATE: upload_assets — peran penuh (owner/admin/manager/
--   strategist) + creator/editor atas asetnya sendiri (uploaded_by = diri).
--   Approver hanya baca, analyst tidak boleh.
-- Hapus: owner/admin/manager (server action memeriksa referensi dulu).
create policy "assets_select_member_or_shared"
  on public.assets for select
  to authenticated
  using (
    public.is_ws_member(assets.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_asset_shared_with_me(assets.id)
  );

create policy "assets_insert_uploaders"
  on public.assets for insert
  to authenticated
  with check (
    public.is_ws_member(assets.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or (
      public.is_ws_member(assets.workspace_id, array['creator', 'editor'])
      and assets.uploaded_by = auth.uid()
    )
  );

create policy "assets_update_uploaders"
  on public.assets for update
  to authenticated
  using (
    public.is_ws_member(assets.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or (
      public.is_ws_member(assets.workspace_id, array['creator', 'editor'])
      and assets.uploaded_by = auth.uid()
    )
  )
  with check (
    public.is_ws_member(assets.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or (
      public.is_ws_member(assets.workspace_id, array['creator', 'editor'])
      and assets.uploaded_by = auth.uid()
    )
  );

create policy "assets_delete_managers"
  on public.assets for delete
  to authenticated
  using (
    public.is_ws_member(assets.workspace_id, array['owner', 'admin', 'manager'])
  );

-- --- asset_versions ---------------------------------------------------------
-- Baca: seperti assets (member workspace pemilik aset ATAU klien yang
--   asetnya dibagikan). Tulis: hanya INSERT (append-only); UPDATE/DELETE tidak.
create policy "asset_versions_select_member_or_shared"
  on public.asset_versions for select
  to authenticated
  using (
    public.is_asset_member(asset_versions.asset_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_asset_shared_with_me(asset_versions.asset_id)
  );

create policy "asset_versions_insert_uploaders"
  on public.asset_versions for insert
  to authenticated
  with check (
    public.is_asset_member(asset_versions.asset_id, array['owner', 'admin', 'manager', 'strategist'])
    or (
      public.is_asset_member(asset_versions.asset_id, array['creator', 'editor'])
      and asset_versions.uploaded_by = auth.uid()
    )
  );

create policy "asset_versions_no_update"
  on public.asset_versions for update to authenticated using (false);

create policy "asset_versions_no_delete"
  on public.asset_versions for delete to authenticated using (false);

-- --- content_assets ---------------------------------------------------------
-- Baca: member aktif workspace (isi content item-nya) ATAU klien yang
--   content item-nya dibagikan. Tulis: yang boleh mengedit content item itu
--   (helper 0007 can_edit_content_item — peran penuh + creator/editor
--   pemilik konten).
create policy "content_assets_select_member_or_shared"
  on public.content_assets for select
  to authenticated
  using (
    public.is_content_item_member(content_assets.content_item_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_resource_shared_with_me('content_item', content_assets.content_item_id)
  );

create policy "content_assets_insert_editors"
  on public.content_assets for insert
  to authenticated
  with check (
    public.can_edit_content_item(content_assets.content_item_id)
  );

create policy "content_assets_update_editors"
  on public.content_assets for update
  to authenticated
  using (
    public.can_edit_content_item(content_assets.content_item_id)
  )
  with check (
    public.can_edit_content_item(content_assets.content_item_id)
  );

create policy "content_assets_delete_editors"
  on public.content_assets for delete
  to authenticated
  using (
    public.can_edit_content_item(content_assets.content_item_id)
  );

-- --- comments ---------------------------------------------------------------
-- Baca: member aktif workspace (termasuk komentar yang sudah soft-delete —
--   aplikasi menampilkannya sebagai "Komentar ini dihapus") ATAU klien yang
--   target komentarnya dibagikan.
-- INSERT: member dengan kemampuan comment (semua kecuali analyst dan
--   viewer_client) + author harus = diri sendiri; ATAU viewer_client yang
--   targetnya dibagikan DAN workspace mengizinkan komentar klien
--   (gerbang ganda, ADR-0009 §5).
-- UPDATE: penulis sendiri, komentar belum dihapus; with check hanya
--   author = diri (agar soft-delete — mengisi deleted_at — tetap lolos).
-- Hapus: tidak (soft-delete lewat UPDATE).
create policy "comments_select_member_or_shared"
  on public.comments for select
  to authenticated
  using (
    public.is_ws_member(comments.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_comment_target_shared(comments.target_type, comments.target_id)
  );

create policy "comments_insert_members_or_allowed_client"
  on public.comments for insert
  to authenticated
  with check (
    (
      public.is_ws_member(comments.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver'])
      and comments.author_user_id = auth.uid()
    )
    or (
      public.is_comment_target_shared(comments.target_type, comments.target_id)
      and public.is_client_comment_allowed(comments.workspace_id)
      and comments.author_user_id = auth.uid()
    )
  );

create policy "comments_update_author_not_deleted"
  on public.comments for update
  to authenticated
  using (
    comments.author_user_id = auth.uid()
    and comments.deleted_at is null
  )
  with check (
    comments.author_user_id = auth.uid()
  );

create policy "comments_no_delete"
  on public.comments for delete to authenticated using (false);

-- --- mentions ---------------------------------------------------------------
-- Baca: member workspace pemilik komentar ATAU klien yang komentarnya dibagikan.
-- Tulis: TIDAK ADA — hanya RPC create_comment_with_mentions (0010,
--   SECURITY DEFINER) yang menulis tabel ini.
create policy "mentions_select_member_or_shared"
  on public.mentions for select
  to authenticated
  using (
    public.is_comment_member(mentions.comment_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_comment_shared_with_me(mentions.comment_id)
  );

create policy "mentions_no_insert"
  on public.mentions for insert to authenticated with check (false);

create policy "mentions_no_update"
  on public.mentions for update to authenticated using (false);

create policy "mentions_no_delete"
  on public.mentions for delete to authenticated using (false);

-- --- notifications ----------------------------------------------------------
-- Baca: hanya penerima. Tulis: TIDAK ADA insert/delete langsung — hanya RPC
--   (0010, SECURITY DEFINER). UPDATE: hanya penerima, dan trigger BAGIAN 3
--   (prevent_notification_tamper) memastikan hanya read_at yang boleh berubah.
create policy "notifications_select_recipient"
  on public.notifications for select
  to authenticated
  using (
    notifications.recipient_user_id = auth.uid()
  );

create policy "notifications_no_insert"
  on public.notifications for insert to authenticated with check (false);

create policy "notifications_update_recipient"
  on public.notifications for update
  to authenticated
  using (
    notifications.recipient_user_id = auth.uid()
  )
  with check (
    notifications.recipient_user_id = auth.uid()
  );

create policy "notifications_no_delete"
  on public.notifications for delete to authenticated using (false);

-- Trigger: notifikasi hanya boleh berubah di read_at/updated_at.
-- Menandai dibaca adalah satu-satunya UPDATE yang sah dari aplikasi.
create or replace function public.prevent_notification_tamper()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.workspace_id is distinct from new.workspace_id
    or old.recipient_user_id is distinct from new.recipient_user_id
    or old.type is distinct from new.type
    or old.title is distinct from new.title
    or old.body is distinct from new.body
    or old.target_type is distinct from new.target_type
    or old.target_id is distinct from new.target_id
  then
    raise exception 'notifications are immutable except read_at';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_notification_tamper on public.notifications;
create trigger trg_prevent_notification_tamper
  before update on public.notifications
  for each row execute function public.prevent_notification_tamper();

-- ============================================================================
-- BAGIAN 6 — Bucket Storage privat + policy storage.objects
-- Bucket 'mative-assets', public = false. Akses file hanya lewat signed URL
-- 1 jam yang dibuat server action (pola ADR-0009 §4).
-- Penyimpangan dari pola revoke+grant migrasi 0001–0008 (didokumentasikan):
--   storage.objects adalah tabel sistem yang dipakai SEMUA bucket — di sini
--   hanya GRANT (aditif) + policy baru, TANPA revoke, agar tidak merusak
--   policy/grant bawaan Supabase untuk bucket lain. RLS tetap menjadi
--   gerbang (tanpa policy yang cocok, akses ditolak).
-- Nama objek: <workspace_id>/<asset_id>/<nama-file>. Folder pertama HARUS
--   UUID workspace yang valid (regex guard) agar cast tidak melempar error
--   pada path yang malformed.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('mative-assets', 'mative-assets', false)
on conflict (id) do nothing;

grant select on storage.buckets to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

-- Bucket hanya bisa dibaca (metadata) oleh authenticated.
create policy "buckets_select_mative_assets"
  on storage.buckets for select
  to authenticated
  using (id = 'mative-assets');

-- Baca objek: member aktif workspace (kecuali viewer_client — mereka hanya
--   lewat cabang kedua) ATAU klien yang asetnya dibagikan.
create policy "mative_assets_objects_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'mative-assets'
    and (
      (
        (split_part(name, '/', 1)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and public.is_ws_member((split_part(name, '/', 1))::uuid, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
      )
      or (
        (split_part(name, '/', 2)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and public.is_asset_shared_with_me((split_part(name, '/', 2))::uuid)
      )
    )
  );

-- Tulis objek: hanya peran upload (owner/admin/manager/strategist/
--   creator/editor) di workspace folder pertama.
create policy "mative_assets_objects_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'mative-assets'
    and (split_part(name, '/', 1)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_ws_member((split_part(name, '/', 1))::uuid, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor'])
  );

create policy "mative_assets_objects_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'mative-assets'
    and (split_part(name, '/', 1)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_ws_member((split_part(name, '/', 1))::uuid, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor'])
  )
  with check (
    bucket_id = 'mative-assets'
    and (split_part(name, '/', 1)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_ws_member((split_part(name, '/', 1))::uuid, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor'])
  );

create policy "mative_assets_objects_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'mative-assets'
    and (split_part(name, '/', 1)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_ws_member((split_part(name, '/', 1))::uuid, array['owner', 'admin', 'manager'])
  );

-- ============================================================================
-- AKHIR MIGRASI 0009 — ringkasan jumlah objek:
--   9 tabel + 1 FK (brands.logo_asset_id) + 23 index + 5 trigger validasi
--   scope + 1 trigger proteksi template default + 1 trigger proteksi
--   notifikasi + 9 helper RLS baru + 36 policy tabel + 1 bucket +
--   5 policy storage (1 buckets + 4 objects).
-- ============================================================================
