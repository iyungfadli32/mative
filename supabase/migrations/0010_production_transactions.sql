-- MaTive Phase 3 — Migrasi 0010: Production Transactions (P3-06, P3-09, P3-10, P3-05)
-- ============================================================================
-- SUMBER: Dok 05 §3/§6; Dok 06 §2/§3; Dok 12 Phase 3; ADR-0009 §2, §5, §6, §7.
--   5 RPC, pola 0008 (SECURITY DEFINER, search_path terkunci, cek
--   keanggotaan/peran di DALAM fungsi, kembalikan jsonb {ok, message, ...},
--   GRANT EXECUTE hanya ke authenticated).
--   1. create_task_with_checklist   — task + checklist + log + notif (P3-06)
--   2. transition_task_status       — mesin status task + log + notif (P3-06)
--   3. create_comment_with_mentions — komentar + mention + notif + log (P3-09)
--   4. restore_content_version     — pulihkan versi lama jadi versi BARU (P3-10)
--   5. set_default_brief_template  — ganti template default, atomik (P3-05)
--
-- KEBIJAKAN KEAMANAN (mengapa SECURITY DEFINER aman di sini):
--   RLS tabel terkait TIDAK bisa menulis dari klien untuk operasi ini
--   (mentions/notifications: tanpa policy INSERT; tasks: aturan "limited"
--   tidak bisa diekspresikan penuh oleh policy INSERT saja). Karena itu
--   fungsi ini memeriksa sendiri keanggotaan + peran + gerbang klien
--   SEBELUM menulis — dan trigger scope 0009 tetap menjadi backstop
--   (gagal TERTUTUP bila data lintas workspace). Lihat ADR-0009 §7.
-- ============================================================================

-- ============================================================================
-- Fungsi 1 — create_task_with_checklist
-- Buat task + item checklist + activity log + notifikasi penugasan dalam
-- SATU transaksi. Peran penuh (owner/admin/manager) boleh menugaskan ke
-- siapa pun; peran "limited" (strategist/creator/editor/approver) hanya
-- untuk dirinya sendiri / kosong. Analyst TIDAK boleh membuat task.
-- p_checklist: jsonb array [{ "title": "...", "sort_order": 0 }, ...].
-- ============================================================================
create or replace function public.create_task_with_checklist(
  p_workspace_id uuid,
  p_parent_type text,
  p_parent_id uuid,
  p_title text,
  p_description text default null,
  p_assignee_user_id uuid default null,
  p_due_at timestamptz default null,
  p_priority text default 'medium',
  p_estimate_minutes integer default null,
  p_checklist jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_task_id uuid;
  v_item jsonb;
  v_idx integer := 0;
  v_title text;
  v_sort integer;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if p_title is null or btrim(p_title) = '' then
    return jsonb_build_object('ok', false, 'message', 'Judul task wajib diisi.');
  end if;
  if p_parent_type not in ('content_item', 'campaign') then
    return jsonb_build_object('ok', false, 'message', 'Jenis parent task tidak dikenal.');
  end if;
  if p_priority not in ('low', 'medium', 'high', 'urgent') then
    return jsonb_build_object('ok', false, 'message', 'Prioritas tidak dikenal.');
  end if;
  if p_estimate_minutes is not null and p_estimate_minutes < 0 then
    return jsonb_build_object('ok', false, 'message', 'Estimasi tidak boleh negatif.');
  end if;
  if not public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver']) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak membuat task di workspace ini.');
  end if;
  if not public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager'])
    and p_assignee_user_id is not null
    and p_assignee_user_id <> v_caller then
    return jsonb_build_object('ok', false, 'message', 'Anda hanya boleh menugaskan task kepada diri sendiri.');
  end if;

  insert into public.tasks (
    workspace_id, parent_type, parent_id, title, description,
    assignee_user_id, created_by, due_at, priority, estimate_minutes
  ) values (
    p_workspace_id, p_parent_type, p_parent_id, btrim(p_title), p_description,
    p_assignee_user_id, v_caller, p_due_at, p_priority, p_estimate_minutes
  ) returning id into v_task_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_checklist, '[]'::jsonb))
  loop
    v_title := nullif(btrim(coalesce(v_item ->> 'title', '')), '');
    if v_title is null then
      return jsonb_build_object('ok', false, 'message', 'Setiap item checklist wajib punya judul.');
    end if;
    v_sort := coalesce((v_item ->> 'sort_order')::integer, v_idx);
    insert into public.task_checklist_items (task_id, title, sort_order)
    values (v_task_id, v_title, v_sort);
    v_idx := v_idx + 1;
  end loop;

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action,
    after_snapshot
  ) values (
    p_workspace_id, v_caller, 'task', v_task_id, 'task_created',
    jsonb_build_object('title', btrim(p_title), 'parent_type', p_parent_type, 'parent_id', p_parent_id, 'assignee_user_id', p_assignee_user_id)
  );

  if p_assignee_user_id is not null and p_assignee_user_id <> v_caller then
    insert into public.notifications (
      workspace_id, recipient_user_id, type, title, body, target_type, target_id
    ) values (
      p_workspace_id, p_assignee_user_id, 'task_assigned',
      'Task baru untuk Anda',
      btrim(p_title),
      'task', v_task_id
    );
  end if;

  return jsonb_build_object('ok', true, 'task_id', v_task_id);
