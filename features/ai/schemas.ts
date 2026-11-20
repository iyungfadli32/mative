/**
 * Skema output terstruktur per aksi AI — features/ai/schemas.ts (P8-03).
 * Validitas output terstruktur 100% (ASUMSI-8F): gagal validasi = gagal
 * aksi, BUKAN disimpan. `.strict()` di tingkat atas supaya field tak
 * dikenal ditolak — gerbang validitas jadi bermakna, bukan formalitas.
 */
import { z } from "zod";
import type { AiFeature } from "./constants";

export const contentIdeasOutputSchema = z
  .object({
    ideas: z
      .array(
        z.object({
          title: z.string().min(1),
          angle: z.string().min(1),
          pillar: z.string().optional(),
          channel: z.string().optional(),
          rationale: z.string().optional(),
        }),
      )
      .min(1, "Minimal 1 ide."),
    groups: z
      .array(z.object({ name: z.string().min(1), ideaIndexes: z.array(z.number().int().min(0)) }))
      .default([]),
    duplicates: z
      .array(
        z.object({
          ideaIndex: z.number().int().min(0),
          similarTo: z.number().int().min(0),
          reason: z.string().optional(),
        }),
      )
      .default([]),
  })
  .strict();

export const briefOutputSchema = z
  .object({
    title: z.string().min(1),
    objective: z.string().min(1),
    audience: z.string().min(1),
    angle: z.string().min(1),
    format: z.string().min(1),
    keyPoints: z.array(z.string().min(1)).min(1, "Minimal 1 poin kunci."),
    hook: z.string().optional(),
    cta: z.string().optional(),
  })
  .strict();

export const contentDraftOutputSchema = z
  .object({
    hook: z.string().min(1),
    outline: z.array(z.string().min(1)).min(1, "Minimal 1 poin outline."),
    script: z.string().min(1),
    caption: z.string().min(1),
    cta: z.string().min(1),
    hashtags: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const repurposeOutputSchema = z
  .object({
    targetChannel: z.string().min(1),
    targetFormat: z.string().min(1),
    hook: z.string().min(1),
    script: z.string().optional(),
    caption: z.string().min(1),
    cta: z.string().min(1),
    platformLimit: z
      .object({
        verified: z.boolean(),
        limit: z.string().optional(),
        note: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const checklistOutputSchema = z
  .object({
    items: z
      .array(
        z.object({
          task: z.string().min(1),
          notes: z.string().optional(),
        }),
      )
      .min(1, "Minimal 1 item checklist."),
    summary: z.string().min(1),
  })
  .strict();

export const feedbackSummaryOutputSchema = z
  .object({
    summary: z.string().min(1),
    actionItems: z
      .array(
        z.object({
          item: z.string().min(1),
          priority: z.enum(["high", "medium", "low"]),
          source: z.string().optional(),
        }),
      )
      .min(1, "Minimal 1 action item."),
    handoffNotes: z.string().min(1),
  })
  .strict();

export const campaignSummaryOutputSchema = z
  .object({
    summary: z.string().min(1),
    metrics: z
      .array(
        z.object({
          metricKey: z.string().min(1),
          value: z.number(),
          unit: z.string().min(1),
          period: z.string().min(1),
        }),
      )
      .min(1, "Minimal 1 metrik yang dikutip."),
    experiments: z
      .array(
        z.object({
          hypothesis: z.string().min(1),
          metric: z.string().min(1),
          period: z.string().min(1),
        }),
      )
      .default([]),
    needsEvaluation: z.array(z.string().min(1)).default([]),
  })
  .strict();

/** Peta fitur → skema output (dipakai adapter + eval + action). */
export const AI_OUTPUT_SCHEMAS = {
  content_ideas: contentIdeasOutputSchema,
  brief: briefOutputSchema,
  content_draft: contentDraftOutputSchema,
  repurpose: repurposeOutputSchema,
  checklist: checklistOutputSchema,
  feedback_summary: feedbackSummaryOutputSchema,
  campaign_summary: campaignSummaryOutputSchema,
} as const satisfies Record<AiFeature, z.ZodType<unknown>>;

export type AiOutput<Feature extends AiFeature> = z.infer<(typeof AI_OUTPUT_SCHEMAS)[Feature]>;

/** Validasi output terstruktur: gagal = gagal aksi (ASUMSI-8F). */
export function validateAiOutput<Feature extends AiFeature>(
  feature: Feature,
  data: unknown,
): { ok: true; data: AiOutput<Feature> } | { ok: false; issues: string[] } {
  const parsed = AI_OUTPUT_SCHEMAS[feature].safeParse(data);
  if (parsed.success) return { ok: true, data: parsed.data as AiOutput<Feature> };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
