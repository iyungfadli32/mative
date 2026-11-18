-- MaTive Phase 1 — Migrasi 0003: workspaces + workspace_members + settings + invitations
-- Dok 05 §3. 9 role baseline (Dok 06 §2) ditegakkan lewat CHECK constraint.
-- Undangan: berlaku 7 hari, bisa dicabut, satu kali pakai (P1-A5).
-- Token undangan disimpan sebagai HASH sha256 — JANGAN PERNAH simpan token mentah.
-- Brand scope BELUM ditegakkan sebagai filter terpisah (P1-A7): kolom
-- brand_scope dicatat untuk masa depan, belum dipakai policy.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  slug text not null,
  timezone text not null default 'Asia/Jakarta',
  default_locale text not null default 'id',
  settings_json jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

comment on table public.workspaces is 'Workspace = batas kerja tim dalam satu organisasi. slug unik per organisasi.';

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_role text not null check (workspace_role in (
    'owner', 'admin', 'manager', 'strategist', 'creator',
    'editor', 'approver', 'analyst', 'viewer_client'
  )),
  membership_status text not null default 'active'
    check (membership_status in ('active', 'invited', 'removed')),
  brand_scope jsonb,
  invited_by uuid references auth.users (id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

comment on table public.workspace_members is 'Keanggotaan workspace + 9 role baseline. brand_scope dicatat untuk masa depan (P1-A7), belum ditegakkan policy.';

create table if not exists public.workspace_settings (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null,
  value_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role text not null check (role in (
    'owner', 'admin', 'manager', 'strategist', 'creator',
    'editor', 'approver', 'analyst', 'viewer_client'
  )),
  token_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  invited_by uuid not null references auth.users (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, email, status)
);

comment on table public.workspace_invitations is 'Undangan workspace: 7 hari, satu kali pakai, bisa dicabut. token_hash = sha256(token); token mentah TIDAK PERNAH disimpan.';

create index if not exists idx_ws_members_user on public.workspace_members (user_id);
create index if not exists idx_ws_members_ws on public.workspace_members (workspace_id);
create index if not exists idx_ws_invitations_token on public.workspace_invitations (token_hash);
create index if not exists idx_ws_invitations_ws on public.workspace_invitations (workspace_id);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.workspace_invitations enable row level security;

revoke all on public.workspaces from anon, authenticated;
revoke all on public.workspace_members from anon, authenticated;
revoke all on public.workspace_settings from anon, authenticated;
revoke all on public.workspace_invitations from anon, authenticated;
grant select, insert, update on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.workspace_settings to authenticated;
grant select, insert, update on public.workspace_invitations to authenticated;

-- workspaces SELECT: member aktif workspace itu.
create policy "workspaces_select_member"
  on public.workspaces for select
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
    )
  );

-- workspaces INSERT: member aktif organisasi induk boleh membuat workspace.
create policy "workspaces_insert_org_member"
  on public.workspaces for insert
  to authenticated
  with check (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = workspaces.organization_id
        and om.user_id = auth.uid()
        and om.membership_status = 'active'
    )
  );

-- workspaces UPDATE: owner/admin workspace.
create policy "workspaces_update_owner_admin"
  on public.workspaces for update
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin')
    )
  );

create policy "workspaces_no_delete"
  on public.workspaces for delete to authenticated using (false);

-- workspace_members SELECT: member aktif workspace yang sama (atau dirinya sendiri).
create policy "ws_members_select_member"
  on public.workspace_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
    )
  );

-- workspace_members INSERT: (a) diri sendiri sebagai owner saat workspace baru
-- dibuat (pemanggil adalah member organisasi induk), atau (b) penerimaan
-- undangan — DILAKSANAKAN oleh fungsi accept_invitation() (security definer,
-- lihat bawah), BUKAN insert langsung; (c) owner/admin menambahkan member.
create policy "ws_members_insert_owner_admin_or_self"
  on public.workspace_members for insert
  to authenticated
  with check (
    (user_id = auth.uid() and exists (
      select 1 from public.workspaces w
      join public.organization_members om on om.organization_id = w.organization_id
      where w.id = workspace_members.workspace_id
        and om.user_id = auth.uid()
        and om.membership_status = 'active'
    ))
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin')
    )
  );

