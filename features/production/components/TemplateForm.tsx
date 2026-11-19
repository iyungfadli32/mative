"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  createBriefTemplateAction,
  updateBriefTemplateAction,
  type ProductionActionResult,
} from "../actions";
import type { BriefTemplate, BriefTemplateField } from "../types";

type FieldRow = BriefTemplateField & { uid: string };

let uidCounter = 0;
function nextUid(): string {
  uidCounter += 1;
  return `field-${Date.now()}-${uidCounter}`;
}

/**
 * Form template brief (P3-05). Field diedit sebagai daftar dinamis
 * (key/label/tipe/wajib); saat submit dikirim sebagai JSON schema_json.
 */
export function TemplateForm({
  workspaceId,
  initial,
}: {
  workspaceId: string;
  initial: BriefTemplate | null;
}) {
  const [fields, setFields] = useState<FieldRow[]>(() =>
    (initial?.schema_json.fields ?? []).map((f) => ({ ...f, uid: nextUid() })),
  );
  const action = initial ? updateBriefTemplateAction : createBriefTemplateAction;
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  const schemaJson = JSON.stringify({
    fields: fields.map(({ key, label, type, required }) => ({ key, label, type, required })),
  });

  const updateField = (uid: string, patch: Partial<FieldRow>) =>
    setFields((list) => list.map((f) => (f.uid === uid ? { ...f, ...patch } : f)));
  const removeField = (uid: string) => setFields((list) => list.filter((f) => f.uid !== uid));
  const addField = () =>
    setFields((list) => [
      ...list,
      { uid: nextUid(), key: "", label: "", type: "text", required: false },
    ]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      {initial ? <input type="hidden" name="templateId" value={initial.id} /> : null}
      <input type="hidden" name="schemaJson" value={schemaJson} />
      <Input
        id="template-name"
        name="name"
        label="Nama template"
        defaultValue={initial?.name ?? ""}
        required
        maxLength={120}
      />
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">
          Field template ({fields.length}/12) — key hanya huruf kecil, angka, garis bawah.
        </p>
        {fields.map((field) => (
          <div
            key={field.uid}
            className="grid gap-2 rounded-xl border border-[var(--mt-border)] p-3 sm:grid-cols-[1fr_1fr_auto_auto_auto]"
          >
            <Input
              id={`field-key-${field.uid}`}
              label="Key"
              value={field.key}
              required
              maxLength={40}
              onChange={(e) => updateField(field.uid, { key: e.target.value })}
            />
            <Input
              id={`field-label-${field.uid}`}
              label="Label"
              value={field.label}
              required
              maxLength={80}
              onChange={(e) => updateField(field.uid, { label: e.target.value })}
            />
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Tipe
              <select
                value={field.type}
                onChange={(e) =>
                  updateField(field.uid, { type: e.target.value as "text" | "list" })
                }
                className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
              >
                <option value="text">Teks</option>
                <option value="list">Daftar</option>
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) => updateField(field.uid, { required: e.target.checked })}
              />
              Wajib
            </label>
            <div className="flex items-end pb-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => removeField(field.uid)}
                disabled={fields.length <= 1}
              >
                Hapus
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={addField}
          disabled={fields.length >= 12}
        >
          ＋ Tambah field
        </Button>
      </div>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        {initial ? "Simpan template" : "Buat template"}
      </Button>
    </form>
  );
}
