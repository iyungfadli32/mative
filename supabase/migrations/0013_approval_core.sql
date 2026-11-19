-- MaTive Phase 4 — Review & Approval: migrasi 0013 (core)
-- ============================================================================
-- Tabel: approval_workflows, approval_steps, approval_requests,
--   approval_decisions (Dok 05 §3, ADR-0010, Keputusan #8).
-- Juga: perpanjangan CHECK notifications.type untuk tipe approval
--   (approval_requested / approval_decided / approval_reapproval_required).
-- TIDAK dibuat di sini: RPC transaksional + trigger critical-change +
--   guard transisi (migrasi 0014); TIDAK ADA publishing, integrasi,
--   analytics, AI, billing.
--
-- ATURAN KERAS (pelajaran Phase 1, 0006):
--   (a) TIDAK ADA policy yang merujuk tabelnya sendiri atau membentuk
--       siklus: semua pengecekan keanggotaan lewat helper 0006/0007 +
--       4 helper baru di bawah (STABLE, SECURITY DEFINER, search_path
--       terkunci, grant hanya ke authenticated, hanya boolean). Policy
--       TIDAK berisi FROM/JOIN ke tabel lain — graf dependensi asiklik
--       (terverifikasi statis; lihat docs/phase-4-report.md).
--   (b) Keputusan append-only: TIDAK ADA policy UPDATE/DELETE pada
--       approval_decisions; trigger (0013) menolak UPDATE langsung.
--       DELETE lewat RLS ditolak eksplisit (using false) — penghapusan
--       hanya lewat CASCADE saat workspace/request induk dihapus, agar
--       cleanup data uji + hapus workspace tidak macet (pelajaran
--       P0001 template default, Phase 3).
--   (c) TIDAK ADA INSERT/UPDATE langsung pada approval_requests lewat
--       RLS — satu-satunya jalan sah adalah RPC 0014 (SECURITY DEFINER).
--       Grant pada requests/decisions hanya SELECT (tulis diblokir di
--       lapisan grant sebelum RLS).
--   (d) TIDAK ADA status approval yang diterima dari client — status
--       hanya berubah lewat RPC 0014 + trigger reapproval.
-- ============================================================================

-- --- approval_workflows ------------------------------------------------------
-- Dok 05 §3: workspace_id, name, applies_to, is_default, config.
-- applies_to/config disederhanakan: workflow default MVP (1 step, 1
-- approver — ASUMSI-4.4) dibuat LAZY oleh RPC 0014 bila belum ada.
-- Satu workflow default per workspace (partial unique index).
create table if not exists public.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null constraint approval_workflows_name_check check (btrim(name) <> ''),
  is_default boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.approval_workflows is 'Workflow approval per workspace (Phase 4, ADR-0010 §1). Default MVP: 1 workflow default, 1 step, 1 approver (ASUMSI-4.4). Workflow builder kustom DITUNDA.';

create unique index if not exists idx_approval_workflows_one_default
  on public.approval_workflows (workspace_id) where is_default;

-- --- approval_steps ----------------------------------------------------------
-- Dok 05 §3: workflow_id, step_order, role_or_user_rule, required_count,
-- step_type. step_order yang sama = step paralel (semua harus selesai);
-- step_order berikutnya baru dibuka setelah sebelumnya selesai (ASUMSI-4.7).
-- Penugasan: assignee_role ATAU assignee_user_id (minimal satu terisi).
-- owner/admin/manager HANYA boleh memutuskan bila ditugaskan eksplisit
-- sebagai assignee_user_id (matriks "limited", R4.3).
create table if not exists public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.approval_workflows (id) on delete cascade,
  step_order integer not null check (step_order >= 1),
  step_type text not null default 'sequential'
    constraint approval_steps_step_type_check
    check (step_type in ('sequential', 'parallel')),
  assignee_role text
    constraint approval_steps_assignee_role_check
    check (assignee_role is null or assignee_role in (
      'owner', 'admin', 'manager', 'strategist', 'creator',
      'editor', 'approver', 'analyst', 'viewer_client'
    )),
  assignee_user_id uuid references auth.users (id),
  required_count integer not null default 1 check (required_count >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_steps_assignee_check
    check (assignee_role is not null or assignee_user_id is not null)
);

comment on table public.approval_steps is 'Step workflow approval (Phase 4). Satu approver = satu keputusan per step per request (unique di approval_decisions). Quorum default 1 (ASUMSI-4.7).';

create index if not exists idx_approval_steps_workflow_order
  on public.approval_steps (workflow_id, step_order);

-- --- approval_requests -------------------------------------------------------
-- Dok 05 §3: target_type, target_id, content_version_id,
-- placement_version_id nullable, workflow_id, status, submitted_by,
-- submitted_at, completed_at. Status enum Keputusan #8 (ADR-0010 §1).
-- target_type 'placement' WAJIB placement_version_id (ASUMSI-4.5).
-- Satu request aktif per (target, versi, placement, tipe): partial unique
-- index di bawah (coalesce placement NULL ke UUID nol agar NULL tidak
-- lolos sebagai "berbeda" — Postgres menganggap NULL distinct).
create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  target_type text not null
    constraint approval_requests_target_type_check
    check (target_type in ('content_item', 'placement')),
  target_id uuid not null,
  content_version_id uuid not null references public.content_versions (id) on delete cascade,
  placement_version_id uuid references public.placement_versions (id) on delete cascade,
  workflow_id uuid not null references public.approval_workflows (id) on delete restrict,
  request_type text not null default 'internal'
    constraint approval_requests_request_type_check
    check (request_type in ('internal', 'client')),
  status text not null default 'in_review'
    constraint approval_requests_status_check
    check (status in (
      'submitted', 'in_review', 'approved', 'changes_requested',
      'rejected', 'reapproval_required'
    )),
  submitted_by uuid not null references auth.users (id),
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  current_step_order integer not null default 1 check (current_step_order >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_placement_version_check
    check (target_type <> 'placement' or placement_version_id is not null)
);

comment on table public.approval_requests is 'Request approval per versi persis (Phase 4, prompt 05): content_version_id WAJIB; placement_version_id wajib bila target placement. Status enum Keputusan #8. client_review = request_type client, satu gerbang setelah internal (ADR-0010 §5).';

create unique index if not exists idx_approval_requests_one_active
  on public.approval_requests (
    target_type, target_id, content_version_id,
    coalesce(placement_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
    request_type
  ) where status in ('submitted', 'in_review', 'reapproval_required');

create index if not exists idx_approval_requests_ws_status
  on public.approval_requests (workspace_id, status);
create index if not exists idx_approval_requests_target
  on public.approval_requests (target_type, target_id);
create index if not exists idx_approval_requests_version
  on public.approval_requests (content_version_id);

-- --- approval_decisions ------------------------------------------------------
-- Dok 05 §3: approval_request_id, step_id, approver_user_id, decision,
-- comment, decided_at. Append-only: TIDAK ADA UPDATE/DELETE lewat RLS
-- (lihat policy di bawah) + trigger menolak UPDATE langsung (di bawah).
-- Komentar WAJIB untuk non-approval (CHECK + validasi RPC 0014).
-- Satu keputusan per approver per step per request (unique) agar quorum
-- tidak bisa digandakan oleh satu orang yang memutuskan dua kali.
create table if not exists public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null references public.approval_requests (id) on delete cascade,
  step_id uuid not null references public.approval_steps (id) on delete restrict,
  approver_user_id uuid not null references auth.users (id),
  decision text not null
    constraint approval_decisions_decision_check
    check (decision in ('approved', 'changes_requested', 'rejected')),
  comment text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (approval_request_id, step_id, approver_user_id),
  constraint approval_decisions_comment_check
    check (decision = 'approved' or (comment is not null and btrim(comment) <> ''))
);

comment on table public.approval_decisions is 'Keputusan approval append-only (Phase 4, Dok 07 §4): satu baris = satu keputusan satu approver satu step. TIDAK ADA UPDATE/DELETE (trigger + RLS).';

create index if not exists idx_approval_decisions_request
  on public.approval_decisions (approval_request_id);
create index if not exists idx_approval_decisions_step_approver
  on public.approval_decisions (step_id, approver_user_id);

-- --- trigger: keputusan tidak bisa DIUBAH (DELETE ditangani RLS + cascade) ---
-- Alasan UPDATE-only (bukan UPDATE OR DELETE): DELETE keputusan hanya
-- terjadi lewat CASCADE saat request/workspace induk dihapus — trigger
-- DELETE akan memacetkan cleanup (pelajaran P0001 template default,
-- Phase 3). DELETE langsung sudah ditolak RLS (using false di bawah).
create or replace function public.prevent_approval_decision_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'approval_decisions bersifat append-only: keputusan tidak bisa diubah.';
end;
$$;

drop trigger if exists trg_prevent_approval_decision_update on public.approval_decisions;
create trigger trg_prevent_approval_decision_update
  before update on public.approval_decisions
  for each row execute function public.prevent_approval_decision_update();

-- --- notifications: tambah tipe approval --------------------------------------
-- CHECK lama (0009) hanya mengizinkan mention/task_assigned/
-- task_status_change/comment_reply. DROP + ADD ulang dengan nama constraint
-- yang sama — idempotent bila migrasi dijalankan ulang.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'mention', 'task_assigned', 'task_status_change', 'comment_reply',
    'approval_requested', 'approval_decided', 'approval_reapproval_required'
  ));

