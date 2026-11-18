"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { profileSchema } from "@/lib/validation/schemas";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";

export type ActionResult = { ok: boolean; message: string };

export async function updateProfileAction(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = profileSchema.safeParse({
    displayName: formData.get("displayName"),
    locale: formData.get("locale"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { ok: false, message: SUPABASE_NOT_CONFIGURED_ID };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Anda harus masuk dulu." };
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      display_name: parsed.data.displayName,
      locale: parsed.data.locale,
      timezone: parsed.data.timezone,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, message: `Gagal menyimpan profil: ${error.message}` };
  revalidatePath("/profil");
  return { ok: true, message: "Profil disimpan." };
}
