/**
 * Supabase browser client — lib/supabase/client.ts
 * LAZY/OPSIONAL: mengembalikan null bila env belum dikonfigurasi, supaya
 * production build + halaman publik lolos tanpa kredensial (ADR-0004).
 * Jangan pernah memanggil ini di server dengan service-role key.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { envStatus, getSupabasePublicKey } from "@/lib/env";

let browserClient: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (browserClient !== undefined) return browserClient;
  if (!envStatus.supabaseConfigured) {
    browserClient = null;
    return null;
  }
  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    getSupabasePublicKey(),
  );
  return browserClient;
}

export function isSupabaseConfigured(): boolean {
  return envStatus.supabaseConfigured;
}
