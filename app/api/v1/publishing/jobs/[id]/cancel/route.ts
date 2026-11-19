import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { cancelPublishingJobCore } from "@/features/publishing/actions";
import { actionStatusFor, errorJson, requireContext } from "../../../helpers";

const cancelBodySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Alasan pembatalan wajib diisi.")
    .max(500, "Alasan pembatalan maksimal 500 karakter."),
});

/** POST /api/v1/publishing/jobs/:id/cancel?workspace=<id> — batal eksplisit (A6.5). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = req.nextUrl.searchParams.get("workspace");
  const { supabase, ctx } = await requireContext(workspaceId);
  if (!supabase) return errorJson("UNAVAILABLE", "Supabase belum dikonfigurasi.", 503);
  if (!ctx) return errorJson("UNAUTHENTICATED", "Anda harus masuk dulu.", 401);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("INVALID_BODY", "Body JSON tidak valid.", 400);
  }
  const parsed = cancelBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "INVALID_BODY",
      parsed.error.issues[0]?.message ?? "Body tidak valid.",
      400,
    );
  }
  const result = await cancelPublishingJobCore(supabase, ctx.userId, {
    workspaceId: ctx.workspace.workspaceId,
    jobId: id,
    reason: parsed.data.reason,
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
