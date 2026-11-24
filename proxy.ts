import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { envStatus, getSupabasePublicKey } from "@/lib/env";

/**
 * Middleware — refresh sesi Supabase di setiap request (pola resmi Supabase)
 * + route guard (S-2).
 *
 * - Anonim yang membuka halaman aplikasi (semua rute di luar daftar publik)
 *   diarahkan ke /masuk.
 * - Pengguna yang sudah masuk dan membuka halaman auth diarahkan ke
 *   /dashboard — kecuali /reset-password, yang harus tetap bisa dibuka
 *   dengan sesi recovery (tautan reset) maupun sesi biasa (ganti kata sandi).
 * - Rute publik tetap bisa dibuka anonim: `/` (landing), /portal/[shareId]
 *   (tautan berbagi klien), /undangan/[token] (terima undangan),
 *   /auth/callback (tukar kode email Supabase), dan /api/* (punya otorisasi
 *   sendiri). Data sendiri tetap dilindungi RLS; guard ini pertahanan
 *   berlapis + UX.
 *
 * Bila Supabase belum dikonfigurasi, middleware TIDAK memblokir apa pun:
 * halaman publik + halaman auth tetap bisa dirender dan memberi tahu
 * status "belum dikonfigurasi" (lihat ADR-0004).
 */
const PUBLIC_PREFIXES = [
  "/masuk",
  "/daftar",
  "/lupa-password",
  "/reset-password",
  "/kirim-ulang",
  "/portal",
  "/undangan",
  "/auth",
  "/api",
];

// Halaman auth yang dilempar ke /dashboard bila pengguna sudah masuk.
// /reset-password sengaja tidak ada di sini (lihat komentar di atas).
const AUTH_REDIRECT_PREFIXES = [
  "/masuk",
  "/daftar",
  "/lupa-password",
  "/kirim-ulang",
];

function matchesPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

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
  const { data } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const isPublic = pathname === "/" || matchesPrefix(pathname, PUBLIC_PREFIXES);

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    const redirectResponse = NextResponse.redirect(url);
    // Bawa cookie sesi yang sudah di-refresh ke respons redirect.
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  };

  if (!data.user && !isPublic) {
    return redirectTo("/masuk");
  }
  if (data.user && matchesPrefix(pathname, AUTH_REDIRECT_PREFIXES)) {
    return redirectTo("/dashboard");
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ],
};
