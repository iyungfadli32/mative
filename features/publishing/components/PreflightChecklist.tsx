/**
 * Checklist preflight — features/publishing/components/PreflightChecklist.tsx (P6-04).
 * Menampilkan hasil RPC publishing_preflight apa adanya: blokir (merah, job
 * tidak bisa dibuat/diproses) vs peringatan (kuning, tidak memblokir).
 * Di Phase 6, koneksi selalu "Belum ada koneksi → manual" (peringatan).
 */
import type { PreflightResult } from "../types";

export function PreflightChecklist({ preflight }: { preflight: PreflightResult | null }) {
  if (!preflight) {
    return (
      <p className="text-sm text-[var(--mt-text-muted)]">
        Preflight belum bisa dijalankan (tabel Publishing Foundation belum tersedia atau placement
        tidak ditemukan).
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        {preflight.ok
          ? "Preflight lolos — job bisa dibuat."
          : `Preflight gagal: ${preflight.message}`}
      </p>
      <ul className="flex flex-col gap-1.5">
        {preflight.checks.map((check) => (
          <li key={check.key} className="flex items-start gap-2 text-sm">
            <span aria-hidden="true">{check.passed ? "✓" : check.severity === "block" ? "✕" : "⚠"}</span>
            <span>
              <span className="font-medium">
                {check.severity === "block" ? "Blokir" : "Peringatan"}:{" "}
              </span>
              {check.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
