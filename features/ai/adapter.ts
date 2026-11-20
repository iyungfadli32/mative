/**
 * Adapter provider-netral — features/ai/adapter.ts (P8-02, ADR-0014 §4).
 * Kontrak: generateStructuredDraft(input, schema), summarize(input,
 * constraints), classify(input, allowedLabels). Provider/model bisa
 * diganti tanpa mengubah business logic — action memanggil interface
 * ini, BUKAN provider langsung.
 *
 * AI NONAKTIF (Keputusan #11): TIDAK ADA provider yang dipilih.
 * getAiAdapter() mengembalikan NullAdapter — setiap metode mengembalikan
 * state "not configured" yang jujur, TANPA pemanggilan model, TANPA biaya.
 * Bila Tuan memilih provider nanti, factory ini membaca konfigurasi
 * provider workspace dan mengembalikan adapter nyatanya; business logic
 * (actions.ts) tidak berubah.
 */
import type { z } from "zod";
import type { AiErrorCategory } from "./constants";
import { AI_NOT_CONFIGURED_ID } from "./constants";

export type AiAdapterSuccess<T> = {
  ok: true;
  data: T;
  provider: string;
  model: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null };
};

export type AiAdapterFailure = {
  ok: false;
  code: AiErrorCategory;
  message: string;
};

export type AiAdapterResult<T> = AiAdapterSuccess<T> | AiAdapterFailure;

export type AiGenerateInput = {
  workspaceId: string;
  feature: string;
  locale: string;
  /** Ringkasan context yang dipakai (sudah dibatasi tenant + brand scope). */
  contextSummary: string;
  /** Instruksi user untuk aksi ini (teks bebas — dipindai safety.ts dulu). */
  userInstruction: string;
  /** Konten yang diambil dari DB/komentar/dokumen = data TIDAK TEPERCAYA. */
  untrustedContent?: string;
};

export type AiSummarizeInput = {
  workspaceId: string;
  locale: string;
  text: string;
  maxSentences?: number;
};

export type AiClassifyInput = {
  workspaceId: string;
  locale: string;
  text: string;
  allowedLabels: string[];
};

export interface AiAdapter {
  readonly providerId: string;
  readonly model: string | null;
  generateStructuredDraft(
    input: AiGenerateInput,
    schema: z.ZodType<unknown>,
  ): Promise<AiAdapterResult<unknown>>;
  summarize(input: AiSummarizeInput): Promise<AiAdapterResult<{ summary: string }>>;
  classify(input: AiClassifyInput): Promise<AiAdapterResult<{ label: string }>>;
}

/** Adapter "tidak ada provider": semua metode gagal jujur, tanpa model. */
export class NullAdapter implements AiAdapter {
  readonly providerId = "none";
  readonly model: string | null = null;

  private notConfigured(): AiAdapterFailure {
    return { ok: false, code: "provider_not_configured", message: AI_NOT_CONFIGURED_ID };
  }

  async generateStructuredDraft(): Promise<AiAdapterResult<unknown>> {
    return this.notConfigured();
  }

  async summarize(): Promise<AiAdapterResult<{ summary: string }>> {
    return this.notConfigured();
  }

  async classify(): Promise<AiAdapterResult<{ label: string }>> {
    return this.notConfigured();
  }
}

/**
 * Factory adapter. Hari ini: selalu NullAdapter (tidak ada provider).
 * Nanti: baca konfigurasi provider workspace (key API server-side saja)
 * dan kembalikan adapter provider itu — tanpa mengubah pemanggil.
 */
export function getAiAdapter(): AiAdapter {
  return new NullAdapter();
}
