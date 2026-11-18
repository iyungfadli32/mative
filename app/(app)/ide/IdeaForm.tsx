"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createIdeaAction } from "@/features/planning/actions";
import type { Brand } from "@/features/planning/types";
import { IDEA_SOURCE_TYPE_LABELS } from "@/features/planning/constants";

/** Form tangkap ide minimal (P2-08). Inbox lengkap + brief adalah Phase 3. */
export function IdeaForm({ workspaceId, brands }: { workspaceId: string; brands: Brand[] }) {
  const [state, formAction, pending] = useActionState(createIdeaAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Input id="idea-title" name="title" label="Judul ide" required />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Brand (opsional)
        <select
          name="brandId"
          defaultValue=""
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="">— Tanpa brand —</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Sumber ide
        <select
          name="sourceType"
          defaultValue="other"
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          {Object.entries(IDEA_SOURCE_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Catatan
        <textarea
          name="notes"
          rows={3}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <Input
        id="idea-tags"
        name="tags"
        label="Tag (pisahkan koma, opsional)"
        hint="Tag sederhana di ide; tag ternormalisasi dikelola lewat konten."
      />
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        Tangkap ide
      </Button>
    </form>
  );
}
