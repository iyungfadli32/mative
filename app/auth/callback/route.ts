import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// S-1: tukar ?code= dari tautan email Supabase (konfirmasi akun / reset kata
// sandi) menjadi sesi, lalu arahkan ke halaman tujuan. Hanya tujuan internal
// yang diizinkan agar rute ini tidak bisa dipakai sebagai open redirect.
const ALLOWED_NEXT = ["/dashboard", "/reset-password", "/profil"];

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requested = request.nextUrl.searchParams.get("next") ?? "/dashboard";
  const next = ALLOWED_NEXT.includes(requested) ? requested : "/dashboard";
  if (!code) {
    return NextResponse.redirect(new URL("/masuk", request.url));
  }
  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/masuk", request.url));
  }
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const url = new URL("/masuk", request.url);
    url.searchParams.set("error", "tautan-kedaluwarsa");
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(new URL(next, request.url));
}
