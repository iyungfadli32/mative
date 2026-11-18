-- MaTive Phase 1 — Migrasi 0004: activity_logs (audit append-only)
-- Dok 05 §3 + Dok 06 §7: setiap perubahan state dicatat sebagai event + audit
-- dalam satu transaksi. Append-only: TIDAK ADA update/delete lewat API.
-- JANGAN PERNAH menulis token rahasia / API key / header secret ke log.

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (workspace_id is not null or organization_id is not null)
);

comment on table public.activity_logs is 'Audit trail append-only. Satu baris workspace_id atau organization_id wajib terisi (tenant scope). Tanpa token rahasia.';

create index if not exists idx_activity_ws on public.activity_logs (workspace_id, created_at desc);
create index if not exists idx_activity_actor on public.activity_logs (actor_user_id, created_at desc);
create index if not exists idx_activity_entity on public.activity_logs (entity_type, entity_id);

alter table public.activity_logs enable row level security;

revoke all on public.activity_logs from anon, authenticated;
grant select, insert on public.activity_logs to authenticated;

-- SELECT: member aktif workspace (atau member organisasi bila log tingkat organisasi).
create policy "activity_select_member"
  on public.activity_logs for select
  to authenticated
  using (
    (workspace_id is not null and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = activity_logs.workspace_id
        and wm.user_id = auth.uid()
        and wm.membership_status = 'active'
    ))
    or (workspace_id is null and organization_id is not null and exists (
      select 1 from public.organization_members om
      where om.organization_id = activity_logs.organization_id
        and om.user_id = auth.uid()
        and om.membership_status = 'active'
    ))
  );

-- INSERT: hanya bila actor = pemanggil DAN pemanggil member aktif tenant terkait.
-- Server action/trigger yang menulis log harus mengisi actor_user_id = auth.uid().
create policy "activity_insert_member_as_actor"
  on public.activity_logs for insert
  to authenticated
  with check (
    actor_user_id = auth.uid()
    and (
      (workspace_id is not null and exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = activity_logs.workspace_id
          and wm.user_id = auth.uid()
          and wm.membership_status = 'active'
      ))
      or (workspace_id is null and organization_id is not null and exists (
        select 1 from public.organization_members om
        where om.organization_id = activity_logs.organization_id
          and om.user_id = auth.uid()
          and om.membership_status = 'active'
      ))
    )
  );

create policy "activity_no_update"
  on public.activity_logs for update to authenticated using (false);

create policy "activity_no_delete"
  on public.activity_logs for delete to authenticated using (false);
