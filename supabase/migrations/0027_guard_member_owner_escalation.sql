-- 0027_guard_member_owner_escalation.sql
--
-- TEMUAN (audit Kritis-1, 2026-11-21 - diverifikasi di HEAD 474fa6d):
--   T-1  Admin workspace bisa menaikkan siapa pun (termasuk dirinya) menjadi
--        owner, menurunkan owner, dan menghapus owner lewat API langsung,
--        karena policy UPDATE/DELETE workspace_members hanya memeriksa role
--        pemanggil, tanpa memeriksa baris target (0006:314-332).
--   T-2  Admin organisasi bisa mempromosikan diri menjadi owner organisasi
--        dan mendemosi owner asli, karena policy INSERT/UPDATE
--        organization_members tidak membatasi role baris target
--        (0006:219-238).
--   T-3  Admin boleh mengundang anggota dengan role owner lewat jalur resmi,
--        karena inviteMemberAction hanya memeriksa canInvite(callerRole)
--        dan memakai role dari form apa adanya
--        (features/tenancy/actions.ts:165-224).
--
-- PERBAIKAN (Batch 1 Putaran Tinggi MaTive):
--   (a) Trigger BEFORE UPDATE / BEFORE DELETE pada workspace_members dan
--       organization_members yang membaca baris OLD/NEW:
--       - user_id dan workspace_id / organization_id tidak boleh berubah.
--       - Baris owner hanya boleh diubah/dihapus oleh owner itu sendiri
--         (workspace) atau oleh owner baris itu / owner organisasi
--         (organization_members; owner organisasi =
--         organizations.owner_user_id).
--       - Role dari/ke 'owner' hanya boleh diubah oleh owner (workspace:
--         anggota dengan role owner; organisasi: organizations.owner_user_id).
--       - Penolakan memakai ERRCODE '42501' supaya tampak seperti penolakan
--         RLS dan bisa ditangkap helper pgTAP yang sama (insufficient_privilege).
--   (b) Pengetatan policy INSERT (WITH CHECK boleh memeriksa role baris NEW
--       dan keanggotaan pemanggil; yang tidak bisa adalah self-lookup):
--       - ws_members_insert_owner_admin: admin tidak boleh menyisipkan
--         role 'owner' (hanya owner workspace yang boleh).
--       - org_members_insert_owner_or_admin: cabang admin tidak boleh
--         menyisipkan role 'owner' (cabang pembuat organisasi tidak berubah).
--       - ws_invitations_insert_owner_admin: role 'owner' hanya boleh
--         diundang oleh owner workspace.
--   (c) inviteMemberAction (aplikasi): tolak role 'owner' bila pemanggil
--       bukan owner - lihat features/tenancy/actions.ts.
--
-- ALUR NORMAL YANG TIDAK BOLEH RUSAK (diverifikasi sebelum menulis migrasi):
--   - create_workspace_with_owner() dan accept_invitation() adalah
--     SECURITY DEFINER dan hanya INSERT ke workspace_members, jadi tidak
--     tersentuh trigger UPDATE/DELETE ini dan melewati policy INSERT.
--   - Pembuatan organisasi menyisipkan baris owner lewat cabang (a) policy
--     org_members_insert_owner_or_admin (user_id = auth.uid() dan
--     is_org_owner) - cabang itu tidak diubah.
--   - Hapus workspace/organisasi: penghapusan berantai (ON DELETE CASCADE)
--     dilewatkan trigger DELETE karena baris induk sudah tidak ada saat
--     trigger berjalan; operasi service role / Auth admin (auth.uid() NULL)
--     juga dilewatkan.
--   - Tidak ada aksi aplikasi yang meng-UPDATE baris member (tidak ada
--     updateMemberRole); removeMemberAction hanya DELETE oleh owner.
--
-- CATATAN: file ini tidak membuat tabel baru dan tidak membuat policy baru
-- (hanya menulis ulang 3 policy INSERT + 4 fungsi trigger + 4 trigger),
-- jadi masuk exclusion list bentuk RLS di tests/migrations.test.ts.

