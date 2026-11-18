-- MaTive Phase 1 — Migrasi 0006: perbaikan rekursi policy RLS
-- ============================================================================
-- DEFECT (terbukti di Supabase live 2026-11-19 03:51 WIB, pgTAP 0/14):
--   ERROR: 42P17: infinite recursion detected in policy for relation
--   "workspace_members" — tes berhenti di T1 saat SELECT dari workspaces.
--
-- AKAR MASALAH (audit lengkap di docs/rls-recursion-fix-0006.md):
--   4 siklus di graf dependensi policy (0001–0005):
--   (A) workspace_members -> workspace_members (self-loop; 4 policy)
--   (B) organization_members -> organization_members (self-loop; 4 policy)
--   (C) organization_members -> organizations -> organization_members
--   (D) workspace_members -> workspaces -> workspace_members
--   Setiap policy yang merujuk workspace_members / organization_members
--   (profiles, workspace_settings, workspace_invitations, activity_logs,
--   resource_shares, workspaces) ikut memicu siklus di atas.
--
-- PERBAIKAN (pola standar Supabase, tanpa mengubah semantik keamanan):
--   5 fungsi helper SECURITY DEFINER di bawah. Fungsi SECURITY DEFINER
--   TIDAK PERNAH di-inline oleh planner dan dieksekusi sebagai pemilik
--   fungsi (postgres — bypass RLS), sehingga pembacaan membership di dalam
--   fungsi TIDAK memicu evaluasi policy lagi: siklus terputus di sini.
--   Policy-policy yang rekursif ditulis ulang agar MEMANGGIL helper,
--   bukan subquery langsung ke tabel yang dilindungi RLS.
--   SEMANTIK IDENTIK: siapa boleh baca/tulis apa TIDAK BERUBAH — hanya
--   mekanisme pengecekannya yang tidak rekursif. Setiap policy lama yang
--   diganti di-DROP dulu (DROP POLICY IF EXISTS) agar migrasi ini
--   idempotent dan aman diterapkan di atas 0001–0005 yang sudah jalan.
--
-- PENGAMAN HELPER (jangan dilonggarkan):
--   (1) search_path dikunci (public, pg_temp) + semua objek di-qualify
--       skema; (2) helper hanya mengembalikan BOOLEAN tentang keanggotaan
--       pemanggil sendiri (auth.uid()) — TIDAK PERNAH mengembalikan baris
--       atau data pengguna lain; (3) tanpa dynamic SQL; (4) grant EXECUTE
--       hanya ke authenticated; (5) STABLE (hanya baca, tidak mutasi).
--   JANGAN ubah helper ini menjadi SECURITY INVOKER — rekursi akan kembali.
--
-- TIDAK DIUBAH: 11 policy tanpa referensi tabel (auth.uid()/false saja)
--   tetap seperti semula: profiles_insert_own, profiles_update_own,
--   profiles_no_delete, organizations_insert_owner, organizations_update_owner,
--   organizations_no_delete, workspaces_no_delete, ws_invitations_no_delete,
--   activity_no_update, activity_no_delete, shares_no_update.
--   Fungsi accept_invitation() (0003) dan trigger audit_resource_share
--   (0005) juga TIDAK disentuh.
-- ============================================================================

-- ============================================================================
-- BAGIAN 1 — Fungsi helper SECURITY DEFINER
-- ============================================================================

-- Apakah pemanggil member AKTIF organisasi ini (opsional: filter role).
-- Menggantikan: exists (select 1 from organization_members om where
--   om.organization_id = <org> and om.user_id = auth.uid()
--   and om.membership_status = 'active' [and om.organization_role in (...)]).
create or replace function public.is_org_member(p_org_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_org_id
      and om.user_id = auth.uid()
      and om.membership_status = 'active'
      and (p_roles is null or om.organization_role = any (p_roles))
  );
$$;

comment on function public.is_org_member(uuid, text[]) is
  'Helper RLS anti-rekursi (0006): apakah pemanggil member aktif organisasi. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil adalah owner organisasi (organizations.owner_user_id).
