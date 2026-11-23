import { LoadingSkeleton } from "@/components/ui/States";

/**
 * Loading boundary rute papan — T-2.
 * Tampil saat halaman dimuat; kerangka AppShell (layout) tetap tampil.
 */
export default function BoardLoading() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <LoadingSkeleton lines={2} label="Memuat filter papan…" />
      <LoadingSkeleton lines={6} label="Memuat kolom papan…" />
    </div>
  );
}
