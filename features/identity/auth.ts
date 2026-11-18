"use server";

import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { signInSchema, signUpSchema } from "@/lib/validation/schemas";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";

/**
 * Server actions auth — features/identity/auth.ts (P1-07).
 * Cookie-based SSR via Supabase Auth. Default aman provider (P1-A4):
 * tanpa MFA wajib, tanpa kebijakan kata sandi kustom.
 * Revokasi sesi seketika mengikuti kemampuan provider — bila tidak
 * didukung, itu known limitation (lihat laporan fase).
 */

export type ActionResult = { ok: boolean; message: string };

/** Signature (prevState, formData) sesuai useActionState React 19. */
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
    options: { data: { display_name: parsed.data.displayName } },
  });
  if (error) return { ok: false, message: error.message };
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
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { ok: false, message: "Email atau kata sandi salah." };
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  const supabase = await getSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/masuk");
}
