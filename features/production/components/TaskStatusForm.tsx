"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { transitionTaskAction, type ProductionActionResult } from "../actions";
import { TASK_STATUS_LABELS } from "../constants";
import { validTaskTargets } from "../transitions";
import type { TaskStatus } from "../types";

/** Form pindah status task (P3-06). Hanya tujuan valid yang ditawarkan. */
export function TaskStatusForm({
  taskId,
  workspaceId,
  fromStatus,
}: {
  taskId: string;
  workspaceId: string;
  fromStatus: TaskStatus;
}) {
  const targets = validTaskTargets(fromStatus);
  const [toStatus, setToStatus] = useState<TaskStatus | "">("");
  const [state, formAction, pending] = useActionState(transitionTaskAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  if (targets.length === 0) {
    return (
      <p className="text-sm text-[var(--mt-text-muted)]">
        Status ini terminal — tidak ada transisi keluar.
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Pindah status ke
        <select
          name="toStatus"
          value={toStatus}
          onChange={(e) => setToStatus(e.target.value as TaskStatus | "")}
          required
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="">— Pilih status tujuan —</option>
          {targets.map((t) => (
            <option key={t} value={t}>
              {TASK_STATUS_LABELS[t].icon} {TASK_STATUS_LABELS[t].label}
            </option>
          ))}
        </select>
      </label>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" size="sm" loading={pending} disabled={!toStatus}>
        Pindah status
      </Button>
    </form>
  );
}
