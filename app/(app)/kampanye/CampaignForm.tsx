"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createCampaignAction } from "@/features/planning/actions";
import type { Audience, Brand } from "@/features/planning/types";

/** Form buat campaign dasar (P2-07). Status enum sementara P2-A3. */
export function CampaignForm({
  workspaceId,
  brands,
  audiences,
}: {
  workspaceId: string;
  brands: Brand[];
  audiences: Audience[];
}) {
  const [state, formAction, pending] = useActionState(createCampaignAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Input id="campaign-name" name="name" label="Nama campaign" required />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Tujuan (objective)
        <textarea
          name="objective"
          rows={2}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Audiens (opsional)
        <select
          name="audienceId"
          defaultValue=""
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="">— Tanpa audiens —</option>
          {audiences.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <Input id="campaign-start" name="startAt" type="datetime-local" label="Mulai (opsional)" />
        <Input id="campaign-end" name="endAt" type="datetime-local" label="Selesai (opsional)" />
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Status
        <select
          name="status"
          defaultValue="draft"
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="draft">Draf</option>
          <option value="active">Aktif</option>
          <option value="completed">Selesai</option>
          <option value="archived">Diarsipkan</option>
          <option value="cancelled">Dibatalkan</option>
        </select>
      </label>
      <fieldset className="rounded-xl border border-[var(--mt-border)] p-3">
        <legend className="px-1 text-sm font-medium">Brand dalam campaign</legend>
        {brands.length === 0 ? (
          <p className="text-sm text-[var(--mt-text-muted)]">Belum ada brand di workspace ini.</p>
        ) : (
          brands.map((b) => (
            <label key={b.id} className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" name="brandIds" value={b.id} />
              {b.name}
            </label>
          ))
        )}
      </fieldset>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Target metrik (JSON, opsional)
        <textarea
          name="targetMetricsJson"
          defaultValue="{}"
          rows={2}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 font-mono text-sm font-normal"
        />
        <span className="text-[13px] font-normal text-[var(--mt-text-muted)]">
          Contoh: {`{"reach": 10000, "leads": 50}`} — kunci metrik → angka target.
        </span>
      </label>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        Buat campaign
      </Button>
    </form>
  );
}
