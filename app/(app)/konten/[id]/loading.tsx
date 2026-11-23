import { LoadingSkeleton } from "@/components/ui/States";

/**
 * Loading boundary rute detail konten — T-2.
 * Tampil saat halaman dimuat; kerangka AppShell (layout) tetap tampil.
 */
export default function KontenDetailLoading() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <LoadingSkeleton lines={3} label="Memuat detail konten…" />
      <LoadingSkeleton lines={2} label="Memuat tab…" />
      <LoadingSkeleton lines={4} label="Memuat bagian…" />
    </div>
  );
}
