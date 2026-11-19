import { NextResponse, type NextRequest } from "next/server";
import { listApprovalQueue } from "@/features/approval/queries";
import { APPROVAL_QUEUE_TABS } from "@/features/approval/constants";
import type { ApprovalQueueTab } from "@/features/approval/types";
import { errorJson, requireContext } from "./helpers";

/**
 * API v1 approval (P4-07, Dok 07 §6).
 * Kode error: FORBIDDEN / INVALID_STATE_TRANSITION / APPROVAL_REQUIRED /
 * NOT_FOUND / UNAUTHENTICATED. TIDAK ADA perubahan status langsung —
 * keputusan hanya lewat POST /:id/decisions (RPC decide_approval_request).
 * Identitas (user/role/workspace) SELALU dari sesi + DB, BUKAN dari body.
 */

/** GET /api/v1/approvals?workspace=<id>&tab=<tab> — antrean approval. */
export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspace");
  const tabParam = req.nextUrl.searchParams.get("tab") ?? "menunggu_saya";
  const tab: ApprovalQueueTab = (APPROVAL_QUEUE_TABS as readonly string[]).includes(tabParam)
    ? (tabParam as ApprovalQueueTab)
    : "menunggu_saya";
  const { supabase, ctx } = await requireContext(workspaceId);
  if (!supabase) return errorJson("UNAVAILABLE", "Supabase belum dikonfigurasi.", 503);
  if (!ctx) return errorJson("UNAUTHENTICATED", "Anda harus masuk dulu.", 401);
  const res = await listApprovalQueue(
    supabase,
    ctx.workspace.workspaceId,
    ctx.userId,
    ctx.role,
    tab,
  );
  if (res.unavailable)
    return errorJson("UNAVAILABLE", "Tabel approval belum tersedia (migrasi 0013/0014).", 503);
  if (res.error) return errorJson("INTERNAL", res.error, 500);
  return NextResponse.json({ ok: true, data: res.data, tab });
}