-- workspace_members UPDATE: hanya owner/admin. ANTI-TAMPERING (Dok 06 §8 tes 2):
-- member biasa TIDAK BISA mengubah workspace_role-nya sendiri.
create policy "ws_members_update_owner_admin"
  on public.workspace_members for update
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin')
    )
  );

-- workspace_members DELETE: hanya owner.
create policy "ws_members_delete_owner"
  on public.workspace_members for delete
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role = 'owner'
    )
  );

-- workspace_settings: baca oleh member; tulis hanya owner/admin.
create policy "ws_settings_select_member"
  on public.workspace_settings for select
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_settings.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
    )
  );
create policy "ws_settings_write_owner_admin"
  on public.workspace_settings for insert
  to authenticated
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_settings.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin')
    )
  );
create policy "ws_settings_update_owner_admin"
  on public.workspace_settings for update
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_settings.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin')
    )
  );
create policy "ws_settings_delete_owner_admin"
  on public.workspace_settings for delete
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_settings.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin')
    )
  );

-- workspace_invitations SELECT: owner/admin workspace (bukan sembarang member,
-- karena daftar undangan berisi email calon anggota).
create policy "ws_invitations_select_owner_admin"
  on public.workspace_invitations for select
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_invitations.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin')
    )
  );

-- workspace_invitations INSERT: hanya owner/admin.
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
  );

-- workspace_invitations UPDATE: hanya owner/admin (mencabut = status revoked).
-- Penerimaan undangan TIDAK lewat UPDATE langsung — lewat fungsi di bawah,
-- karena penerima belum menjadi member dan RLS akan menolaknya.
create policy "ws_invitations_update_owner_admin"
  on public.workspace_invitations for update
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_invitations.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin')
    )
  );

create policy "ws_invitations_no_delete"
  on public.workspace_invitations for delete to authenticated using (false);

-- ============================================================================
-- Fungsi accept_invitation(p_token_hash) — SECURITY DEFINER, ditinjau khusus.
-- Alasan: penerima undangan BELUM menjadi member, jadi RLS menolak SELECT
-- undangan + INSERT membership. Fungsi ini adalah SATU-SATUNYA jalan masuk.
-- Pengaman: (1) search_path dikunci; (2) hanya memeriksa hash, bukan token
-- mentah; (3) email pemanggil HARUS sama dengan email undangan (dari JWT);
-- (4) undangan harus pending + belum kedaluwarsa; (5) role diambil dari
-- undangan, BUKAN dari parameter pemanggil; (6) insert membership +
-- penanda accepted dalam SATU transaksi; (7) grant EXECUTE hanya ke
-- authenticated. Tinjau ulang fungsi ini sebelum perubahan apa pun.
-- ============================================================================
create or replace function public.accept_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.workspace_invitations%rowtype;
  v_email text;
begin
  v_email := lower((auth.jwt() ->> 'email')::text);
  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;

  select * into v_inv
  from public.workspace_invitations
  where token_hash = p_token_hash;

  if v_inv.id is null then
    return jsonb_build_object('ok', false, 'message', 'Undangan tidak ditemukan atau sudah tidak berlaku.');
  end if;
  if v_inv.status <> 'pending' then
    return jsonb_build_object('ok', false, 'message', 'Undangan ini sudah dipakai atau dicabut.');
  end if;
  if v_inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'message', 'Undangan sudah kedaluwarsa (7 hari).');
  end if;
  if lower(v_inv.email) <> v_email then
    return jsonb_build_object('ok', false, 'message', 'Undangan ini ditujukan ke email lain.');
  end if;

  insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, invited_by, joined_at)
  values (v_inv.workspace_id, auth.uid(), v_inv.role, 'active', v_inv.invited_by, now())
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
  set status = 'accepted'
  where id = v_inv.id;

  return jsonb_build_object('ok', true, 'message', 'Undangan diterima.', 'workspace_id', v_inv.workspace_id);
end;
$$;

comment on function public.accept_invitation(text) is 'Terima undangan workspace (SECURITY DEFINER, ditinjau — lihat komentar migrasi 0003). Satu-satunya jalan penerima yang belum member masuk ke workspace.';

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;
