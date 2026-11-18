import { cn } from "@/lib/utils";

/**
 * StatusBadge & PriorityBadge — Dok 03 §3/§7.
 * Status SELALU teks + ikon, bukan warna saja. Pemetaan warna di bawah
 * SEMENTARA (Keputusan #14) memakai token yang ada yang paling dekat.
 */
export type StatusTone = "neutral" | "info" | "progress" | "success" | "warning" | "danger";

const toneClass: Record<StatusTone, string> = {
  neutral: "bg-[var(--mt-canvas)] text-[var(--mt-text-muted)]",
  info: "bg-[var(--mt-mint-100)] text-[var(--mt-teal-700)]",
  progress: "bg-[var(--mt-mint-100)] text-[var(--mt-indigo-600)]",
  success: "bg-[var(--mt-mint-100)] text-[var(--mt-teal-700)]",
  warning: "bg-[var(--mt-mint-100)] text-[var(--mt-amber-500)]",
  danger: "bg-[var(--mt-mint-100)] text-[var(--mt-rose-500)]",
};

export function StatusBadge({
  label,
  tone = "neutral",
  icon,
}: {
  label: string;
  tone?: StatusTone;
  icon?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        toneClass[tone],
      )}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {label}
    </span>
  );
}

/** Pemetaan sementara status produksi → badge (Dok 03 §7, warna sementara). */
export function ProductionStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: StatusTone; icon: string }> = {
    idea: { label: "Ide", tone: "neutral", icon: "💡" },
    brief: { label: "Brief", tone: "info", icon: "📝" },
    scripting: { label: "Scripting", tone: "progress", icon: "✍️" },
    ready_for_production: { label: "Siap Produksi", tone: "info", icon: "✅" },
    in_production: { label: "Dalam Produksi", tone: "warning", icon: "🎬" },
    editing: { label: "Editing", tone: "progress", icon: "✂️" },
    internal_review: { label: "Review Internal", tone: "progress", icon: "👀" },
    client_review: { label: "Review Klien", tone: "progress", icon: "🧑‍💼" },
    approved: { label: "Disetujui", tone: "success", icon: "✔️" },
    changes_requested: { label: "Minta Revisi", tone: "danger", icon: "↩️" },
    blocked: { label: "Terblokir", tone: "danger", icon: "⛔" },
    cancelled: { label: "Dibatalkan", tone: "neutral", icon: "✕" },
    archived: { label: "Diarsipkan", tone: "neutral", icon: "🗄️" },
  };
  const entry = map[status] ?? { label: status, tone: "neutral" as StatusTone, icon: "•" };
  return <StatusBadge label={entry.label} tone={entry.tone} icon={entry.icon} />;
}

export type Priority = "low" | "medium" | "high" | "urgent";

const priorityMeta: Record<Priority, { label: string; icon: string }> = {
  low: { label: "Rendah", icon: "↓" },
  medium: { label: "Sedang", icon: "→" },
  high: { label: "Tinggi", icon: "↑" },
  urgent: { label: "Mendesak", icon: "‼️" },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const meta = priorityMeta[priority];
  const tone: StatusTone =
    priority === "urgent" || priority === "high"
      ? "danger"
      : priority === "medium"
        ? "warning"
        : "neutral";
  return <StatusBadge label={`Prioritas: ${meta.label}`} tone={tone} icon={meta.icon} />;
}
