-- ============================================================================
-- MaTive — migrasi 0016: penegakan brand scope (P1-A7, Keputusan #9)
--
-- KEPUTUSAN: brand scope ditegakkan paling lambat sebelum Phase 5
-- (v2, Keputusan #9, dikunci Tuan 2026-11-19 01:54 WIB). Kolom
-- `workspace_members.brand_scope` (JSONB) ada sejak 0003 tetapi selama
-- ini tidak dipakai policy mana pun (Phase 2 report: "belum ada filter
-- brand terpisah di policy").
--
-- BENTUK YANG DIKUNCI (ADR-0011 §2):
--   NULL = semua brand di workspace (default; perilaku lama dipertahankan).
--   Array JSON berisi UUID brand = member hanya boleh melihat/memakai
--   brand itu. Array kosong [] = tidak ada brand.
--   CHECK baru: NULL atau array. Elemen yang bukan UUID diabaikan secara
--   fail-closed oleh helper (tidak pernah melonggarkan akses); aplikasi
--   memvalidasi UUID lewat Zod sebelum menulis.
--
-- PENEGAKAN (tiga lapis; RLS di sini adalah penegak sesungguhnya):
--   (1) Helper baru `brand_in_scope(p_brand_id)` (STABLE, SECURITY
--       DEFINER, search_path terkunci): NULL -> true (unbranded terlihat
--       semua member); brand tak dikenal / pemanggil bukan member aktif
--       -> false; scope NULL -> true; selain itu brand harus ada di array.
--   (2) Helper ditulis ulang (+ scope): `is_brand_member` (channels
--       ikut ter-scope tanpa ubah policy), `is_content_item_member`
--       (placements + versions + content_assets ikut ter-scope lewat
--       can_read/can_edit_content_item), `can_read_placement` +
--       `can_edit_placement` (placement_versions + guard RPC 0008).
--   (3) Policy ditulis ulang (DROP + CREATE, isi lain dipertahankan
--       persis): brands, content_pillars, ideas, content_items,
--       campaign_brands — cabang member ditambah `AND brand_in_scope(..)`.
--       Cabang SHARED (`is_resource_shared_with_me`) TIDAK di-scope:
--       berbagi eksplisit ke klien mengalahkan scope menurut desain,
--       portal tetap jalan. Campaigns sendiri TIDAK di-scope (wadah;
--       tautan brand + deliverable-nya yang ter-scope).
--
-- YANG TIDAK DI-SCOPE (dicatat jujur, ADR-0011 §2): tasks, checklist,
-- assets, comments, notifications — artefak produksi workspace-level;
-- tautan induknya (content item) yang ter-scope. Bila Tuan menghendaki
-- scope penuh sampai task, itu pekerjaan lanjutan.
--
-- TIDAK ADA data yang diubah (brand_scope live saat ini semuanya NULL —
-- seed tidak mengisinya; CHECK baru lolos untuk semua baris lama).
-- 0001–0015 TIDAK diubah. RLS adalah pertahanan terakhir; UI/server
-- action tetap memvalidasi scope lebih dulu (pesan jelas).
-- ============================================================================

-- --- (1) CHECK bentuk brand_scope -------------------------------------------
alter table public.workspace_members
  add constraint workspace_members_brand_scope_check
  check (brand_scope is null or jsonb_typeof(brand_scope) = 'array');

-- --- (2) Helper baru: apakah brand ini dalam cakupan pemanggil ---------------
create or replace function public.brand_in_scope(p_brand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_brand_id is null then true
    else exists (
      select 1
      from public.brands b
      join public.workspace_members wm
        on wm.workspace_id = b.workspace_id
       and wm.user_id = auth.uid()
       and wm.membership_status = 'active'
      where b.id = p_brand_id
        and (
          wm.brand_scope is null
          or p_brand_id = any (
            select x::uuid
            from jsonb_array_elements_text(
              case when jsonb_typeof(wm.brand_scope) = 'array'
                then wm.brand_scope else '[]'::jsonb end
            ) as x
            where x ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          )
        )
    )
  end;
$$;

comment on function public.brand_in_scope(uuid) is 'Helper RLS anti-rekursi (0016, P1-A7): apakah brand ini dalam brand_scope pemanggil (NULL = semua brand; array UUID = hanya brand itu; bukan member / brand tak dikenal = false). SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- --- (3) Helper ditulis ulang: is_brand_member (+ scope) ---------------------
-- Channels ikut ter-scope tanpa ubah policy (semua policy channel memakai
-- helper ini). Perilaku lain tidak berubah.
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
      and public.brand_in_scope(p_brand_id)
  );
$$;

comment on function public.is_brand_member(uuid, text[]) is 'Helper RLS anti-rekursi (0007, diubah 0016): apakah pemanggil member aktif workspace pemilik brand + brand dalam scope-nya (P1-A7). SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- --- (4) Helper ditulis ulang: is_content_item_member (+ scope) ---------------
-- Placements + versions + content_assets ikut ter-scope lewat
-- can_read/can_edit_content_item (0007) dan policy content_assets (0009).
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
      and public.brand_in_scope(ci.brand_id)
  );
$$;

comment on function public.is_content_item_member(uuid, text[]) is 'Helper RLS anti-rekursi (0007, diubah 0016): apakah pemanggil member aktif workspace pemilik content item + brand item dalam scope-nya (P1-A7). SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- --- (5) Helper ditulis ulang: can_read/can_edit_placement (+ scope) ---------
-- placement_versions ikut ter-scope; guard RPC 0008 (reschedule +
-- change_distribution) ikut menolak placement di luar scope.
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
      and public.brand_in_scope(ci.brand_id)
      and (
        public.is_ws_member(ci.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'approver', 'analyst'])
        or (
          public.is_ws_member(ci.workspace_id, array['creator', 'editor'])
          and ci.owner_user_id = auth.uid()
        )
      )
  );
