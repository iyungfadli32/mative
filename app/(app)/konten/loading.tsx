import { LoadingSkeleton } from "@/components/ui/States";

/**
 * Loading boundary rute konten — T-2.
 * Tampil saat halaman dimuat; kerangka AppShell (layout) tetap tampil.
 */
export default function KontenLoading() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <LoadingSkeleton lines={2} label="Memuat filter…" />
      <LoadingSkeleton lines={6} label="Memuat daftar konten…" />
    </div>
  );
}
