import { NextResponse, type NextRequest } from "next/server";
import { getApprovalRequest, listApprovalDecisions, listWorkflowSteps } from "@/features/approval/queries";
import { errorJson, requireContext } from "../helpers";

/** GET /api/v1/approvals/:id — detail request + keputusan + step (Dok 07 §6). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase, ctx } = await requireContext(null);
  if (!supabase) return errorJson("UNAVAILABLE", "Supabase belum dikonfigurasi.", 503);
  if (!ctx) return errorJson("UNAUTHENTICATED", "Anda harus masuk dulu.", 401);
  const reqRes = await getApprovalRequest(supabase, id);
  if (reqRes.unavailable)
    return errorJson("UNAVAILABLE", "Tabel approval belum tersedia (migrasi 0013/0014).", 503);
  const request = reqRes.data;
  if (!request) return errorJson("NOT_FOUND", "Approval request tidak ditemukan.", 404);
  if (request.workspace_id !== ctx.workspace.workspaceId)
    return errorJson("FORBIDDEN", "Request ini bukan milik workspace Anda.", 403);
  const [decRes, stepsRes] = await Promise.all([
    listApprovalDecisions(supabase, id),
    listWorkflowSteps(supabase, request.workflow_id),
  ]);
  return NextResponse.json({
    ok: true,
    data: { request, decisions: decRes.data, steps: stepsRes.data },
  });
}
