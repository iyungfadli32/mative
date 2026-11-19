-- 0019_brands_insert_scope_fix.sql — MaTive Phase 5 (perbaikan cacat policy 0016).
--
-- Latar: e2e Phase 5 live 2026-11-19 (chromium) — ketiga tes @needs-db
-- (A5.1/A5.3/A5.5) gagal di langkah yang sama, SEBELUM menyentuh fitur
-- Phase 5: "Buat brand" mengembalikan
--   new row violates row-level security policy for table "brands"
-- padahal pemanggil adalah owner workspace dengan brand_scope NULL
-- (scope penuh). Bukan cacat aplikasi, bukan cacat tes — cacat POLICY.
--
-- Akar masalah: 0016 menulis ulang policy
-- "brands_insert_owner_admin_manager" dengan WITH CHECK
--   is_ws_member(...) AND brand_in_scope(brands.id)
-- brand_in_scope(id) mencari brand itu di public.brands — tetapi baris
-- yang sedang di-INSERT belum ada di tabel, jadi exists(...) selalu
-- false dan INSERT ditolak untuk SEMUA peran, termasuk owner scope
-- penuh. Policy INSERT lain di 0016 tidak kena: mereka memeriksa
-- brand_in_scope(<FK ke brand YANG SUDAH ADA>) atau NULL (= true).
-- pgTAP 05 tidak menangkap ini: ia hanya menguji SELECT brand (T3)
-- + INSERT sebagai postgres (bypass RLS) — tidak pernah INSERT brand
-- sebagai authenticated.
--
-- Perbaikan: buat ulang policy INSERT brand TANPA conjunct
-- brand_in_scope(brands.id). Pembuatan brand tetap dibatasi ke
-- owner/admin/manager workspace (sama seperti sebelum 0016, dan sama
-- seperti server action createBrandAction yang memakai capability
-- manage_brands_channels tanpa cek scope). Scope tetap ditegakkan
-- pada SELECT + UPDATE (baris sudah ada, jadi brand_in_scope bekerja).
--
-- Batas jujur yang disadari: anggota ber-scope terbatas yang membuat
-- brand TIDAK langsung melihat brand itu (SELECT menyembunyikannya
-- karena id baru tidak ada di scope-nya) sampai owner menambahkannya
-- ke scope-nya. Fail-safe di sisi baca, bukan kebocoran — tetapi
-- membingungkan; bila nanti diputuskan hanya scope penuh yang boleh
-- membuat brand, itu perubahan perilaku terpisah (bukan 0019).
-- 0016 TIDAK diubah (sudah live); 0019 menimpa policynya saja.

drop policy if exists "brands_insert_owner_admin_manager" on public.brands;
create policy "brands_insert_owner_admin_manager"
  on public.brands for insert
  to authenticated
  with check (
    public.is_ws_member(brands.workspace_id, array['owner', 'admin', 'manager'])
  );
