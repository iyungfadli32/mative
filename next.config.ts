import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Supabase belum dikonfigurasi saat build awal: halaman yang memakai
  // Supabase harus lazy/opsional agar production build lolos tanpa kredensial.
  // Lihat lib/supabase/* dan docs/decisions/ADR-0004-auth-supabase.md.
};

export default nextConfig;
