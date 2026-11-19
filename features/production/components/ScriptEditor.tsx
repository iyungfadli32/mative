"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { updateScriptAction, type ProductionActionResult } from "../actions";

/** Editor script/caption/CTA (tab Script, P3-11). Simpan = versi baru. */
export function ScriptEditor({
  workspaceId,
  contentItemId,
  initial,
  canEdit,
}: {
  workspaceId: string;
  contentItemId: string;
  initial: {
    script: string | null;
    caption: string | null;
    cta: string | null;
    creativeNotes: string | null;
  };
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateScriptAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  if (!canEdit) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-[var(--mt-text-muted)]">
          Peran Anda tidak boleh mengubah script konten ini.
        </p>
        <dl className="flex flex-col gap-2">
          <div>
            <dt className="font-medium">Script</dt>
            <dd className="whitespace-pre-wrap text-[var(--mt-text-muted)]">
              {initial.script || "—"}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Caption</dt>
            <dd className="whitespace-pre-wrap text-[var(--mt-text-muted)]">
              {initial.caption || "—"}
            </dd>
          </div>
          <div>
            <dt className="font-medium">CTA</dt>
            <dd className="text-[var(--mt-text-muted)]">{initial.cta || "—"}</dd>
          </div>
          <div>
            <dt className="font-medium">Catatan kreatif</dt>
            <dd className="whitespace-pre-wrap text-[var(--mt-text-muted)]">
              {initial.creativeNotes || "—"}
            </dd>
          </div>
        </dl>
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="contentItemId" value={contentItemId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Script
        <textarea
          name="script"
          rows={8}
          defaultValue={initial.script ?? ""}
          maxLength={10000}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Caption
        <textarea
          name="caption"
          rows={4}
          defaultValue={initial.caption ?? ""}
          maxLength={5000}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <Input
        id="script-cta"
        name="cta"
        label="CTA"
        defaultValue={initial.cta ?? ""}
        maxLength={300}
      />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Catatan kreatif
        <textarea
          name="creativeNotes"
          rows={3}
          defaultValue={initial.creativeNotes ?? ""}
          maxLength={2000}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <Input
        id="script-change-summary"
        name="changeSummary"
        label="Ringkasan perubahan (wajib — tercatat di versi baru)"
        required
        maxLength={500}
      />
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        Simpan script (versi baru)
      </Button>
    </form>
  );
}
