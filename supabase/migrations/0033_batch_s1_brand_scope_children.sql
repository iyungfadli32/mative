-- 0033_batch_s1_brand_scope_children.sql
-- Batch S-1, temuan S-6: enforce brand scope on child tables.
--
-- Header 0016_brand_scope.sql (baris 41-45) mengakui tasks, checklist
-- items, assets, comments, notifications, dan campaigns BELUM di-scope:
-- policy SELECT mereka hanya memeriksa is_ws_member(). Migrasi ini
-- menutup celah itu. Satu-satunya kasus yang sengaja tetap tidak
-- di-scope adalah campaign tanpa brand yang tertaut: seperti content
-- item dengan brand_id NULL (brand_in_scope(NULL) = true, 0016),
-- campaign tanpa brand terlihat oleh semua anggota workspace, karena
-- batas brand ditegakkan pada deliverable-nya (content_items).
-- Campaign YANG memiliki brand tertaut di-scope ke brand-brand itu.
--
-- Semantik (mengikuti 0016):
--   * brand_in_scope(p_brand_id) menerima SATU argumen. Brand NULL =
--     terlihat oleh semua anggota (tidak ada brand yang bocor).
--   * Anggota dengan brand_scope = jsonb array hanya melihat baris yang
--     brand-nya ada di array itu, ditambah baris tanpa brand.
--   * Anggota dengan brand_scope NULL melihat semua brand.
--   * Cabang berbagi-klien (is_resource_shared_with_me,
--     is_asset_shared_with_me, is_comment_target_shared, dan cabang
--     komentar klien) TIDAK di-scope: klien yang diundang ke satu resource
--     tertentu tetap melihat resource itu apa pun brand-nya.
--   * Parent/target yang sudah terhapus (dangling) diselesaikan sebagai
--     terlihat: tidak ada brand yang tersisa untuk dibocorkan.
--
-- Tabel yang disentuh: campaigns (SELECT), tasks (SELECT/INSERT/UPDATE),
-- task_checklist_items (SELECT/INSERT/UPDATE/DELETE), assets (SELECT),
-- comments (SELECT/INSERT/UPDATE), notifications (SELECT/UPDATE).
-- INSERT/UPDATE/DELETE pada campaigns dan assets tidak berubah: campaign
-- belum punya brand saat insert (brand ditautkan sesudahnya lewat
-- campaign_brands, yang insert-nya sudah di-scope di 0016), dan asset
-- tidak punya atribusi brand saat ditulis.
--
-- Peran mengikuti definisi policy yang berlaku di live (0016, bukan 0009
-- asli): cabang manager [owner,admin,manager], cabang limited
-- [strategist,creator,editor,approver].

-- ---------------------------------------------------------------------
-- Helper: apakah campaign terlihat oleh pemanggil?
-- Terlihat bila campaign tidak punya brand tertaut, atau salah satu
-- brand yang tertaut ada dalam scope pemanggil.
-- ---------------------------------------------------------------------
create or replace function public.campaign_brand_in_scope(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
      select 1
      from public.campaign_brands cb
      where cb.campaign_id = p_campaign_id
    )
    or exists (
      select 1
      from public.campaign_brands cb
      where cb.campaign_id = p_campaign_id
        and public.brand_in_scope(cb.brand_id)
    );
$$;

