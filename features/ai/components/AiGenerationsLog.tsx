/**
 * Log AI — features/ai/components/AiGenerationsLog.tsx (P8-07).
 * Menampilkan log ai_generations workspace (RLS: member 8 peran
 * non-klien; viewer_client tidak melihat). Append-only: tidak ada
 * update/delete dari UI — hapus hanya lewat cleanup_ai_generations
 * (owner/admin, operator).
 */
import { AI_FEATURE_LABELS, AI_RETENTION_DAYS } from "../constants";
import type { AiGenerationRow } from "../types";

export function AiGenerationsLog({ generations }: { generations: AiGenerationRow[] }) {
  return (
    <section aria-label="Log AI" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Log AI</h2>
      <p className="text-sm text-[var(--mt-text-muted)]">
        Append-only, retensi {AI_RETENTION_DAYS} hari. Log hanya menyimpan referensi, status, dan
        kategori galat — input mentah tidak disimpan.
      </p>
      {generations.length === 0 ? (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Belum ada aksi AI yang tercatat di workspace ini.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--mt-border)] text-left">
                <th className="px-4 py-2 font-medium">Waktu</th>
                <th className="px-4 py-2 font-medium">Fitur</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Kategori galat</th>
                <th className="px-4 py-2 font-medium">Referensi input</th>
              </tr>
            </thead>
            <tbody>
              {generations.map((g) => (
                <tr key={g.id} className="border-b border-[var(--mt-border)] last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {new Date(g.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                  </td>
                  <td className="px-4 py-2">{AI_FEATURE_LABELS[g.feature] ?? g.feature}</td>
                  <td className="px-4 py-2">{g.status}</td>
                  <td className="px-4 py-2">{g.error_category}</td>
                  <td className="px-4 py-2 font-mono text-xs">{g.input_reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
