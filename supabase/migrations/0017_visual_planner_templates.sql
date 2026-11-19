-- ============================================================================
-- MaTive — migrasi 0017: visual planner + template dasar (Phase 5)
--
-- KEPUTUSAN (ADR-0011): visual planner = modul lepas (Keputusan #4);
-- urutan visual = data TERPISAH dari `content_placements.scheduled_at`
-- (ASUMSI-5.1); template dasar = salinan (ASUMSI-5.4).
--
-- (1) `visual_orders`: satu baris per (workspace, brand, channel,
--     placement) + `position int`. Unique per placement DAN per posisi.
--     Tulis HANYA lewat RPC `set_visual_order` (di bawah) — RLS:
--     revoke all + grant select saja (pola approval_requests 0013),
--     policy insert/update/delete using (false).
-- (2) `campaign_templates` + `campaign_template_brands`: salinan field
--     campaign + tautan brand.
-- (3) `content_templates` + `content_template_placements`: salinan
--     konten (judul, brand, pilar, script, caption) + struktur placement
--     (channel + format SAJA — tanpa `scheduled_at`).
-- (4) RPC `set_visual_order`: validasi 7 poin Dok 06 §4, tulis ulang
--     posisi dalam SATU transaksi, jejak audit ke `activity_logs`.
--     TIDAK PERNAH menulis `scheduled_at` (R5.1). Kode error Dok 07 §6
--     (jsonb 'ok'/'code'/'message', pola 0014) — BUKAN raise exception.
-- (5) Trigger scope untuk keempat tabel template/visual (pola 0007):
--     brand/pilar/channel harus satu workspace dengan baris induknya.
--
-- 0001–0016 TIDAK diubah. Tidak ada data yang diubah (tabel baru kosong).
-- ============================================================================

-- --- (1) Tabel visual_orders --------------------------------------------------
create table if not exists public.visual_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  social_channel_id uuid not null references public.social_channels (id) on delete cascade,
  placement_id uuid not null references public.content_placements (id) on delete cascade,
  position int not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, brand_id, social_channel_id, placement_id),
  unique (workspace_id, brand_id, social_channel_id, position)
);

comment on table public.visual_orders is 'Urutan visual per (workspace, brand, channel) — data TERPISAH dari content_placements.scheduled_at (ASUMSI-5.1, ADR-0011 §6). Tulis hanya lewat RPC set_visual_order.';

create index if not exists idx_visual_orders_scope on public.visual_orders (workspace_id, brand_id, social_channel_id, position);
create index if not exists idx_visual_orders_placement on public.visual_orders (placement_id);

-- --- (2) Tabel campaign_templates ---------------------------------------------
create table if not exists public.campaign_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  source_campaign_id uuid references public.campaigns (id) on delete set null,
  objective text,
  audience_id uuid references public.audiences (id) on delete set null,
  target_metrics jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

comment on table public.campaign_templates is 'Template campaign dasar (ASUMSI-5.4): salinan field campaign + tautan brand. Bentuk target_metrics mengikuti ASUMSI-5.3 (3 field).';

