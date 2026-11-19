import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getPlanningContext } from "@/features/planning/context";

/** Helper bersama route API approval (P4-07): error JSON + konteks sesi. */
export function errorJson(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function requireContext(workspaceId: string | null) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { supabase: null as null, ctx: null };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, ctx: null };
  const ctx = await getPlanningContext(workspaceId ?? undefined);
  if (!ctx) return { supabase, ctx: null };
  return { supabase, ctx };
}
