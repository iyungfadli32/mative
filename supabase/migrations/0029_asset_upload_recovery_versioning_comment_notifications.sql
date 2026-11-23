-- MaTive -- Migrasi 0029: Perbaikan (c) T-1..T-4 (unggah aset + versioning + notifikasi komentar)
-- ===========================================================================
-- T-4: `create_comment_with_mentions` (0010) kini juga mengirim notifikasi
--   'comment_created' ke pemilik konten (content_items/campaigns.owner_user_id
--   atau tasks.created_by) dan ke assignee tugas terkait, selain mention dan
--   balasan yang sudah ada. Tanpa ganda dan tanpa memberitahu penulis sendiri.
--   Daftar tipe notifikasi yang diizinkan ditambah 'comment_created'.
-- T-1: `sweep_stale_asset_uploads` menandai baris aset 'uploading' yang sudah
--   lama (default > 60 menit, tidak pernah di-confirm) menjadi 'failed' dan
--   mengembalikan object_key-nya supaya server action dapat menghapus objek
--   Storage yatimnya (Storage tidak bisa dihapus dari SQL).
-- T-3: `restore_asset_version` memulihkan versi aset lama sebagai versi BARU
--   (append-only, mengikuti pola restore_content_version) dan mengarahkan
--   aset ke object_key versi tersebut. `asset_versions` mendapat kolom
--   mime_type + byte_size supaya pulihan juga mengembalikan metadata file.
-- T-2: tidak ada perubahan skema; perbaikan ada di server action
--   (hapus objek Storage DULU dan periksa hasilnya, baru hapus baris DB).
-- Keamanan: pola 0008/0010/0028 -- SECURITY DEFINER, search_path terkunci,
--   keanggotaan diperiksa di dalam fungsi, kembalikan {ok, code, message},
--   GRANT EXECUTE hanya ke authenticated. Tidak ada tabel/policy RLS baru.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- T-4: izinkan tipe notifikasi 'comment_created'
-- ---------------------------------------------------------------------------
-- Daftar lama (0013) + 'comment_created'. DROP + ADD dengan nama constraint
-- yang sama -- idempotent bila migrasi dijalankan ulang.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'mention', 'task_assigned', 'task_status_change', 'comment_reply', 'comment_created',
    'approval_requested', 'approval_decided', 'approval_reapproval_required'
  ));

-- ---------------------------------------------------------------------------
-- T-4: create_comment_with_mentions -- 0010 + notifikasi pemilik/assignee
-- ---------------------------------------------------------------------------
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
  v_owner_id uuid;
  v_assignee_id uuid;
  v_notify_id uuid;
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

  -- (0029, T-4) Beri tahu pemilik konten + assignee tugas terkait. Sebelum
  -- ini komentar biasa tidak membuat notifikasi apa pun bagi mereka.
  -- Penerima yang sudah mendapat 'mention'/'comment_reply' untuk komentar
  -- yang sama tidak dikirimi ganda; penulis komentar tidak diberitahu.
  -- Keanggotaan aktif diperiksa di sini supaya trigger scope notifikasi
  -- tidak menggagalkan pembuatan komentar bila penerimanya sudah nonaktif.
  select case p_target_type
    when 'content_item' then (select owner_user_id from public.content_items where id = p_target_id)
    when 'campaign' then (select owner_user_id from public.campaigns where id = p_target_id)
    when 'task' then (select created_by from public.tasks where id = p_target_id)
  end into v_owner_id;
  select case
    when p_target_type = 'task' then (select assignee_user_id from public.tasks where id = p_target_id)
    else null
  end into v_assignee_id;
  for v_notify_id in
    select distinct x from unnest(array[v_owner_id, v_assignee_id]) as x where x is not null
  loop
    if v_notify_id = v_caller then
      continue;
    end if;
    if v_notify_id = any (coalesce(p_mentioned_user_ids, '{}'::uuid[])) then
      continue;
    end if;
    if v_parent_author is not null and v_notify_id = v_parent_author then
      continue;
    end if;
    if not exists (
      select 1 from public.workspace_members
      where workspace_id = p_workspace_id and user_id = v_notify_id and membership_status = 'active'
    ) then
      continue;
    end if;
    insert into public.notifications (
      workspace_id, recipient_user_id, type, title, body, target_type, target_id
    ) values (
      p_workspace_id, v_notify_id, 'comment_created',
      'Komentar baru',
      left(btrim(p_body), 200),
      'comment', v_comment_id
    );
  end loop;

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
comment on function public.create_comment_with_mentions(uuid, text, uuid, uuid, text, uuid[])
  is 'Komentar + mention + notifikasi (mention, balasan, dan comment_created ke pemilik konten/assignee tugas) + activity log. Mention dari daftar anggota, bukan parsing teks. Gerbang ganda untuk klien. SECURITY DEFINER -- ditinjau.';
