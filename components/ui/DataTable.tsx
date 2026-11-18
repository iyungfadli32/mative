import type { ReactNode } from "react";

/**
 * DataTable — tabel aksesibel: <table> semantik, th scope, empty state bawaan.
 * Dipakai untuk daftar anggota, undangan, dan share portal.
 */
export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
};

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  caption,
  emptyTitle = "Belum ada data",
  emptyDescription = "Data akan tampil di sini setelah ditambahkan.",
}: {
  columns: Array<Column<T>>;
  rows: T[];
  caption: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (rows.length === 0) {
    return (
      <div
        role="status"
        className="rounded-2xl border border-dashed border-[var(--mt-border)] bg-[var(--mt-surface)] px-6 py-8 text-center"
      >
        <h3 className="text-sm font-semibold text-[var(--mt-text)]">{emptyTitle}</h3>
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{emptyDescription}</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)]">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--mt-border)] bg-[var(--mt-canvas)]">
            {columns.map((c) => (
              <th key={c.key} scope="col" className="px-4 py-3 font-semibold text-[var(--mt-text)]">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-[var(--mt-border)] last:border-0">
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-3 align-top text-[var(--mt-text)]">
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
