-- ============================================================================
-- MaTive — Migrasi 0026: tegakkan brand scope DI DALAM RPC
-- create_content_item_with_version + convert_idea_to_content
-- (perbaikan temuan audit (b) K-3, 2026-11-21)
-- ============================================================================
-- MASALAH
--   Kedua RPC ini SECURITY DEFINER dan hanya memeriksa keanggotaan
--   workspace + brand satu workspace — TIDAK PERNAH memeriksa
--   brand_scope pemanggil (helper public.brand_in_scope, 0016). RLS
--   0016 bukan backstop karena RPC SECURITY DEFINER melewati RLS.
--   Akibatnya anggota dengan brand_scope=[Brand A] bisa membuat konten
--   (atau mengonversi ide dengan p_brand_id) untuk Brand B lewat
--   pemanggilan RPC langsung, walau UI menyembunyikan Brand B.
--   Server action sudah mengecek scope di lapis aplikasi
--   (createContentAction/convertIdeaAction, pola createCampaignAction),
--   tetapi penegakan di lapis aplikasi saja tidak menutup jalur RPC
--   langsung — karena itu scope ditegakkan JUGA di sini.
--
-- PERBAIKAN (pola yang sama dengan 0012 — 0008/0012 TIDAK DIUBAH,
-- keduanya sudah diterapkan live):
--   (a) create_content_item_with_version: sesudah cek keanggotaan/role,
--       tolak ok=false "Brand di luar scope Anda." bila
--       NOT public.brand_in_scope(p_brand_id).
--   (b) convert_idea_to_content: sesudah brand efektif dihitung
--       (coalesce(p_brand_id, v_idea.brand_id)) dan divalidasi milik
--       workspace ide, tolak dengan pesan yang sama bila
--       NOT public.brand_in_scope(v_brand_id).
--   (c) Sisa logika SAMA PERSIS dengan 0008/0012 (izin, judul, v1,
--       status, event, log, return). Signatur TIDAK berubah, jadi tidak
--       ada overload baru dan tidak perlu DROP.
--
-- KOMPATIBILITAS
--   brand_in_scope(NULL) = true, dan scope NULL = semua brand — pemanggil
--   tanpa pembatasan (perilaku lama, termasuk semua pemakai RPC saat ini
--   dan tes pgTAP 03 yang memanggil RPC sebagai owner tanpa scope)
--   TIDAK berubah perilakunya. Yang berubah hanya pemanggil dengan
--   brand_scope array yang mencoba brand di luar arraynya: dulu lolos,
--   kini ditolak bersih (ok=false, bukan exception).
--
-- CATATAN: file ini HANYA mengganti dua fungsi RPC (tanpa tabel/policy
-- baru) — seperti 0008/0012. CREATE OR REPLACE idempotent; search_path
-- dikunci; grant EXECUTE hanya ke authenticated (pola 0008/0010/0012).
-- ============================================================================

