"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { clientCommentAction } from "@/features/approval/actions";

/**
 * Form komentar klien di portal (P4-14, Keputusan #12).
 * Komentar klien TIDAK PERNAH menjadi keputusan approval — hanya catatan
 * untuk tim. Form tetap mounted setelah aksi (pelajaran e2e Phase 3).
 */
export function ClientCommentForm({ shareId }: { shareId: string }) {
  const [state, formAction, pending] = useActionState(clientCommentAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="shareId" value={shareId} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Komentar Anda
        <textarea
          name="body"
          rows={3}
          placeholder="Tulis komentar atau pertanyaan Anda di sini…"
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Kirim komentar
        </Button>
        {state.message ? (
          <span role={state.ok ? "status" : "alert"} className="text-xs">
            {state.message}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-[var(--mt-text-muted)]">
        Komentar Anda dibaca tim, tetapi tidak mengubah keputusan approval — keputusan dibuat
        approver internal.
      </p>
    </form>
  );
}
