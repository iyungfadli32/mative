"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { toggleClientCommentsAction, type ProductionActionResult } from "../actions";

/**
 * Toggle komentar klien (P3-09, v2 Keputusan #12): hanya owner/admin.
 * Default MATI. Bila menyala, viewer_client boleh berkomentar HANYA pada
 * konten/campaign yang dibagikan eksplisit kepadanya.
 */
export function ClientCommentsToggle({
  workspaceId,
  workspaceName,
  allowed,
}: {
  workspaceId: string;
  workspaceName: string;
  allowed: boolean;
}) {
  const [state, formAction, pending] = useActionState(toggleClientCommentsAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  return (
    <div className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
      <h2 className="font-semibold">Komentar klien — {workspaceName}</h2>
      <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
        Saat ini: <strong>{allowed ? "diizinkan" : "dimatikan"}</strong>. Klien (viewer_client)
        hanya bisa berkomentar pada konten yang dibagikan eksplisit — dan komentar klien tidak
        pernah menjadi keputusan approval.
      </p>
      <form action={formAction} className="mt-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="allowed" value={String(!allowed)} />
        <Button type="submit" size="sm" loading={pending}>
          {allowed ? "Matikan komentar klien" : "Izinkan komentar klien"}
        </Button>
      </form>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="mt-2 text-sm">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
