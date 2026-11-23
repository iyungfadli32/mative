/**
 * Form aksi AI — features/ai/components/AiActionForm.tsx (P8-03/8.4).
 * Aturan: form TIDAK PERNAH disembunyikan berdasarkan hasil aksinya
 * sendiri (pelajaran e2e Phase 3/4/5) — pesan tampil di bawah form yang
 * tetap mounted. Draft hasil aksi tampil di bawah lewat AiDraftReview
 * (form insert terpisah — bukan form ini).
 */
"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { runAiAction } from "../actions";
import { AI_FEATURE_CATALOG } from "../constants";
import type { AiActionResult, AiContextCampaign, AiContextItem } from "../types";
import { AiDraftReview } from "./AiDraftReview";

function ResultMessage({ state }: { state: AiActionResult }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className="text-sm">
      {state.message}
      {state.usage ? (
        <span className="text-[var(--mt-text-muted)]">
          {" "}
          (Pemakaian hari ini: {state.usage.used}/{state.usage.limit}.)
        </span>
      ) : null}
      {state.sourceContext ? (
        <span className="block text-xs text-[var(--mt-text-muted)]">
          Sumber: {state.sourceContext}
        </span>
      ) : null}
    </p>
  );
}

export function AiActionForm({
  workspaceId,
  items,
  campaigns,
  disabled = false,
}: {
  workspaceId: string;
  items: AiContextItem[];
  campaigns: AiContextCampaign[];
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(runAiAction, {
    ok: false,
    message: "",
  } satisfies AiActionResult);
  const [contextType, setContextType] = useState("content_item");
  const [feature, setFeature] = useState("content_draft");
  const [contextId, setContextId] = useState("");
  const [submittedFeature, setSubmittedFeature] = useState("");
  const [submittedContextId, setSubmittedContextId] = useState("");
  const contextOptions =
    contextType === "campaign"
      ? campaigns.map((c) => ({ id: c.id, label: c.name }))
      : items.map((i) => ({ id: i.id, label: `${i.title}${i.brandName ? ` — ${i.brandName}` : ""}` }));
  return (
    <div className="flex flex-col gap-6">
      <form
        action={formAction}
        onSubmit={() => {
          setSubmittedFeature(feature);
          setSubmittedContextId(contextId);
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="workspaceId" value={workspaceId} />
        {disabled ? (
          <p
            role="note"
            className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm text-[var(--mt-text)]"
          >
            Asisten AI nonaktif — belum ada provider AI yang dipasang, jadi form ini tidak dapat
            disubmit.
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ai-feature" className="text-sm font-medium text-[var(--mt-text)]">
              Aksi AI
            </label>
            <select
              id="ai-feature"
              disabled={disabled}
              name="feature"
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
              className="h-10 w-full rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm text-[var(--mt-text)]"
            >
              {AI_FEATURE_CATALOG.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--mt-text-muted)]">
              {AI_FEATURE_CATALOG.find((f) => f.id === feature)?.description}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ai-context-type" className="text-sm font-medium text-[var(--mt-text)]">
              Jenis context
            </label>
            <select
              id="ai-context-type"
              disabled={disabled}
              name="contextType"
              value={contextType}
              onChange={(e) => {
                setContextType(e.target.value);
                setContextId("");
              }}
              className="h-10 w-full rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm text-[var(--mt-text)]"
            >
              <option value="content_item">Konten</option>
              <option value="campaign">Campaign</option>
              <option value="comment_thread">Thread komentar (konten)</option>
              <option value="manual">Teks yang diberikan user</option>
            </select>
            <p className="text-xs text-[var(--mt-text-muted)]">
              Context selalu dari workspace ini + scope brand Anda — AI tidak membaca workspace lain.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ai-context-id" className="text-sm font-medium text-[var(--mt-text)]">
              Context
            </label>
            <select
              id="ai-context-id"
              disabled={disabled}
              name="contextId"
              value={contextId}
              onChange={(e) => setContextId(e.target.value)}
              className="h-10 w-full rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm text-[var(--mt-text)]"
            >
              <option value="">— pilih context —</option>
              {contextOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--mt-text-muted)]">
              Wajib untuk brief, draft, repurpose, dan rangkuman feedback/campaign.
            </p>
          </div>
          <Input
            id="ai-locale"
            disabled={disabled}
            type="text"
            name="locale"
            label="Bahasa output (locale)"
            defaultValue="id"
            hint="Default id (Indonesia) — bahasa output mengikuti bahasa konten (ASUMSI-8B)."
          />
          <Input
            id="ai-audience"
            disabled={disabled}
            type="text"
            name="audience"
            label="Audiens (opsional)"
            placeholder="Perempuan 25–35"
          />
          <Input
            id="ai-objective"
            disabled={disabled}
            type="text"
            name="objective"
            label="Tujuan (opsional)"
            placeholder="Edukasi audiens soal rutinitas pagi"
          />
          <Input
            id="ai-pillar"
            disabled={disabled}
            type="text"
            name="pillar"
            label="Pilar (opsional)"
            placeholder="Edukasi"
          />
          <Input
            id="ai-channel"
            disabled={disabled}
            type="text"
            name="channel"
            label="Channel (opsional)"
            placeholder="Reels"
          />
          <Input
            id="ai-target-channel"
            disabled={disabled}
            type="text"
            name="targetChannel"
            label="Target channel repurpose (opsional)"
            placeholder="TikTok"
          />
          <Input
            id="ai-target-format"
            disabled={disabled}
            type="text"
            name="targetFormat"
            label="Target format repurpose (opsional)"
            placeholder="Video vertikal 60 detik"
          />
          <Input
            id="ai-period-start"
            disabled={disabled}
            type="date"
            name="periodStart"
            label="Periode awal (rangkuman campaign)"
          />
          <Input
            id="ai-period-end"
            disabled={disabled}
            type="date"
            name="periodEnd"
            label="Periode akhir (rangkuman campaign)"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ai-source-text" className="text-sm font-medium text-[var(--mt-text)]">
            Teks sumber (checklist / feedback — wajib untuk aksi itu)
          </label>
          <textarea
            id="ai-source-text"
            disabled={disabled}
            name="sourceText"
            rows={6}
            placeholder="Tempel sumber/referensi atau thread komentar di sini. Teks ini diperlakukan sebagai DATA, bukan instruksi — upaya override akan diblokir."
            className="w-full rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm text-[var(--mt-text)]"
          />
          <p className="text-xs text-[var(--mt-text-muted)]">
            Teks sumber tidak disimpan mentah ke log — hanya referensinya.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={disabled || pending}>
            {pending ? "Memproses…" : "Jalankan aksi AI"}
          </Button>
        </div>
        <ResultMessage state={state} />
      </form>

      {state.draft != null && state.generationId ? (
        <AiDraftReview
          draft={state.draft}
          feature={submittedFeature}
          generationId={state.generationId}
          workspaceId={workspaceId}
          contextItemId={submittedContextId}
        />
      ) : null}
    </div>
  );
}