-- Menggantikan: exists (select 1 from organizations o where
--   o.id = <org> and o.owner_user_id = auth.uid()).
create or replace function public.is_org_owner(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = p_org_id
      and o.owner_user_id = auth.uid()
  );
$$;

comment on function public.is_org_owner(uuid) is
  'Helper RLS anti-rekursi (0006): apakah pemanggil owner organisasi. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil member AKTIF workspace ini (opsional: filter role).
-- Menggantikan: exists (select 1 from workspace_members wm where
--   wm.workspace_id = <ws> and wm.user_id = auth.uid()
--   and wm.membership_status = 'active' [and wm.workspace_role in (...)]).
create or replace function public.is_ws_member(p_ws_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_ws_id
      and wm.user_id = auth.uid()
      and wm.membership_status = 'active'
      and (p_roles is null or wm.workspace_role = any (p_roles))
  );
$$;

comment on function public.is_ws_member(uuid, text[]) is
  'Helper RLS anti-rekursi (0006): apakah pemanggil member aktif workspace. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil member AKTIF organisasi induk dari workspace ini.
-- Menggantikan: exists (select 1 from workspaces w
--   join organization_members om on om.organization_id = w.organization_id
--   where w.id = <ws> and om.user_id = auth.uid()
--   and om.membership_status = 'active').
create or replace function public.is_org_member_of_workspace(p_ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.organization_members om
      on om.organization_id = w.organization_id
    where w.id = p_ws_id
      and om.user_id = auth.uid()
      and om.membership_status = 'active'
  );
$$;

comment on function public.is_org_member_of_workspace(uuid) is
  'Helper RLS anti-rekursi (0006): apakah pemanggil member aktif organisasi induk workspace. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Apakah pemanggil berbagi workspace AKTIF dengan pengguna lain.
-- Menggantikan subquery self-join di profiles_select_own_or_same_workspace:
--   exists (select 1 from workspace_members wm_self
--     join workspace_members wm_other
--       on wm_other.workspace_id = wm_self.workspace_id
--     where wm_self.user_id = auth.uid() and wm_self.membership_status = 'active'
--       and wm_other.user_id = <profil> and wm_other.membership_status = 'active').
create or replace function public.shares_workspace_with(p_other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members wm_self
    join public.workspace_members wm_other
      on wm_other.workspace_id = wm_self.workspace_id
    where wm_self.user_id = auth.uid()
      and wm_self.membership_status = 'active'
      and wm_other.user_id = p_other_user
      and wm_other.membership_status = 'active'
  );
$$;

comment on function public.shares_workspace_with(uuid) is
  'Helper RLS anti-rekursi (0006): apakah pemanggil berbagi workspace aktif dengan pengguna lain. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- Grant EXECUTE hanya ke authenticated (bukan public/anon).
revoke all on function public.is_org_member(uuid, text[]) from public;
revoke all on function public.is_org_owner(uuid) from public;
revoke all on function public.is_ws_member(uuid, text[]) from public;
revoke all on function public.is_org_member_of_workspace(uuid) from public;
revoke all on function public.shares_workspace_with(uuid) from public;
grant execute on function public.is_org_member(uuid, text[]) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;
grant execute on function public.is_ws_member(uuid, text[]) to authenticated;
grant execute on function public.is_org_member_of_workspace(uuid) to authenticated;
grant execute on function public.shares_workspace_with(uuid) to authenticated;

-- ============================================================================
-- BAGIAN 2 — Tulis ulang policy rekursif (DROP dulu, lalu CREATE).
-- Semantik IDENTIK dengan 0001–0005; hanya subquery tabel diganti helper.
-- ============================================================================

-- --- 0002: organizations -----------------------------------------------
-- organizations_select_member: owner, atau member aktif organisasi itu.
-- Alasan: subquery ke organization_members memicu siklus (B)/(C).
drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member"
  on public.organizations for select
  to authenticated
  using (
    owner_user_id = auth.uid()
    or public.is_org_member(organizations.id)
  );