revoke all on function public.campaign_brand_in_scope(uuid) from public;
grant execute on function public.campaign_brand_in_scope(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Helper: apakah parent sebuah task terlihat oleh pemanggil?
-- content_item -> brand_in_scope(brand_id); campaign ->
-- campaign_brand_in_scope; parent lain/tidak dikenal -> terlihat.
-- ---------------------------------------------------------------------
create or replace function public.task_brand_in_scope(p_parent_type text, p_parent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_parent_type = 'content_item' then public.brand_in_scope(
      (select ci.brand_id from public.content_items ci where ci.id = p_parent_id)
    )
    when p_parent_type = 'campaign' then public.campaign_brand_in_scope(p_parent_id)
    else true
  end;
$$;

revoke all on function public.task_brand_in_scope(text, uuid) from public;
grant execute on function public.task_brand_in_scope(text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Helper: apakah target sebuah comment terlihat oleh pemanggil?
-- Menelusuri rantai target (comment -> task -> content_item/campaign)
-- sampai ke brand, maksimal 10 langkah. Target yang tidak dikenal atau
-- rantai yang putus (baris induk terhapus) diselesaikan sebagai terlihat.
-- ---------------------------------------------------------------------
create or replace function public.comment_target_in_scope(p_target_type text, p_target_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text := p_target_type;
  v_id uuid := p_target_id;
  v_depth int := 0;
  v_parent_type text;
  v_parent_id uuid;
  v_brand_id uuid;
begin
  loop
    if v_depth >= 10 then
      return true;
    end if;
    v_depth := v_depth + 1;
    if v_type = 'content_item' then
      select brand_id into v_brand_id from public.content_items where id = v_id;
      if not found then
        return true;
      end if;
      return public.brand_in_scope(v_brand_id);
    elsif v_type = 'campaign' then
      return public.campaign_brand_in_scope(v_id);
    elsif v_type = 'task' then
      select parent_type, parent_id into v_parent_type, v_parent_id
      from public.tasks where id = v_id;
      if not found then
        return true;
      end if;
      v_type := v_parent_type;
      v_id := v_parent_id;
    elsif v_type = 'comment' then
      select target_type, target_id into v_parent_type, v_parent_id
      from public.comments where id = v_id;
      if not found then
        return true;
      end if;
      v_type := v_parent_type;
      v_id := v_parent_id;
    else
      return true;
    end if;
  end loop;
end;
$$;

revoke all on function public.comment_target_in_scope(text, uuid) from public;
grant execute on function public.comment_target_in_scope(text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Helper: apakah asset terlihat oleh pemanggil?
-- Terlihat bila asset tidak tertaut ke content item mana pun, atau salah
-- satu content item yang tertaut brand-nya ada dalam scope pemanggil.
-- ---------------------------------------------------------------------
create or replace function public.asset_brand_in_scope(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
      select 1
      from public.content_assets ca
      where ca.asset_id = p_asset_id
    )
    or exists (
      select 1
      from public.content_assets ca
      join public.content_items ci on ci.id = ca.content_item_id
      where ca.asset_id = p_asset_id
        and public.brand_in_scope(ci.brand_id)
    );
$$;

revoke all on function public.asset_brand_in_scope(uuid) from public;
grant execute on function public.asset_brand_in_scope(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Helper: apakah task pemilik sebuah checklist item terlihat?
-- Task yang tidak ditemukan mengembalikan NULL (fail closed: checklist
-- item yang task-nya sudah terhapus menjadi tidak terlihat).
-- ---------------------------------------------------------------------
create or replace function public.task_id_brand_in_scope(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.task_brand_in_scope(t.parent_type, t.parent_id)
  from public.tasks t
  where t.id = p_task_id;
$$;

revoke all on function public.task_id_brand_in_scope(uuid) from public;
grant execute on function public.task_id_brand_in_scope(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Campaigns: cabang member pada SELECT di-scope ke brand campaign.
-- Cabang berbagi-klien tidak berubah.
-- Nama policy + array peran mengikuti definisi yang berlaku di live
-- (peran berupa text[], bukan enum workspace_role).
-- ---------------------------------------------------------------------
drop policy if exists campaigns_select_member_or_shared on public.campaigns;
create policy campaigns_select_member_or_shared
  on public.campaigns for select
  using (
    (
      public.is_ws_member(workspace_id, array['owner','admin','manager','strategist','creator','editor','approver','analyst'])
      and public.campaign_brand_in_scope(id)
    )
    or public.is_resource_shared_with_me('campaign', id)
  );

-- ---------------------------------------------------------------------
-- Tasks: cabang member pada SELECT/INSERT/UPDATE di-scope ke brand
-- parent (content_item atau campaign). Cabang berbagi-klien tidak berubah.
-- ---------------------------------------------------------------------
drop policy if exists tasks_select_member_or_shared on public.tasks;
create policy tasks_select_member_or_shared
  on public.tasks for select
  using (
    (
      public.is_ws_member(workspace_id, array['owner','admin','manager','strategist','creator','editor','approver','analyst'])
      and public.task_brand_in_scope(parent_type, parent_id)
    )
    or public.is_resource_shared_with_me(parent_type, parent_id)
  );

drop policy if exists tasks_insert_managers_or_self_assigned on public.tasks;
create policy tasks_insert_managers_or_self_assigned
  on public.tasks for insert
  with check (
    (
      public.is_ws_member(workspace_id, array['owner','admin','manager'])
      and public.task_brand_in_scope(parent_type, parent_id)
    )
    or (
      public.is_ws_member(workspace_id, array['strategist','creator','editor','approver'])
      and public.task_brand_in_scope(parent_type, parent_id)
      and (assignee_user_id is null or assignee_user_id = auth.uid())
    )
  );

drop policy if exists tasks_update_managers_or_assignee on public.tasks;
create policy tasks_update_managers_or_assignee
  on public.tasks for update
  using (
    (
      public.is_ws_member(workspace_id, array['owner','admin','manager'])
      and public.task_brand_in_scope(parent_type, parent_id)
    )
    or (
      public.is_ws_member(workspace_id, array['strategist','creator','editor','approver'])
      and public.task_brand_in_scope(parent_type, parent_id)
      and assignee_user_id = auth.uid()
    )
  )
  with check (
    (
      public.is_ws_member(workspace_id, array['owner','admin','manager'])
      and public.task_brand_in_scope(parent_type, parent_id)
    )
    or (
      public.is_ws_member(workspace_id, array['strategist','creator','editor','approver'])
      and public.task_brand_in_scope(parent_type, parent_id)
      and assignee_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- Task checklist items: cabang member di-scope lewat brand task induk.
-- Cabang berbagi-klien (is_task_shared_with_me) tidak berubah.
-- ---------------------------------------------------------------------
drop policy if exists checklist_select_member_or_shared on public.task_checklist_items;
create policy checklist_select_member_or_shared
  on public.task_checklist_items for select
  using (
    (
      public.is_task_member(task_id, array['owner','admin','manager','strategist','creator','editor','approver','analyst'])
      and public.task_id_brand_in_scope(task_id)
    )
    or public.is_task_shared_with_me(task_id)
  );

drop policy if exists checklist_insert_managers_or_assignee on public.task_checklist_items;
create policy checklist_insert_managers_or_assignee
  on public.task_checklist_items for insert
  with check (
    (
      public.is_task_member(task_id, array['owner','admin','manager'])
      and public.task_id_brand_in_scope(task_id)
    )
    or (
      public.is_task_member(task_id, array['strategist','creator','editor','approver'])
      and public.task_id_brand_in_scope(task_id)
      and public.is_task_assignee(task_id)
    )
  );

drop policy if exists checklist_update_managers_or_assignee on public.task_checklist_items;
create policy checklist_update_managers_or_assignee
  on public.task_checklist_items for update
  using (
    (
      public.is_task_member(task_id, array['owner','admin','manager'])
      and public.task_id_brand_in_scope(task_id)
    )
    or (
      public.is_task_member(task_id, array['strategist','creator','editor','approver'])
      and public.task_id_brand_in_scope(task_id)
      and public.is_task_assignee(task_id)
    )
  )
  with check (
    (
      public.is_task_member(task_id, array['owner','admin','manager'])
      and public.task_id_brand_in_scope(task_id)
    )
    or (
      public.is_task_member(task_id, array['strategist','creator','editor','approver'])
      and public.task_id_brand_in_scope(task_id)
      and public.is_task_assignee(task_id)
    )
  );

drop policy if exists checklist_delete_managers_or_assignee on public.task_checklist_items;
create policy checklist_delete_managers_or_assignee
  on public.task_checklist_items for delete
  using (
    (
      public.is_task_member(task_id, array['owner','admin','manager'])
      and public.task_id_brand_in_scope(task_id)
    )
    or (
      public.is_task_member(task_id, array['strategist','creator','editor','approver'])
      and public.task_id_brand_in_scope(task_id)
      and public.is_task_assignee(task_id)
    )
  );

-- ---------------------------------------------------------------------
-- Assets: cabang member pada SELECT di-scope ke brand content item yang
-- tertaut (asset tanpa tautan tetap terlihat). Cabang berbagi-klien
-- tidak berubah. INSERT/UPDATE/DELETE tidak berubah: asset belum punya
-- atribusi brand saat ditulis.
-- ---------------------------------------------------------------------
drop policy if exists assets_select_member_or_shared on public.assets;
create policy assets_select_member_or_shared
  on public.assets for select
  using (
    (
      public.is_ws_member(workspace_id, array['owner','admin','manager','strategist','creator','editor','approver','analyst'])
      and public.asset_brand_in_scope(id)
    )
    or public.is_asset_shared_with_me(id)
  );

-- ---------------------------------------------------------------------
-- Comments: cabang member pada SELECT/INSERT/UPDATE di-scope ke brand
-- target (content_item/campaign/task, menelusuri rantai). Cabang
-- berbagi-klien dan cabang komentar klien tidak berubah.
-- ---------------------------------------------------------------------
drop policy if exists comments_select_member_or_shared on public.comments;
create policy comments_select_member_or_shared
  on public.comments for select
  using (
    (
      public.is_ws_member(workspace_id, array['owner','admin','manager','strategist','creator','editor','approver','analyst'])
      and public.comment_target_in_scope(target_type, target_id)
    )
    or public.is_comment_target_shared(target_type, target_id)
  );

drop policy if exists comments_insert_members_or_allowed_client on public.comments;
create policy comments_insert_members_or_allowed_client
  on public.comments for insert
  with check (
    (
      public.is_ws_member(workspace_id, array['owner','admin','manager','strategist','creator','editor','approver'])
      and author_user_id = auth.uid()
      and public.comment_target_in_scope(target_type, target_id)
    )
    or (
      public.is_comment_target_shared(target_type, target_id)
      and public.is_client_comment_allowed(workspace_id)
      and author_user_id = auth.uid()
    )
  );

drop policy if exists comments_update_author_not_deleted on public.comments;
create policy comments_update_author_not_deleted
  on public.comments for update
  using (
    author_user_id = auth.uid()
    and deleted_at is null
    and public.comment_target_in_scope(target_type, target_id)
  )
  with check (
    author_user_id = auth.uid()
    and public.comment_target_in_scope(target_type, target_id)
  );

-- ---------------------------------------------------------------------
-- Notifications: penerima hanya melihat notifikasi yang target-nya ada
-- dalam brand scope-nya. Target non-konten (mis. undangan) tidak punya
-- brand sehingga tetap terlihat. Batas tamper (hanya read_at/updated_at
-- yang boleh berubah) tidak berubah.
-- ---------------------------------------------------------------------
drop policy if exists notifications_select_recipient on public.notifications;
create policy notifications_select_recipient
  on public.notifications for select
  using (
    recipient_user_id = auth.uid()
    and public.comment_target_in_scope(target_type, target_id)
  );

drop policy if exists notifications_update_recipient on public.notifications;
create policy notifications_update_recipient
  on public.notifications for update
  using (
    recipient_user_id = auth.uid()
    and public.comment_target_in_scope(target_type, target_id)
  )
  with check (
    recipient_user_id = auth.uid()
    and public.comment_target_in_scope(target_type, target_id)
    and (
      read_at is null
      or read_at is not distinct from (
        select read_at from public.notifications where id = notifications.id
      )
    )
  );
