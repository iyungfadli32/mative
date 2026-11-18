import Link from "next/link";
import { Button } from "@/components/ui/Button";

export type FilterField = {
  name: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
};

/**
 * FilterBar — form GET: setiap filter tercermin di URL (P2-13).
 * Tanpa JavaScript: pilih lalu tekan "Terapkan filter".
 */
export function FilterBar({
  action,
  workspaceId,
  fields,
  query,
  queryLabel = "Cari judul / kata kunci",
  resetHref,
  dateFilter,
  hidden,
}: {
  action: string;
  workspaceId: string;
  fields: FilterField[];
  query?: string;
  queryLabel?: string;
  resetHref: string;
  /** Filter tanggal tunggal (mis. tenggat) — dirender sebagai input date. */
  dateFilter?: { name: string; label: string; value: string };
  /** Nilai yang dipertahankan di URL saat filter dikirim (mis. month, view). */
  hidden?: Record<string, string>;
}) {
  return (
    <form
      method="get"
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
      role="search"
      aria-label="Filter dan pencarian"
    >
      <input type="hidden" name="workspace" value={workspaceId} />
      {hidden
        ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)
        : null}
      {typeof query === "string" ? (
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm font-medium">
          {queryLabel}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Ketik kata kunci…"
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
          />
        </label>
      ) : null}
      {fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-1 text-sm font-medium">
          {f.label}
          <select
            name={f.name}
            defaultValue={f.value}
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-2 text-sm font-normal"
          >
            <option value="">Semua</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {dateFilter ? (
        <label className="flex flex-col gap-1 text-sm font-medium">
          {dateFilter.label}
          <input
            type="date"
            name={dateFilter.name}
            defaultValue={dateFilter.value}
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-2 text-sm font-normal"
          />
        </label>
      ) : null}
      <Button type="submit" size="sm">
        Terapkan filter
      </Button>
      <Link href={resetHref} className="text-sm font-medium text-[var(--mt-teal-700)] underline">
        Reset
      </Link>
    </form>
  );
}