revoke all on function public.create_comment_with_mentions(uuid, text, uuid, uuid, text, uuid[]) from public;
grant execute on function public.create_comment_with_mentions(uuid, text, uuid, uuid, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- T-1: penyapu unggahan aset yang terjebak 'uploading'
-- ---------------------------------------------------------------------------
create or replace function public.sweep_stale_asset_uploads(
  p_workspace_id uuid,
  p_older_than_minutes integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_swept_ids uuid[] := '{}';
  v_swept_keys text[] := '{}';
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Anda harus masuk dulu.');
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = v_caller and membership_status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Anda bukan anggota workspace ini.');
  end if;
  if p_older_than_minutes is null or p_older_than_minutes < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'message', 'Batas umur unggahan tidak valid.');
  end if;
  with swept as (
    update public.assets
    set processing_status = 'failed', updated_at = now()
    where workspace_id = p_workspace_id
      and processing_status = 'uploading'
      and created_at < now() - make_interval(mins => p_older_than_minutes)
    returning id, object_key
  )
  select coalesce(array_agg(id), '{}'::uuid[]), coalesce(array_agg(object_key), '{}'::text[])
    into v_swept_ids, v_swept_keys from swept;
  return jsonb_build_object(
    'ok', true,
    'swept_count', coalesce(array_length(v_swept_ids, 1), 0),
    'asset_ids', to_jsonb(v_swept_ids),
    'object_keys', to_jsonb(v_swept_keys)
  );
end;
$$;

revoke all on function public.sweep_stale_asset_uploads(uuid, integer) from public;
grant execute on function public.sweep_stale_asset_uploads(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- T-3: pulihkan versi aset lama sebagai versi baru (append-only)
-- ---------------------------------------------------------------------------
-- asset_versions menyimpan metadata file supaya pulihan juga mengembalikan
-- mime_type/byte_size versi sumber (baris v1 lama yang dibuat sebelum 0029
-- bernilai null dan akan memakai metadata aset saat ini).
alter table public.asset_versions add column if not exists mime_type text;
alter table public.asset_versions add column if not exists byte_size bigint;

create or replace function public.restore_asset_version(
  p_workspace_id uuid,
  p_asset_id uuid,
  p_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_asset public.assets%rowtype;
  v_src public.asset_versions%rowtype;
  v_next integer;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Anda harus masuk dulu.');
  end if;
  select * into v_asset from public.assets where id = p_asset_id and workspace_id = p_workspace_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Aset tidak ditemukan.');
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = v_caller and membership_status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Anda bukan anggota workspace ini.');
  end if;
  if v_asset.processing_status = 'uploading' then
    return jsonb_build_object('ok', false, 'code', 'asset_uploading', 'message', 'Aset masih diunggah; pulihkan setelah unggahan selesai atau gagal.');
  end if;
  select * into v_src from public.asset_versions where id = p_version_id and asset_id = p_asset_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Versi aset tidak ditemukan.');
  end if;
  select coalesce(max(version_number), 0) + 1 into v_next from public.asset_versions where asset_id = p_asset_id;
  insert into public.asset_versions (asset_id, version_number, storage_object_key, mime_type, byte_size, uploaded_by)
  values (p_asset_id, v_next, v_src.storage_object_key, v_src.mime_type, v_src.byte_size, v_caller);
  update public.assets
  set object_key = v_src.storage_object_key,
      mime_type = coalesce(v_src.mime_type, v_asset.mime_type),
      byte_size = coalesce(v_src.byte_size, v_asset.byte_size),
      processing_status = 'ready',
      updated_at = now()
  where id = p_asset_id;
  return jsonb_build_object(
    'ok', true,
    'version_number', v_next,
    'restored_version_id', v_src.id,
    'storage_object_key', v_src.storage_object_key
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'conflict', 'message', 'Versi sudah dibuat bersamaan; coba lagi.');
end;
$$;

revoke all on function public.restore_asset_version(uuid, uuid, uuid) from public;
grant execute on function public.restore_asset_version(uuid, uuid, uuid) to authenticated;
