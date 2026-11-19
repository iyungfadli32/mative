"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { updateBriefAction, type ProductionActionResult } from "../actions";
import type { BriefSnapshot, BriefTemplateField } from "@/lib/validation/schemas";

const DRAFT_EVENT = "mative-brief-draft";

/**
 * Baca draf brief dari localStorage sebagai external store (React pattern
 * useSyncExternalStore — aman untuk SSR: server mengembalikan null).
 * Perubahan draf (termasuk dari tab lain) memicu render ulang.
 */
function useBriefDraft(draftKey: string): string | null {
  const subscribe = useCallback((onStoreChange: () => void) => {
    window.addEventListener(DRAFT_EVENT, onStoreChange);
    window.addEventListener("storage", onStoreChange);
    return () => {
      window.removeEventListener(DRAFT_EVENT, onStoreChange);
      window.removeEventListener("storage", onStoreChange);
    };
  }, []);
  const getSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(draftKey);
    } catch {
      return null;
    }
  }, [draftKey]);
  const getServerSnapshot = useCallback(() => null, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function saveBriefDraft(draftKey: string, values: Record<string, string>): void {
  try {
    localStorage.setItem(draftKey, JSON.stringify(values));
    window.dispatchEvent(new Event(DRAFT_EVENT));
  } catch {
    // abaikan (kuota penuh / privat)
  }
}

function removeBriefDraft(draftKey: string): void {
  try {
    localStorage.removeItem(draftKey);
    window.dispatchEvent(new Event(DRAFT_EVENT));
  } catch {
    // abaikan
  }
}

/**
 * Editor brief terstruktur (P3-05). Field dirender dari template default
 * workspace; nilai tersimpan sebagai brief_snapshot (JSONB) + versi baru.
 * Draf disimpan otomatis di localStorage per content item — bila ada draf,
 * pengguna ditawari pulihkan / buang; draf TIDAK PERNAH hilang diam-diam.
 */
export function BriefEditor({
  workspaceId,
  contentItemId,
  templateFields,
  templateName,
  initial,
  canEdit,
}: {
  workspaceId: string;
  contentItemId: string;
  templateFields: BriefTemplateField[];
  templateName: string;
  initial: BriefSnapshot;
  canEdit: boolean;
}) {
  const draftKey = `mative-brief-draft:${contentItemId}`;
  // Nilai awal dari versi tersimpan (dihitung tiap render — murah, sedikit field).
  const initialValues = snapshotToValues(initial, templateFields);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState(false);
  const [draftChecked, setDraftChecked] = useState(false);
  const [prevInitial, setPrevInitial] = useState(initial);
  const [state, formAction, pending] = useActionState(updateBriefAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  const draft = useBriefDraft(draftKey);

  // Sinkronkan nilai bila prop initial berubah (mis. setelah simpan berhasil
  // + revalidasi): pola "adjusting state during render" (React docs).
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setValues(snapshotToValues(initial, templateFields));
  }
  // Periksa draf SEKALI saat pertama kali draf tersedia (mount): tampilkan
  // pemberitahuan HANYA bila draf berbeda dari versi tersimpan.
  if (!draftChecked && draft !== null) {
    setDraftChecked(true);
    if (draft !== JSON.stringify(initialValues)) {
      setSavedDraft(draft);
      setDraftNotice(true);
    } else {
      removeBriefDraft(draftKey);
    }
  }

  // Simpan draf tiap kali nilai berubah (debounce 500 ms). Effect ini hanya
  // menulis ke external store (localStorage) — bukan setState.
  useEffect(() => {
    const timer = setTimeout(() => saveBriefDraft(draftKey, values), 500);
    return () => clearTimeout(timer);
  }, [values, draftKey]);

  const snapshot = useMemo(
    () => valuesToSnapshot(values, templateFields),
    [values, templateFields],
  );

  const restoreDraft = () => {
    if (!savedDraft) return;
    try {
      const parsed = JSON.parse(savedDraft) as Record<string, string>;
      setValues(parsed);
    } catch {
      // draf rusak — buang saja
    }
    setDraftNotice(false);
  };
  const discardDraft = () => {
    removeBriefDraft(draftKey);
    setSavedDraft(null);
    setDraftNotice(false);
  };

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-[var(--mt-text-muted)]">
          Template: {templateName}. Peran Anda tidak boleh mengubah brief konten ini.
        </p>
        <BriefPreview snapshot={initial} />
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="contentItemId" value={contentItemId} />
      <input type="hidden" name="briefSnapshot" value={JSON.stringify(snapshot)} />
      <p className="text-sm text-[var(--mt-text-muted)]">Template: {templateName}</p>
      {draftNotice ? (
        <div
          role="alert"
          className="rounded-xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-3 text-sm"
        >
          <p className="font-medium">Draf brief yang belum tersimpan ditemukan di perangkat ini.</p>
          <p className="mt-1 text-[var(--mt-text-muted)]">
            Draf disimpan otomatis saat Anda mengetik. Pulihkan untuk melanjutkan, atau buang bila
            tidak diperlukan.
          </p>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" onClick={restoreDraft}>
              Pulihkan draf
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={discardDraft}>
              Buang draf
            </Button>
          </div>
        </div>
      ) : null}
      {templateFields.map((field) => {
        const value = values[field.key] ?? "";
        if (field.type === "list") {
          return (
            <label key={field.key} className="flex flex-col gap-1.5 text-sm font-medium">
              {field.label}
              {field.required ? " (wajib)" : ""}
              <textarea
                rows={3}
                value={value}
                required={field.required}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                placeholder="Satu item per baris"
                className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
              />
            </label>
          );
        }
        return (
          <Input
            key={field.key}
            id={`brief-${field.key}`}
            label={`${field.label}${field.required ? " (wajib)" : ""}`}
            value={value}
            required={field.required}
            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
          />
        );
      })}
      <Input
        id="brief-change-summary"
        name="changeSummary"
        label="Ringkasan perubahan (wajib — tercatat di versi baru)"
        required
        maxLength={500}
      />
      <p className="text-xs text-[var(--mt-text-muted)]">
        Menyimpan brief membuat versi baru (v berikutnya). Draf otomatis tersimpan di perangkat ini
        sampai berhasil disimpan.
      </p>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        Simpan brief (versi baru)
      </Button>
    </form>
  );
}

