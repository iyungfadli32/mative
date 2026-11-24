/**
 * Form template — app/(app)/template/TemplateForms.tsx (P5-06).
 * Template dasar (ASUMSI-5.4): simpan = salinan, pakai = salinan baru.
 * Form TIDAK PERNAH disembunyikan berdasarkan hasil aksinya sendiri.
 */
"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  createCampaignFromTemplateAction,
  createContentFromTemplateAction,
  deleteCampaignTemplateAction,
  deleteContentTemplateAction,
  saveContentAsTemplateAction,
} from "@/features/campaign/actions";

function ResultMessage({ state }: { state: { ok: boolean; message: string } }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className="text-sm">
      {state.message}
    </p>
  );
}

export function CreateCampaignFromTemplateForm({
  workspaceId,
  templateId,
  templateName,
}: {
  workspaceId: string;
  templateId: string;
  templateName: string;
}) {
  const [state, formAction, pending] = useActionState(createCampaignFromTemplateAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="templateId" value={templateId} />
      <Input
        id={`campaign-from-${templateId}`}
        name="name"
        label={`Nama campaign baru dari “${templateName}”`}
        defaultValue={templateName}
        required
      />
      <ResultMessage state={state} />
      <Button type="submit" loading={pending}>
        Buat campaign dari template
      </Button>
    </form>
  );
}

export function CreateContentFromTemplateForm({
  workspaceId,
  templateId,
  templateTitle,
}: {
  workspaceId: string;
  templateId: string;
  templateTitle: string;
}) {
  const [state, formAction, pending] = useActionState(createContentFromTemplateAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="templateId" value={templateId} />
      <Input
        id={`content-from-${templateId}`}
        name="title"
        label={`Judul konten baru dari “${templateTitle}”`}
        defaultValue={templateTitle}
        required
      />
      <ResultMessage state={state} />
      <Button type="submit" loading={pending}>
        Buat konten dari template
      </Button>
    </form>
  );
}

export function SaveContentAsTemplateForm({
  workspaceId,
  items,
}: {
  workspaceId: string;
  items: Array<{ id: string; title: string; brandName: string | null }>;
}) {
  const [state, formAction, pending] = useActionState(saveContentAsTemplateAction, {
    ok: false,
    message: "",
  });
  if (items.length === 0) {
    return (
      <p className="text-sm text-[var(--mt-text-muted)]">
        Belum ada konten di workspace ini untuk disimpan sebagai template.
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Konten sumber (judul, naskah, caption, dan channel disalin dari konten ini)
        <select
          name="sourceContentItemId"
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} — {item.brandName ?? "tanpa brand"}
            </option>
          ))}
        </select>
      </label>
      <Input id="content-template-name" name="name" label="Nama template" required />
      <ResultMessage state={state} />
      <Button type="submit" loading={pending}>
        Simpan konten sebagai template
      </Button>
    </form>
  );
}

// Hapus template (S-5) dengan konfirmasi.
export function DeleteTemplateForm({
  workspaceId,
  templateId,
  templateName,
  kind,
}: {
  workspaceId: string;
  templateId: string;
  templateName: string;
  kind: "campaign" | "content";
}) {
  const action = kind === "campaign" ? deleteCampaignTemplateAction : deleteContentTemplateAction;
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
  });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Hapus template "${templateName}"? Template yang dihapus tidak bisa dikembalikan.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="templateId" value={templateId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? "Menghapus…" : "Hapus template"}
      </Button>
      <ResultMessage state={state} />
    </form>
  );
}
