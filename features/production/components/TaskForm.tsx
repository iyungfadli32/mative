"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createTaskAction, type ProductionActionResult } from "../actions";
import type { TaskParentType } from "../types";

/**
 * Form buat task (P3-06). Parent dipilih dari konten/campaign workspace;
 * assignee dipilih dari anggota workspace (peran "limited" hanya boleh
 * memilih dirinya sendiri — pilihan dibatasi di sini, RPC menegakkan).
 */
export function TaskForm({
  workspaceId,
  parents,
  members,
  defaultParentType,
  defaultParentId,
  canAssignAnyone,
  selfUserId,
  lockedParent,
}: {
  workspaceId: string;
  parents: Array<{ id: string; title: string; kind: TaskParentType }>;
  members: Array<{ userId: string; displayName: string }>;
  defaultParentType?: TaskParentType;
  defaultParentId?: string;
  canAssignAnyone: boolean;
  selfUserId: string;
  /** Bila diisi, parent sudah ditentukan (mis. tab Task di editor konten) — pemilih disembunyikan. */
  lockedParent?: { type: TaskParentType; id: string; title: string };
}) {
  const [state, formAction, pending] = useActionState(createTaskAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  const assignees = canAssignAnyone ? members : members.filter((m) => m.userId === selfUserId);
  const [parentType, setParentType] = useState<TaskParentType>(defaultParentType ?? "content_item");
  const parentOptions = parents.filter((p) => p.kind === parentType);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      {lockedParent ? (
        <>
          <input type="hidden" name="parentType" value={lockedParent.type} />
          <input type="hidden" name="parentId" value={lockedParent.id} />
          <p className="text-sm text-[var(--mt-text-muted)]">
            Parent: {lockedParent.type === "content_item" ? "Konten: " : "Campaign: "}
            {lockedParent.title}
          </p>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Jenis parent
            <select
              name="parentType"
              value={parentType}
              onChange={(e) => setParentType(e.target.value as TaskParentType)}
              className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
            >
              <option value="content_item">Konten</option>
              <option value="campaign">Campaign</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Parent task
            <select
              name="parentId"
              defaultValue={defaultParentId ?? ""}
              required
              className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
            >
              <option value="">
                — Pilih {parentType === "content_item" ? "konten" : "campaign"} —
              </option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <Input id="task-title" name="title" label="Judul task" required maxLength={200} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Deskripsi (opsional)
        <textarea
          name="description"
          rows={3}
          maxLength={2000}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Ditugaskan ke
          <select
            name="assigneeUserId"
            defaultValue=""
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
          >
            <option value="">— Belum ditugaskan —</option>
            {assignees.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Prioritas
          <select
            name="priority"
            defaultValue="medium"
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
          >
            <option value="low">Rendah</option>
            <option value="medium">Sedang</option>
            <option value="high">Tinggi</option>
            <option value="urgent">Mendesak</option>
          </select>
        </label>
        <Input id="task-due" name="dueAt" label="Tenggat (opsional)" type="datetime-local" />
        <Input
          id="task-estimate"
          name="estimateMinutes"
          label="Estimasi (menit, opsional)"
          type="number"
          min={0}
          inputMode="numeric"
        />
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Checklist (opsional — satu item per baris)
        <textarea
          name="checklist"
          rows={3}
          maxLength={4000}
          placeholder={"Contoh:\nRiset referensi\nTulis draf pertama"}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        Buat task
      </Button>
    </form>
  );
}
