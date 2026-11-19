"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  addChecklistItemAction,
  toggleChecklistItemAction,
  type ProductionActionResult,
} from "../actions";
import type { TaskChecklistItem } from "../types";

/**
 * Checklist task (P3-06). Menandai selesai mengisi completed_by/at;
 * membuka lagi mengosongkannya (RPC tidak dipakai — update langsung
 * dengan RLS; hanya assignee / peran penuh yang lolos).
 */
export function TaskChecklist({
  taskId,
  workspaceId,
  items,
  canEdit,
}: {
  taskId: string;
  workspaceId: string;
  items: TaskChecklistItem[];
  canEdit: boolean;
}) {
  const [addState, addAction, addPending] = useActionState(addChecklistItemAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  const [toggleState, toggleAction, togglePending] = useActionState(toggleChecklistItemAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  const done = items.filter((i) => i.is_done).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--mt-text-muted)]">
        Checklist: {done}/{items.length} selesai
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--mt-text-muted)]">Belum ada item checklist.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              {canEdit ? (
                <form action={toggleAction}>
                  <input type="hidden" name="checklistItemId" value={item.id} />
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input type="hidden" name="isDone" value={String(!item.is_done)} />
                  <button
                    type="submit"
                    disabled={togglePending}
                    aria-label={
                      item.is_done ? `Buka lagi: ${item.title}` : `Tandai selesai: ${item.title}`
                    }
                    className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--mt-border)] text-base leading-none"
                  >
                    {item.is_done ? "✓" : ""}
                  </button>
                </form>
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--mt-border)] text-base leading-none"
                >
                  {item.is_done ? "✓" : ""}
                </span>
              )}
              <span className={item.is_done ? "text-[var(--mt-text-muted)] line-through" : ""}>
                {item.title}
              </span>
            </li>
          ))}
        </ul>
      )}
      {toggleState.message ? (
        <p role={toggleState.ok ? "status" : "alert"} className="text-sm">
          {toggleState.message}
        </p>
      ) : null}
      {canEdit ? (
        <form action={addAction} className="flex flex-col gap-2">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <Input
            id={`checklist-add-${taskId}`}
            name="title"
            label="Tambah item checklist"
            required
            maxLength={200}
          />
          {addState.message ? (
            <p role={addState.ok ? "status" : "alert"} className="text-sm">
              {addState.message}
            </p>
          ) : null}
          <Button type="submit" size="sm" loading={addPending}>
            Tambah item
          </Button>
        </form>
      ) : null}
    </div>
  );
}
