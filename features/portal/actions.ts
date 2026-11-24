"use server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { resourceShareSchema } from "@/lib/validation/schemas";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";

/**
 * Portal klien — features/portal/actions.ts (P1-16, Keputusan #12).
 * viewer_client HANYA membaca resource yang dibagikan eksplisit lewat
 * `resource_shares`. Penegakan di server + RLS (migrasi 0005):
 *  - SELECT share: hanya bila shared_with_user_id = auth.uid()
 *    ATAU pemanggil adalah member workspace pemilik share.
 *  - TIDAK ADA mutasi apa pun untuk viewer_client (RLS menolak INSERT/
 *    UPDATE/DELETE oleh viewer_client pada tabel tenant).
 *  - Komentar klien default TIDAK BOLEH (Keputusan #12) — tidak ada
 *    endpoint komentar klien di fase ini.
 * Daftar share dicatat di activity_logs (audit) oleh trigger migrasi 0005.
 */

export type ActionResult = { ok: boolean; message: string };

export type PortalShare = {
  id: string;
  workspace_id: string;
  resource_type: string;
  resource_id: string;
  shared_with_user_id: string;
  created_at: string;
};

/** Daftar konten yang dibagikan ke pengguna saat ini (khusus portal klien). */
export async function listMyPortalShares(): Promise<PortalShare[]> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("resource_shares")
    .select("id, workspace_id, resource_type, resource_id, shared_with_user_id, created_at")
    .eq("shared_with_user_id", user.id)
    .order("created_at", { ascending: false });
  return (data ?? []) as PortalShare[];
}

/** Detail satu share — RLS menolak bila share ini bukan milik pemanggil. */
export async function getPortalShare(shareId: string): Promise<PortalShare | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("resource_shares")
    .select("id, workspace_id, resource_type, resource_id, shared_with_user_id, created_at")
    .eq("id", shareId)
    .single();
  return (data ?? null) as PortalShare | null;
}

/** Membagikan resource ke klien — hanya owner/admin/manajer workspace. */
export async function shareResourceAction(formData: FormData): Promise<ActionResult> {
  const parsed = resourceShareSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    resourceType: formData.get("resourceType"),
    resourceId: formData.get("resourceId"),
    sharedWithUserId: formData.get("sharedWithUserId"),
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
  const { error } = await supabase.from("resource_shares").insert({
    workspace_id: parsed.data.workspaceId,
    resource_type: parsed.data.resourceType,
    resource_id: parsed.data.resourceId,
    shared_with_user_id: parsed.data.sharedWithUserId,
    shared_by: user.id,
  });
  if (error) {
    console.error("[portal] gagal membagikan", error.message);
    return { ok: false, message: "Gagal membagikan. Coba lagi." };
  }
  return { ok: true, message: "Resource dibagikan ke klien dan tercatat di audit." };
}

/** Mencabut share — hanya member workspace pemilik share (ditegakkan RLS). */
export async function unshareResourceAction(shareId: string): Promise<ActionResult> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { ok: false, message: SUPABASE_NOT_CONFIGURED_ID };
  const { error } = await supabase.from("resource_shares").delete().eq("id", shareId);
  if (error) {
    console.error("[portal] gagal mencabut share", error.message);
    return { ok: false, message: "Gagal mencabut share. Coba lagi." };
  }
  return { ok: true, message: "Share dicabut; klien tidak lagi bisa melihat resource ini." };
}
