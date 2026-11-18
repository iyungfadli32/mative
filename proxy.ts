import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { envStatus, getSupabasePublicKey } from "@/lib/env";

/**
 * Middleware — refresh sesi Supabase di setiap request (pola resmi Supabase).
 * Bila Supabase belum dikonfigurasi, middleware TIDAK memblokir apa pun:
 * halaman publik + halaman auth tetap bisa dirender dan memberi tahu
 * status "belum dikonfigurasi" (lihat ADR-0004).
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  if (!envStatus.supabaseConfigured) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    getSupabasePublicKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
