/**
 * Validasi environment — lib/env.ts
 * Aturan: TIDAK ADA nilai rahasia di file ini. Fungsi ini hanya membaca
 * process.env dan melaporkan nama variabel yang hilang.
 * Aplikasi BOLEH jalan tanpa Supabase (mode "belum dikonfigurasi") agar
 * production build lolos sebelum proyek Supabase tersedia (lihat ADR-0004).
 */

export type EnvStatus = {
  /** true bila URL + kunci publik tersedia (auth/data Supabase bisa dipakai). */
  supabaseConfigured: boolean;
  /** true bila service-role key tersedia (HANYA server; tidak pernah ke browser). */
  serviceRoleConfigured: boolean;
  /** Nama variabel yang hilang (untuk pesan "belum dikonfigurasi" yang jujur). */
  missing: string[];
  appUrl: string;
  defaultTimezone: string;
  /** true bila memakai format kunci publishable baru (sb_publishable_...). */
  usesPublishableKey: boolean;
};

/**
 * Kunci publik Supabase: format baru NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * (sb_publishable_...) diutamakan; format lama NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (JWT) tetap didukung sebagai fallback. Keduanya bersifat publik dan aman
 * di browser — RLS yang menegakkan izin. Nilai TIDAK PERNAH dicatat ke log.
 */
export function getSupabasePublicKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  );
}

function readEnv(): EnvStatus {
  const missing: string[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const pubKey = getSupabasePublicKey();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!pubKey) {
    missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (atau NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  }
  if (!serviceRole) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return {
    supabaseConfigured: Boolean(url && pubKey),
    serviceRoleConfigured: Boolean(serviceRole),
    missing,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    // Keputusan #13: timezone default workspace Asia/Jakarta.
    defaultTimezone: process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE ?? "Asia/Jakarta",
    usesPublishableKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  };
}

export const envStatus: EnvStatus = readEnv();

/** Pesan jujur untuk UI saat Supabase belum dikonfigurasi. */
export const SUPABASE_NOT_CONFIGURED_ID =
  "Supabase belum dikonfigurasi di environment ini. Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY di .env.local (lihat .env.example).";
