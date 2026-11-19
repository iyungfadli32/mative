import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { confirmPublishingJobCore } from "@/features/publishing/actions";
import { actionStatusFor, errorJson, requireContext } from "../../../helpers";

const confirmBodySchema = z.object({
  canonical_url: z
    .string()
    .trim()
    .min(1, "URL publikasi wajib diisi.")
    .max(2048, "URL publikasi maksimal 2048 karakter.")
    .refine((v) => /^https?:\/\/[^/\s]+[^\s]*$/.test(v), {
      message: "URL publikasi tidak valid — isi URL lengkap (http:// atau https://) tanpa spasi.",
    }),
  published_at: z.string().datetime({ offset: true, message: "published_at harus ISO UTC." }),
});

/**
 * POST /api/v1/publishing/jobs/:id/confirm?workspace=<id> — konfirmasi manual (A6.1).
 * Satu-satunya jalan ke Published; URL + waktu terbit nyata (ISO UTC).
 */
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
  const parsed = confirmBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "INVALID_BODY",
      parsed.error.issues[0]?.message ?? "Body tidak valid.",
      400,
    );
  }
  const result = await confirmPublishingJobCore(supabase, ctx.userId, {
    workspaceId: ctx.workspace.workspaceId,
    jobId: id,
    canonicalUrl: parsed.data.canonical_url,
    publishedAtUtc: parsed.data.published_at,
  });
  if (!result.ok) {
    return errorJson(
      result.code ?? "PUBLISHING_ERROR",
      result.message,
      actionStatusFor(result.code),
    );
  }
  return NextResponse.json({
    ok: true,
    data: { job_id: id, status: "published", message: result.message },
  });
}