-- --- 0002: organization_members ----------------------------------------
-- org_members_select_member: dirinya sendiri, atau member aktif org yang sama.
-- Alasan: SELF-LOOP langsung (siklus B) — policy merujuk tabelnya sendiri.
drop policy if exists "org_members_select_member" on public.organization_members;
create policy "org_members_select_member"
  on public.organization_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_org_member(organization_members.organization_id)
  );

-- org_members_insert_owner_or_admin: (a) diri sendiri sebagai owner saat
-- organisasi baru dibuat, atau (b) owner/admin organisasi menambahkan anggota.
-- Alasan: SELF-LOOP (siklus B) + subquery ke organizations memicu siklus (C).
drop policy if exists "org_members_insert_owner_or_admin" on public.organization_members;
create policy "org_members_insert_owner_or_admin"
  on public.organization_members for insert
  to authenticated
  with check (
    (user_id = auth.uid() and public.is_org_owner(organization_members.organization_id))
    or public.is_org_member(organization_members.organization_id, array['owner', 'admin'])
  );

-- org_members_update_owner_or_admin: hanya owner/admin organisasi.
-- Alasan: SELF-LOOP langsung (siklus B), di USING dan WITH CHECK.
drop policy if exists "org_members_update_owner_or_admin" on public.organization_members;
create policy "org_members_update_owner_or_admin"
  on public.organization_members for update
  to authenticated
  using (
    public.is_org_member(organization_members.organization_id, array['owner', 'admin'])
  )
  with check (
    public.is_org_member(organization_members.organization_id, array['owner', 'admin'])
  );

-- org_members_delete_owner: hanya owner.
-- Alasan: SELF-LOOP langsung (siklus B).
drop policy if exists "org_members_delete_owner" on public.organization_members;
create policy "org_members_delete_owner"
  on public.organization_members for delete
  to authenticated
  using (
    public.is_org_member(organization_members.organization_id, array['owner'])
  );

-- --- 0003: workspaces ----------------------------------------------------
-- workspaces_select_member: member aktif workspace itu.
-- Alasan: subquery ke workspace_members memicu siklus (A) — inilah jalur
-- yang meledak di T1 (SELECT workspaces -> policy workspace_members -> rekursi).
drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
  on public.workspaces for select
  to authenticated
  using (
    public.is_ws_member(workspaces.id)
  );

-- workspaces_insert_org_member: member aktif organisasi induk boleh membuat workspace.
-- Alasan: subquery ke organization_members memicu siklus (B).
drop policy if exists "workspaces_insert_org_member" on public.workspaces;
create policy "workspaces_insert_org_member"
  on public.workspaces for insert
  to authenticated
  with check (
    public.is_org_member(workspaces.organization_id)
  );

-- workspaces_update_owner_admin: owner/admin workspace.
-- Alasan: subquery ke workspace_members memicu siklus (A), di USING dan WITH CHECK.
drop policy if exists "workspaces_update_owner_admin" on public.workspaces;
create policy "workspaces_update_owner_admin"
  on public.workspaces for update
  to authenticated
  using (
    public.is_ws_member(workspaces.id, array['owner', 'admin'])
  )
  with check (
    public.is_ws_member(workspaces.id, array['owner', 'admin'])
  );

-- --- 0003: workspace_members ---------------------------------------------
-- ws_members_select_member: member aktif workspace yang sama (atau dirinya sendiri).
-- Alasan: SELF-LOOP langsung (siklus A) — policy merujuk tabelnya sendiri.
drop policy if exists "ws_members_select_member" on public.workspace_members;
create policy "ws_members_select_member"
  on public.workspace_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_ws_member(workspace_members.workspace_id)
  );

