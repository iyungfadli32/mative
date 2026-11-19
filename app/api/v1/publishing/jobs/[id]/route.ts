import { NextResponse, type NextRequest } from "next/server";
import { getPublishingJob } from "@/features/publishing/queries";
import { PUBLISHING_TABLES_UNAVAILABLE_ID } from "@/features/publishing/constants";
import { errorJson, requireContext } from "../../helpers";

/** GET /api/v1/publishing/jobs/:id?workspace=<id> — satu job + attempts + bukti terbit. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = req.nextUrl.searchParams.get("workspace");
  const { supabase, ctx } = await requireContext(workspaceId);
  if (!supabase) return errorJson("UNAVAILABLE", "Supabase belum dikonfigurasi.", 503);
  if (!ctx) return errorJson("UNAUTHENTICATED", "Anda harus masuk dulu.", 401);
  const res = await getPublishingJob(supabase, id);
  if (!res.ok) return errorJson("UNAVAILABLE", PUBLISHING_TABLES_UNAVAILABLE_ID, 503);
  if (!res.data || res.data.workspace_id !== ctx.workspace.workspaceId) {
    return errorJson("NOT_FOUND", "Job tidak ditemukan.", 404);
  }
  return NextResponse.json({ ok: true, data: res.data });
}
