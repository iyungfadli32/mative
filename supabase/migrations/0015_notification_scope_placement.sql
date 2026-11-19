-- ============================================================================
-- MaTive — migrasi 0015: notifikasi untuk target 'placement'
-- (perbaikan cacat produk Phase 4, ditemukan pgTAP 04 v1.4 live 2026-11-19)
--
-- CACAT: approval request untuk placement (target_type 'placement', 0013
-- sudah mengizinkannya di approval_requests) SELALU gagal saat RPC
-- create_approval_request mencoba memberi notifikasi ke assignee step 1.
-- Dua lapisan di 0009 memblokir 'placement':
--   (1) trigger validate_notification_scope() tidak punya cabang
--       'placement' — v_ws tetap NULL → raise P0001 'scope mismatch:
--       notifications.target_id belongs to a different workspace or
--       does not exist' (bukti live: run pgTAP 04 v1.4, T16 SETUP).
--   (2) CHECK notifications_target_type_check hanya mengizinkan
--       ('content_item','campaign','task','comment') — setelah trigger
--       diperbaiki, INSERT akan gagal 23514 di CHECK ini.
-- Dampak nyata (bukan hanya tes): SEMUA alur approval placement di
-- produksi rusak — submit (create, 0014:254), putusan (decide, 0014:489),
-- dan reapproval (0014:653) semuanya menulis notifikasi dengan
-- target_type request ('placement'). Tanpa perbaikan ini, tidak ada
-- request approval placement yang bisa dibuat bila assignee-nya bukan
-- si pengaju sendiri. Lolos dari pengujian lokal karena e2e approval
-- hanya menguji alur content_item, bukan placement.
--
-- PERBAIKAN (migrasi baru; 0009 yang sudah live TIDAK diubah):
--   (1) CHECK diperluas dengan 'placement'.
--   (2) trigger mendapat cabang 'placement': workspace diambil lewat
--       content_placements → content_items (pola yang sama dipakai
--       helper 0013:296 untuk target placement).
-- Tidak ada perubahan perilaku untuk target lain; tidak ada GRANT baru;
-- tidak ada data yang diubah (tabel notifications live masih kosong —
-- hanya seed).
-- ============================================================================

-- --- (1) CHECK notifikasi: izinkan target 'placement' -----------------------
alter table public.notifications
  drop constraint notifications_target_type_check;
alter table public.notifications
  add constraint notifications_target_type_check
    check (target_type in ('content_item', 'campaign', 'task', 'comment', 'placement'));

-- --- (2) Trigger scope: kenali target 'placement' ---------------------------
-- Salinan lengkap fungsi 0009 + satu cabang baru (create or replace).
create or replace function public.validate_notification_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
begin
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.recipient_user_id
      and wm.membership_status = 'active'
  ) then
    raise exception 'scope mismatch: notifications.recipient_user_id is not an active member of this workspace';
  end if;
  if new.target_type = 'content_item' then
    select workspace_id into v_ws from public.content_items where id = new.target_id;
  elsif new.target_type = 'campaign' then
    select workspace_id into v_ws from public.campaigns where id = new.target_id;
  elsif new.target_type = 'task' then
    select workspace_id into v_ws from public.tasks where id = new.target_id;
  elsif new.target_type = 'comment' then
    select workspace_id into v_ws from public.comments where id = new.target_id;
  elsif new.target_type = 'placement' then
    select ci.workspace_id into v_ws
    from public.content_placements cp
    join public.content_items ci on ci.id = cp.content_item_id
    where cp.id = new.target_id;
  end if;
  if v_ws is null or v_ws <> new.workspace_id then
    raise exception 'scope mismatch: notifications.target_id belongs to a different workspace or does not exist';
  end if;
  return new;
end;
$$;
