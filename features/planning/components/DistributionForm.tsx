"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { transitionDistributionAction } from "../actions";
import type { DistributionStatus } from "../constants";
import { DISTRIBUTION_STATUS_LABELS } from "../constants";
import { validDistributionTargets } from "../transitions";

/**
 * Form ubah status distribusi satu placement (P2-14). Hanya tujuan yang
 * valid yang ditawarkan; validasi akhir di RPC 0008. Perubahan tercatat
 * sebagai content_status_events + activity_logs.
 */
export function DistributionForm({
  placementId,
  workspaceId,
  fromStatus,
}: {
  placementId: string;
  workspaceId: string;
  fromStatus: DistributionStatus;
}) {
  const targets = validDistributionTargets(fromStatus);
  const [state, formAction, pending] = useActionState(transitionDistributionAction, {
    ok: false,
    message: "",
  });
  if (targets.length === 0) {
    return (
      <p className="text-xs text-[var(--mt-text-muted)]">
        Status distribusi terminal — tidak ada transisi keluar.
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="placementId" value={placementId} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="sr-only" htmlFor={`dist-${placementId}`}>
        Ubah status distribusi
      </label>
      <select
        id={`dist-${placementId}`}
        name="toStatus"
        defaultValue=""
        required
        className="h-8 rounded-lg border border-[var(--mt-border)] bg-[var(--mt-surface)] px-2 text-xs"
      >
        <option value="">Ubah distribusi ke…</option>
        {targets.map((t) => (
          <option key={t} value={t}>
            {DISTRIBUTION_STATUS_LABELS[t].label}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" loading={pending}>
        Ubah
      </Button>
      {state.message ? (
        <span role={state.ok ? "status" : "alert"} className="text-xs">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
