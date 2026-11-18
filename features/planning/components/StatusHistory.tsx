import { formatInTimezone } from "@/lib/time";
import { PRODUCTION_STATUS_LABELS } from "../constants";
import type { ContentStatusEvent } from "../types";

/** Riwayat status content item (P2-14) — siapa, dari–ke, kapan, alasan. */
export function StatusHistory({ events }: { events: ContentStatusEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-[var(--mt-text-muted)]">
        Belum ada perubahan status yang tercatat.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {events.map((e) => (
        <li
          key={e.id}
          className="rounded-xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-3 text-sm"
        >
          <p>
            <strong>
              {e.from_status
                ? `${PRODUCTION_STATUS_LABELS[e.from_status as keyof typeof PRODUCTION_STATUS_LABELS]?.label ?? e.from_status} → `
                : ""}
              {PRODUCTION_STATUS_LABELS[e.to_status as keyof typeof PRODUCTION_STATUS_LABELS]
                ?.label ?? e.to_status}
            </strong>{" "}
            <span className="text-[var(--mt-text-muted)]">· {formatInTimezone(e.occurred_at)}</span>
          </p>
          {e.reason ? <p className="mt-1 text-[var(--mt-text-muted)]">Alasan: {e.reason}</p> : null}
          <p className="mt-1 text-xs text-[var(--mt-text-muted)]">Oleh: {e.actor_user_id ?? "—"}</p>
        </li>
      ))}
    </ol>
  );
}