-- ws_members_insert_owner_admin_or_self: (a) diri sendiri sebagai owner saat
-- workspace baru dibuat (pemanggil member organisasi induk), atau
-- (b) owner/admin menambahkan member.
-- Alasan: SELF-LOOP (siklus A) + subquery ke workspaces memicu siklus (D)
-- + join ke organization_members memicu siklus (B).
drop policy if exists "ws_members_insert_owner_admin_or_self" on public.workspace_members;
create policy "ws_members_insert_owner_admin_or_self"
  on public.workspace_members for insert
  to authenticated
  with check (
    (user_id = auth.uid() and public.is_org_member_of_workspace(workspace_members.workspace_id))
    or public.is_ws_member(workspace_members.workspace_id, array['owner', 'admin'])
  );

-- ws_members_update_owner_admin: hanya owner/admin. ANTI-TAMPERING tetap berlaku.
-- Alasan: SELF-LOOP langsung (siklus A), di USING dan WITH CHECK.
drop policy if exists "ws_members_update_owner_admin" on public.workspace_members;
create policy "ws_members_update_owner_admin"
  on public.workspace_members for update
  to authenticated
  using (
    public.is_ws_member(workspace_members.workspace_id, array['owner', 'admin'])
  )
  with check (
    public.is_ws_member(workspace_members.workspace_id, array['owner', 'admin'])
  );

-- ws_members_delete_owner: hanya owner.
-- Alasan: SELF-LOOP langsung (siklus A).
drop policy if exists "ws_members_delete_owner" on public.workspace_members;
create policy "ws_members_delete_owner"
  on public.workspace_members for delete
  to authenticated
  using (
    public.is_ws_member(workspace_members.workspace_id, array['owner'])
  );

-- --- 0003: profiles (policy didefinisikan di 0003) ------------------------
-- profiles_select_own_or_same_workspace: profil sendiri, atau profil pengguna
-- yang berbagi workspace aktif dengan pemanggil.
-- Alasan: self-join workspace_members memicu siklus (A).
drop policy if exists "profiles_select_own_or_same_workspace" on public.profiles;
create policy "profiles_select_own_or_same_workspace"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or public.shares_workspace_with(profiles.id)
  );

-- --- 0003: workspace_settings ---------------------------------------------
-- Alasan keempat policy: subquery ke workspace_members memicu siklus (A).
drop policy if exists "ws_settings_select_member" on public.workspace_settings;
create policy "ws_settings_select_member"
  on public.workspace_settings for select
  to authenticated
  using (
    public.is_ws_member(workspace_settings.workspace_id)
  );

drop policy if exists "ws_settings_write_owner_admin" on public.workspace_settings;
create policy "ws_settings_write_owner_admin"
  on public.workspace_settings for insert
  to authenticated
  with check (
    public.is_ws_member(workspace_settings.workspace_id, array['owner', 'admin'])
  );

drop policy if exists "ws_settings_update_owner_admin" on public.workspace_settings;
create policy "ws_settings_update_owner_admin"
  on public.workspace_settings for update
  to authenticated
  using (
    public.is_ws_member(workspace_settings.workspace_id, array['owner', 'admin'])
  );

drop policy if exists "ws_settings_delete_owner_admin" on public.workspace_settings;
create policy "ws_settings_delete_owner_admin"
  on public.workspace_settings for delete
  to authenticated
  using (
    public.is_ws_member(workspace_settings.workspace_id, array['owner', 'admin'])
  );

-- --- 0003: workspace_invitations ------------------------------------------
-- Alasan ketiga policy: subquery ke workspace_members memicu siklus (A).
drop policy if exists "ws_invitations_select_owner_admin" on public.workspace_invitations;
create policy "ws_invitations_select_owner_admin"
  on public.workspace_invitations for select
  to authenticated
  using (
    public.is_ws_member(workspace_invitations.workspace_id, array['owner', 'admin'])
  );

drop policy if exists "ws_invitations_insert_owner_admin" on public.workspace_invitations;
create policy "ws_invitations_insert_owner_admin"
  on public.workspace_invitations for insert
  to authenticated
  with check (
    public.is_ws_member(workspace_invitations.workspace_id, array['owner', 'admin'])
  );

drop policy if exists "ws_invitations_update_owner_admin" on public.workspace_invitations;
create policy "ws_invitations_update_owner_admin"
  on public.workspace_invitations for update
  to authenticated
  using (
    public.is_ws_member(workspace_invitations.workspace_id, array['owner', 'admin'])
  );