-- ============================================================
-- Bagian 1 - Guard UPDATE/DELETE workspace_members (T-1)
-- ============================================================

create or replace function public.guard_workspace_member_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  -- Tanpa JWT (service role / SECURITY DEFINER / Auth admin): tidak ada
  -- pemanggil terautentikasi yang bisa menyalahgunakan; biarkan lewat.
  if v_caller is null then
    return new;
  end if;

  -- Kolom kunci tidak boleh berubah.
  if new.user_id is distinct from old.user_id
    or new.workspace_id is distinct from old.workspace_id
  then
    raise exception 'Perubahan user_id/workspace_id pada workspace_members tidak diizinkan.'
      using errcode = '42501';
  end if;

  -- Baris owner hanya boleh diubah oleh owner itu sendiri.
  if old.workspace_role = 'owner'
    and old.user_id is distinct from v_caller
  then
    raise exception 'Hanya owner yang bersangkutan yang boleh mengubah baris owner workspace.'
      using errcode = '42501';
  end if;

  -- Memberi role owner hanya boleh dilakukan oleh owner workspace.
  if new.workspace_role = 'owner'
    and old.workspace_role is distinct from 'owner'
    and not public.is_ws_member(old.workspace_id, array['owner'])
  then
    raise exception 'Hanya owner workspace yang boleh memberi role owner.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.guard_workspace_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return old;
  end if;

  -- Penghapusan berantai (hapus workspace): baris induk sudah tidak ada.
  if not exists (
    select 1 from public.workspaces where id = old.workspace_id
  ) then
    return old;
  end if;

  -- Baris owner hanya boleh dihapus oleh owner itu sendiri.
  if old.workspace_role = 'owner'
    and old.user_id is distinct from v_caller
  then
    raise exception 'Hanya owner yang bersangkutan yang boleh menghapus baris owner workspace.'
      using errcode = '42501';
  end if;

  return old;
end;
$$;

-- ============================================================
-- Bagian 2 - Guard UPDATE/DELETE organization_members (T-2)
-- ============================================================

create or replace function public.guard_organization_member_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org_owner uuid;
begin
  if v_caller is null then
    return new;
  end if;

  select owner_user_id into v_org_owner
  from public.organizations
  where id = old.organization_id;

  -- Kolom kunci tidak boleh berubah.
  if new.user_id is distinct from old.user_id
    or new.organization_id is distinct from old.organization_id
  then
    raise exception 'Perubahan user_id/organization_id pada organization_members tidak diizinkan.'
      using errcode = '42501';
  end if;

  -- Baris owner hanya boleh diubah oleh owner baris itu sendiri atau oleh
  -- owner organisasi (organizations.owner_user_id).
  if old.organization_role = 'owner'
    and old.user_id is distinct from v_caller
    and v_caller is distinct from v_org_owner
  then
    raise exception 'Hanya owner yang bersangkutan atau owner organisasi yang boleh mengubah baris owner organisasi.'
      using errcode = '42501';
  end if;

  -- Perubahan role dari/ke 'owner' hanya oleh owner organisasi.
  if (old.organization_role = 'owner' and new.organization_role is distinct from 'owner')
    or (old.organization_role is distinct from 'owner' and new.organization_role = 'owner')
  then
    if v_caller is distinct from v_org_owner then
      raise exception 'Hanya owner organisasi yang boleh mengubah role dari/ke owner.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.guard_organization_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_org_owner uuid;
