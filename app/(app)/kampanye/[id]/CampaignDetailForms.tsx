/**
 * Form detail campaign — app/(app)/kampanye/[id]/CampaignDetailForms.tsx (P5-04).
 * Aturan: form TIDAK PERNAH disembunyikan berdasarkan hasil aksinya
 * sendiri (pelajaran e2e Phase 3/4) — pesan tampil di bawah form yang
 * tetap mounted.
 */
"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  linkCampaignBrandAction,
  linkCampaignContentAction,
  saveCampaignAsTemplateAction,
  transitionCampaignAction,
  unlinkCampaignContentAction,
  updateCampaignAction,
} from "@/features/campaign/actions";
import { CAMPAIGN_TRANSITIONS } from "@/features/campaign/transitions";
import { CAMPAIGN_STATUS_LABELS } from "@/features/campaign/constants";
import type { CampaignTargetMetrics } from "@/lib/validation/schemas";
import type { Audience, Brand, Campaign } from "@/features/planning/types";
import { unlinkCampaignBrandAction } from "@/features/planning/actions";

function ResultMessage({ state }: { state: { ok: boolean; message: string } }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className="text-sm">
      {state.message}
    </p>
  );
}

export function CampaignTransitionForm({
  workspaceId,
  campaign,
}: {
  workspaceId: string;
  campaign: Campaign;
}) {
  const [state, formAction, pending] = useActionState(transitionCampaignAction, {
    ok: false,
    message: "",
  });
  const allowed = CAMPAIGN_TRANSITIONS[campaign.status as keyof typeof CAMPAIGN_TRANSITIONS] ?? [];
  if (allowed.length === 0) {
    return (
      <p className="text-sm text-[var(--mt-text-muted)]">
        Status{" "}
        {CAMPAIGN_STATUS_LABELS[campaign.status as keyof typeof CAMPAIGN_STATUS_LABELS] ??
          campaign.status}{" "}
        adalah status akhir — tidak ada transisi lagi.
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="campaignId" value={campaign.id} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Ubah status menjadi
        <select
          name="toStatus"
          defaultValue={allowed[0]}
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          {allowed.map((s) => (
            <option key={s} value={s}>
              {CAMPAIGN_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Alasan (wajib bila membatalkan)
        <textarea
          name="reason"
          rows={2}
          maxLength={500}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <ResultMessage state={state} />
      <Button type="submit" loading={pending}>
        Ubah status
      </Button>
    </form>
  );
}

export function CampaignEditForm({
  workspaceId,
  campaign,
  brands,
  audiences,
  linkedBrandIds,
  targetMetrics,
}: {
  workspaceId: string;
  campaign: Campaign;
  brands: Brand[];
  audiences: Audience[];
  linkedBrandIds: string[];
  targetMetrics: CampaignTargetMetrics;
}) {
  const [state, formAction, pending] = useActionState(updateCampaignAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="campaignId" value={campaign.id} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Input
        id="edit-name"
        name="name"
        label="Nama campaign"
        defaultValue={campaign.name}
        required
      />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Tujuan (objective)
        <textarea
          name="objective"
          rows={2}
          defaultValue={campaign.objective ?? ""}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Audiens (opsional)
        <select
          name="audienceId"
          defaultValue={campaign.audience_id ?? ""}
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
        <Input
          id="edit-start"
          name="startAt"
          type="datetime-local"
          label="Mulai (opsional)"
          defaultValue={campaign.start_at ? campaign.start_at.slice(0, 16) : ""}
        />
        <Input
          id="edit-end"
          name="endAt"
          type="datetime-local"
          label="Selesai (opsional)"
          defaultValue={campaign.end_at ? campaign.end_at.slice(0, 16) : ""}
        />
      </div>
      <fieldset className="rounded-xl border border-[var(--mt-border)] p-3">
        <legend className="px-1 text-sm font-medium">Target (ASUMSI-5.3)</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            id="edit-target-deliverables"
            name="targetDeliverables"
            type="number"
            min={0}
            step={1}
            label="Target deliverable (jumlah konten)"
            defaultValue={targetMetrics.target_deliverables?.toString() ?? ""}
          />
          <Input
            id="edit-target-date"
            name="targetDate"
            type="date"
            label="Target tanggal selesai"
            defaultValue={targetMetrics.target_date ?? ""}
          />
        </div>
        <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium">
          Catatan target
          <textarea
            name="targetNotes"
            rows={2}
            maxLength={500}
            defaultValue={targetMetrics.notes ?? ""}
            className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
          />
        </label>
      </fieldset>
      <fieldset className="rounded-xl border border-[var(--mt-border)] p-3">
        <legend className="px-1 text-sm font-medium">Brand dalam campaign</legend>
        {brands.length === 0 ? (
          <p className="text-sm text-[var(--mt-text-muted)]">Belum ada brand di workspace ini.</p>
        ) : (
          brands.map((b) => (
            <label key={b.id} className="flex items-center gap-2 py-1 text-sm">
              <input
                type="checkbox"
                name="brandIds"
                value={b.id}
                defaultChecked={linkedBrandIds.includes(b.id)}
              />
              {b.name}
            </label>
          ))
        )}
      </fieldset>
      <ResultMessage state={state} />
      <Button type="submit" loading={pending}>
        Simpan perubahan
      </Button>
    </form>
  );
}

export function LinkContentForm({
  workspaceId,
  campaignId,
  items,
}: {
  workspaceId: string;
  campaignId: string;
  items: Array<{ id: string; title: string; brandName: string | null }>;
}) {
  const [state, formAction, pending] = useActionState(linkCampaignContentAction, {
    ok: false,
    message: "",
  });
  if (items.length === 0) {
    return (
      <p className="text-sm text-[var(--mt-text-muted)]">
        Tidak ada konten tanpa campaign di workspace ini.
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Konten yang ditautkan
        <select
          name="contentItemId"
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} — {item.brandName ?? "tanpa brand"}
            </option>
          ))}
        </select>
      </label>
      <ResultMessage state={state} />
      <Button type="submit" loading={pending}>
        Tautkan konten
      </Button>
    </form>
  );
}

export function UnlinkContentButton({
  workspaceId,
  campaignId,
  contentItemId,
  title,
}: {
  workspaceId: string;
  campaignId: string;
  contentItemId: string;
  title: string;
}) {
  const [state, formAction, pending] = useActionState(unlinkCampaignContentAction, {
    ok: false,
    message: "",
  });
  return (
    <span className="inline-flex items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="campaignId" value={campaignId} />
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="contentItemId" value={contentItemId} />
        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Lepas
        </Button>
      </form>
      {state.message ? (
        <span role={state.ok ? "status" : "alert"} className="text-xs">
          {state.message}
        </span>
      ) : (
        <span className="sr-only">{title}</span>
      )}
    </span>
  );
}

export function LinkBrandForm({
  workspaceId,
  campaignId,
  brands,
}: {
  workspaceId: string;
  campaignId: string;
  brands: Brand[];
}) {
  const [state, formAction, pending] = useActionState(linkCampaignBrandAction, {
    ok: false,
    message: "",
  });
  if (brands.length === 0) {
    return (
      <p className="text-sm text-[var(--mt-text-muted)]">
        Semua brand di workspace ini sudah terhubung ke campaign ini.
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Brand yang ditautkan
        <select
          name="brandId"
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <ResultMessage state={state} />
      <Button type="submit" loading={pending}>
        Tautkan brand
      </Button>
    </form>
  );
}

export function UnlinkBrandButton({
  workspaceId,
  campaignId,
  brandId,
  brandName,
}: {
  workspaceId: string;
  campaignId: string;
  brandId: string;
  brandName: string;
}) {
  return (
    <form action={unlinkCampaignBrandAction} className="inline">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="brandId" value={brandId} />
      <Button type="submit" variant="secondary" size="sm">
        Lepas {brandName}
      </Button>
    </form>
  );
}

export function SaveCampaignTemplateForm({
  workspaceId,
  campaign,
  linkedBrandIds,
  targetMetrics,
}: {
  workspaceId: string;
  campaign: Campaign;
  linkedBrandIds: string[];
  targetMetrics: CampaignTargetMetrics;
}) {
  const [state, formAction, pending] = useActionState(saveCampaignAsTemplateAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="sourceCampaignId" value={campaign.id} />
      <input type="hidden" name="objective" value={campaign.objective ?? ""} />
      <input type="hidden" name="audienceId" value={campaign.audience_id ?? ""} />
      <input
        type="hidden"
        name="targetDeliverables"
        value={targetMetrics.target_deliverables?.toString() ?? ""}
      />
      <input type="hidden" name="targetDate" value={targetMetrics.target_date ?? ""} />
      <input type="hidden" name="targetNotes" value={targetMetrics.notes ?? ""} />
      {linkedBrandIds.map((id) => (
        <input key={id} type="hidden" name="brandIds" value={id} />
      ))}
      <Input
        id="template-name"
        name="name"
        label="Nama template"
        defaultValue={`${campaign.name} (template)`}
        required
      />
      <ResultMessage state={state} />
      <Button type="submit" loading={pending}>
        Simpan sebagai template
      </Button>
    </form>
  );
}