-- --- RLS ----------------------------------------------------------------------
alter table public.approval_workflows enable row level security;
alter table public.approval_steps enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_decisions enable row level security;

revoke all on public.approval_workflows from anon, authenticated;
revoke all on public.approval_steps from anon, authenticated;
revoke all on public.approval_requests from anon, authenticated;
revoke all on public.approval_decisions from anon, authenticated;
grant select, insert, update, delete on public.approval_workflows to authenticated;
grant select, insert, update, delete on public.approval_steps to authenticated;
grant select on public.approval_requests to authenticated;
grant select on public.approval_decisions to authenticated;

-- --- helper RLS (anti-rekursi, pola 0006/0007) --------------------------------
-- is_workflow_member: member aktif workspace pemilik workflow.
create or replace function public.is_workflow_member(p_workflow_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.approval_workflows w
    where w.id = p_workflow_id
      and public.is_ws_member(w.workspace_id, p_roles)
  );
$$;

comment on function public.is_workflow_member(uuid, text[]) is 'Helper RLS anti-rekursi (0013): apakah pemanggil member aktif workspace pemilik workflow. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- is_approval_request_member: member aktif workspace pemilik request.
create or replace function public.is_approval_request_member(p_request_id uuid, p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.approval_requests r
    where r.id = p_request_id
      and public.is_ws_member(r.workspace_id, p_roles)
  );
