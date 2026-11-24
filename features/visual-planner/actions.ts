/**
 * Server actions Visual Planner — features/visual-planner/actions.ts (P5-05).
 * Satu-satunya jalan menulis urutan visual adalah RPC set_visual_order
 * (0017) — RPC TIDAK PERNAH menulis scheduled_at (R5.1; diuji statis di
 * tests/migrations.test.ts + pgTAP 05). Penegakan scope brand ada di RPC;
 * lapis aplikasi di sini hanya memberi pesan galat yang jelas.
 */
"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";
import { brandInScope, can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { visualOrderSchema } from "@/lib/validation/schemas";
import { getCallerBrandScope, getCallerRole } from "@/features/planning/context";
import type { CampaignActionResult } from "@/features/campaign/actions";

export async function setVisualOrderAction(formData: FormData): Promise<CampaignActionResult> {
  const parsed = visualOrderSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    brandId: formData.get("brandId"),
    channelId: formData.get("channelId"),
    placementIds: formData.getAll("placementIds"),
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
  const role = (await getCallerRole(parsed.data.workspaceId, user.id)) as WorkspaceRole | null;
  if (!role || !can(role, "manage_pillars_campaigns")) {
    return { ok: false, message: "Peran Anda tidak boleh mengatur urutan visual." };
  }
  const scope = await getCallerBrandScope(parsed.data.workspaceId, user.id);
  if (!brandInScope(scope, parsed.data.brandId)) {
    return { ok: false, message: "Brand ini di luar scope Anda." };
  }
  const { data, error } = await supabase.rpc("set_visual_order", {
    p_workspace_id: parsed.data.workspaceId,
    p_brand_id: parsed.data.brandId,
    p_channel_id: parsed.data.channelId,
    p_placement_ids: parsed.data.placementIds,
  });
  if (error) {
    console.error("[visual-planner] gagal menyimpan urutan", error.message);
    return { ok: false, message: "Gagal menyimpan urutan visual. Coba lagi." };
  }
  const result = data as { ok: boolean; code?: string; message?: string } | null;
  if (!result?.ok) {
    return { ok: false, message: result?.message ?? "Gagal menyimpan urutan visual." };
  }
  revalidatePath(`/kampanye`);
  return {
    ok: true,
    message:
      parsed.data.placementIds.length === 0
        ? "Urutan visual dihapus untuk scope ini."
        : `Urutan visual disimpan (${parsed.data.placementIds.length} placement). Jadwal (scheduled_at) tidak berubah.`,
  };
}
