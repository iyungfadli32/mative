-- ============================================================================
-- MaTive — Migrasi 0012: convert_idea_to_content terima p_brand_id + guard
-- brand NULL (perbaikan defect konversi ide tanpa brand, ditemukan saat
-- pgTAP 03 live — 2026-11-19)
-- ============================================================================
-- MASALAH
--   RPC convert_idea_to_content (0008) menyalin v_idea.brand_id apa adanya
--   ke content_items.brand_id. Ide BOLEH dibuat tanpa brand (ideas.brand_id
--   nullable; IdeaForm punya opsi "— Tanpa brand —"), tetapi kolom
--   content_items.brand_id NOT NULL — sehingga konversi ide tanpa brand
--   CRASH dengan ERROR 23502 (bukan pesan bersih), terbukti live di pgTAP
--   03 TES 15. Trigger guard 0011 tidak cukup: constraint NOT NULL pada
--   kolomnya sendiri yang memblokir INSERT.
--
-- KEPUTUSAN (dikunci parent 2026-11-19): content_items.brand_id TETAP
-- NOT NULL. Empat sumber sepakat: DDL 0007 baris 200
-- ("brand_id uuid not null ... on delete restrict"); Dok 05 §3 kanonis
-- (content_items mencantumkan brand_id TANPA penanda "nullable", berbeda
-- dengan campaign_id/pillar_id/audience_id/origin_idea_id yang eksplisit
-- nullable); ERD §5 ("BRANDS ||--o{ CONTENT_ITEMS : owns" = tiap item
-- wajib tepat satu brand); skema aplikasi (contentItemSchema brandId =
-- z.string().uuid() WAJIB). Premis lama ("brand_id NULLABLE menurut
-- skema 0007") SALAH — ia membaca komentar header 0007 baris 191, bukan
-- DDL-nya. Migrasi 0011 tidak diubah (guard trigger tetap sebagai
-- defense-in-depth; tidak pernah terpicu selama kolom NOT NULL).
--
-- PERBAIKAN (pola yang sama dengan 0011 — 0008 TIDAK DIUBAH, sudah
-- diterapkan live):
--   (a) RPC menerima parameter opsional p_brand_id; brand efektif =
--       coalesce(p_brand_id, v_idea.brand_id).
--   (b) Bila brand efektif NULL → kembalikan ok:false dengan pesan bersih
--       "Ide ini belum punya brand. Pilih brand dulu sebelum dikonversi."
--       (bukan crash 23502).
--   (c) Bila p_brand_id terisi tetapi bukan brand di workspace yang sama
--       → ok:false "Brand tidak ditemukan di workspace ini."
--   (d) Sisa logika SAMA PERSIS dengan 0008 (izin, judul, v1, status
--       converted, event, log, return).
--
-- CATATAN SIGNATUR: fungsi lama (0008) bersignatur (uuid, text).
-- CREATE OR REPLACE dengan signatur baru (uuid, text, uuid) akan membuat
-- OVERLOAD, bukan mengganti — fungsi lama yang crash pada brand NULL akan
-- tetap ada dan tetap bisa dipanggil. Karena itu fungsi lama di-DROP dulu
-- di file ini, lalu dibuat ulang dengan signatur baru. DROP + CREATE
-- berada dalam SATU migrasi yang sama (fungsi diganti, bukan dihapus).
-- Panggilan lama tetap jalan: p_title dan p_brand_id punya default, jadi
-- pemanggilan 1-arg (pgTAP) dan 2-arg (convertIdeaAction lama) tetap valid.
-- ============================================================================

-- Fungsi lama (0008) di-drop agar tidak tersisa overload yang crash.
drop function if exists public.convert_idea_to_content(uuid, text);

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
  -- brand; lihat header file ini).
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

comment on function public.convert_idea_to_content(uuid, text, uuid) is 'RPC transaksional (0008, diperbaiki 0012, P2-08): konversi ide → content item + v1 + tandai converted dalam satu transaksi; tolak konversi ulang; brand efektif = p_brand_id atau brand ide (wajib ada — content_items.brand_id NOT NULL). SECURITY DEFINER — ditinjau.';

-- ============================================================================
-- GRANT — hanya authenticated (pola 0008/0010). Fungsi baru (uuid, text,
-- uuid) mendapat ACL sendiri; fungsi lama (uuid, text) sudah di-drop di
-- atas sehingga tidak perlu revoke terpisah.
-- ============================================================================
revoke all on function public.convert_idea_to_content(uuid, text, uuid) from public;
grant execute on function public.convert_idea_to_content(uuid, text, uuid) to authenticated;

-- ============================================================================
-- AKHIR MIGRASI 0012 — 1 RPC diganti (signatur baru + guard brand).
-- ============================================================================
