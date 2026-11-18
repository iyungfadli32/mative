/**
 * KPIStatCard — Dok 02 §3 / Dok 03 §6.
 * ATURAN KERAS (P1-05, Keputusan #6): angka HANYA dari record nyata.
 * Bila belum ada data, tampilkan 0 + empty state — DILARANG hardcode KPI.
 */
export function KPIStatCard({
  label,
  value,
  hint,
  icon,
  empty = false,
}: {
  label: string;
  value: number;
  hint?: string;
  icon?: string;
  /** true bila tidak ada record sama sekali (tampilkan penjelasan, bukan angka karangan). */
  empty?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-[var(--mt-text-muted)]">{label}</p>
        {icon ? (
          <span aria-hidden="true" className="text-lg">
            {icon}
          </span>
        ) : null}
      </div>
      <p
        className="mt-1 text-3xl font-bold tabular-nums text-[var(--mt-text)]"
        aria-label={`${label}: ${value}`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
        {empty ? "Belum ada data — angka dihitung dari record nyata." : (hint ?? "")}
      </p>
    </div>
  );
}
