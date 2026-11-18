"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { PlanningActionResult } from "../actions";
import type { ProductionStatus } from "../constants";
import { PRODUCTION_STATUS_LABELS } from "../constants";
import { validProductionTargets, productionTransitionRequiresReason } from "../transitions";

/**
 * Form pindah production stage (P2-12/P2-14). Hanya tujuan yang valid
 * yang ditawarkan; alasan wajib ditandai bila transisi membutuhkannya.
 * Validasi akhir tetap di RPC 0008 (domain service, bukan UI).
 */
export function TransitionForm({
  contentItemId,
  workspaceId,
  fromStatus,
  action,
}: {
  contentItemId: string;
  workspaceId: string;
  fromStatus: ProductionStatus;
  action: (prev: PlanningActionResult, formData: FormData) => Promise<PlanningActionResult>;
}) {
  const targets = validProductionTargets(fromStatus);
  const [toStatus, setToStatus] = useState<ProductionStatus | "">("");
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
  });
  const needsReason =
    toStatus !== "" && productionTransitionRequiresReason(fromStatus, toStatus as ProductionStatus);
  if (targets.length === 0) {
    return (
      <p className="text-sm text-[var(--mt-text-muted)]">
        Status ini terminal — tidak ada transisi keluar.
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="contentItemId" value={contentItemId} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Pindah stage ke
        <select
          name="toStatus"
          value={toStatus}
          onChange={(e) => setToStatus(e.target.value as ProductionStatus | "")}
          required
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="">— Pilih stage tujuan —</option>
          {targets.map((t) => (
            <option key={t} value={t}>
              {PRODUCTION_STATUS_LABELS[t].label}
            </option>
          ))}
        </select>
      </label>
      <Input
        id="transition-reason"
        name="reason"
        label={needsReason ? "Alasan (wajib)" : "Alasan (opsional)"}
        required={needsReason}
        defaultValue=""
      />
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending} disabled={!toStatus}>
        Pindah stage
      </Button>
    </form>
  );
}
