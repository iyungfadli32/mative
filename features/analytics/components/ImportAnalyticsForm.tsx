/**
 * Form impor analytics CSV — features/analytics/components/ImportAnalyticsForm.tsx (P7-03).
 * Aturan: form TIDAK PERNAH disembunyikan berdasarkan hasil aksinya
 * sendiri (pelajaran e2e Phase 3/4/5) — pesan tampil di bawah form yang
 * tetap mounted. CSV bisa ditempel (textarea) ATAU diunggah (file);
 * file menang bila keduanya diisi.
 */
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { importAnalyticsCsvAction } from "../actions";
import { METRIC_DEFINITIONS } from "../constants";
import type { ImportSubjectRef } from "../queries";

function ResultMessage({ state }: { state: { ok: boolean; message: string } }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className="text-sm">
      {state.message}
    </p>
  );
}

export function ImportAnalyticsForm({
  workspaceId,
  brands,
  subjects,
  defaultPeriodStart,
  defaultPeriodEnd,
}: {
  workspaceId: string;
  brands: Array<{ id: string; name: string }>;
  subjects: ImportSubjectRef[];
  defaultPeriodStart: string;
  defaultPeriodEnd: string;
}) {
  const [state, formAction, pending] = useActionState(importAnalyticsCsvAction, {
    ok: false,
    message: "",
  });
  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4" encType="multipart/form-data">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="imp-brand" className="text-sm font-medium text-[var(--mt-text)]">
              Brand (opsional)
            </label>
            <select
              id="imp-brand"
              name="brandId"
              defaultValue=""
              className="h-10 w-full rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm text-[var(--mt-text)]"
            >
              <option value="">Semua brand (impor multi-brand)</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--mt-text-muted)]">
              Bila satu brand dipilih, semua baris CSV harus milik brand itu. Tanpa pilihan,
              tiap baris harus dalam scope brand Anda.
            </p>
          </div>
          <Input
            id="imp-raw-ref"
            type="text"
            name="rawReference"
            label="Referensi file (opsional)"
            hint="Mis. csv:impor-nov.csv:12. Boleh dikosongkan — otomatis csv:impor.csv:<jumlah baris>."
            placeholder="csv:impor-nov.csv:12"
          />
          <Input
            id="imp-period-start"
            type="date"
            name="periodStart"
            label="Periode awal"
            defaultValue={defaultPeriodStart}
          />
          <Input
            id="imp-period-end"
            type="date"
            name="periodEnd"
            label="Periode akhir"
            defaultValue={defaultPeriodEnd}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="imp-csv-file" className="text-sm font-medium text-[var(--mt-text)]">
            File CSV (opsional — menang bila textarea juga diisi)
          </label>
          <input
            id="imp-csv-file"
            type="file"
            name="csvFile"
            accept=".csv,text/csv"
            className="w-full rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="imp-csv-text" className="text-sm font-medium text-[var(--mt-text)]">
            Tempel CSV
          </label>
          <textarea
            id="imp-csv-text"
            name="csvText"
            rows={10}
            placeholder="date,platform,account,subject_type,subject_ref,metric_key,value,unit,source_notes"
            className="w-full rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 font-mono text-sm text-[var(--mt-text)]"
          />
          <p className="text-xs text-[var(--mt-text-muted)]">
            Satu CSV = satu snapshot = satu periode. Tanggal tiap baris harus di dalam periode
            di atas. Satu baris buruk = seluruh impor gagal (atomik) — tidak ada yang
            tersimpan sebagian.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Mengimpor…" : "Impor CSV"}
          </Button>
          <a
            href="/api/v1/analytics/export?report=template"
            className="text-sm font-medium text-[var(--mt-teal-700)] underline"
          >
            Unduh template CSV
          </a>
        </div>
        <ResultMessage state={state} />
      </form>

      <section aria-label="Katalog metrik">
        <h2 className="text-lg font-semibold">Katalog 14 kunci metrik</h2>
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
          Hanya 12 kunci yang bisa diimpor. Dua kunci turunan dihitung otomatis dan ditolak
          bila ada di CSV.
        </p>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--mt-border)] text-left">
                <th className="px-4 py-2 font-medium">Kunci</th>
                <th className="px-4 py-2 font-medium">Label</th>
                <th className="px-4 py-2 font-medium">Satuan</th>
                <th className="px-4 py-2 font-medium">Jenis</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_DEFINITIONS.map((d) => (
                <tr key={d.key} className="border-b border-[var(--mt-border)] last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{d.key}</td>
                  <td className="px-4 py-2">{d.label}</td>
                  <td className="px-4 py-2">{d.unit}</td>
                  <td className="px-4 py-2">{d.isDerived ? "Turunan (dihitung)" : "Impor"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Referensi subject">
        <h2 className="text-lg font-semibold">Referensi subject (ID untuk kolom subject_ref)</h2>
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
          Salin UUID dari tabel ini ke kolom subject_ref. Hanya subject yang terlihat oleh
          Anda (sesuai scope brand) yang tampil.
        </p>
        {subjects.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
            Belum ada placement/konten/postingan di workspace ini — buat konten dulu, lalu
            kembali ke sini.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--mt-border)] text-left">
                  <th className="px-4 py-2 font-medium">Jenis</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Brand</th>
                  <th className="px-4 py-2 font-medium">ID (subject_ref)</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((s) => (
                  <tr
                    key={`${s.subjectType}|${s.subjectId}`}
                    className="border-b border-[var(--mt-border)] last:border-0"
                  >
                    <td className="px-4 py-2">{s.subjectType}</td>
                    <td className="px-4 py-2">{s.label}</td>
                    <td className="px-4 py-2">{s.brandName ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{s.subjectId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