-- ============================================================================
-- Fungsi 1 — create_content_item_with_version (0008 + cek scope 0026)
-- ============================================================================
create or replace function public.create_content_item_with_version(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_title text,
  p_campaign_id uuid default null,
  p_pillar_id uuid default null,
  p_audience_id uuid default null,
  p_internal_description text default null,
  p_objective text default null,
  p_funnel_stage text default null,
  p_priority text default null,
  p_due_at timestamptz default null,
  p_timezone text default 'Asia/Jakarta',
  p_origin_idea_id uuid default null,
  p_script text default null,
  p_caption text default null,
  p_cta text default null,
  p_creative_notes text default null,
  p_brief_snapshot jsonb default '{}'::jsonb,
  p_change_summary text default 'Versi awal (v1)'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_brand_ws uuid;
  v_item_id uuid;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  if p_title is null or btrim(p_title) = '' then
    return jsonb_build_object('ok', false, 'message', 'Judul konten wajib diisi.');
  end if;
  if p_priority is not null and p_priority not in ('low', 'medium', 'high', 'urgent') then
    return jsonb_build_object('ok', false, 'message', 'Prioritas tidak dikenal.');
  end if;
  if p_funnel_stage is not null and p_funnel_stage not in ('awareness', 'consideration', 'conversion', 'retention', 'advocacy') then
    return jsonb_build_object('ok', false, 'message', 'Funnel stage tidak dikenal.');
  end if;
  -- Brand harus milik workspace yang sama (trigger scope juga memeriksa).
  select workspace_id into v_brand_ws from public.brands where id = p_brand_id;
  if v_brand_ws is null then
    return jsonb_build_object('ok', false, 'message', 'Brand tidak ditemukan.');
  end if;
  if v_brand_ws <> p_workspace_id then
    return jsonb_build_object('ok', false, 'message', 'Brand milik workspace lain.');
  end if;
  -- Izin: tulis-penuh, atau creator/editor (owner otomatis = pemanggil).
  if not (
    public.is_ws_member(p_workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or public.is_ws_member(p_workspace_id, array['creator', 'editor'])
  ) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak membuat konten di workspace ini.');
  end if;
  -- Brand scope (0016, ditegakkan 0026 — (b) K-3): anggota dengan
  -- brand_scope terbatas hanya boleh membuat konten untuk brand di
  -- scope-nya. brand_in_scope memakai auth.uid() pemanggil; scope
  -- NULL = semua brand (perilaku lama tidak berubah).
  if not public.brand_in_scope(p_brand_id) then
    return jsonb_build_object('ok', false, 'message', 'Brand di luar scope Anda.');
  end if;

  insert into public.content_items (
    workspace_id, brand_id, campaign_id, pillar_id, title,
    internal_description, objective, audience_id, funnel_stage,
    production_status, priority, owner_user_id, due_at, timezone, origin_idea_id
  ) values (
    p_workspace_id, p_brand_id, p_campaign_id, p_pillar_id, btrim(p_title),
    p_internal_description, p_objective, p_audience_id, p_funnel_stage,
    'idea', p_priority, v_caller, p_due_at, p_timezone, p_origin_idea_id
  ) returning id into v_item_id;

  insert into public.content_versions (
    content_item_id, version_number, brief_snapshot, script, caption,
    cta, creative_notes, change_summary, created_by
  ) values (
    v_item_id, 1, coalesce(p_brief_snapshot, '{}'::jsonb), p_script, p_caption,
    p_cta, p_creative_notes, p_change_summary, v_caller
  );

  insert into public.content_status_events (
    content_item_id, from_status, to_status, actor_user_id, reason
  ) values (
    v_item_id, null, 'idea', v_caller, 'Dibuat (v1)'
  );

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action, after_snapshot
  ) values (
    p_workspace_id, v_caller, 'content_item', v_item_id, 'content_created',
    jsonb_build_object('title', btrim(p_title), 'production_status', 'idea')
  );

  return jsonb_build_object('ok', true, 'content_item_id', v_item_id, 'version_number', 1);
end;
$$;

comment on function public.create_content_item_with_version(uuid, uuid, text, uuid, uuid, uuid, text, text, text, text, timestamptz, text, uuid, text, text, text, text, jsonb, text) is 'RPC transaksional (0008, P2-09; scope ditegakkan 0026): buat content item + versi v1 + status event + activity log dalam satu transaksi. SECURITY DEFINER — ditinjau; cek role sendiri via is_ws_member; brand di luar brand_scope pemanggil ditolak; tanpa token.';

-- ============================================================================
-- Fungsi 2 — convert_idea_to_content (0012 + cek scope 0026)
-- ============================================================================
create or replace function public.convert_idea_to_content(
  p_idea_id uuid,
  p_title text default null,
  p_brand_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_idea public.ideas%rowtype;
  v_brand_id uuid;
  v_ws_tz text;
  v_item_id uuid;
  v_title text;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;
  select * into v_idea from public.ideas where id = p_idea_id;
  if v_idea.id is null then
    return jsonb_build_object('ok', false, 'message', 'Ide tidak ditemukan.');
  end if;
  if v_idea.status = 'converted' or v_idea.converted_content_item_id is not null then
    return jsonb_build_object('ok', false, 'message', 'Ide ini sudah dikonversi dan tidak bisa dikonversi ulang.');
  end if;
  if not (
    public.is_ws_member(v_idea.workspace_id, array['owner', 'admin', 'manager', 'strategist'])
    or (public.is_ws_member(v_idea.workspace_id, array['creator', 'editor']) and v_idea.owner_user_id = v_caller)
  ) then
    return jsonb_build_object('ok', false, 'message', 'Anda tidak berhak mengonversi ide ini.');
  end if;

  -- Brand efektif: parameter mengalahkan brand ide. Keduanya NULL → tolak
  -- bersih (content_items.brand_id NOT NULL — item konten wajib punya
  -- brand; lihat header 0012).
  v_brand_id := coalesce(p_brand_id, v_idea.brand_id);
  if v_brand_id is null then
    return jsonb_build_object('ok', false, 'message', 'Ide ini belum punya brand. Pilih brand dulu sebelum dikonversi.');
  end if;
  if not exists (
    select 1 from public.brands
    where id = v_brand_id and workspace_id = v_idea.workspace_id
  ) then
    return jsonb_build_object('ok', false, 'message', 'Brand tidak ditemukan di workspace ini.');
  end if;
  -- Brand scope (0016, ditegakkan 0026 — (b) K-3): cek terhadap brand
  -- EFEKTIF (bukan hanya brand ide) — p_brand_id yang di luar scope
  -- tidak boleh dipakai untuk lolos dari scope brand ide.
  if not public.brand_in_scope(v_brand_id) then
    return jsonb_build_object('ok', false, 'message', 'Brand di luar scope Anda.');
  end if;

  v_title := nullif(btrim(coalesce(p_title, v_idea.title, '')), '');
  if v_title is null then
    return jsonb_build_object('ok', false, 'message', 'Judul konten wajib diisi.');
  end if;
  select timezone into v_ws_tz from public.workspaces where id = v_idea.workspace_id;

  insert into public.content_items (
    workspace_id, brand_id, title, internal_description,
    production_status, owner_user_id, timezone, origin_idea_id
  ) values (
    v_idea.workspace_id, v_brand_id, v_title, v_idea.notes,
    'idea', v_caller, coalesce(v_ws_tz, 'Asia/Jakarta'), p_idea_id
  ) returning id into v_item_id;

  insert into public.content_versions (
    content_item_id, version_number, brief_snapshot, change_summary, created_by
  ) values (
    v_item_id, 1, '{}'::jsonb, 'Dibuat dari ide', v_caller
  );

  update public.ideas set
    status = 'converted',
    converted_content_item_id = v_item_id,
    updated_at = now()
  where id = p_idea_id;

  insert into public.content_status_events (
    content_item_id, from_status, to_status, actor_user_id, reason
  ) values (
    v_item_id, null, 'idea', v_caller, 'Dibuat dari ide'
  );

  insert into public.activity_logs (
    workspace_id, actor_user_id, entity_type, entity_id, action, after_snapshot
  ) values (
    v_idea.workspace_id, v_caller, 'content_item', v_item_id, 'content_created_from_idea',
    jsonb_build_object('title', v_title, 'origin_idea_id', p_idea_id)
  );

  return jsonb_build_object('ok', true, 'content_item_id', v_item_id, 'version_number', 1);
end;
$$;

comment on function public.convert_idea_to_content(uuid, text, uuid) is 'RPC transaksional (0008, diperbaiki 0012, P2-08; scope ditegakkan 0026): konversi ide → content item + v1 + tandai converted dalam satu transaksi; tolak konversi ulang; brand efektif = p_brand_id atau brand ide (wajib ada — content_items.brand_id NOT NULL); brand efektif di luar brand_scope pemanggil ditolak. SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- GRANT — hanya authenticated (pola 0008/0010/0012). CREATE OR REPLACE
-- mempertahankan ACL lama, tetapi revoke/grant ditulis ulang di sini agar
-- migrasi ini lengkap bila dijalankan di database yang ACL-nya pernah
-- diubah manual.
-- ============================================================================
revoke all on function public.create_content_item_with_version(uuid, uuid, text, uuid, uuid, uuid, text, text, text, text, timestamptz, text, uuid, text, text, text, text, jsonb, text) from public;
grant execute on function public.create_content_item_with_version(uuid, uuid, text, uuid, uuid, uuid, text, text, text, text, timestamptz, text, uuid, text, text, text, text, jsonb, text) to authenticated;
revoke all on function public.convert_idea_to_content(uuid, text, uuid) from public;
grant execute on function public.convert_idea_to_content(uuid, text, uuid) to authenticated;

-- ============================================================================
-- AKHIR MIGRASI 0026 — 2 RPC diganti (cek brand scope di dalam fungsi).
-- ============================================================================
