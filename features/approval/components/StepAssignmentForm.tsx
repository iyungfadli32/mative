"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { assignWorkflowStepAction } from "@/features/approval/actions";
import { APPROVAL_ROLES } from "@/lib/validation/schemas";

/**
 * Form penugasan satu step workflow (P4-08).
 * Workflow default menugaskan role 'approver'; workspace baru belum punya
 * member approver, sehingga request default tidak pernah bisa diputuskan
 * sebelum step ini ditugaskan ke role lain atau pengguna eksplisit.
 * Minimal satu terisi (role ATAU pengguna); bila keduanya terisi, salah
 * satu yang cocok sudah cukup (ADR-0010 §6).
 * Form tetap mounted setelah aksi (pelajaran e2e Phase 3).
 */
export function StepAssignmentForm({
  workspaceId,
  stepId,
  stepOrder,
  stepType,
  assigneeRole,
  assigneeUserId,
  members,
}: {
  workspaceId: string;
  stepId: string;
  stepOrder: number;
  stepType: string;
  assigneeRole: string | null;
  assigneeUserId: string | null;
  members: { userId: string; displayName: string; role: string }[];
}) {
  const [state, formAction, pending] = useActionState(assignWorkflowStepAction, {
    ok: false,
    message: "",
  });
  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 rounded-xl border border-[var(--mt-border)] bg-[var(--mt-canvas)] p-3"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="stepId" value={stepId} />
      <p className="text-sm font-medium">
        Step {stepOrder} ({stepType === "parallel" ? "paralel" : "sekuensial"})
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Tugaskan ke role
        <select
          name="assigneeRole"
          defaultValue={assigneeRole ?? ""}
          className="h-9 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm"
        >
          <option value="">— Tidak ditugaskan ke role —</option>
          {APPROVAL_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        atau ke pengguna eksplisit
        <select
          name="assigneeUserId"
          defaultValue={assigneeUserId ?? ""}
          className="h-9 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm"
        >
          <option value="">— Tidak ditugaskan ke pengguna —</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName} ({m.role})
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Simpan penugasan
        </Button>
        {state.message ? (
          <span role={state.ok ? "status" : "alert"} className="text-xs">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