$$;

comment on function public.is_approval_request_member(uuid, text[]) is 'Helper RLS anti-rekursi (0013): apakah pemanggil member aktif workspace pemilik approval request. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- is_approval_request_approver: pemanggil ditugaskan di step AKTIF request
-- ini (assignee_user_id = pemanggil, ATAU assignee_role = role pemanggil
-- di workspace itu). Dipakai policy SELECT + RPC 0014 (7 poin Dok 06 §4).
create or replace function public.is_approval_request_approver(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.approval_requests r
    join public.approval_steps s on s.workflow_id = r.workflow_id
      and s.step_order = r.current_step_order
    join public.workspace_members wm on wm.workspace_id = r.workspace_id
      and wm.user_id = auth.uid()
      and wm.membership_status = 'active'
    where r.id = p_request_id
      and (
        s.assignee_user_id = auth.uid()
        or (s.assignee_role is not null and s.assignee_role = wm.workspace_role)
      )
  );
$$;

comment on function public.is_approval_request_approver(uuid) is 'Helper anti-rekursi (0013): apakah pemanggil ditugaskan memutuskan di step aktif request ini (user eksplisit ATAU role cocok). Dipakai RPC 0014 (7 poin Dok 06 §4), bukan policy — agar graf policy tetap asiklik. SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

