/**
 * Server actions AI Assistant — features/ai/actions.ts (P8-02/8.4/8.7).
 * Pola analytics/actions.ts: Zod dulu (boundary), lalu sesi + peran dari
 * DB (BUKAN dari body), lalu Supabase client sesi (RLS penegak terakhir).
 * - D-010 (permanen): AI draft-only — TIDAK ADA jalur dari AI ke
 *   simpan/setuju/terbit tanpa aksi manusia eksplisit. Insert versi baru
 *   HANYA lewat RPC 0022 insert_ai_draft_version (append-only; snapshot
 *   yang disetujui tidak pernah dimutasi).
 * - Input mentah TIDAK disimpan (ASUMSI-8D): log hanya referensi.
 * - AI NONAKTIF: adapter = NullAdapter — aksi berakhir not_configured
 *   yang jujur + baris log tercatat (status not_configured).
 */
"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";
import { brandInScope, can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import {
  aiActionInputSchema,
  aiSettingsSchema,
  insertAiDraftVersionSchema,
} from "@/lib/validation/schemas";
import { getCallerBrandScope, getCallerRole } from "@/features/planning/context";
import { getAiAdapter } from "./adapter";
import {
  AI_ACCESS_DENIED_ID,
  AI_DISABLED_ID,
  AI_INJECTION_BLOCKED_ID,
  AI_NOT_CONFIGURED_ID,
  AI_TABLES_UNAVAILABLE_ID,
  AI_USAGE_LIMIT_ID,
} from "./constants";
import { buildMetricPayload } from "./grounding";
import { scanUntrustedContent } from "./safety";
import { AI_SETTINGS_KEY, getAiSettings } from "./settings";
import { AI_OUTPUT_SCHEMAS } from "./schemas";
import {
  getCampaignMetricsForGrounding,
  listAiContextComments,
} from "./queries";
import type { AiActionResult, InsertAiDraftVersionRpcResult } from "./types";

const ok = (message: string, extra?: Partial<AiActionResult>): AiActionResult => ({
  ok: true,
  message,
  ...extra,
});
const fail = (
  message: string,
  extra?: Partial<AiActionResult>,
): AiActionResult => ({ ok: false, message, ...extra });

function isMissingTableMessage(message: string): boolean {
  return /Could not find the table|Could not find the function|does not exist|42P01|PGRST205/i.test(
    message,
  );
}

function dbErrorMessage(error: { message?: string } | null, fallback: string): string {
  const message = error?.message ?? fallback;
  if (isMissingTableMessage(message)) return AI_TABLES_UNAVAILABLE_ID;
  return message;
}

function asRpcResult(data: unknown): InsertAiDraftVersionRpcResult | null {
  if (!data || typeof data !== "object") return null;
  return data as InsertAiDraftVersionRpcResult;
}

async function logGeneration(
  supabase: SupabaseClient,
  row: {
    workspaceId: string;
    userId: string;
    feature: string;
    inputReference: string;
    outputReference?: string | null;
    status: string;
    errorCategory: string;
  },
): Promise<string | undefined> {
  const { data, error } = await supabase
    .from("ai_generations")
    .insert({
      workspace_id: row.workspaceId,
      actor_user_id: row.userId,
      feature: row.feature,
      provider: "none",
      model: null,
      input_reference: row.inputReference,
      output_reference: row.outputReference ?? null,
      status: row.status,
      error_category: row.errorCategory,
    })
    .select("id")
    .single();
  if (error) return undefined;
  return (data as { id?: string } | null)?.id ?? undefined;
}

/** Jalankan satu aksi AI (8.3): konteks → validasi → adapter → log. */
export async function runAiAction(
  _prev: AiActionResult,
  formData: FormData,
): Promise<AiActionResult> {
  const parsed = aiActionInputSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    feature: formData.get("feature"),
    locale: formData.get("locale") ?? "id",
    contextType: formData.get("contextType"),
    contextId:
      String(formData.get("contextId") ?? "") === ""
        ? null
        : String(formData.get("contextId")),
    brandId:
      String(formData.get("brandId") ?? "") === "" ? null : String(formData.get("brandId")),
    audience: String(formData.get("audience") ?? ""),
    objective: String(formData.get("objective") ?? ""),
    pillar: String(formData.get("pillar") ?? ""),
    channel: String(formData.get("channel") ?? ""),
    targetChannel: String(formData.get("targetChannel") ?? ""),
    targetFormat: String(formData.get("targetFormat") ?? ""),
    sourceText: String(formData.get("sourceText") ?? ""),
    periodStart:
      String(formData.get("periodStart") ?? "") === ""
        ? null
        : String(formData.get("periodStart")),
    periodEnd:
      String(formData.get("periodEnd") ?? "") === "" ? null : String(formData.get("periodEnd")),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input = parsed.data;
  const supabase = await getSupabaseServerClient();
  if (!supabase) return fail(SUPABASE_NOT_CONFIGURED_ID);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Anda harus masuk dulu.");
  const role = (await getCallerRole(input.workspaceId, user.id)) as WorkspaceRole | null;
  if (!role || !can(role, "use_ai")) {
    return fail(AI_ACCESS_DENIED_ID, { code: "FORBIDDEN" });
  }
  const settings = await getAiSettings(supabase, input.workspaceId);
  if (!settings.enabled) {
    return fail(AI_DISABLED_ID, { code: "AI_DISABLED" });
  }
  // Kuota harian (ASUMSI-8E): hanya completed yang dihitung; -1 = bukan
  // member yang boleh memakai AI (RPC 0022).
  const { data: usageData, error: usageError } = await supabase.rpc("ai_daily_usage_count", {
    p_workspace_id: input.workspaceId,
  });
  if (usageError) {
    return fail(dbErrorMessage(usageError, "Gagal memeriksa kuota AI."));
  }
  const used = usageData as number;
  if (used < 0) return fail(AI_ACCESS_DENIED_ID, { code: "FORBIDDEN" });
  if (used >= settings.dailyLimit) {
    return fail(AI_USAGE_LIMIT_ID, {
      code: "usage_limit",
      usage: { used, limit: settings.dailyLimit },
    });
  }
  // Safety (8.6): teks yang diberikan user = data TIDAK TEPERCAYA.
  const scan = scanUntrustedContent(
    [input.sourceText, input.objective, input.audience, input.pillar, input.channel].join("\n"),
  );
  const inputReference =
    input.contextType === "manual"
      ? `manual:${input.feature}`
      : `${input.contextType}:${input.contextId ?? "none"}`;
  if (scan.blocked) {
    const generationId = await logGeneration(supabase, {
      workspaceId: input.workspaceId,
      userId: user.id,
      feature: input.feature,
      inputReference,
      status: "blocked",
      errorCategory: "prompt_injection",
    });
    return fail(AI_INJECTION_BLOCKED_ID, {
      code: "prompt_injection",
      generationId,
      usage: { used, limit: settings.dailyLimit },
    });
  }
  // Resolusi context (tenant + brand scope; RLS penegak terakhir).
  let sourceContext = "";
  if (input.contextType === "content_item" && input.contextId) {
    const { data, error } = await supabase
      .from("content_items")
      .select("id, title, brand_id")
      .eq("id", input.contextId)
      .eq("workspace_id", input.workspaceId)
      .single();
    if (error || !data) return fail("Konten context tidak ditemukan di workspace ini.");
    const scope = await getCallerBrandScope(input.workspaceId, user.id);
    if (!brandInScope(scope, (data as { brand_id: string }).brand_id)) {
      return fail("Konten ini di luar scope brand Anda.", { code: "FORBIDDEN" });
    }
    sourceContext = `Konten: ${(data as { title: string | null }).title ?? "(tanpa judul)"}`;
  } else if (input.contextType === "campaign" && input.contextId) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, name")
      .eq("id", input.contextId)
      .eq("workspace_id", input.workspaceId)
      .single();
    if (error || !data) return fail("Campaign context tidak ditemukan di workspace ini.");
    sourceContext = `Campaign: ${(data as { name: string }).name}`;
    if (input.feature === "campaign_summary" && input.periodStart && input.periodEnd) {
      const metricsRes = await getCampaignMetricsForGrounding(
        supabase,
        input.workspaceId,
        input.contextId,
        input.periodStart,
        input.periodEnd,
      );
      if (!metricsRes.ok) return fail(AI_TABLES_UNAVAILABLE_ID);
      const payload = buildMetricPayload({
        campaignId: input.contextId,
        campaignName: (data as { name: string }).name,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        rows: metricsRes.data,
      });
      sourceContext =
        payload.metrics.length === 0
          ? `${sourceContext} — data tidak tersedia (periode ${input.periodStart} s.d. ${input.periodEnd})`
          : `${sourceContext} — ${payload.metrics.length} metrik (periode ${input.periodStart} s.d. ${input.periodEnd})`;
    }
  } else if (input.contextType === "comment_thread" && input.contextId) {
    const commentsRes = await listAiContextComments(supabase, "content_item", input.contextId);
    if (!commentsRes.ok) return fail(AI_TABLES_UNAVAILABLE_ID);
    sourceContext =
      commentsRes.data.length === 0
        ? "Thread komentar: belum ada komentar"
        : `Thread komentar: ${commentsRes.data.length} komentar`;
  } else {
    sourceContext = "Teks yang diberikan user";
  }
  // Adapter netral: hari ini selalu NullAdapter → not_configured.
  const adapter = getAiAdapter();
  const result = await adapter.generateStructuredDraft(
    {
      workspaceId: input.workspaceId,
      feature: input.feature,
      locale: input.locale,
      contextSummary: sourceContext,
      userInstruction: [
        input.objective ? `Tujuan: ${input.objective}` : "",
        input.audience ? `Audiens: ${input.audience}` : "",
        input.pillar ? `Pilar: ${input.pillar}` : "",
        input.channel ? `Channel: ${input.channel}` : "",
        input.targetChannel ? `Target channel: ${input.targetChannel}` : "",
        input.targetFormat ? `Target format: ${input.targetFormat}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      untrustedContent: input.sourceText === "" ? undefined : input.sourceText,
    },
    AI_OUTPUT_SCHEMAS[input.feature],
  );
  if (!result.ok) {
    const generationId = await logGeneration(supabase, {
      workspaceId: input.workspaceId,
      userId: user.id,
      feature: input.feature,
      inputReference,
      status: "not_configured",
      errorCategory: result.code,
    });
    return fail(result.code === "provider_not_configured" ? AI_NOT_CONFIGURED_ID : result.message, {
      code: result.code,
      generationId,
      sourceContext,
      usage: { used, limit: settings.dailyLimit },
    });
  }
  // Jalur sukses (hanya tercapai bila provider sudah dipilih nanti):
  // validasi output terstruktur 100% — gagal = gagal aksi.
  const validated = AI_OUTPUT_SCHEMAS[input.feature].safeParse(result.data);
  if (!validated.success) {
    const generationId = await logGeneration(supabase, {
      workspaceId: input.workspaceId,
      userId: user.id,
      feature: input.feature,
      inputReference,
      status: "failed",
      errorCategory: "invalid_output",
    });
    return fail("Output AI tidak lolos validasi struktur — aksi gagal, tidak ada yang disimpan.", {
      code: "invalid_output",
      generationId,
      sourceContext,
      usage: { used, limit: settings.dailyLimit },
    });
  }
  const generationId = await logGeneration(supabase, {
    workspaceId: input.workspaceId,
    userId: user.id,
    feature: input.feature,
    inputReference,
    outputReference: `ai-draft:${input.feature}:${Date.now()}`,
    status: "completed",
    errorCategory: "none",
  });
  return ok("Draft AI siap — tinjau, edit, lalu masukkan sebagai versi baru bila cocok.", {
    draft: validated.data,
    generationId,
    sourceContext,
    usage: { used: used + 1, limit: settings.dailyLimit },
  });
}

/** Insert draft AI sebagai versi baru konten (RPC 0022, D-010). */
export async function insertAiDraftVersionAction(
  _prev: AiActionResult,
  formData: FormData,
): Promise<AiActionResult> {
  const parsed = insertAiDraftVersionSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentItemId: formData.get("contentItemId"),
    script: formData.get("script"),
    caption: formData.get("caption"),
    cta: String(formData.get("cta") ?? ""),
    briefSnapshot: String(formData.get("briefSnapshot") ?? "{}"),
    changeSummary: formData.get("changeSummary"),
    aiGenerationId: formData.get("aiGenerationId"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input = parsed.data;
  let briefSnapshot: unknown;
  try {
    briefSnapshot = JSON.parse(input.briefSnapshot);
  } catch {
    return fail("Brief snapshot bukan JSON yang valid.");
  }
  const supabase = await getSupabaseServerClient();
  if (!supabase) return fail(SUPABASE_NOT_CONFIGURED_ID);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Anda harus masuk dulu.");
  const role = (await getCallerRole(input.workspaceId, user.id)) as WorkspaceRole | null;
  if (!role || !can(role, "use_ai") || !can(role, "create_edit_content")) {
    return fail("Peran Anda tidak boleh menyimpan versi konten.", { code: "FORBIDDEN" });
  }
  const { data: item, error: itemError } = await supabase
    .from("content_items")
    .select("id, brand_id")
    .eq("id", input.contentItemId)
    .eq("workspace_id", input.workspaceId)
    .single();
  if (itemError || !item) {
    return fail("Konten tidak ditemukan di workspace ini.", { code: "INVALID_ITEM" });
  }
  const scope = await getCallerBrandScope(input.workspaceId, user.id);
  if (!brandInScope(scope, (item as { brand_id: string }).brand_id)) {
    return fail("Konten ini di luar scope brand Anda.", { code: "FORBIDDEN" });
  }
  const { data, error } = await supabase.rpc("insert_ai_draft_version", {
    p_content_item_id: input.contentItemId,
    p_script: input.script,
    p_caption: input.caption,
    p_cta: input.cta === "" ? null : input.cta,
    p_brief_snapshot: briefSnapshot,
    p_change_summary: input.changeSummary,
    p_ai_generation_id: input.aiGenerationId,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal menyimpan versi AI."));
  const result = asRpcResult(data);
  if (!result?.ok) {
    return fail(result?.message ?? "Gagal menyimpan versi AI.", { code: result?.code });
  }
  revalidatePath("/ai");
  revalidatePath("/konten");
  return ok(
    `Versi ${result.version_number ?? "?"} tersimpan sebagai draft AI-assisted — snapshot yang sudah disetujui tidak berubah.`,
    { code: result.code },
  );
}

/** Simpan pengaturan AI workspace (owner/admin saja — RLS 0003 menegakkan). */
export async function saveAiSettingsAction(
  _prev: AiActionResult,
  formData: FormData,
): Promise<AiActionResult> {
  const parsed = aiSettingsSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    enabled: String(formData.get("enabled") ?? "false"),
    dailyLimit: String(formData.get("dailyLimit") ?? "10"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const input = parsed.data;
  const supabase = await getSupabaseServerClient();
  if (!supabase) return fail(SUPABASE_NOT_CONFIGURED_ID);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Anda harus masuk dulu.");
  const role = (await getCallerRole(input.workspaceId, user.id)) as WorkspaceRole | null;
  if (!role || !["owner", "admin"].includes(role)) {
    return fail("Hanya owner/admin yang boleh mengatur AI.", { code: "FORBIDDEN" });
  }
  const { error } = await supabase.from("workspace_settings").upsert(
    {
      workspace_id: input.workspaceId,
      key: AI_SETTINGS_KEY,
      value_json: { enabled: input.enabled, dailyLimit: input.dailyLimit },
    },
    { onConflict: "workspace_id,key" },
  );
  if (error) return fail(dbErrorMessage(error, "Gagal menyimpan pengaturan AI."));
  revalidatePath("/ai");
  return ok("Pengaturan AI disimpan.");
}
