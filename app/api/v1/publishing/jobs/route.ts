import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { listPublishingJobs } from "@/features/publishing/queries";
import { createPublishingJobCore } from "@/features/publishing/actions";
import { PUBLISHING_TABLES_UNAVAILABLE_ID } from "@/features/publishing/constants";
import { actionStatusFor, errorJson, requireContext } from "../helpers";

/**
 * API v1 publishing — jobs (P6-08, Dok 07 §6).
 * Kode error: FORBIDDEN / NOT_FOUND / DUPLICATE_JOB / APPROVAL_REQUIRED /
 * APPROVAL_STALE / SCHEDULE_PAST / TIMEZONE_INVALID / UNAUTHENTICATED /
 * UNSUPPORTED_CAPABILITY (provider — lihat /providers).
 * TIDAK ADA perubahan status langsung — mutasi hanya lewat RPC 0020
 * (via core yang sama dengan server action UI).
 */

/** GET /api/v1/publishing/jobs?workspace=<id> — antrean publishing (RLS). */
export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspace");
  const { supabase, ctx } = await requireContext(workspaceId);
  if (!supabase) return errorJson("UNAVAILABLE", "Supabase belum dikonfigurasi.", 503);
  if (!ctx) return errorJson("UNAUTHENTICATED", "Anda harus masuk dulu.", 401);
  const res = await listPublishingJobs(supabase, ctx.workspace.workspaceId);
  if (!res.ok) return errorJson("UNAVAILABLE", PUBLISHING_TABLES_UNAVAILABLE_ID, 503);
  return NextResponse.json({ ok: true, data: res.data });
}

const createBodySchema = z.object({
  placement_id: z.string().uuid("placement_id tidak valid."),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: z.string().trim().max(64, "Zona waktu maksimal 64 karakter.").optional(),
});

/** POST /api/v1/publishing/jobs?workspace=<id> — buat job (body JSON, ISO UTC). */
export async function POST(req: NextRequest) {
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
  const parsed = createBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "INVALID_BODY",
      parsed.error.issues[0]?.message ?? "Body tidak valid.",
      400,
    );
  }
  const result = await createPublishingJobCore(supabase, ctx.userId, {
    workspaceId: ctx.workspace.workspaceId,
    placementId: parsed.data.placement_id,
    scheduledAtUtc: parsed.data.scheduled_at ?? null,
    timezone: parsed.data.timezone ?? "",
  });
  if (!result.ok) {
    return errorJson(
      result.code ?? "PUBLISHING_ERROR",
      result.message,
      actionStatusFor(result.code),
    );
  }
  return NextResponse.json(
    { ok: true, data: { job_id: result.jobId, status: result.status } },
    { status: 201 },
  );
}
