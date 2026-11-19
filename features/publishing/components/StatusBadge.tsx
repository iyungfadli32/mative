/**
 * Badge status publishing — features/publishing/components/StatusBadge.tsx (P6-04).
 * Label HARFIAH 9 status Dok 08 §6 (tidak ada sinonim: "Scheduled locally"
 * tidak pernah tampil sebagai "Scheduled (provider)").
 */
import { publishingStatusLabel } from "../utils";

const BADGE_STYLES: Record<string, string> = {
  draft: "bg-[var(--mt-surface-muted)] text-[var(--mt-text-muted)]",
  ready: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  scheduled_locally: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  sending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  uploaded_or_draft_created: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  needs_manual_action: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  cancelled: "bg-[var(--mt-surface-muted)] text-[var(--mt-text-muted)]",
};

export function PublishingStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[status] ?? BADGE_STYLES.draft}`}
    >
      {publishingStatusLabel(status)}
    </span>
  );
}