create table if not exists public.campaign_template_brands (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.campaign_templates (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (template_id, brand_id)
);

comment on table public.campaign_template_brands is 'Tautan template campaign <-> brand. Template dan brand WAJIB satu workspace (trigger validate_campaign_template_brand_scope).';

create index if not exists idx_campaign_templates_ws on public.campaign_templates (workspace_id);
create index if not exists idx_campaign_template_brands_template on public.campaign_template_brands (template_id);
create index if not exists idx_campaign_template_brands_brand on public.campaign_template_brands (brand_id);

-- --- (3) Tabel content_templates ----------------------------------------------
create table if not exists public.content_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  source_content_item_id uuid references public.content_items (id) on delete set null,
  title text not null,
  brand_id uuid not null references public.brands (id) on delete cascade,
  pillar_id uuid references public.content_pillars (id) on delete set null,
  script text,
  caption text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

comment on table public.content_templates is 'Template konten dasar (ASUMSI-5.4): salinan judul/brand/pilar/script/caption dari konten yang sudah ada.';

create table if not exists public.content_template_placements (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.content_templates (id) on delete cascade,
  social_channel_id uuid not null references public.social_channels (id) on delete cascade,
  platform_format text,
  created_at timestamptz not null default now(),
  unique (template_id, social_channel_id)
);

comment on table public.content_template_placements is 'Struktur placement template konten: channel + format SAJA, tanpa scheduled_at (template tidak punya jadwal).';

create index if not exists idx_content_templates_ws on public.content_templates (workspace_id);
create index if not exists idx_content_template_placements_template on public.content_template_placements (template_id);

-- --- (4) Trigger scope (pola 0007) ---------------------------------------------
-- visual_orders: placement harus milik workspace+brand+channel yang sama.
create or replace function public.validate_visual_order_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
  v_brand uuid;
  v_channel uuid;
begin
  select ci.workspace_id, ci.brand_id, pl.social_channel_id
    into v_ws, v_brand, v_channel
  from public.content_placements pl
  join public.content_items ci on ci.id = pl.content_item_id
  where pl.id = new.placement_id;
  if v_ws is null or v_ws <> new.workspace_id
    or v_brand <> new.brand_id
    or v_channel <> new.social_channel_id then
    raise exception 'scope mismatch: visual_orders.placement_id belongs to a different workspace/brand/channel';
  end if;
  return new;
end;
$$;

comment on function public.validate_visual_order_scope() is 'Trigger scope (0017): visual order hanya untuk placement milik workspace+brand+channel yang sama. SECURITY DEFINER, ditinjau — hanya baca scope + raise.';

drop trigger if exists trg_visual_order_scope on public.visual_orders;
create trigger trg_visual_order_scope
  before insert or update on public.visual_orders
  for each row execute function public.validate_visual_order_scope();

-- campaign_templates: audience (bila ada) harus satu workspace.
create or replace function public.validate_campaign_template_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
begin
  if new.audience_id is not null then
    select workspace_id into v_ws from public.audiences where id = new.audience_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: campaign_templates.audience_id belongs to a different workspace';
    end if;
  end if;
  if new.source_campaign_id is not null then
    select workspace_id into v_ws from public.campaigns where id = new.source_campaign_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: campaign_templates.source_campaign_id belongs to a different workspace';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.validate_campaign_template_scope() is 'Trigger scope (0017): audience + campaign sumber template harus satu workspace. SECURITY DEFINER, ditinjau — hanya baca scope + raise.';

drop trigger if exists trg_campaign_template_scope on public.campaign_templates;
create trigger trg_campaign_template_scope
  before insert or update on public.campaign_templates
  for each row execute function public.validate_campaign_template_scope();

-- campaign_template_brands: brand harus satu workspace dengan template.
create or replace function public.validate_campaign_template_brand_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_template_ws uuid;
  v_brand_ws uuid;
begin
  select workspace_id into v_template_ws from public.campaign_templates where id = new.template_id;
  select workspace_id into v_brand_ws from public.brands where id = new.brand_id;
  if v_template_ws is null or v_brand_ws is null or v_template_ws <> v_brand_ws then
    raise exception 'scope mismatch: campaign_template_brands template and brand belong to different workspaces';
  end if;
  return new;
end;
$$;

comment on function public.validate_campaign_template_brand_scope() is 'Trigger scope (0017): template campaign-brand satu workspace. SECURITY DEFINER, ditinjau — hanya baca scope + raise.';

drop trigger if exists trg_campaign_template_brand_scope on public.campaign_template_brands;
create trigger trg_campaign_template_brand_scope
  before insert or update on public.campaign_template_brands
  for each row execute function public.validate_campaign_template_brand_scope();

-- content_templates: brand + pilar harus satu workspace.
create or replace function public.validate_content_template_scope()
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
    raise exception 'scope mismatch: content_templates.brand_id belongs to a different workspace';
  end if;
  if new.pillar_id is not null then
    select workspace_id into v_ws from public.content_pillars where id = new.pillar_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_templates.pillar_id belongs to a different workspace';
    end if;
  end if;
  if new.source_content_item_id is not null then
    select workspace_id into v_ws from public.content_items where id = new.source_content_item_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_templates.source_content_item_id belongs to a different workspace';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.validate_content_template_scope() is 'Trigger scope (0017): brand + pilar + konten sumber template harus satu workspace. SECURITY DEFINER, ditinjau — hanya baca scope + raise.';

drop trigger if exists trg_content_template_scope on public.content_templates;
create trigger trg_content_template_scope
  before insert or update on public.content_templates
  for each row execute function public.validate_content_template_scope();

-- content_template_placements: channel harus satu workspace + satu brand
-- dengan template induknya.
create or replace function public.validate_content_template_placement_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_template_ws uuid;
  v_template_brand uuid;
  v_channel_ws uuid;
  v_channel_brand uuid;
begin
  select workspace_id, brand_id into v_template_ws, v_template_brand
  from public.content_templates where id = new.template_id;
  select b.workspace_id, sc.brand_id into v_channel_ws, v_channel_brand
  from public.social_channels sc
  join public.brands b on b.id = sc.brand_id
  where sc.id = new.social_channel_id;
  if v_template_ws is null or v_channel_ws is null
    or v_template_ws <> v_channel_ws
    or v_template_brand <> v_channel_brand then
    raise exception 'scope mismatch: content_template_placements channel belongs to a different workspace/brand than its template';
  end if;
  return new;
end;
$$;

comment on function public.validate_content_template_placement_scope() is 'Trigger scope (0017): channel template placement harus satu workspace + satu brand dengan template induknya. SECURITY DEFINER, ditinjau — hanya baca scope + raise.';

drop trigger if exists trg_content_template_placement_scope on public.content_template_placements;
create trigger trg_content_template_placement_scope
  before insert or update on public.content_template_placements
  for each row execute function public.validate_content_template_placement_scope();

-- --- (5) RLS: aktifkan untuk semua tabel baru ---------------------------------
alter table public.visual_orders enable row level security;
alter table public.campaign_templates enable row level security;
alter table public.campaign_template_brands enable row level security;
alter table public.content_templates enable row level security;
alter table public.content_template_placements enable row level security;

-- Helper RLS untuk tabel anak template (pola is_task_member 0009):
-- policy TIDAK BOLEH memindai tabel lain — hanya helper + kolom baris.
create or replace function public.is_campaign_template_member(p_template_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.campaign_templates t
    where t.id = p_template_id
      and public.is_ws_member(t.workspace_id, p_roles)
  );
$$;

comment on function public.is_campaign_template_member(uuid, text[]) is 'Helper RLS (0017): apakah pemanggil member aktif workspace pemilik template campaign. SECURITY DEFINER — hanya boolean.';

create or replace function public.is_content_template_member(p_template_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.content_templates t
    where t.id = p_template_id
      and public.is_ws_member(t.workspace_id, p_roles)
  );
$$;

comment on function public.is_content_template_member(uuid, text[]) is 'Helper RLS (0017): apakah pemanggil member aktif workspace pemilik template konten. SECURITY DEFINER — hanya boolean.';

-- visual_orders — baca: member aktif workspace. Tulis: TIDAK (hanya RPC
-- set_visual_order; pola approval_requests 0013).
create policy "visual_orders_select_member"
  on public.visual_orders for select
  to authenticated
  using (
    public.is_ws_member(visual_orders.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "visual_orders_no_insert"
  on public.visual_orders for insert to authenticated using (false);

create policy "visual_orders_no_update"
  on public.visual_orders for update to authenticated using (false);

create policy "visual_orders_no_delete"
  on public.visual_orders for delete to authenticated using (false);

-- campaign_templates — baca: member. Tulis: planners. Hapus: owner/admin.
create policy "campaign_templates_select_member"
  on public.campaign_templates for select
  to authenticated
  using (
    public.is_ws_member(campaign_templates.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "campaign_templates_insert_planners"
  on public.campaign_templates for insert
  to authenticated
  with check (
    public.is_ws_member(campaign_templates.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  );

create policy "campaign_templates_update_planners"
  on public.campaign_templates for update
  to authenticated
  using (
    public.is_ws_member(campaign_templates.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  )
  with check (
    public.is_ws_member(campaign_templates.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
  );

create policy "campaign_templates_delete_owner_admin"
  on public.campaign_templates for delete
  to authenticated
  using (
    public.is_ws_member(campaign_templates.workspace_id, array['owner', 'admin'])
  );

-- campaign_template_brands — baca: member. Tulis/hapus tautan: planners.
-- UPDATE: tidak (lepas + tautkan ulang).
create policy "campaign_template_brands_select_member"
  on public.campaign_template_brands for select
  to authenticated
  using (
    public.is_campaign_template_member(campaign_template_brands.template_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "campaign_template_brands_insert_planners"
  on public.campaign_template_brands for insert
  to authenticated
  with check (
    public.is_campaign_template_member(campaign_template_brands.template_id, array['owner', 'admin', 'manager', 'strategist'])
  );

create policy "campaign_template_brands_no_update"
  on public.campaign_template_brands for update to authenticated using (false);

create policy "campaign_template_brands_delete_planners"
  on public.campaign_template_brands for delete
  to authenticated
  using (
    public.is_campaign_template_member(campaign_template_brands.template_id, array['owner', 'admin', 'manager', 'strategist'])
  );

-- content_templates — baca: member. Tulis: planners + creator/editor
-- (template adalah aset workspace bersama). Hapus: owner/admin.
create policy "content_templates_select_member"
  on public.content_templates for select
  to authenticated
  using (
    public.is_ws_member(content_templates.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "content_templates_insert_editors"
  on public.content_templates for insert
  to authenticated
  with check (
    public.is_ws_member(content_templates.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor'])
  );

create policy "content_templates_update_editors"
  on public.content_templates for update
  to authenticated
  using (
    public.is_ws_member(content_templates.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor'])
  )
  with check (
    public.is_ws_member(content_templates.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor'])
  );

create policy "content_templates_delete_owner_admin"
  on public.content_templates for delete
  to authenticated
  using (
    public.is_ws_member(content_templates.workspace_id, array['owner', 'admin'])
  );

-- content_template_placements — baca: member. Tulis/hapus: planners +
-- creator/editor. UPDATE: tidak (lepas + tautkan ulang).
create policy "content_template_placements_select_member"
  on public.content_template_placements for select
  to authenticated
  using (
    public.is_content_template_member(content_template_placements.template_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "content_template_placements_insert_editors"
  on public.content_template_placements for insert
  to authenticated
  with check (
    public.is_content_template_member(content_template_placements.template_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor'])
  );

create policy "content_template_placements_no_update"
  on public.content_template_placements for update to authenticated using (false);

create policy "content_template_placements_delete_editors"
  on public.content_template_placements for delete
  to authenticated
  using (
    public.is_content_template_member(content_template_placements.template_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor'])
  );

-- --- (6) Grant tabel baru ------------------------------------------------------
-- visual_orders: revoke all + grant select saja (tulis hanya lewat RPC).
revoke all on public.visual_orders from anon, authenticated;
grant select on public.visual_orders to authenticated;
-- Template: keempat operasi ke authenticated; penegakan sepenuhnya di policy.
grant select, insert, update, delete on public.campaign_templates to authenticated;
grant select, insert, update, delete on public.campaign_template_brands to authenticated;
grant select, insert, update, delete on public.content_templates to authenticated;
grant select, insert, update, delete on public.content_template_placements to authenticated;

-- --- (7) RPC set_visual_order --------------------------------------------------
-- Tulis ulang urutan visual untuk satu (workspace, brand, channel) dalam
-- SATU transaksi. Validasi 7 poin Dok 06 §4 + duplikat + kepemilikan tiap
-- placement. TIDAK PERNAH menulis scheduled_at (R5.1) — tidak ada satu
-- pun statement UPDATE/INSERT ke content_placements di fungsi ini.
-- Daftar kosong (array '{}') = hapus semua urutan untuk scope itu.
create or replace function public.set_visual_order(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_channel_id uuid,
  p_placement_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_pid uuid;
  v_pos int := 0;
  v_brand_ws uuid;
  v_channel_brand uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if not public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist']) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Hanya owner/admin/manager/strategist yang boleh mengubah urutan visual.');
  end if;
  if not public.brand_in_scope(p_brand_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Brand di luar cakupan Anda.');
  end if;
  select workspace_id into v_brand_ws from public.brands where id = p_brand_id;
  if v_brand_ws is null or v_brand_ws <> p_workspace_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Brand tidak ditemukan di workspace ini.');
  end if;
  select brand_id into v_channel_brand from public.social_channels where id = p_channel_id;
  if v_channel_brand is null or v_channel_brand <> p_brand_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Channel tidak ditemukan untuk brand ini.');
  end if;
  if exists (
    select 1 from unnest(coalesce(p_placement_ids, '{}'::uuid[])) as x(id)
    group by id having count(*) > 1
  ) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE_TRANSITION', 'message', 'Daftar placement mengandung duplikat.');
  end if;
  for v_pid in select unnest(coalesce(p_placement_ids, '{}'::uuid[])) loop
    if not exists (
      select 1 from public.content_placements pl
      join public.content_items ci on ci.id = pl.content_item_id
      where pl.id = v_pid
        and ci.workspace_id = p_workspace_id
        and ci.brand_id = p_brand_id
        and pl.social_channel_id = p_channel_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Placement tidak ditemukan di workspace/brand/channel ini.');
    end if;
  end loop;
  delete from public.visual_orders
   where workspace_id = p_workspace_id
     and brand_id = p_brand_id
     and social_channel_id = p_channel_id;
  foreach v_pid in array coalesce(p_placement_ids, '{}'::uuid[]) loop
    insert into public.visual_orders (workspace_id, brand_id, social_channel_id, placement_id, position)
    values (p_workspace_id, p_brand_id, p_channel_id, v_pid, v_pos);
    v_pos := v_pos + 1;
  end loop;
  insert into public.activity_logs (workspace_id, actor_user_id, entity_type, entity_id, action, after_snapshot)
  values (p_workspace_id, v_caller, 'visual_order', p_channel_id, 'visual_order.set',
    jsonb_build_object('brand_id', p_brand_id, 'channel_id', p_channel_id, 'placement_ids', to_jsonb(coalesce(p_placement_ids, '{}'::uuid[]))));
  return jsonb_build_object('ok', true, 'count', v_pos);
end;
$$;

comment on function public.set_visual_order(uuid, uuid, uuid, uuid[]) is 'RPC Phase 5 (0017): tulis ulang urutan visual satu (workspace, brand, channel) dalam satu transaksi + jejak audit. TIDAK PERNAH menulis scheduled_at. SECURITY DEFINER — ditinjau.';

revoke all on function public.set_visual_order(uuid, uuid, uuid, uuid[]) from public;
grant execute on function public.set_visual_order(uuid, uuid, uuid, uuid[]) to authenticated;

revoke all on function public.validate_visual_order_scope() from public;
revoke all on function public.validate_campaign_template_scope() from public;
revoke all on function public.validate_campaign_template_brand_scope() from public;
revoke all on function public.validate_content_template_scope() from public;
revoke all on function public.validate_content_template_placement_scope() from public;
revoke all on function public.is_campaign_template_member(uuid, text[]) from public;
revoke all on function public.is_content_template_member(uuid, text[]) from public;
grant execute on function public.is_campaign_template_member(uuid, text[]) to authenticated;
grant execute on function public.is_content_template_member(uuid, text[]) to authenticated;
