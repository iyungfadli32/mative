/**
 * Supabase server client — lib/supabase/server.ts
 * Cookie-based SSR (pola resmi Supabase + Next.js).
 * LAZY/OPSIONAL: mengembalikan null bila env belum dikonfigurasi.
 * Service-role client HANYA dibuat di server, HANYA bila
 * SUPABASE_SERVICE_ROLE_KEY tersedia, dan HANYA untuk operasi admin
 * eksplisit (mis. undangan). Jangan pernah mengimpor file ini dari
 * komponen client.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { envStatus, getSupabasePublicKey } from "@/lib/env";

export async function getSupabaseServerClient(): Promise<SupabaseClient | null> {
  if (!envStatus.supabaseConfigured) return null;
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    getSupabasePublicKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Dipanggil dari Server Component: set cookie tidak didukung di sini;
            // middleware yang me-refresh sesi (lihat middleware.ts).
          }
        },
      },
      // Data SELALU segar: fetch Next.js tidak boleh men-cache respons
      // PostgREST (cacat e2e 2026-11-19: daftar brand di /konten/baru
      // basi sesudah brand dibuat — render pertama sesudah mutasi tidak
      // melihat baris baru, padahal barisnya sudah terlihat via REST;
      // revalidatePath (termasuk /konten/baru) TIDAK membersihkannya —
      // terbukti 4x via probe). no-store di sini membuat setiap baca
      // server mengenai database live; biaya tambahannya kecil untuk
      // aplikasi operasi ini.
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: "no-store" }),
      },
    },
  );
}

/** Client admin (service role). null bila key tidak tersedia. Server-only. */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (!envStatus.supabaseConfigured || !envStatus.serviceRoleConfigured) {
    return null;
  }
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Pengguna dari sesi saat ini, atau null bila belum login / belum dikonfigurasi. */
export async function getCurrentUser() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