$$;

comment on function public.can_read_placement(uuid) is 'Helper RLS anti-rekursi (0007, diubah 0016): apakah pemanggil boleh membaca placement ini (aturan baca item induknya + brand item dalam scope, P1-A7). SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

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
      and public.brand_in_scope(ci.brand_id)
      and (
        public.is_ws_member(ci.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
        or (
          public.is_ws_member(ci.workspace_id, array['creator', 'editor'])
          and ci.owner_user_id = auth.uid()
        )
      )
  );
$$;

comment on function public.can_edit_placement(uuid) is 'Helper RLS anti-rekursi (0007, diubah 0016): apakah pemanggil boleh mengedit placement ini (aturan edit item induknya + brand item dalam scope, P1-A7). SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- --- (6a) Policy ditulis ulang: brands (+ scope) -----------------------------
drop policy if exists "brands_select_member" on public.brands;
create policy "brands_select_member"
  on public.brands for select
  to authenticated
  using (
    public.is_ws_member(brands.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    and public.brand_in_scope(brands.id)
  );

drop policy if exists "brands_insert_owner_admin_manager" on public.brands;
create policy "brands_insert_owner_admin_manager"
  on public.brands for insert
  to authenticated
  with check (
    public.is_ws_member(brands.workspace_id, array['owner', 'admin', 'manager'])
    and public.brand_in_scope(brands.id)
  );

drop policy if exists "brands_update_owner_admin_manager" on public.brands;
create policy "brands_update_owner_admin_manager"
  on public.brands for update
  to authenticated
  using (
    public.is_ws_member(brands.workspace_id, array['owner', 'admin', 'manager'])
    and public.brand_in_scope(brands.id)
  )
  with check (
    public.is_ws_member(brands.workspace_id, array['owner', 'admin', 'manager'])
    and public.brand_in_scope(brands.id)
  );

-- --- (6b) Policy ditulis ulang: content_pillars (+ scope) --------------------
-- brand_id NULL (pilar tanpa brand) -> brand_in_scope(NULL) = true.
drop policy if exists "pillars_select_member" on public.content_pillars;
create policy "pillars_select_member"
  on public.content_pillars for select
  to authenticated
  using (
    public.is_ws_member(content_pillars.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    and public.brand_in_scope(content_pillars.brand_id)
  );

drop policy if exists "pillars_insert_planners" on public.content_pillars;
create policy "pillars_insert_planners"
  on public.content_pillars for insert
  to authenticated
  with check (
    public.is_ws_member(content_pillars.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    and public.brand_in_scope(content_pillars.brand_id)
  );

drop policy if exists "pillars_update_planners" on public.content_pillars;
create policy "pillars_update_planners"
  on public.content_pillars for update
  to authenticated
  using (
    public.is_ws_member(content_pillars.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    and public.brand_in_scope(content_pillars.brand_id)
  )
  with check (
    public.is_ws_member(content_pillars.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    and public.brand_in_scope(content_pillars.brand_id)
  );

-- --- (6c) Policy ditulis ulang: ideas (+ scope) ------------------------------
-- brand_id NULL (ide tanpa brand) -> brand_in_scope(NULL) = true.
drop policy if exists "ideas_select_member" on public.ideas;
create policy "ideas_select_member"
  on public.ideas for select
  to authenticated
  using (
    public.is_ws_member(ideas.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    and public.brand_in_scope(ideas.brand_id)
  );

drop policy if exists "ideas_insert_creators" on public.ideas;
create policy "ideas_insert_creators"
  on public.ideas for insert
  to authenticated
  with check (
    (
      public.is_ws_member(ideas.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
      and public.brand_in_scope(ideas.brand_id)
    )
    or (
      public.is_ws_member(ideas.workspace_id, array['creator', 'editor'])
      and ideas.owner_user_id = auth.uid()
      and public.brand_in_scope(ideas.brand_id)
    )
  );

drop policy if exists "ideas_update_creators" on public.ideas;
create policy "ideas_update_creators"
  on public.ideas for update
  to authenticated
  using (
    (
      public.is_ws_member(ideas.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
      and public.brand_in_scope(ideas.brand_id)
    )
    or (
      public.is_ws_member(ideas.workspace_id, array['creator', 'editor'])
      and ideas.owner_user_id = auth.uid()
      and public.brand_in_scope(ideas.brand_id)
    )
  )
  with check (
    (
      public.is_ws_member(ideas.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
      and public.brand_in_scope(ideas.brand_id)
    )
    or (
      public.is_ws_member(ideas.workspace_id, array['creator', 'editor'])
      and ideas.owner_user_id = auth.uid()
      and public.brand_in_scope(ideas.brand_id)
    )
  );

-- --- (6d) Policy ditulis ulang: content_items (+ scope) ----------------------
-- Cabang SHARED sengaja TIDAK di-scope (berbagi eksplisit mengalahkan scope).
-- brand_id di content_items NOT NULL, jadi tidak ada kasus NULL di sini.
drop policy if exists "items_select_member_or_shared" on public.content_items;
create policy "items_select_member_or_shared"
  on public.content_items for select
  to authenticated
  using (
    (
      public.is_ws_member(content_items.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'approver', 'analyst'])
      and public.brand_in_scope(content_items.brand_id)
    )
    or (
      public.is_ws_member(content_items.workspace_id, array['creator', 'editor'])
      and content_items.owner_user_id = auth.uid()
      and public.brand_in_scope(content_items.brand_id)
    )
    or public.is_resource_shared_with_me('content_item', content_items.id)
  );

drop policy if exists "items_insert_editors" on public.content_items;
create policy "items_insert_editors"
  on public.content_items for insert
  to authenticated
  with check (
    (
      public.is_ws_member(content_items.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
      and public.brand_in_scope(content_items.brand_id)
    )
    or (
      public.is_ws_member(content_items.workspace_id, array['creator', 'editor'])
      and content_items.owner_user_id = auth.uid()
      and public.brand_in_scope(content_items.brand_id)
    )
  );

drop policy if exists "items_update_editors" on public.content_items;
create policy "items_update_editors"
  on public.content_items for update
  to authenticated
  using (
    (
      public.is_ws_member(content_items.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
      and public.brand_in_scope(content_items.brand_id)
    )
    or (
      public.is_ws_member(content_items.workspace_id, array['creator', 'editor'])
      and content_items.owner_user_id = auth.uid()
      and public.brand_in_scope(content_items.brand_id)
    )
  )
  with check (
    (
      public.is_ws_member(content_items.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
      and public.brand_in_scope(content_items.brand_id)
    )
    or (
      public.is_ws_member(content_items.workspace_id, array['creator', 'editor'])
      and content_items.owner_user_id = auth.uid()
      and public.brand_in_scope(content_items.brand_id)
    )
  );

-- --- (6e) Policy ditulis ulang: campaign_brands (+ scope) --------------------
-- Campaign-nya sendiri tidak di-scope; tautan brand-nya yang di-scope.
-- Cabang SHARED sengaja TIDAK di-scope.
drop policy if exists "campaign_brands_select_member_or_shared" on public.campaign_brands;
create policy "campaign_brands_select_member_or_shared"
  on public.campaign_brands for select
  to authenticated
  using (
    (
      public.is_campaign_member(campaign_brands.campaign_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
      and public.brand_in_scope(campaign_brands.brand_id)
    )
    or public.is_resource_shared_with_me('campaign', campaign_brands.campaign_id)
  );

drop policy if exists "campaign_brands_insert_planners" on public.campaign_brands;
create policy "campaign_brands_insert_planners"
  on public.campaign_brands for insert
  to authenticated
  with check (
    public.is_campaign_member(campaign_brands.campaign_id, array['owner', 'admin', 'manager', 'strategist'])
    and public.brand_in_scope(campaign_brands.brand_id)
  );

drop policy if exists "campaign_brands_delete_planners" on public.campaign_brands;
create policy "campaign_brands_delete_planners"
  on public.campaign_brands for delete
  to authenticated
  using (
    public.is_campaign_member(campaign_brands.campaign_id, array['owner', 'admin', 'manager', 'strategist'])
    and public.brand_in_scope(campaign_brands.brand_id)
  );

-- --- (7) Grant helper baru + komentar -----------------------------------------
revoke all on function public.brand_in_scope(uuid) from public;
grant execute on function public.brand_in_scope(uuid) to authenticated;

comment on table public.workspace_members is 'Keanggotaan workspace + 9 role baseline. brand_scope DITEGAKKAN sejak 0016 (P1-A7, Keputusan #9): NULL = semua brand, array UUID = hanya brand itu.';
