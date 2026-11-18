-- MaTive Phase 1 — Migrasi 0002: organizations + organization_members
-- Dok 05 §3. Organisasi = akun pelanggan/agensi. Satu user bisa jadi member
-- beberapa organisasi. RLS eksplisit per operasi; default deny.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  owner_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is 'Organisasi (customer/agency account). slug unik global.';

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_role text not null default 'member'
    check (organization_role in ('owner', 'admin', 'member')),
  membership_status text not null default 'active'
    check (membership_status in ('active', 'invited', 'removed')),
  invited_by uuid references auth.users (id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

comment on table public.organization_members is 'Keanggotaan organisasi. Role organisasi terpisah dari role workspace (9 role baseline ada di workspace_members).';

create index if not exists idx_org_members_user on public.organization_members (user_id);
create index if not exists idx_org_members_org on public.organization_members (organization_id);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

revoke all on public.organizations from anon, authenticated;
revoke all on public.organization_members from anon, authenticated;
grant select, insert, update on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;

-- organizations SELECT: owner, atau member aktif organisasi itu.
create policy "organizations_select_member"
  on public.organizations for select
  to authenticated
  using (
    owner_user_id = auth.uid()
    or exists (
      select 1 from public.organization_members om
      where om.organization_id = organizations.id
        and om.user_id = auth.uid()
        and om.membership_status = 'active'
    )
  );

-- organizations INSERT: pengguna terautentikasi boleh membuat organisasi
-- (dirinya menjadi owner_user_id; keanggotaan owner dibuat terpisah di bawah).
create policy "organizations_insert_owner"
  on public.organizations for insert
  to authenticated
  with check (owner_user_id = auth.uid());

-- organizations UPDATE: hanya owner.
create policy "organizations_update_owner"
  on public.organizations for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- organizations DELETE: tidak diizinkan lewat API.
create policy "organizations_no_delete"
  on public.organizations for delete
  to authenticated
  using (false);

-- organization_members SELECT: member aktif organisasi yang sama.
create policy "org_members_select_member"
  on public.organization_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_members.organization_id
        and om.user_id = auth.uid()
        and om.membership_status = 'active'
    )
  );

-- organization_members INSERT: (a) diri sendiri sebagai owner saat organisasi
-- baru dibuat (owner_user_id = pemanggil), atau (b) owner/admin organisasi
-- menambahkan anggota lain.
create policy "org_members_insert_owner_or_admin"
  on public.organization_members for insert
  to authenticated
  with check (
    (user_id = auth.uid() and exists (
      select 1 from public.organizations o
      where o.id = organization_members.organization_id
        and o.owner_user_id = auth.uid()
    ))
    or exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_members.organization_id
        and om.user_id = auth.uid()
        and om.membership_status = 'active'
        and om.organization_role in ('owner', 'admin')
    )
  );

-- organization_members UPDATE: hanya owner/admin organisasi.
-- ANTI-TAMPERING (Dok 06 §8 tes 2): user TIDAK BISA mengubah role-nya sendiri
-- lewat request body — policy ini menolak bila pemanggil bukan owner/admin,
-- dan kolom user_id/organization_id tidak boleh diubah menjadi milik orang lain
-- (with check memastikan baris hasil tetap dalam organisasi yang sama).
create policy "org_members_update_owner_or_admin"
  on public.organization_members for update
  to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_members.organization_id
        and om.user_id = auth.uid()
        and om.membership_status = 'active'
        and om.organization_role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_members.organization_id
        and om.user_id = auth.uid()
        and om.membership_status = 'active'
        and om.organization_role in ('owner', 'admin')
    )
  );

-- organization_members DELETE: hanya owner (penghapusan member = removed,
-- disarankan memakai UPDATE membership_status='removed'; DELETE tetap
-- dibatasi ke owner untuk kebersihan data bila diperlukan).
create policy "org_members_delete_owner"
  on public.organization_members for delete
  to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = organization_members.organization_id
        and om.user_id = auth.uid()
        and om.membership_status = 'active'
        and om.organization_role = 'owner'
    )
  );
