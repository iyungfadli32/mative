"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { PlanningActionResult } from "../actions";
import type { Audience, Brand, Campaign, ContentItem, ContentPillar } from "../types";
import { FUNNEL_STAGE_LABELS, PRIORITY_LABELS } from "../constants";

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local memakai waktu dinding lokal browser; nilai disimpan UTC
  // oleh server setelah parsing ISO.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Form buat/edit content item (P2-09). Edit field kunci → versi baru
 * (server action memanggil RPC update_content_item_with_version).
 * production_status TIDAK diubah di sini — pakai TransitionForm.
 */
export function ContentForm({
  workspaceId,
  timezone,
  brands,
  campaigns,
  pillars,
  audiences,
  initial,
  initialVersion,
  prefillDueAt,
  action,
  submitLabel,
}: {
  workspaceId: string;
  timezone: string;
  brands: Brand[];
  campaigns: Campaign[];
  pillars: ContentPillar[];
  audiences: Audience[];
  /** Tanggal awal tenggat saat dibuat dari kalender (?tanggal=YYYY-MM-DD). */
  prefillDueAt?: string;
  initial: ContentItem | null;
  /** Versi terbaru (untuk mengisi field script/caption/CTA saat edit). */
  initialVersion?: {
    script: string | null;
    caption: string | null;
    cta: string | null;
    creative_notes: string | null;
  } | null;
  action: (prev: PlanningActionResult, formData: FormData) => Promise<PlanningActionResult>;
  submitLabel: string;
}) {
  // S-6: brand terpilih mengendalikan opsi pilar (pilar brand lain disembunyikan).
  const [selectedBrandId, setSelectedBrandId] = useState(initial?.brand_id ?? "");
  const visiblePillars = pillars.filter(
    (p) => p.brand_id == null || p.brand_id === selectedBrandId, // S-6: pilar tanpa brand berlaku untuk semua; pilar ber-brand hanya untuk brand itu.
  );
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      {initial ? <input type="hidden" name="contentItemId" value={initial.id} /> : null}
      {/* Select brand di-disable saat edit (brand tak bisa diubah), tapi
          kontrol disabled TIDAK ikut terkirim — tanpa input tersembunyi
          ini brandId null dan validasi update selalu gagal ("expected
          string, received null", defect 2026-11-19: edit konten tak
          pernah bisa menyimpan). */}
      {initial ? <input type="hidden" name="brandId" value={initial.brand_id} /> : null}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Brand <span className="text-[var(--mt-rose-700)]">*</span>
        <select
          name="brandId"
          defaultValue={initial?.brand_id ?? ""}
          required
          disabled={Boolean(initial)}
          onChange={(e) => setSelectedBrandId(e.target.value)}
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="">— Pilih brand —</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {initial ? (
          <span className="text-[13px] font-normal text-[var(--mt-text-muted)]">
            Brand tidak bisa diubah setelah konten dibuat.
          </span>
        ) : null}
      </label>
      <Input
        id="content-title"
        name="title"
        label="Judul konten"
        defaultValue={initial?.title ?? ""}
        required
      />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Deskripsi internal
        <textarea
          name="internalDescription"
          defaultValue={initial?.internal_description ?? ""}
          rows={3}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Tujuan (objective)
        <textarea
          name="objective"
          defaultValue={initial?.objective ?? ""}
          rows={2}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Campaign (opsional)
          <select
            name="campaignId"
            defaultValue={initial?.campaign_id ?? ""}
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
          >
            <option value="">— Tanpa campaign —</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Pilar (opsional)
          <select
            key={selectedBrandId || "none"}
            name="pillarId"
            defaultValue={
              visiblePillars.some((p) => p.id === initial?.pillar_id)
                ? (initial?.pillar_id ?? "")
                : ""
            }
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
          >
            <option value="">— Tanpa pilar —</option>
            {visiblePillars.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Audiens (opsional)
          <select
            name="audienceId"
            defaultValue={initial?.audience_id ?? ""}
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
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Funnel stage (opsional)
          <select
            name="funnelStage"
            defaultValue={initial?.funnel_stage ?? ""}
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
          >
            <option value="">— Tanpa funnel stage —</option>
            {Object.entries(FUNNEL_STAGE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Prioritas
          <select
            name="priority"
            defaultValue={initial?.priority ?? "medium"}
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
          >
            {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <Input
          id="content-dueAt"
          name="dueAt"
          type="datetime-local"
          label={`Tenggat produksi (zona ${timezone})`}
          defaultValue={
            prefillDueAt ? `${prefillDueAt}T09:00` : toDatetimeLocalValue(initial?.due_at ?? null)
          }
        />
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Script / naskah
        <textarea
          name="script"
          defaultValue={initialVersion?.script ?? ""}
          rows={3}
          placeholder="Ringkasan script — tersimpan di versi konten."
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Caption
        <textarea
          name="caption"
          defaultValue={initialVersion?.caption ?? ""}
          rows={3}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <Input id="content-cta" name="cta" label="CTA" defaultValue={initialVersion?.cta ?? ""} />
        <Input
          id="content-changeSummary"
          name="changeSummary"
          label="Ringkasan perubahan (wajib — tercatat di versi)"
          defaultValue={initial ? "" : "Versi awal (v1)"}
          required
        />
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Catatan kreatif
        <textarea
          name="creativeNotes"
          defaultValue={initialVersion?.creative_notes ?? ""}
          rows={2}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <input type="hidden" name="timezone" value={timezone} />
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        {submitLabel}
      </Button>
      {initial ? (
        <p className="text-[13px] text-[var(--mt-text-muted)]">
          Menyimpan akan membuat versi baru (v berikutnya), bukan menimpa versi lama. Status
          produksi tidak berubah di sini.
        </p>
      ) : null}
    </form>
  );
}
