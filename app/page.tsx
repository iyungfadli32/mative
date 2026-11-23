import { Button } from "@/components/ui/Button";
import { envStatus } from "@/lib/env";

/**
 * Halaman muka MaTive (publik). Bukan landing pemasaran penuh — itu di luar
 * scope Phase 1. Menjelaskan produk + status fondasi secara jujur.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-[var(--mt-teal-700)]">
        MaTive — Creative Content Operations Platform
      </p>
      <h1 className="mt-3 text-4xl font-bold leading-tight text-[var(--mt-text)] md:text-5xl">
        Satu workspace untuk merencanakan, membuat, menyetujui, dan mengukur konten.
      </h1>
      <p className="mt-4 text-lg text-[var(--mt-text-muted)]">
        Plan • Create • Collaborate • Approve • Publish • Analyze — dengan satu content item kanonis
        sebagai sumber kebenaran semua tampilan.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button href="/masuk" size="lg">
          Masuk
        </Button>
        <Button href="/daftar" variant="secondary" size="lg">
          Daftar akun
        </Button>
        <Button href="/portal" variant="ghost" size="lg">
          Portal Klien →
        </Button>
      </div>
      <div className="mt-10 rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-5">
        <h2 className="text-base font-semibold">Status fondasi — Phase 1 (DRAF)</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--mt-text-muted)]">
          <li>
            Repo, CI, design tokens (13 token sementara), komponen primitif, app shell responsif.
          </li>
          <li>Auth + organisasi/workspace + undangan + RBAC 9 role + RLS (migrasi tertulis).</li>
          <li>
            Client portal dasar untuk viewer_client (hanya resource yang dibagikan eksplisit).
          </li>
          <li>
            Status Supabase:{" "}
            {envStatus.supabaseConfigured
              ? "terkonfigurasi — auth dan data aktif."
              : "belum dikonfigurasi — isi .env.local dari dashboard Supabase (lihat .env.example)."}
          </li>
          <li>
            Modul konten, kalender, board, approval, publishing, analytics, dan AI menyusul di
            fasenya — tombolnya disabled dengan alasan, bukan palsu.
          </li>
        </ul>
      </div>
    </main>
  );
}
