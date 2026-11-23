"use client";

import { useRouter } from "next/navigation";
import { ErrorState } from "./States";

/**
 * Banner galat query (T-1): tampil saat query gagal karena galat selain
 * tabel hilang. Pesan aman (tanpa stack trace); tombol "Coba lagi"
 * memuat ulang data lewat router.refresh().
 */
export function QueryErrorBanner({
  title = "Gagal memuat data",
  description = "Terjadi kesalahan saat mengambil data. Coba muat ulang halaman.",
}: {
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  return <ErrorState title={title} description={description} onRetry={() => router.refresh()} />;
}
