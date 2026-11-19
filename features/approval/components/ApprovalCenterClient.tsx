"use client";

import Link from "next/link";
import { APPROVAL_QUEUE_TABS, APPROVAL_QUEUE_TAB_LABELS, APPROVAL_STATUS_LABELS } from "@/features/approval/constants";
import type { ApprovalQueueTab, ApprovalRequest } from "@/features/approval/types";
import { DecisionForm } from "./DecisionForm";

export type ApprovalCenterRow = {
  request: ApprovalRequest;
  contentTitle: string;
  contentProductionStatus: string;
  versionNumber: number | null;
  submittedByName: string;
  canDecide: boolean;
  isStale: boolean;
};

/**
 * Approval Center — client (P4-08/P4-09).
 * Tab antrean (M4.1) + kartu request (thumbnail diganti judul + versi —
 * konten belum punya thumbnail di MVP) + form keputusan inline.
 * Form keputusan tetap mounted setelah aksi (pelajaran e2e Phase 3).
 */
export function ApprovalCenterClient({
  rows,
  tab,
  workspaceId,
}: {
  rows: ApprovalCenterRow[];
  tab: ApprovalQueueTab;
  workspaceId: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-2" aria-label="Tab antrean approval">
        {APPROVAL_QUEUE_TABS.map((t) => (
          <Link
            key={t}
            href={`/persetujuan?workspace=${workspaceId}&tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              tab === t
                ? "border-[var(--mt-teal-700)] bg-[var(--mt-teal-700)] font-semibold text-white"
                : "border-[var(--mt-border)] bg-[var(--mt-surface)]"
            }`}
          >
            {APPROVAL_QUEUE_TAB_LABELS[t]}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Tidak ada request di antrean {APPROVAL_QUEUE_TAB_LABELS[tab].toLowerCase()} saat ini.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ request, contentTitle, contentProductionStatus, versionNumber, submittedByName, canDecide, isStale }) => (
            <li
              key={request.id}
              className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    href={`/konten/${request.target_id}?workspace=${workspaceId}&tab=approval`}
                    className="font-semibold underline"
                  >
                    {contentTitle}
                  </Link>
                  <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
                    {versionNumber !== null ? `Versi v${versionNumber}` : "Versi tidak diketahui"} •{" "}
                    {request.request_type === "client" ? "Client review" : "Review internal"} •{" "}
                    Status produksi: {contentProductionStatus}
                  </p>
                  <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
                    Diajukan oleh {submittedByName} •{" "}
                    {new Date(request.submitted_at).toLocaleString("id-ID")}
                  </p>
                </div>
                <span className="rounded-full border border-[var(--mt-border)] bg-[var(--mt-canvas)] px-3 py-1 text-sm font-medium">
                  {APPROVAL_STATUS_LABELS[request.status]}
                </span>
              </div>
              {isStale ? (
                <p role="alert" className="mt-2 rounded-xl border border-[var(--mt-amber-500)] bg-[var(--mt-canvas)] p-2 text-sm">
                  ⚠️ Request ini menunjuk versi lama — keputusan atas versi basi akan ditolak
                  server. Buka konten untuk melihat versi terbaru.
                </p>
              ) : null}
              {request.status === "in_review" && canDecide ? (
                <DecisionForm requestId={request.id} workspaceId={workspaceId} />
              ) : request.status === "in_review" ? (
                <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
                  Anda tidak ditugaskan di step saat ini.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