-- is_approval_request_visible_to_client: target request dibagikan eksplisit
-- ke pemanggil (portal klien, Keputusan #12). Content item langsung, atau
-- placement yang item induknya dibagikan.
create or replace function public.is_approval_request_visible_to_client(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.approval_requests r
    where r.id = p_request_id
      and (
        (r.target_type = 'content_item'
          and public.is_resource_shared_with_me('content_item', r.target_id))
        or (r.target_type = 'placement'
          and public.is_placement_shared_with_me(r.target_id))
      )
  );
$$;

comment on function public.is_approval_request_visible_to_client(uuid) is 'Helper RLS anti-rekursi (0013): apakah target request ini dibagikan eksplisit ke pemanggil (portal klien). SECURITY DEFINER — jangan ubah jadi SECURITY INVOKER. Hanya boolean; tidak mengembalikan data.';

grant execute on function public.is_workflow_member(uuid, text[]) to authenticated;
grant execute on function public.is_approval_request_member(uuid, text[]) to authenticated;
grant execute on function public.is_approval_request_approver(uuid) to authenticated;
grant execute on function public.is_approval_request_visible_to_client(uuid) to authenticated;

-- --- policies: approval_workflows ---------------------------------------------
-- Baca: member aktif workspace (semua kecuali viewer_client — portal tidak
-- punya fitur workflow). Tulis: owner/admin/manager. Hapus: owner/admin.
create policy "workflows_select_member"
  on public.approval_workflows for select
  to authenticated
  using (
    public.is_ws_member(approval_workflows.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "workflows_insert_managers"
  on public.approval_workflows for insert
  to authenticated
  with check (
    public.is_ws_member(approval_workflows.workspace_id, array['owner', 'admin', 'manager'])
  );

create policy "workflows_update_managers"
  on public.approval_workflows for update
  to authenticated
  using (
    public.is_ws_member(approval_workflows.workspace_id, array['owner', 'admin', 'manager'])
  )
  with check (
    public.is_ws_member(approval_workflows.workspace_id, array['owner', 'admin', 'manager'])
  );

create policy "workflows_delete_managers"
  on public.approval_workflows for delete
  to authenticated
  using (
    public.is_ws_member(approval_workflows.workspace_id, array['owner', 'admin'])
  );

-- --- policies: approval_steps --------------------------------------------------
-- Baca: member aktif workspace pemilik workflow. Tulis: owner/admin/manager.
create policy "steps_select_member"
  on public.approval_steps for select
  to authenticated
  using (
    public.is_workflow_member(approval_steps.workflow_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );

create policy "steps_insert_managers"
  on public.approval_steps for insert
  to authenticated
  with check (
    public.is_workflow_member(approval_steps.workflow_id, array['owner', 'admin', 'manager'])
  );

create policy "steps_update_managers"
  on public.approval_steps for update
  to authenticated
  using (
    public.is_workflow_member(approval_steps.workflow_id, array['owner', 'admin', 'manager'])
  )
  with check (
    public.is_workflow_member(approval_steps.workflow_id, array['owner', 'admin', 'manager'])
  );

create policy "steps_delete_managers"
  on public.approval_steps for delete
  to authenticated
  using (
    public.is_workflow_member(approval_steps.workflow_id, array['owner', 'admin'])
  );

-- --- policies: approval_requests -----------------------------------------------
-- Baca: member aktif workspace ATAU klien yang target-nya dibagikan.
-- INSERT/UPDATE/DELETE: TIDAK ADA lewat RLS — hanya RPC 0014
-- (SECURITY DEFINER). DELETE eksplisit ditolak (using false); hapus
-- hanya lewat CASCADE induk.
create policy "requests_select_member_or_shared"
  on public.approval_requests for select
  to authenticated
  using (
    public.is_approval_request_member(approval_requests.id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_approval_request_visible_to_client(approval_requests.id)
  );

create policy "requests_no_insert"
  on public.approval_requests for insert to authenticated with check (false);

create policy "requests_no_update"
  on public.approval_requests for update to authenticated using (false);

create policy "requests_no_delete"
  on public.approval_requests for delete to authenticated using (false);

-- --- policies: approval_decisions ----------------------------------------------
-- Baca: member aktif workspace ATAU klien yang target request-nya dibagikan.
-- INSERT/UPDATE/DELETE: TIDAK ADA lewat RLS — hanya RPC 0014.
-- UPDATE langsung juga ditolak trigger (di atas); DELETE langsung ditolak
-- (using false); hapus hanya lewat CASCADE induk.
create policy "decisions_select_member_or_shared"
  on public.approval_decisions for select
  to authenticated
  using (
    public.is_approval_request_member(approval_decisions.approval_request_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
    or public.is_approval_request_visible_to_client(approval_decisions.approval_request_id)
  );

create policy "decisions_no_insert"
  on public.approval_decisions for insert to authenticated with check (false);

create policy "decisions_no_update"
  on public.approval_decisions for update to authenticated using (false);

create policy "decisions_no_delete"
  on public.approval_decisions for delete to authenticated using (false);
