import { NextResponse, type NextRequest } from "next/server";
import { getCallerRole } from "@/features/planning/context";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { decideApprovalSchema } from "@/lib/validation/schemas";
import { errorJson, requireContext } from "../../helpers";

/**
 * POST /api/v1/approvals/:id/decisions — catat keputusan approval
 * (approve / request-changes / reject), Dok 07 §6.
 * Identitas (user/role/workspace) dari sesi + DB, BUKAN dari body.
 * Keputusan append-only; penugasan + stale + kuorum ditegakkan RPC.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return errorJson("INVALID_STATE_TRANSITION", "Body JSON tidak valid.", 400);
  }
  const parsed = decideApprovalSchema.safeParse({
    requestId: id,
    workspaceId: (body as { workspaceId?: unknown } | null)?.workspaceId,
    decision: (body as { decision?: unknown } | null)?.decision,
    comment: (body as { comment?: unknown } | null)?.comment ?? "",
  });
  if (!parsed.success)
    return errorJson(
      "INVALID_STATE_TRANSITION",
      parsed.error.issues[0]?.message ?? "Data tidak valid.",
      400,
    );
  const { supabase, ctx } = await requireContext(parsed.data.workspaceId);
  if (!supabase) return errorJson("UNAVAILABLE", "Supabase belum dikonfigurasi.", 503);
  if (!ctx) return errorJson("UNAUTHENTICATED", "Anda harus masuk dulu.", 401);
  const role = await getCallerRole(parsed.data.workspaceId, ctx.userId);
  if (!role || !can(role as WorkspaceRole, "approve_assigned"))
    return errorJson("FORBIDDEN", "Peran Anda tidak boleh memutuskan approval.", 403);
  const { data, error } = await supabase.rpc("decide_approval_request", {
    p_request_id: parsed.data.requestId,
    p_decision: parsed.data.decision,
    p_comment: parsed.data.comment || null,
  });
  if (error) return errorJson("INTERNAL", `Gagal mencatat keputusan: ${error.message}`, 500);
  const result = data as { ok: boolean; code?: string | null; message?: string | null } | null;
  if (!result?.ok) {
    const code = result?.code ?? "INVALID_STATE_TRANSITION";
    const status = code === "FORBIDDEN" ? 403 : 409;
    return errorJson(code, result?.message ?? "Gagal mencatat keputusan.", status);
  }
  return NextResponse.json({ ok: true, data: result }, { status: 200 });
}