/** Pratinjau brief (read-only) untuk peran yang tidak boleh mengedit. */
export function BriefPreview({ snapshot }: { snapshot: BriefSnapshot }) {
  const entries: Array<[string, string]> = [
    ["Tujuan", snapshot.objective ?? ""],
    ["Audiens", snapshot.audience ?? ""],
    ["Sudut pandang", snapshot.angle ?? ""],
    ["Format", snapshot.format ?? ""],
    ["CTA", snapshot.cta ?? ""],
  ];
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt className="font-medium">{label}</dt>
          <dd className="text-[var(--mt-text-muted)]">{value || "—"}</dd>
        </div>
      ))}
      <div>
        <dt className="font-medium">Pesan kunci</dt>
        <dd className="text-[var(--mt-text-muted)]">
          {(snapshot.keyMessages ?? []).length > 0 ? (
            <ul className="list-disc pl-5">
              {(snapshot.keyMessages ?? []).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          ) : (
            "—"
          )}
        </dd>
      </div>
      <div>
        <dt className="font-medium">Referensi</dt>
        <dd className="text-[var(--mt-text-muted)]">
          {(snapshot.references ?? []).length > 0 ? (
            <ul className="list-disc pl-5">
              {(snapshot.references ?? []).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : (
            "—"
          )}
        </dd>
      </div>
    </dl>
  );
}

function snapshotToValues(
  snapshot: BriefSnapshot,
  fields: BriefTemplateField[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const raw = (snapshot as unknown as Record<string, unknown>)[f.key];
    if (Array.isArray(raw)) out[f.key] = raw.join("\n");
    else if (typeof raw === "string") out[f.key] = raw;
    else out[f.key] = "";
  }
  // Field brief inti yang tidak ada di template tetap dipertahankan.
  for (const key of ["objective", "audience", "angle", "format", "cta"] as const) {
    if (!(key in out)) out[key] = snapshot[key] ?? "";
  }
  if (!("key_messages" in out)) out["key_messages"] = (snapshot.keyMessages ?? []).join("\n");
  if (!("references" in out)) out["references"] = (snapshot.references ?? []).join("\n");
  return out;
}

function valuesToSnapshot(
  values: Record<string, string>,
  fields: BriefTemplateField[],
): BriefSnapshot {
  const get = (key: string) => values[key] ?? "";
  const splitList = (key: string) =>
    get(key)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  const snapshot: BriefSnapshot = {
    objective: get("objective"),
    audience: get("audience"),
    angle: get("angle"),
    format: get("format"),
    keyMessages: splitList("key_messages"),
    cta: get("cta"),
    references: splitList("references"),
  };
  // Field template kustom di luar inti brief disimpan apa adanya (teks/list).
  for (const f of fields) {
    const key = f.key;
    if (key in snapshot || ["keyMessages", "references"].includes(key)) continue;
    if (f.type === "list") {
      (snapshot as unknown as Record<string, unknown>)[key] = splitList(key);
    } else {
      (snapshot as unknown as Record<string, unknown>)[key] = get(key);
    }
  }
  return snapshot;
}
