"use client";

import Link from "next/link";

/**
 * Error boundary untuk grup (app) — menggantikan isi <main> bila sebuah
 * halaman aplikasi gagal render, tanpa menjatuhkan sidebar/topbar.
 * Ditambahkan di Phase 9 (9.1 gap a: sebelumnya tidak ada error boundary).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-6">
      <h1 className="text-xl font-bold text-[var(--mt-text)]">Terjadi kesalahan</h1>
      <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
        Halaman ini gagal dimuat. Coba muat ulang — bila terus gagal, kembali ke Command Center dan
        laporkan masalahnya.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-[var(--mt-text-muted)]">Kode galat: {error.digest}</p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-[10px] bg-[var(--mt-teal-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--mt-teal-600)]"
        >
          Muat ulang halaman
        </button>
        <Link
          href="/dashboard"
          className="rounded-[10px] border border-[var(--mt-border)] px-4 py-2 text-sm font-medium text-[var(--mt-text)]"
        >
          Ke Command Center
        </Link>
      </div>
    </div>
  );
}
