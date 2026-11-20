/**
 * Query AI Assistant — features/ai/queries.ts (P8-02/8.5/8.10).
 * Pola analytics/queries.ts: `runQuery` menggulung kegagalan ke
 * `unavailable` (BUKAN null). RLS adalah penegak baca — query di sini
 * tidak pernah mem-bypass RLS (tidak ada service-role client).
 * Kolom WAJIB sama dengan migrasi 0022 (ai_generations TIDAK punya kolom
 * payload mentah — hanya referensi).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_TABLES_UNAVAILABLE_ID } from "./constants";
import type {
  AiContextCampaign,
  AiContextComment,
  AiContextItem,
  AiGenerationRow,
} from "./types";
import type { CampaignMetricRow } from "./grounding";

export { AI_TABLES_UNAVAILABLE_ID };

export type QueryOutcome<T> = { ok: true; data: T } | { ok: false; unavailable: true };

function wrap<T>(fn: () => Promise<T>): Promise<QueryOutcome<T>> {
  return fn()
    .then((data) => ({ ok: true as const, data }))
    .catch(() => ({ ok: false as const, unavailable: true as const }));
}

const GENERATION_COLUMNS =
  // Kolom WAJIB sama dengan migrasi 0022: ai_generations punya
  // `input_reference`/`output_reference` (bukan input_text/output_text)
  // dan TIDAK punya kolom payload mentah (PostgREST 400 bila salah).
  "id, workspace_id, actor_user_id, feature, provider, model, input_reference, output_reference, usage_input_tokens, usage_output_tokens, status, error_category, created_at";

/** Log AI terbaru workspace (RLS: member 8 peran non-klien; viewer_client 0). */
export async function listAiGenerations(
  supabase: SupabaseClient,
  workspaceId: string,
  limit = 50,
): Promise<QueryOutcome<AiGenerationRow[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("ai_generations")
      .select(GENERATION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as AiGenerationRow[];
  });
}

/** Pemakaian AI hari ini (completed, zona Asia/Jakarta) — RPC 0022. -1 = bukan member use_ai. */
export async function getAiDailyUsage(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryOutcome<number>> {
  return wrap(async () => {
    const { data, error } = await supabase.rpc("ai_daily_usage_count", {
      p_workspace_id: workspaceId,
    });
    if (error) throw error;
    return data as number;
  });
}

/** Content item workspace untuk picker context (RLS menyaring sesuai scope). */
export async function listAiContextItems(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryOutcome<AiContextItem[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("content_items")
      .select("id, title, brand_id, brands(name)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return ((data ?? []) as unknown as Array<{
      id: string;
      title: string | null;
      brand_id: string;
      brands: { name: string | null } | null;
    }>).map((it) => ({
      id: it.id,
      title: it.title ?? "(tanpa judul)",
      brandId: it.brand_id,
      brandName: it.brands?.name ?? null,
    }));
  });
}

/** Campaign workspace untuk picker context. */
export async function listAiContextCampaigns(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryOutcome<AiContextCampaign[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as AiContextCampaign[];
  });
}

/** Komentar target (content_item/campaign/task) untuk feedback_summary. */
export async function listAiContextComments(
  supabase: SupabaseClient,
  targetType: "content_item" | "campaign" | "task",
  targetId: string,
): Promise<QueryOutcome<AiContextComment[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("comments")
      .select("id, body, author_user_id, created_at")
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw error;
    return ((data ?? []) as Array<{
      id: string;
      body: string;
      author_user_id: string | null;
      created_at: string;
    }>).map((c) => ({
      id: c.id,
      body: c.body,
      authorUserId: c.author_user_id,
      createdAt: c.created_at,
    }));
  });
}

/** Metrik campaign nyata untuk grounding (8.5) — periode yang diminta. */
export async function getCampaignMetricsForGrounding(
  supabase: SupabaseClient,
  workspaceId: string,
  campaignId: string,
  periodStart: string,
  periodEnd: string,
): Promise<QueryOutcome<CampaignMetricRow[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("campaign_metrics")
      .select("metric_key, value, unit, period_start, period_end, snapshot_id")
      .eq("workspace_id", workspaceId)
      .eq("campaign_id", campaignId)
      .gte("period_start", periodStart)
      .lte("period_end", periodEnd)
      .order("metric_key", { ascending: true })
      .limit(500);
    if (error) throw error;
    return (data ?? []) as CampaignMetricRow[];
  });
}
