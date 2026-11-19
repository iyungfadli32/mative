import { NextResponse } from "next/server";
import { errorJson } from "../helpers";

/**
 * API provider publishing — app/api/v1/publishing/providers/route.ts (P6-08).
 * Decision #3 (ADR-0012): manual-only di MVP, adapter DISABLED.
 * TIDAK ADA fungsi adapter provider di repo — bukan implementasi palsu,
 * bukan stub diam-diam. Setiap aksi provider menjawab 501.
 */
const MESSAGE =
  "Integrasi provider dinonaktifkan di MVP (manual-only, ADR-0012): publikasi dilakukan manual di platform, lalu dikonfirmasi lewat /api/v1/publishing/jobs/:id/confirm.";

export async function GET() {
  return errorJson("UNSUPPORTED_CAPABILITY", MESSAGE, 501);
}

export async function POST() {
  return NextResponse.json({ ok: false, code: "UNSUPPORTED_CAPABILITY", message: MESSAGE }, { status: 501 });
}
