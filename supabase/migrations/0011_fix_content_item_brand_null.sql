-- ============================================================================
-- MaTive — Migrasi 0011: perbaiki trigger scope content_items untuk brand NULL
-- (defek laten Phase 2, ditemukan saat penerimaan Phase 3 — 2026-11-19)
-- ============================================================================
-- MASALAH
--   validate_content_item_scope() (0007) memeriksa brand_id TANPA guard
--   NULL:
--       select workspace_id into v_ws from public.brands where id = new.brand_id;
--       if v_ws is null or v_ws <> new.workspace_id then
--         raise exception 'scope mismatch: content_items.brand_id ...';
--       end if;
--   Bila new.brand_id NULL, SELECT tidak menemukan baris -> v_ws NULL ->
--   trigger melempar scope mismatch. Padahal:
--     (a) kolom content_items.brand_id NULLABLE menurut skema 0007
--         ("workspace_id, brand_id, campaign_id nullable, ...");
--     (b) validate_idea_scope() (0007) SUDAH mengizinkan brand NULL
--         ("if new.brand_id is null then return new; end if;");
--     (c) ide BOLEH dibuat tanpa brand (IdeaForm: brand opsional), dan
--         RPC convert_idea_to_content (0008) menyalin brand_id ide apa
--         adanya -> ide tanpa brand menghasilkan content item brand NULL.
--   Akibat: konversi ide tanpa brand SELALU gagal dengan
--   "Gagal mengonversi ide: scope mismatch: content_items.brand_id
--   belongs to a different workspace" — terbukti lewat e2e production.spec.ts
--   2026-11-19 (alert di halaman /ide; konversi tidak pernah berhasil).
--   Trigger ini jalan di INSERT OR UPDATE, jadi item tanpa brand juga
--   tidak bisa di-update (mis. simpan brief) sebelum perbaikan ini.
--
-- PERBAIKAN (pola yang sama dengan validate_idea_scope + guard
-- campaign_id/pillar_id/audience_id di fungsi yang sama): lewati
-- pemeriksaan brand bila new.brand_id IS NULL. Brand yang terisi TETAP
-- wajib satu workspace (tidak ada pelonggaran keamanan).
--   Migrasi 0007 TIDAK DIUBAH (sudah diterapkan live) — perbaikan lewat
--   CREATE OR REPLACE FUNCTION di migrasi baru ini.
--
-- TIDAK DIUBAH: validate_content_placement_scope sengaja MENOLAK placement
-- pada item tanpa brand ("Placement HANYA ke channel dengan brand yang
-- SAMA dengan item") — itu keputusan desain, bukan defect. Item tanpa
-- brand baru bisa diberi placement setelah brand diisi lewat edit konten.
-- ============================================================================

create or replace function public.validate_content_item_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ws uuid;
begin
  -- Brand NULL diizinkan (kolom nullable; ide tanpa brand sah) — sama
  -- seperti validate_idea_scope(). Brand yang terisi tetap wajib satu
  -- workspace dengan item.
  if new.brand_id is not null then
    select workspace_id into v_ws from public.brands where id = new.brand_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.brand_id belongs to a different workspace';
    end if;
  end if;
  if new.campaign_id is not null then
    select workspace_id into v_ws from public.campaigns where id = new.campaign_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.campaign_id belongs to a different workspace';
    end if;
  end if;
  if new.pillar_id is not null then
    select workspace_id into v_ws from public.content_pillars where id = new.pillar_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.pillar_id belongs to a different workspace';
    end if;
  end if;
  if new.audience_id is not null then
    select workspace_id into v_ws from public.audiences where id = new.audience_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.audience_id belongs to a different workspace';
    end if;
  end if;
  if new.origin_idea_id is not null then
    select workspace_id into v_ws from public.ideas where id = new.origin_idea_id;
    if v_ws is null or v_ws <> new.workspace_id then
      raise exception 'scope mismatch: content_items.origin_idea_id belongs to a different workspace';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.validate_content_item_scope() is 'Trigger scope (0007, diperbaiki 0011): item-brand/campaign/pillar/audience/origin-idea satu workspace; brand NULL diizinkan (kolom nullable, ide tanpa brand sah — pola validate_idea_scope). SECURITY DEFINER, ditinjau — hanya baca scope + raise.';

-- Hardening (pola revoke 0006/0007/0008/0010): fungsi SECURITY DEFINER
-- tidak boleh dipanggil langsung oleh siapa pun — hanya trigger yang
-- menjalankannya. CREATE OR REPLACE mempertahankan ACL lama; 0007 tidak
-- pernah me-revoke fungsi validate_* sehingga revoke ditegaskan di sini.
revoke all on function public.validate_content_item_scope() from public;
