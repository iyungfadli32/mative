"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  createBrandAction,
  updateBrandAction,
  type PlanningActionResult,
} from "@/features/planning/actions";
import type { Brand } from "@/features/planning/types";

/** Form buat/edit brand (P2-04). Slug tidak bisa diubah setelah dibuat. */
export function BrandForm({
  workspaceId,
  initial,
}: {
  workspaceId: string;
  initial?: Brand | null;
}) {
  const action = initial ? updateBrandAction : createBrandAction;
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      {initial ? <input type="hidden" name="brandId" value={initial.id} /> : null}
      <Input
        id={`brand-name-${initial?.id ?? "new"}`}
        name="name"
        label="Nama brand"
        defaultValue={initial?.name ?? ""}
        required
      />
      {!initial ? (
        <Input
          id="brand-slug-new"
          name="slug"
          label="Slug (huruf kecil, angka, tanda hubung — unik per workspace)"
          defaultValue=""
          required
          hint="Slug tidak bisa diubah setelah brand dibuat."
        />
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Slug: <code>{initial.slug}</code> (tidak bisa diubah)
        </p>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Deskripsi
        <textarea
          name="description"
          defaultValue={initial?.description ?? ""}
          rows={2}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Status
        <select
          name="status"
          defaultValue={initial?.status ?? "active"}
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
          <option value="archived">Diarsipkan</option>
        </select>
      </label>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        {initial ? "Simpan perubahan" : "Buat brand"}
      </Button>
    </form>
  );
}

// Re-ekspor tipe agar halaman tidak perlu mengimpor actions langsung.
export type { PlanningActionResult };
