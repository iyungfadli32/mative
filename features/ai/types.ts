/**
 * Tipe domain AI Assistant — features/ai/types.ts (P8-02).
 * Draft AI SELALU terstruktur (Zod, features/ai/schemas.ts) + bermetadata
 * (sumber + periode) — tidak ada teks bebas tanpa provenance.
 */
import type { AiErrorCategory, AiFeature, AiGenerationStatus } from "./constants";

/** Pengaturan AI per workspace (workspace_settings key "ai", ASUMSI-8E). */
export type AiSettings = {
  enabled: boolean;
  dailyLimit: number;
};

/** Satu baris log ai_generations (kolom WAJIB sama dengan migrasi 0022). */
export type AiGenerationRow = {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  feature: AiFeature;
  provider: string;
  model: string | null;
  input_reference: string;
  output_reference: string | null;
  usage_input_tokens: number | null;
  usage_output_tokens: number | null;
  status: AiGenerationStatus;
  error_category: AiErrorCategory;
  created_at: string;
};

/** Hasil RPC 0022 insert_ai_draft_version (jsonb, TIDAK melempar). */
export type InsertAiDraftVersionRpcResult = {
  ok: boolean;
  code: string;
  message: string;
  version_number?: number | null;
};

/** Hasil server action AI (form). */
export type AiActionResult = {
  ok: boolean;
  message: string;
  code?: string;
  /** Id baris log ai_generations yang tercatat untuk aksi ini. */
  generationId?: string;
  /** Draft terstruktur (sudah lolos Zod) — null bila aksi gagal/diblokir. */
  draft?: unknown;
  /** Sumber data yang dipakai aksi ini (ditampilkan ke user, R8.9). */
  sourceContext?: string;
  /** Pemakaian hari ini (completed) + batas — sesudah aksi ini. */
  usage?: { used: number; limit: number };
};

/** Satu metrik grounding (8.5): angka + periode + sumber, dari DB nyata. */
export type AiGroundedMetric = {
  metricKey: string;
  value: number;
  unit: string;
  source: string;
  periodStart: string;
  periodEnd: string;
};

/** Payload grounding untuk rangkuman campaign (8.5). */
export type AiMetricPayload = {
  campaignId: string;
  campaignName: string | null;
  periodStart: string;
  periodEnd: string;
  metrics: AiGroundedMetric[];
};

/** Item konteks untuk picker (content item / campaign). */
export type AiContextItem = {
  id: string;
  title: string;
  brandId: string;
  brandName: string | null;
};

export type AiContextCampaign = {
  id: string;
  name: string;
};

/** Satu komentar sumber untuk feedback_summary (data TIDAK TEPERCAYA). */
export type AiContextComment = {
  id: string;
  body: string;
  authorUserId: string | null;
  createdAt: string;
};
