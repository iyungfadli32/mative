/**
 * Form CSV campaign — app/(app)/kampanye/CampaignCsvForms.tsx (P5-07).
 * M5.5: export bisa diimpor kembali; import baris tidak valid ditolak
 * per baris dengan pesan jelas (laporan ditampilkan di bawah form).
 */
"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { exportCampaignsCsvAction, importCampaignsCsvAction } from "@/features/campaign/actions";
import { CAMPAIGN_CSV_FILENAME } from "@/features/campaign/constants";

export function CampaignCsvExportButton({ workspaceId }: { workspaceId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function handleExport() {
    setBusy(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.set("workspaceId", workspaceId);
      const result = await exportCampaignsCsvAction(formData);
      if (!result.ok || !result.csv) {
        setMessage(result.message);
        return;
      }
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = CAMPAIGN_CSV_FILENAME;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(result.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" variant="secondary" onClick={handleExport} loading={busy}>
        Ekspor CSV
      </Button>
      {message ? (
        <span role="status" className="text-xs">
          {message}
        </span>
      ) : null}
    </span>
  );
}

export function CampaignCsvImportForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction, pending] = useActionState(importCampaignsCsvAction, {
    ok: false,
    message: "",
    report: undefined,
  });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        File CSV (format sama dengan hasil ekspor)
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
        <span className="text-[13px] font-normal text-[var(--mt-text-muted)]">
          Kolom: name, objective, audience_name, start_at, end_at, status, owner_email,
          target_deliverables, target_date, notes, brands, deliverables. Baris yang gagal ditolak
          satu per satu — baris lain tetap diimpor. owner_email hanya bisa diisi email Anda sendiri.
        </span>
      </label>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      {state.report ? (
        <div className="rounded-xl border border-[var(--mt-border)] p-3 text-sm">
          <p>
            Total {state.report.total} baris · Diimpor {state.report.imported} · Gagal{" "}
            {state.report.failed} · Deliverable ditautkan {state.report.linkedDeliverables} ·
            Dilewati {state.report.skippedDeliverables.length}
          </p>
          {state.report.errors.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {state.report.errors.map((e, i) => (
                <li key={i} className="text-[13px]">
                  Baris {e.row}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
          {state.report.skippedDeliverables.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {state.report.skippedDeliverables.map((s, i) => (
                <li key={i} className="text-[13px] text-[var(--mt-text-muted)]">
                  Baris {s.row}: deliverable &ldquo;{s.title}&rdquo; dilewati ({s.reason}).
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <Button type="submit" loading={pending}>
        Impor CSV
      </Button>
    </form>
  );
}
