import { NextResponse } from "next/server";
import { envStatus } from "@/lib/env";
import pkg from "@/package.json";

/** Health check — dipakai CI/smoke test. Tidak pernah membocorkan secret. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    product: "mative",
    phase: "9-hardening-launch",
    version: pkg.version,
    supabaseConfigured: envStatus.supabaseConfigured,
    defaultTimezone: envStatus.defaultTimezone,
    timestampUtc: new Date().toISOString(),
  });
}
