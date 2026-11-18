-- MaTive Phase 1 — Migrasi 0005: resource_shares (portal klien, P1-16)
-- Keputusan #12: viewer_client HANYA membaca resource yang dibagikan eksplisit.
-- Penegakan: server + RLS di sini. Daftar share dicatat di audit (trigger).
-- viewer_client TIDAK BISA mutasi apa pun: tidak ada policy INSERT/UPDATE/
-- DELETE yang mengizinkan viewer_client; share hanya dibuat/dicabut oleh
-- owner/admin/manager workspace pemilik resource.
-- Komentar klien default TIDAK BOLEH — tidak ada tabel/endpoint komentar klien
-- di fase ini (baru Phase 4 bila workspace mengizinkan eksplisit).

create table if not exists public.resource_shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  resource_type text not null check (resource_type in ('content_item', 'campaign')),
  resource_id uuid not null,
  shared_with_user_id uuid not null references auth.users (id) on delete cascade,
  shared_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (resource_type, resource_id, shared_with_user_id)
);

comment on table public.resource_shares is 'Portal klien (P1-16): resource yang dibagikan eksplisit ke viewer_client. Satu share = satu resource + satu klien.';

create index if not exists idx_shares_recipient on public.resource_shares (shared_with_user_id);
create index if not exists idx_shares_resource on public.resource_shares (resource_type, resource_id);
create index if not exists idx_shares_ws on public.resource_shares (workspace_id);

alter table public.resource_shares enable row level security;

revoke all on public.resource_shares from anon, authenticated;
grant select, insert, delete on public.resource_shares to authenticated;

-- SELECT: (a) klien penerima share itu sendiri, atau (b) member aktif
-- workspace pemilik share. Klien TIDAK bisa menebak UUID share/resource
-- lain: policy menolak bila shared_with_user_id <> auth.uid() dan pemanggil
-- bukan member workspace itu.
create policy "shares_select_recipient_or_member"
  on public.resource_shares for select
  to authenticated
  using (
    shared_with_user_id = auth.uid()
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = resource_shares.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
    )
  );

-- INSERT: hanya owner/admin/manager workspace pemilik share.
create policy "shares_insert_owner_admin_manager"
  on public.resource_shares for insert
  to authenticated
  with check (
    shared_by = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = resource_shares.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin', 'manager')
    )
  );

-- UPDATE: tidak diizinkan (share diubah dengan hapus + buat baru, keduanya tercatat).
create policy "shares_no_update"
  on public.resource_shares for update to authenticated using (false);

-- DELETE (cabut share): hanya owner/admin/manager workspace pemilik share.
create policy "shares_delete_owner_admin_manager"
  on public.resource_shares for delete
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = resource_shares.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
        and wm.workspace_role in ('owner', 'admin', 'manager')
    )
  );

-- ============================================================================
-- Trigger audit: setiap share/unshare dicatat ke activity_logs.
-- Trigger function berjalan sebagai pemilik tabel (bypass RLS) — ini pola
-- normal untuk audit; fungsinya HANYA insert ke activity_logs, tidak
-- membaca/mengubah data lain. actor = auth.uid() saat aksi terjadi.
-- ============================================================================
create or replace function public.audit_resource_share()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs
      (workspace_id, actor_user_id, entity_type, entity_id, action, after_snapshot)
    values
      (new.workspace_id, auth.uid(), 'resource_share', new.id, 'share_created',
       jsonb_build_object('resource_type', new.resource_type, 'resource_id', new.resource_id, 'shared_with_user_id', new.shared_with_user_id));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.activity_logs
      (workspace_id, actor_user_id, entity_type, entity_id, action, before_snapshot)
    values
      (old.workspace_id, auth.uid(), 'resource_share', old.id, 'share_revoked',
       jsonb_build_object('resource_type', old.resource_type, 'resource_id', old.resource_id, 'shared_with_user_id', old.shared_with_user_id));
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_resource_share() is 'Trigger audit share/unshare portal klien ke activity_logs (P1-16). Hanya INSERT audit; tidak membaca data lain.';

drop trigger if exists trg_audit_resource_share on public.resource_shares;
create trigger trg_audit_resource_share
  after insert or delete on public.resource_shares
  for each row execute function public.audit_resource_share();
