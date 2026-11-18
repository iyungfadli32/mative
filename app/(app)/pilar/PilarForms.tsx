"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  createAudienceAction,
  createPillarAction,
  updatePillarAction,
} from "@/features/planning/actions";
import type { ContentPillar } from "@/features/planning/types";

/** Form buat/edit pilar konten (P2-06). */
export function PillarForm({
  workspaceId,
  brands,
  initial,
}: {
  workspaceId: string;
  brands: Array<{ id: string; name: string }>;
  initial?: ContentPillar | null;
}) {
  const action = initial ? updatePillarAction : createPillarAction;
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      {initial ? <input type="hidden" name="pillarId" value={initial.id} /> : null}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Brand (kosong = berlaku untuk seluruh workspace)
        <select
          name="brandId"
          defaultValue={initial?.brand_id ?? ""}
          disabled={Boolean(initial)}
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="">— Semua brand (workspace) —</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <Input
        id={`pillar-name-${initial?.id ?? "new"}`}
        name="name"
        label="Nama pilar"
        defaultValue={initial?.name ?? ""}
        required
      />
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
        Token warna
        <select
          name="colorToken"
          defaultValue={initial?.color_token ?? "teal"}
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          {["teal", "navy", "indigo", "amber", "rose", "mint", "slate"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="active"
          value="true"
          defaultChecked={initial?.active ?? true}
        />
        Aktif
      </label>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        {initial ? "Simpan perubahan" : "Buat pilar"}
      </Button>
    </form>
  );
}

/**
 * Form audiens (P2-06). Atribut diisi sebagai daftar sederhana
 * (minat / pain point dipisah koma); bentuk JSONB didokumentasikan ADR-0008.
 */
export function AudienceForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction, pending] = useActionState(createAudienceAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Input id="audience-name" name="name" label="Nama audiens" required />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Deskripsi
        <textarea
          name="description"
          rows={2}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <Input
        id="audience-age"
        name="ageRange"
        label="Rentang usia (opsional)"
        hint="Disimpan sebagai attributes.age_range."
      />
      <Input
        id="audience-location"
        name="location"
        label="Lokasi (opsional)"
        hint="Disimpan sebagai attributes.location."
      />
      <Input
        id="audience-interests"
        name="interests"
        label="Minat (pisahkan koma, opsional)"
        hint="Disimpan sebagai attributes.interests[]."
      />
      <Input
        id="audience-pains"
        name="painPoints"
        label="Pain point (pisahkan koma, opsional)"
        hint="Disimpan sebagai attributes.pain_points[]."
      />
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        Buat audiens
      </Button>
    </form>
  );
}
