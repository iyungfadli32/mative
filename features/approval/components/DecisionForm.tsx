"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { decideApprovalAction } from "@/features/approval/actions";
import { APPROVAL_DECISION_LABELS } from "@/features/approval/constants";
import type { ApprovalDecisionKind } from "@/features/approval/types";

/**
 * Form keputusan approval (P4-04): setujui / minta revisi / tolak.
 * Minta revisi dan tolak WAJIB komentar (ditegakkan server via Zod + RPC).
 *
 * ATURAN POLA (pelajaran e2e Phase 3): form ini SENGAJA tetap dirender
 * setelah keputusan tercatat — pesannya hidup di useActionState, dan
 * unmount akan menghapus pesan sukses sebelum sempat dibaca. Jangan
 * sembunyikan form ini berdasarkan hasil aksinya sendiri.
 */
export function DecisionForm({
  requestId,
  workspaceId,
  disabled,
}: {
  requestId: string;
  workspaceId: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(decideApprovalAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 rounded-xl border border-[var(--mt-border)] bg-[var(--mt-canvas)] p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <fieldset className="flex flex-wrap gap-2" disabled={disabled || pending}>
        <legend className="text-sm font-medium">Keputusan Anda</legend>
        {(["approved", "changes_requested", "rejected"] as const).map((d: ApprovalDecisionKind) => (
          <label
            key={d}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-1 text-sm"
          >
            <input type="radio" name="decision" value={d} required defaultChecked={d === "approved"} />
            {APPROVAL_DECISION_LABELS[d]}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Komentar (wajib bila minta revisi / tolak)
        <textarea
          name="comment"
          rows={2}
          placeholder="Tulis alasan revisi atau penolakan di sini…"
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={disabled}>
          Kirim keputusan
        </Button>
        {state.message ? (
          <span role={state.ok ? "status" : "alert"} className="text-xs">
            {state.message}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-[var(--mt-text-muted)]">
        Keputusan tercatat permanen (append-only) dan tidak bisa diubah atau dihapus.
      </p>
    </form>
  );
}