end;
$$;

comment on function public.create_task_with_checklist(uuid, text, uuid, text, text, uuid, timestamptz, text, integer, jsonb) is 'RPC transaksional (0010, P3-06): task + checklist + activity log + notifikasi penugasan dalam satu transaksi. Peran limited hanya boleh menugaskan ke diri sendiri. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Fungsi 2 — transition_task_status
-- Pindah status task mengikuti mesin ADR-0009 §2:
--   todo → in_progress | blocked | cancelled
--   in_progress → in_review | blocked | cancelled
--   in_review → done | blocked | cancelled
--   blocked → todo | cancelled
--   cancelled → todo
--   done → terminal (tidak ada transisi keluar)
-- Peran penuh bebas; peran "limited" hanya task yang ditugaskan kepadanya.
-- Menulis activity log + notifikasi task_status_change ke assignee (bila
-- pengubahnya bukan assignee).
-- ============================================================================
create or replace function public.transition_task_status(
  p_task_id uuid,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_allowed boolean := false;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if p_new_status not in ('todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled') then
    return jsonb_build_object('ok', false, 'message', 'Status task tidak dikenal.');
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if v_task.id is null then
    return jsonb_build_object('ok', false, 'message', 'Task tidak ditemukan.');
  end if;
  if v_task.status = p_new_status then
    return jsonb_build_object('ok', false, 'message', 'Task sudah berstatus tersebut.');
  end if;
  if not (
    public.is_ws_member(v_task.workspace_id, array['owner', 'admin', 'manager'])
    or (
      public.is_ws_member(v_task.workspace_id, array['strategist', 'creator', 'editor', 'approver'])
      and v_task.assignee_user_id = v_caller
    )
  ) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak mengubah status task ini.');
  end if;

  v_allowed := case
    when v_task.status = 'todo' and p_new_status in ('in_progress', 'blocked', 'cancelled') then true
    when v_task.status = 'in_progress' and p_new_status in ('in_review', 'blocked', 'cancelled') then true
    when v_task.status = 'in_review' and p_new_status in ('done', 'blocked', 'cancelled') then true
    when v_task.status = 'blocked' and p_new_status in ('todo', 'cancelled') then true
    when v_task.status = 'cancelled' and p_new_status = 'todo' then true
    else false
  end;
  if not v_allowed then
    return jsonb_build_object('ok', false, 'message', 'Transisi status dari "' || v_task.status || '" ke "' || p_new_status || '" tidak diizinkan.');
  end if;

  update public.tasks
    set status = p_new_status, updated_at = now()
    where id = p_task_id;

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action,
    before_snapshot, after_snapshot
  ) values (
    v_task.workspace_id, v_caller, 'task', p_task_id, 'task_status_changed',
    jsonb_build_object('status', v_task.status),
    jsonb_build_object('status', p_new_status)
  );

  if v_task.assignee_user_id is not null and v_task.assignee_user_id <> v_caller then
    insert into public.notifications (
      workspace_id, recipient_user_id, type, title, body, target_type, target_id
    ) values (
      v_task.workspace_id, v_task.assignee_user_id, 'task_status_change',
      'Status task berubah',
      v_task.title || ' → ' || p_new_status,
      'task', p_task_id
    );
  end if;

  return jsonb_build_object('ok', true, 'task_id', p_task_id, 'status', p_new_status);
