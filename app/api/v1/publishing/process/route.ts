import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { processPublishingJobsCore } from "@/features/publishing/actions";
import { actionStatusFor, errorJson, requireContext } from "../helpers";

const processBodySchema = z.object({
  job_id: z.string().uuid("job_id tidak valid.").nullable().optional(),
});

/**
 * POST /api/v1/publishing/process?workspace=<id> — proses antrean (worker lokal, P6-06).
 * Tanpa job_id: klaim semua job jatuh tempo (maks 20). Dengan job_id:
 * periksa-ulang satu job (ASUMSI-6.1). Idempotent.
 */
export async function POST(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspace");
  const { supabase, ctx } = await requireContext(workspaceId);
  if (!supabase) return errorJson("UNAVAILABLE", "Supabase belum dikonfigurasi.", 503);
  if (!ctx) return errorJson("UNAUTHENTICATED", "Anda harus masuk dulu.", 401);
  let body: unknown = {};
  const text = await req.text();
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      return errorJson("INVALID_BODY", "Body JSON tidak valid.", 400);
    }
  }
  const parsed = processBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "INVALID_BODY",
      parsed.error.issues[0]?.message ?? "Body tidak valid.",
      400,
    );
  }
  const result = await processPublishingJobsCore(
    supabase,
    ctx.userId,
    ctx.workspace.workspaceId,
    parsed.data.job_id ?? null,
  );
  if (!result.ok) {
    return errorJson(
      result.code ?? "PUBLISHING_ERROR",
      result.message,
      actionStatusFor(result.code),
    );
  }
  return NextResponse.json({
    ok: true,
    data: { processed: result.processed ?? 0, message: result.message },
  });
}
