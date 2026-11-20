"use client";

/**
 * Global error boundary — menangkap galat di root layout itu sendiri.
 * Wajib me-render <html>/<body> sendiri (aturan Next.js).
 * Ditambahkan di Phase 9 (9.1 gap a).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="id">
      <body>
        <div
          style={{
            maxWidth: 640,
            margin: "0 auto",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1>Terjadi kesalahan</h1>
          <p>MaTive gagal dimuat. Coba muat ulang halaman ini.</p>
          {error.digest ? <p>Kode galat: {error.digest}</p> : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              borderRadius: 10,
              background: "#0f766e",
              color: "#fff",
              padding: "8px 16px",
              border: "none",
              cursor: "pointer",
            }}
          >
            Muat ulang
          </button>
        </div>
      </body>
    </html>
  );
}
