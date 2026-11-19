"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { restoreVersionAction, type ProductionActionResult } from "../actions";
import type { ContentVersion } from "@/features/planning/types";
import { formatInTimezone } from "@/lib/time";

/**
 * Bandingkan dua versi + restore (P3-10). Perbandingan per-field (bukan
 * diff baris otomatis): field yang berbeda ditandai. Restore membuat
 * versi BARU dari snapshot lama — riwayat tidak ditimpa.
 */
export function VersionCompare({
  versions,
  workspaceId,
  contentItemId,
  canEdit,
}: {
  versions: ContentVersion[];
  workspaceId: string;
  contentItemId: string;
  canEdit: boolean;
}) {
  const sorted = useMemo(
    () => [...versions].sort((a, b) => b.version_number - a.version_number),
    [versions],
  );
  const [aNum, setANum] = useState<number | null>(sorted[0]?.version_number ?? null);
  const [bNum, setBNum] = useState<number | null>(sorted[1]?.version_number ?? null);
  const [state, formAction, pending] = useActionState(restoreVersionAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);

  const a = sorted.find((v) => v.version_number === aNum) ?? null;
  const b = sorted.find((v) => v.version_number === bNum) ?? null;

  if (sorted.length === 0) {
    return <p className="text-sm text-[var(--mt-text-muted)]">Belum ada versi.</p>;
  }
  const fieldRows: Array<{ label: string; get: (v: ContentVersion) => string }> = [
    { label: "Ringkasan perubahan", get: (v) => v.change_summary ?? "—" },
    { label: "Brief — tujuan", get: (v) => briefField(v, "objective") },
    { label: "Brief — audiens", get: (v) => briefField(v, "audience") },
    { label: "Brief — sudut pandang", get: (v) => briefField(v, "angle") },
    { label: "Brief — format", get: (v) => briefField(v, "format") },
    { label: "Brief — pesan kunci", get: (v) => briefList(v, "key_messages") },
    { label: "Brief — CTA", get: (v) => briefField(v, "cta") },
    { label: "Script", get: (v) => v.script ?? "—" },
    { label: "Caption", get: (v) => v.caption ?? "—" },
    { label: "CTA konten", get: (v) => v.cta ?? "—" },
    { label: "Catatan kreatif", get: (v) => v.creative_notes ?? "—" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Versi A (baru)
          <select
            value={aNum ?? ""}
            onChange={(e) => setANum(e.target.value ? Number(e.target.value) : null)}
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
          >
            {sorted.map((v) => (
              <option key={v.id} value={v.version_number}>
                v{v.version_number} · {formatInTimezone(v.created_at)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Versi B (pembanding)
          <select
            value={bNum ?? ""}
            onChange={(e) => setBNum(e.target.value ? Number(e.target.value) : null)}
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
          >
            <option value="">— Tidak ada —</option>
            {sorted.map((v) => (
              <option key={v.id} value={v.version_number}>
                v{v.version_number} · {formatInTimezone(v.created_at)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {a && b ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="text-left">
                <th className="border-b border-[var(--mt-border)] py-2 pr-2 font-medium">Field</th>
                <th className="border-b border-[var(--mt-border)] py-2 pr-2 font-medium">
                  v{a.version_number}
                </th>
                <th className="border-b border-[var(--mt-border)] py-2 font-medium">
                  v{b.version_number}
                </th>
              </tr>
            </thead>
            <tbody>
              {fieldRows.map(({ label, get }) => {
                const va = get(a);
                const vb = get(b);
                const changed = va !== vb;
                return (
                  <tr key={label} className={changed ? "bg-[var(--mt-amber-500)]/10" : ""}>
                    <td className="border-b border-[var(--mt-border)] py-2 pr-2 align-top font-medium">
                      {label}
                      {changed ? (
                        <span className="ml-2 rounded-full bg-[var(--mt-amber-500)] px-2 py-0.5 text-[11px] font-semibold text-white">
                          berubah
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-pre-wrap border-b border-[var(--mt-border)] py-2 pr-2 align-top">
                      {va}
                    </td>
                    <td className="whitespace-pre-wrap border-b border-[var(--mt-border)] py-2 align-top">
                      {vb}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : a ? (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Pilih versi B untuk membandingkan dengan v{a.version_number}.
        </p>
      ) : null}
      {canEdit && b ? (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="contentItemId" value={contentItemId} />
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="versionNumber" value={b.version_number} />
          <p className="text-sm text-[var(--mt-text-muted)]">
            Memulihkan v{b.version_number} akan membuat versi BARU (bukan menimpa v
            {a?.version_number ?? "—"}).
          </p>
          {state.message ? (
            <p role={state.ok ? "status" : "alert"} className="text-sm">
              {state.message}
            </p>
          ) : null}
          <div>
            <Button type="submit" loading={pending}>
              Pulihkan v{b.version_number} sebagai versi baru
            </Button>
          </div>
        </form>
      ) : null}
      <div>
        <h3 className="text-sm font-semibold">Semua versi ({sorted.length})</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {sorted.map((v) => (
            <li key={v.id} className="rounded-xl border border-[var(--mt-border)] p-3 text-sm">
              <p className="font-medium">
                v{v.version_number} · {formatInTimezone(v.created_at)}
              </p>
              {v.change_summary ? (
                <p className="text-[var(--mt-text-muted)]">{v.change_summary}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function briefField(v: ContentVersion, key: string): string {
  const snap = (v.brief_snapshot ?? {}) as Record<string, unknown>;
  const raw = snap[key];
  return typeof raw === "string" && raw !== "" ? raw : "—";
}

function briefList(v: ContentVersion, key: string): string {
  const snap = (v.brief_snapshot ?? {}) as Record<string, unknown>;
  const raw = snap[key];
  // brief_snapshot menyimpan key_messages (camelCase) — dukung juga snake_case.
  const alt = key === "key_messages" ? snap["keyMessages"] : undefined;
  const list = Array.isArray(raw) ? raw : Array.isArray(alt) ? alt : [];
  return list.length > 0 ? (list as string[]).join("\n") : "—";
}
