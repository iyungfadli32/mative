-- 0023_ai_generations_select_policy_fix.sql — MaTive Phase 8 (perbaikan cacat policy 0022).
--
-- Latar: e2e Phase 8 live 2026-11-20 (Chromium) — A8.4 gagal di asersi
-- log: sesudah aksi checklist diblokir (injeksi), halaman /ai tetap
-- menampilkan "Belum ada aksi AI yang tercatat di workspace ini."
-- Asersi log A8.2 (not_configured) tidak pernah tercapai karena tes
-- mati lebih dulu di locator pesan (diperbaiki terpisah, test-only),
-- tetapi akar masalahnya sama. Bukan cacat aplikasi, bukan cacat tes
-- — cacat POLICY.
--
-- Akar masalah: 0022 menulis policy SELECT ai_generations dengan
--   using (public.is_ai_generation_visible(ai_generations.id, array[...]))
-- helper itu mencari barisnya di public.ai_generations sendiri
-- (select 1 from public.ai_generations g where g.id = ...).
-- SELECT biasa dan INSERT biasa (tanpa RETURNING) lolos — pgTAP 08
-- 52/52 membuktikannya. Tetapi server action logGeneration memakai
-- pola supabase-js .insert(...).select("id").single() — PostgREST
-- INSERT ... RETURNING — dan Postgres mengevaluasi policy SELECT
-- atas baris baru itu; lookup-ke-diri-sendiri di konteks RETURNING
-- gagal → 42501 "new row violates row-level security policy" dan
-- SELURUH statement di-rollback (baris log tidak tersimpan).
-- Direproduksi langsung via REST sebagai owner workspace (aktif):
--   POST /rest/v1/ai_generations + Prefer: return=representation → 403 42501, 0 baris.
--   POST yang sama + Prefer: return=minimal → 201, baris tersimpan + terlihat di SELECT.
--   Kontrol activity_logs (policy SELECT = is_ws_member langsung,
--   tanpa self-lookup) + return=representation → 201.
-- Pola yang sama sudah diperbaiki di 0019 untuk brands (WITH CHECK
-- memeriksa baris yang sedang di-INSERT di tabelnya sendiri).
--
-- Perbaikan: buat ulang policy SELECT ai_generations TANPA helper
-- self-lookup — langsung is_ws_member(ai_generations.workspace_id,
-- array 8 peran non-klien). Semantik visibilitas SAMA PERSIS dengan
-- helper (member aktif workspace; viewer_client tetap tidak melihat
-- karena tidak ada di daftar peran). Helper is_ai_generation_visible
-- TETAP ADA (dipakai pgTAP 08 T2f/T2g + bisa dipakai pemanggil lain)
-- — yang diubah hanya policy-nya.
-- 0022 TIDAK diubah (sudah live); 0023 menimpa policynya saja.

drop policy if exists "ai_generations_select_member" on public.ai_generations;
create policy "ai_generations_select_member"
  on public.ai_generations for select
  to authenticated
  using (
    public.is_ws_member(ai_generations.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])
  );
