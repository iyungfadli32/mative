"use server";

import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  passwordResetRequestSchema,
  passwordUpdateSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/schemas";
import { envStatus, SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";

/**
 * Server actions auth — features/identity/auth.ts (P1-07).
 * Cookie-based SSR via Supabase Auth. Default aman provider (P1-A4):
 * tanpa MFA wajib, tanpa kebijakan kata sandi kustom.
 * Revokasi sesi seketika mengikuti kemampuan provider — bila tidak
 * didukung, itu known limitation (lihat laporan fase).
 */

export type ActionResult = { ok: boolean; message: string };

/** Signature (prevState, formData) sesuai useActionState React 19. */
// S-1/S-4: pesan generik agar tidak terjadi enumerasi email. Detail error
// hanya dicatat ke log server, tidak pernah dikembalikan ke UI.
const GENERIC_SIGNUP_MESSAGE =
  "Bila email belum terdaftar, tautan konfirmasi dikirim. Periksa inbox Anda.";
const GENERIC_RESET_MESSAGE =
  "Bila email terdaftar, tautan reset kata sandi telah dikirim. Periksa inbox Anda.";

function authCallbackUrl(next: string) {
  return `${envStatus.appUrl}/auth/callback?next=${encodeURIComponent(next)}`;
}

export async function signUpAction(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { ok: false, message: SUPABASE_NOT_CONFIGURED_ID };
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: authCallbackUrl("/dashboard"),
    },
  });
  if (error) {
    console.error("[auth] signUp gagal", error.message);
    return { ok: false, message: GENERIC_SIGNUP_MESSAGE };
  }
  return { ok: true, message: "Akun dibuat. Periksa email Anda bila verifikasi diminta." };
}

export async function signInAction(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { ok: false, message: SUPABASE_NOT_CONFIGURED_ID };
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (/email not confirmed/i.test(error.message)) {
      return {
        ok: false,
        message:
          "Email belum dikonfirmasi. Periksa inbox Anda, atau kirim ulang tautan konfirmasi dari halaman Kirim ulang.",
      };
    }
    return { ok: false, message: "Email atau kata sandi salah." };
  }
  // S-1: tolak akun yang belum terkonfirmasi meski sign-in lolos (mis. bila
  // penegakan konfirmasi dimatikan di dashboard Supabase).
  if (data.user && !data.user.email_confirmed_at) {
    await supabase.auth.signOut();
    return {
      ok: false,
      message:
        "Email belum dikonfirmasi. Periksa inbox Anda, atau kirim ulang tautan konfirmasi dari halaman Kirim ulang.",
    };
  }
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  const supabase = await getSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/masuk");
}

// S-1: kirim ulang tautan konfirmasi email. Selalu menjawab generik agar
// tidak membocorkan apakah email terdaftar / sudah terkonfirmasi.
export async function resendConfirmationAction(
  prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void prevState;
  const parsed = passwordResetRequestSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Masukkan email yang valid.",
    };
  }
  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return { ok: false, message: "Layanan autentikasi belum dikonfigurasi." };
  }
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: authCallbackUrl("/dashboard") },
  });
  if (error) {
    console.error("[auth] kirim ulang konfirmasi gagal", error.message);
  }
  return {
    ok: true,
    message:
      "Bila email terdaftar dan belum dikonfirmasi, tautan konfirmasi baru telah dikirim. Periksa inbox Anda.",
  };
}

// S-1: minta tautan reset kata sandi. Selalu menjawab generik (tanpa
// enumerasi email); tautan mengarah ke /auth/callback lalu /reset-password.
export async function requestPasswordResetAction(
  prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void prevState;
  const parsed = passwordResetRequestSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Masukkan email yang valid.",
    };
  }
  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return { ok: false, message: "Layanan autentikasi belum dikonfigurasi." };
  }
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    { redirectTo: authCallbackUrl("/reset-password") },
  );
  if (error) {
    console.error("[auth] minta reset kata sandi gagal", error.message);
  }
  return { ok: true, message: GENERIC_RESET_MESSAGE };
}

// S-1: ubah kata sandi. Dipakai dari tautan reset (sesi recovery) maupun
// oleh pengguna yang sedang masuk (ganti kata sandi).
export async function updatePasswordAction(
  prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void prevState;
  const parsed = passwordUpdateSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Kata sandi tidak valid.",
    };
  }
  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return { ok: false, message: "Layanan autentikasi belum dikonfigurasi." };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      message:
        "Sesi reset tidak valid atau sudah kedaluwarsa. Minta tautan reset baru dari halaman Lupa kata sandi.",
    };
  }
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    console.error("[auth] ubah kata sandi gagal", error.message);
    return {
      ok: false,
      message: "Gagal mengubah kata sandi. Minta tautan reset baru dan coba lagi.",
    };
  }
  return {
    ok: true,
    message: "Kata sandi berhasil diubah. Silakan masuk dengan kata sandi baru.",
  };
}
