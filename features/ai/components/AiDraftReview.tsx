/**
 * Review draft AI — features/ai/components/AiDraftReview.tsx (P8-04).
 * Alur review manusia: draft terstruktur + metadata ditampilkan, user
 * meninjau/mengedit, lalu MEMUTUSKAN insert sebagai versi baru (D-010 —
 * tanpa auto-save). Form insert ini form TERPISAH dari form aksi (lesson
 * 6: form tidak disembunyikan berdasarkan hasil aksinya sendiri — pesan
 * insert tampil di bawah form ini yang tetap mounted).
 * Insert hanya untuk brief/content_draft/repurpose (punya script +
 * caption + CTA); fitur lain hanya tampil + salin.
 */
"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { insertAiDraftVersionAction } from "../actions";
import type { AiActionResult } from "../types";

function ResultMessage({ state }: { state: AiActionResult }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className="text-sm">
      {state.message}
    </p>
  );
}

function asRecord(draft: unknown): Record<string, unknown> {
  return draft && typeof draft === "object" ? (draft as Record<string, unknown>) : {};
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function AiDraftReview({
  draft,
  feature,
  generationId,
  workspaceId,
  contextItemId,
}: {
  draft: unknown;
  feature: string;
  generationId: string;
  workspaceId: string;
  contextItemId: string;
}) {
  const d = asRecord(draft);
  const canInsert = ["brief", "content_draft", "repurpose"].includes(feature) && contextItemId !== "";
  const initialScript =
    feature === "brief"
      ? [asString(d.title), "", ...asStringArray(d.keyPoints)].join("\n").trim()
      : asString(d.script) || asString(d.caption);
  const initialCaption =
    feature === "brief" ? asString(d.objective) : asString(d.caption);
  const initialCta = asString(d.cta);
  const [script, setScript] = useState(initialScript);
  const [caption, setCaption] = useState(initialCaption);
  const [cta, setCta] = useState(initialCta);
  const [copied, setCopied] = useState(false);
  const [insertState, insertAction, insertPending] = useActionState(insertAiDraftVersionAction, {
    ok: false,
    message: "",
  } satisfies AiActionResult);
  return (
    <section aria-label="Review draft AI" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Draft AI — tinjau sebelum dimasukkan</h2>
      <p className="text-sm text-[var(--mt-text-muted)]">
        Draft ini AI-assisted dan tetap milik Anda — snapshot yang sudah disetujui tidak berubah
        bila draft dimasukkan (versi baru, append-only).
      </p>
      <pre className="overflow-x-auto rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4 text-xs">
        {JSON.stringify(draft, null, 2)}
      </pre>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
            setCopied(true);
          }}
        >
          {copied ? "Disalin ✓" : "Salin draft"}
        </Button>
      </div>

      {canInsert ? (
        <form action={insertAction} className="flex flex-col gap-4">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="contentItemId" value={contextItemId} />
          <input type="hidden" name="aiGenerationId" value={generationId} />
          <input type="hidden" name="briefSnapshot" value={JSON.stringify(draft)} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ai-ins-script" className="text-sm font-medium text-[var(--mt-text)]">
              Script (bisa diedit)
            </label>
            <textarea
              id="ai-ins-script"
              name="script"
              rows={6}
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="w-full rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm text-[var(--mt-text)]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ai-ins-caption" className="text-sm font-medium text-[var(--mt-text)]">
              Caption (bisa diedit)
            </label>
            <textarea
              id="ai-ins-caption"
              name="caption"
              rows={4}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="w-full rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm text-[var(--mt-text)]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ai-ins-cta" className="text-sm font-medium text-[var(--mt-text)]">
              CTA (bisa diedit)
            </label>
            <input
              id="ai-ins-cta"
              name="cta"
              type="text"
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              className="h-10 w-full rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm text-[var(--mt-text)]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ai-ins-summary" className="text-sm font-medium text-[var(--mt-text)]">
              Ringkasan perubahan
            </label>
            <input
              id="ai-ins-summary"
              name="changeSummary"
              type="text"
              defaultValue="Draft AI: dimasukkan sebagai versi baru"
              className="h-10 w-full rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm text-[var(--mt-text)]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={insertPending}>
              {insertPending ? "Menyimpan…" : "Masukkan sebagai versi baru"}
            </Button>
          </div>
          <ResultMessage state={insertState} />
        </form>
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Aksi ini tidak dimasukkan sebagai versi konten — salin draft di atas bila perlu.
        </p>
      )}
    </section>
  );
}
