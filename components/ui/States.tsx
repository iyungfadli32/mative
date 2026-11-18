import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

/** EmptyState — menjelaskan KENAPA kosong + aksi berikutnya (Dok 02 §5). */
export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon = "📭",
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--mt-border)] bg-[var(--mt-surface)] px-6 py-10 text-center"
      role="status"
    >
      <span aria-hidden="true" className="text-3xl">
        {icon}
      </span>
      <h3 className="text-base font-semibold text-[var(--mt-text)]">{title}</h3>
      <p className="max-w-md text-sm text-[var(--mt-text-muted)]">{description}</p>
      {actionLabel && onAction ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** ErrorState — pesan aman + tombol coba lagi; JANGAN tampilkan stack trace ke user. */
export function ErrorState({
  title = "Terjadi kesalahan",
  description = "Sesuatu tidak berjalan seperti seharusnya. Coba lagi, dan bila terus gagal, catat waktu kejadian untuk dilaporkan.",
  onRetry,
  referenceId,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  referenceId?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--mt-rose-500)] bg-[var(--mt-surface)] px-6 py-10 text-center"
      role="alert"
    >
      <span aria-hidden="true" className="text-3xl">
        ⚠️
      </span>
      <h3 className="text-base font-semibold text-[var(--mt-text)]">{title}</h3>
      <p className="max-w-md text-sm text-[var(--mt-text-muted)]">{description}</p>
      {referenceId ? (
        <p className="text-xs text-[var(--mt-text-muted)]">Referensi: {referenceId}</p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          Coba lagi
        </Button>
      ) : null}
    </div>
  );
}

/** LoadingSkeleton — placeholder saat data dimuat (bukan angka palsu). */
export function LoadingSkeleton({
  lines = 3,
  label = "Memuat…",
  className,
}: {
  lines?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn("flex flex-col gap-3 rounded-2xl bg-[var(--mt-surface)] p-4", className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-4 animate-pulse rounded bg-[var(--mt-canvas)]"
          style={{ width: `${100 - i * 18}%` }}
        />
      ))}
    </div>
  );
}
