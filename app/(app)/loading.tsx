import { LoadingSkeleton } from "@/components/ui/States";

/**
 * Loading boundary segmen (app) — D1/D3.
 * Tampil INSTAN saat navigasi antar-halaman aplikasi dimulai (sebelum
 * payload RSC tujuan tiba), supaya klik tidak pernah terasa mati: dialog
 * "Buat cepat" yang menutup + skeleton ini = umpan balik langsung.
 * Meniru kerangka AppShell (sidebar 248px + topbar h-16 + konten) agar
 * tidak ada kedipan layout saat halaman tujuan selesai dimuat.
 */
export default function AppLoading() {
  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--mt-canvas)]" aria-hidden="true">
      {/* Sidebar skeleton — tampil md ke atas, seperti AppSidebar */}
      <div className="hidden h-full w-[248px] flex-col bg-[var(--mt-navy-950)] p-4 md:flex">
        <div className="h-8 w-3/4 animate-pulse rounded bg-white/15" />
        <div className="mt-6 flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-white/10" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar skeleton */}
        <div className="flex h-16 items-center justify-between gap-3 border-b border-[var(--mt-border)] bg-[var(--mt-surface)] px-4">
          <div className="h-9 w-full max-w-md animate-pulse rounded-[10px] bg-[var(--mt-canvas)]" />
          <div className="h-8 w-28 shrink-0 animate-pulse rounded-[10px] bg-[var(--mt-canvas)]" />
        </div>
        {/* Konten skeleton */}
        <main className="flex-1 overflow-y-auto px-4 pb-24 pt-4 md:px-6 md:pb-8 md:pt-6">
          <p role="status" className="text-sm text-[var(--mt-text-muted)]">
            Memuat halaman…
          </p>
          <div className="mt-4">
            <LoadingSkeleton lines={3} label="Memuat halaman…" />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <LoadingSkeleton lines={2} label="Memuat halaman…" />
            <LoadingSkeleton lines={2} label="Memuat halaman…" />
            <LoadingSkeleton lines={2} label="Memuat halaman…" />
          </div>
        </main>
      </div>
    </div>
  );
}
