/**
 * Hasil query Supabase: bedakan "tabel belum tersedia" (unavailable)
 * dari error lain (error berisi pesan). Error selain tabel hilang
 * JANGAN ditelan menjadi daftar kosong — pemanggil wajib menampilkan
 * banner error (lihat QueryErrorBanner).
 */
export function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "42P01" || code === "PGRST205") return true;
  // Kolom hilang (PostgREST 42703, mis. "column x.y does not exist") bukan
  // tabel hilang: jangan samarkan menjadi banner migrasi 0021.
  if (code === "42703") return false;
  if (typeof message === "string" && /^column\s/i.test(message)) return false;
  return (
    typeof message === "string" &&
    /Could not find the table|does not exist|relation .* does not exist/i.test(message)
  );
}

export function describeQueryError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Gagal memuat data.";
}

export type QueryOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; unavailable: true; error: null }
  | { ok: false; unavailable: false; error: string };

export function wrapQueryOutcome<T>(fn: () => Promise<T>): Promise<QueryOutcome<T>> {
  return fn()
    .then((data) => ({ ok: true as const, data }))
    .catch((error: unknown) => {
      if (isMissingTable(error)) {
        return { ok: false as const, unavailable: true as const, error: null };
      }
      return { ok: false as const, unavailable: false as const, error: describeQueryError(error) };
    });
}
