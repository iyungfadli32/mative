import { NextResponse, type NextRequest } from "next/server";
import { retryPublishingJobCore } from "@/features/publishing/actions";
import { actionStatusFor, errorJson, requireContext } from "../../../helpers";

/** POST /api/v1/publishing/jobs/:id/retry?workspace=<id> — retry eksplisit (A6.4). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = req.nextUrl.searchParams.get("workspace");
  const { supabase, ctx } = await requireContext(workspaceId);
  if (!supabase) return errorJson("UNAVAILABLE", "Supabase belum dikonfigurasi.", 503);
  if (!ctx) return errorJson("UNAUTHENTICATED", "Anda harus masuk dulu.", 401);
  const result = await retryPublishingJobCore(supabase, ctx.userId, {
    workspaceId: ctx.workspace.workspaceId,
    jobId: id,
  });
  if (!result.ok) {
    return errorJson(
      result.code ?? "PUBLISHING_ERROR",
      result.message,
      actionStatusFor(result.code),
    );
  }
  return NextResponse.json({ ok: true, data: { job_id: id, message: result.message } });
}
