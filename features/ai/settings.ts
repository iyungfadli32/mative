/**
 * Pengaturan AI workspace — features/ai/settings.ts (P8-07, ADR-0014 §8).
 * Pengaturan hidup di workspace_settings key "ai" (RLS 0003: baca member,
 * tulis owner/admin saja). AI default NONAKTIF per workspace (ASUMSI-8E):
 * tanpa opt-in eksplisit, AI tidak diaktifkan untuk workspace itu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AI_DEFAULT_DAILY_LIMIT } from "./constants";
import type { AiSettings } from "./types";

export const AI_SETTINGS_KEY = "ai";

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  dailyLimit: AI_DEFAULT_DAILY_LIMIT,
};

const aiSettingsValueSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    dailyLimit: z.number().int().min(0).max(1000).optional().default(AI_DEFAULT_DAILY_LIMIT),
  })
  .passthrough();

/** Baca pengaturan AI workspace; default NONAKTIF bila belum ada/tidak valid. */
export async function getAiSettings(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<AiSettings> {
  const { data } = await supabase
    .from("workspace_settings")
    .select("value_json")
    .eq("workspace_id", workspaceId)
    .eq("key", AI_SETTINGS_KEY)
    .limit(1);
  const row = (data ?? [])[0] as { value_json?: unknown } | undefined;
  const parsed = aiSettingsValueSchema.safeParse(row?.value_json ?? {});
  if (!parsed.success) return { ...DEFAULT_AI_SETTINGS };
  return {
    enabled: parsed.data.enabled,
    dailyLimit: parsed.data.dailyLimit,
  };
}
