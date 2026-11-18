import { NextResponse } from "next/server";
import { envStatus } from "@/lib/env";

/** Health check — dipakai CI/smoke test. Tidak pernah membocorkan secret. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    product: "mative",
    phase: "1-foundation",
    version: "0.1.0",
    supabaseConfigured: envStatus.supabaseConfigured,
    defaultTimezone: envStatus.defaultTimezone,
    timestampUtc: new Date().toISOString(),
  });
}
