# ADR-0004 — Autentikasi Supabase Auth (cookie-based SSR)

- **Status:** Diterima. **Tanggal:** 2026-11-19. **Konteks:** P1-07, Dok 04 §1.
- **Keputusan:** Supabase Auth + `@supabase/ssr` (cookie-based SSR/session).
  Proyek: "mative", ref `kwyqtlxglhlvtghfrnhr`, Free, ap-southeast-1.
  Kunci publik format baru `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  (sb_publishable_...) diutamakan; anon JWT sebagai fallback.
- **Default aman provider (P1-A4):** tanpa MFA wajib, tanpa kebijakan kata
  sandi kustom. Revokasi sesi seketika mengikuti kemampuan provider; bila
  tidak didukung seketika, itu known limitation (bukan klaim "segera").
- **Lazy/opsional:** client Supabase dibuat hanya bila env tersedia
  (`lib/supabase/*` mengembalikan null bila belum dikonfigurasi) agar
  production build lolos tanpa kredensial; halaman menampilkan status jujur
  "Supabase belum dikonfigurasi".
- **Service-role key:** HANYA di server, HANYA untuk operasi admin eksplisit
  (pengiriman email undangan otomatis). TIDAK PERNAH ke browser/bundle/log.
  Dipegang koordinator; tidak ada di repo ini.
- **Profil:** `profiles.id = auth.users.id`; dibuat/diisi aplikasi setelah
  sign up (upsert), tanpa trigger `handle_new_user`.
- **Konsekuensi:** auth end-to-end (sign up → buat workspace → undang anggota)
  hanya bisa dibuktikan setelah migrasi diterapkan + akun uji dibuat
  (lihat docs/apply-migrations.md).
