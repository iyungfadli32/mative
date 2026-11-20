"use client";

import Link from "next/link";

/**
 * Error boundary root — untuk halaman di luar grup (app), mis. landing dan
 * halaman auth. Ditambahkan di Phase 9 (9.1 gap a).
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-bold">Terjadi kesalahan</h1>
      <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
        Halaman ini gagal dimuat. Coba muat ulang — bila terus gagal, kembali ke beranda.
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
          href="/"
          className="rounded-[10px] border border-[var(--mt-border)] px-4 py-2 text-sm font-medium"
        >
          Ke beranda
        </Link>
      </div>
    </div>
  );
}