begin
  if v_caller is null then
    return old;
  end if;

  -- Penghapusan berantai (hapus organisasi): baris induk sudah tidak ada.
  if not exists (
    select 1 from public.organizations where id = old.organization_id
  ) then
    return old;
  end if;

  select owner_user_id into v_org_owner
  from public.organizations
  where id = old.organization_id;

  -- Baris owner hanya boleh dihapus oleh owner baris itu sendiri atau oleh
  -- owner organisasi.
  if old.organization_role = 'owner'
    and old.user_id is distinct from v_caller
    and v_caller is distinct from v_org_owner
  then
    raise exception 'Hanya owner yang bersangkutan atau owner organisasi yang boleh menghapus baris owner organisasi.'
      using errcode = '42501';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_guard_ws_member_update on public.workspace_members;
create trigger trg_guard_ws_member_update
  before update on public.workspace_members
  for each row execute function public.guard_workspace_member_update();

drop trigger if exists trg_guard_ws_member_delete on public.workspace_members;
create trigger trg_guard_ws_member_delete
  before delete on public.workspace_members
  for each row execute function public.guard_workspace_member_delete();

drop trigger if exists trg_guard_org_member_update on public.organization_members;
create trigger trg_guard_org_member_update
  before update on public.organization_members
  for each row execute function public.guard_organization_member_update();

drop trigger if exists trg_guard_org_member_delete on public.organization_members;
create trigger trg_guard_org_member_delete
  before delete on public.organization_members
  for each row execute function public.guard_organization_member_delete();

-- ============================================================
-- Bagian 3 - Pengetatan policy INSERT (T-1/T-2/T-3)
-- ============================================================

-- (T-1) Admin workspace tidak boleh menyisipkan baris member dengan
-- role 'owner'. Jalur sah (create_workspace_with_owner dan
-- accept_invitation) adalah SECURITY DEFINER dan melewati policy ini.
drop policy if exists "ws_members_insert_owner_admin" on public.workspace_members;
create policy "ws_members_insert_owner_admin"
  on public.workspace_members for insert
  to authenticated
  with check (
    public.is_ws_member(workspace_id, array['owner', 'admin'])
    and (workspace_role <> 'owner' or public.is_ws_member(workspace_id, array['owner']))
  );

-- (T-2) Cabang admin pada org_members_insert_owner_or_admin tidak boleh
-- menyisipkan role 'owner'; cabang (a) pembuat organisasi tidak berubah.
drop policy if exists "org_members_insert_owner_or_admin" on public.organization_members;
create policy "org_members_insert_owner_or_admin"
  on public.organization_members for insert
  to authenticated
  with check (
    (user_id = auth.uid() and public.is_org_owner(organization_members.organization_id))
    or (
      public.is_org_member(organization_members.organization_id, array['owner', 'admin'])
      and (organization_members.organization_role <> 'owner' or public.is_org_member(organization_members.organization_id, array['owner']))
    )
  );

-- (T-3) Undangan dengan role 'owner' hanya boleh dibuat oleh owner
-- workspace. Penerimaan undangan tetap lewat accept_invitation()
-- (SECURITY DEFINER) dan tidak menyentuh tabel ini.
drop policy if exists "ws_invitations_insert_owner_admin" on public.workspace_invitations;
create policy "ws_invitations_insert_owner_admin"
  on public.workspace_invitations for insert
  to authenticated
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_invitations.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin')
    )
    and (workspace_invitations.role <> 'owner' or public.is_ws_member(workspace_invitations.workspace_id, array['owner']))
  );

-- ============================================================
-- Bagian 4 - Cabut grant default fungsi trigger
-- ============================================================
-- Fungsi trigger hanya dipanggil oleh trigger (bukan dipanggil langsung
-- oleh peran aplikasi); cabut akses default supaya tidak bisa dieksekusi
-- langsung oleh anon/authenticated. (Kebutuhan tes
-- tests/migrations.test.ts: setiap migrasi memuat "revoke all on".)
revoke all on function public.guard_workspace_member_update() from public;
revoke all on function public.guard_workspace_member_delete() from public;
revoke all on function public.guard_organization_member_update() from public;
revoke all on function public.guard_organization_member_delete() from public;