end;
$$;

comment on function public.transition_task_status(uuid, text) is 'RPC transaksional (0010, P3-06): mesin status task (ADR-0009 §2) + activity log + notifikasi ke assignee. Done terminal. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Fungsi 3 — create_comment_with_mentions
-- Buat komentar + mention eksplisit + notifikasi + activity log dalam SATU
-- transaksi. Mention HANYA dari daftar anggota yang dipilih (parameter
-- p_mentioned_user_ids) — BUKAN parsing teks. Mention diri sendiri dilewati
-- (tidak ada notifikasi ke diri sendiri). Balasan juga memberi notifikasi
-- comment_reply ke penulis komentar induk (bila bukan pengirim).
-- Gerbang klien: viewer_client boleh berkomentar HANYA bila target dibagikan
-- eksplisit DAN workspace mengizinkan komentar klien (ADR-0009 §5).
-- ============================================================================
create or replace function public.create_comment_with_mentions(
  p_workspace_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_parent_comment_id uuid default null,
  p_body text default null,
  p_mentioned_user_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_comment_id uuid;
  v_mention_id uuid;
  v_notif_id uuid;
  v_parent_author uuid;
  v_uid uuid;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if p_body is null or btrim(p_body) = '' then
    return jsonb_build_object('ok', false, 'message', 'Isi komentar wajib diisi.');
  end if;
  if p_target_type not in ('content_item', 'campaign', 'task') then
    return jsonb_build_object('ok', false, 'message', 'Target komentar tidak dikenal.');
  end if;
  if not (
    public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver'])
    or (
      public.is_ws_member(p_workspace_id, array['viewer_client'])
      and public.is_comment_target_shared(p_target_type, p_target_id)
      and public.is_client_comment_allowed(p_workspace_id)
    )
  ) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak berkomentar di sini.');
  end if;

  insert into public.comments (
    workspace_id, target_type, target_id, parent_comment_id, body, author_user_id
  ) values (
    p_workspace_id, p_target_type, p_target_id, p_parent_comment_id, btrim(p_body), v_caller
  ) returning id into v_comment_id;

  for v_uid in select distinct unnest(coalesce(p_mentioned_user_ids, '{}'::uuid[]))
  loop
    if v_uid = v_caller then
      continue;
    end if;
    insert into public.mentions (comment_id, mentioned_user_id)
    values (v_comment_id, v_uid)
    returning id into v_mention_id;

    insert into public.notifications (
      workspace_id, recipient_user_id, type, title, body, target_type, target_id
    ) values (
      p_workspace_id, v_uid, 'mention',
      'Anda disebut dalam komentar',
      left(btrim(p_body), 200),
      'comment', v_comment_id
    ) returning id into v_notif_id;

    update public.mentions set notification_id = v_notif_id where id = v_mention_id;
  end loop;

  if p_parent_comment_id is not null then
    select author_user_id into v_parent_author
      from public.comments where id = p_parent_comment_id;
    if v_parent_author is not null and v_parent_author <> v_caller then
      insert into public.notifications (
        workspace_id, recipient_user_id, type, title, body, target_type, target_id
      ) values (
        p_workspace_id, v_parent_author, 'comment_reply',
        'Ada balasan untuk komentar Anda',
        left(btrim(p_body), 200),
        'comment', v_comment_id
      );
    end if;
  end if;

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action,
    after_snapshot
  ) values (
    p_workspace_id, v_caller, 'comment', v_comment_id, 'comment_created',
    jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'parent_comment_id', p_parent_comment_id)
  );

  return jsonb_build_object('ok', true, 'comment_id', v_comment_id);
end;
$$;