-- --- 0004: activity_logs ---------------------------------------------------
-- activity_select_member: member aktif workspace (atau member organisasi
-- bila log tingkat organisasi).
-- Alasan: subquery ke workspace_members memicu siklus (A); subquery ke
-- organization_members memicu siklus (B).
drop policy if exists "activity_select_member" on public.activity_logs;
create policy "activity_select_member"
  on public.activity_logs for select
  to authenticated
  using (
    (workspace_id is not null and public.is_ws_member(activity_logs.workspace_id))
    or (workspace_id is null and organization_id is not null and public.is_org_member(activity_logs.organization_id))
  );

-- activity_insert_member_as_actor: actor = pemanggil DAN pemanggil member
-- aktif tenant terkait.
-- Alasan: sama seperti activity_select_member.
drop policy if exists "activity_insert_member_as_actor" on public.activity_logs;
create policy "activity_insert_member_as_actor"
  on public.activity_logs for insert
  to authenticated
  with check (
    actor_user_id = auth.uid()
    and (
      (workspace_id is not null and public.is_ws_member(activity_logs.workspace_id))
      or (workspace_id is null and organization_id is not null and public.is_org_member(activity_logs.organization_id))
    )
  );

-- --- 0005: resource_shares -------------------------------------------------
-- shares_select_recipient_or_member: klien penerima share itu sendiri,
-- atau member aktif workspace pemilik share.
-- Alasan: subquery ke workspace_members memicu siklus (A).
drop policy if exists "shares_select_recipient_or_member" on public.resource_shares;
create policy "shares_select_recipient_or_member"
  on public.resource_shares for select
  to authenticated
  using (
    shared_with_user_id = auth.uid()
    or public.is_ws_member(resource_shares.workspace_id)
  );

-- shares_insert_owner_admin_manager: hanya owner/admin/manager workspace
-- pemilik share; shared_by harus = pemanggil.
-- Alasan: subquery ke workspace_members memicu siklus (A).
drop policy if exists "shares_insert_owner_admin_manager" on public.resource_shares;
create policy "shares_insert_owner_admin_manager"
  on public.resource_shares for insert
  to authenticated
  with check (
    shared_by = auth.uid()
    and public.is_ws_member(resource_shares.workspace_id, array['owner', 'admin', 'manager'])
  );

-- shares_delete_owner_admin_manager: hanya owner/admin/manager workspace
-- pemilik share.
-- Alasan: subquery ke workspace_members memicu siklus (A).
drop policy if exists "shares_delete_owner_admin_manager" on public.resource_shares;
create policy "shares_delete_owner_admin_manager"
  on public.resource_shares for delete
  to authenticated
  using (
    public.is_ws_member(resource_shares.workspace_id, array['owner', 'admin', 'manager'])
  );

-- ============================================================================
-- CATATAN PENERAPAN (untuk koordinator — database live TIDAK disentuh dari VM):
--   Terapkan 0006 SETELAH 0001–0005, di database yang sama:
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0006_rls_recursion_fix.sql
--   atau: npx supabase db push   (dari folder repo mative/)
--   Lalu jalankan ulang pgTAP (14 tes, UUID uji sudah ada di live):
--     psql "$DATABASE_URL" -v user_a='094e8752-eef4-4f0e-b6ae-2d5813445018' \
--       -v user_b='aabb1dab-77c1-4659-af0e-c703c9de279c' \
--       -f supabase/tests/01_rls_phase1.sql
--   Ekspektasi: 14/14 ok, tanpa ERROR 42P17.
--   Verifikasi statis file ini (parse pglast + analisis graf) sudah dilakukan
--   di VM — lihat docs/rls-recursion-fix-0006.md. Uji terap ke database nyata
--   BELUM dilakukan dari VM ini (Postgres langsung diblokir) — wajib dijalankan
--   koordinator di atas sebelum Phase 1 dinyatakan selesai.
-- ============================================================================