comment on function public.create_comment_with_mentions(uuid, text, uuid, uuid, text, uuid[]) is 'RPC transaksional (0010, P3-09): komentar + mention eksplisit + notifikasi mention/reply + activity log. Mention dari daftar anggota, bukan parsing teks. Gerbang ganda untuk klien. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Fungsi 4 — restore_content_version
-- Pulihkan versi lama menjadi versi BARU (bukan menimpa versi lama):
-- membaca snapshot versi lama, lalu memanggil
-- update_content_item_with_version (0008) dengan snapshot itu +
-- change_summary "Dipulihkan dari vN". Riwayat versi tetap utuh.
-- ============================================================================
create or replace function public.restore_content_version(
  p_content_item_id uuid,
  p_version_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_item public.content_items%rowtype;
  v_ver public.content_versions%rowtype;
  v_res jsonb;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;

  select * into v_item from public.content_items where id = p_content_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'message', 'Content item tidak ditemukan.');
  end if;
  if not public.can_edit_content_item(p_content_item_id) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak memulihkan versi konten ini.');
  end if;

  select * into v_ver
    from public.content_versions
    where content_item_id = p_content_item_id and version_number = p_version_number;
  if v_ver.id is null then
    return jsonb_build_object('ok', false, 'message', 'Versi tidak ditemukan.');
  end if;

  v_res := public.update_content_item_with_version(
    p_content_item_id,
    v_item.title,
    v_item.internal_description,
    v_item.objective,
    v_item.funnel_stage,
    v_item.priority,
    v_item.due_at,
    v_item.campaign_id,
    v_item.pillar_id,
    v_item.audience_id,
    v_ver.script,
    v_ver.caption,
    v_ver.cta,
    v_ver.creative_notes,
    v_ver.brief_snapshot,
    'Dipulihkan dari v' || p_version_number::text
  );

  if not coalesce((v_res ->> 'ok')::boolean, false) then
    return v_res;
  end if;

  return jsonb_build_object(
    'ok', true,
    'content_item_id', p_content_item_id,
    'version_number', (v_res ->> 'version_number')::integer,
    'restored_from_version', p_version_number
  );
end;
$$;

comment on function public.restore_content_version(uuid, integer) is 'RPC transaksional (0010, P3-10): pulihkan versi lama sebagai versi BARU via update_content_item_with_version (0008). Riwayat tidak ditimpa. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- Fungsi 5 — set_default_brief_template
-- Ganti template default workspace secara atomik (dua UPDATE dalam satu
-- transaksi fungsi): matikan default lama, nyalakan yang baru. Template
-- harus ada di workspace yang sama. Peran: owner/admin/manager/strategist.
-- ============================================================================
create or replace function public.set_default_brief_template(
  p_workspace_id uuid,
  p_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if not public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist']) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak mengatur template brief di workspace ini.');
  end if;
  if not exists (
    select 1 from public.brief_templates
    where id = p_template_id and workspace_id = p_workspace_id
  ) then
    return jsonb_build_object('ok', false, 'message', 'Template brief tidak ditemukan di workspace ini.');
  end if;

  update public.brief_templates
    set is_default = false, updated_at = now()
    where workspace_id = p_workspace_id and is_default = true;
  update public.brief_templates
    set is_default = true, updated_at = now()
    where id = p_template_id;

  return jsonb_build_object('ok', true, 'template_id', p_template_id);
end;
$$;

comment on function public.set_default_brief_template(uuid, uuid) is 'RPC transaksional (0010, P3-05): ganti template brief default secara atomik. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- GRANT — hanya authenticated (pola 0008)
-- ============================================================================
revoke all on function public.create_task_with_checklist(uuid, text, uuid, text, text, uuid, timestamptz, text, integer, jsonb) from public;
grant execute on function public.create_task_with_checklist(uuid, text, uuid, text, text, uuid, timestamptz, text, integer, jsonb) to authenticated;

revoke all on function public.transition_task_status(uuid, text) from public;
grant execute on function public.transition_task_status(uuid, text) to authenticated;

revoke all on function public.create_comment_with_mentions(uuid, text, uuid, uuid, text, uuid[]) from public;
grant execute on function public.create_comment_with_mentions(uuid, text, uuid, uuid, text, uuid[]) to authenticated;

revoke all on function public.restore_content_version(uuid, integer) from public;
grant execute on function public.restore_content_version(uuid, integer) to authenticated;

revoke all on function public.set_default_brief_template(uuid, uuid) from public;
grant execute on function public.set_default_brief_template(uuid, uuid) to authenticated;

-- ============================================================================
-- AKHIR MIGRASI 0010 — 5 RPC (semua SECURITY DEFINER, search_path terkunci).
-- ============================================================================
