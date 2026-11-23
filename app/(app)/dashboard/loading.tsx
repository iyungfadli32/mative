import { LoadingSkeleton } from "@/components/ui/States";

/**
 * Loading boundary rute dasbor — T-2.
 * Tampil saat halaman dimuat; kerangka AppShell (layout) tetap tampil.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <LoadingSkeleton lines={2} label="Memuat ringkasan…" />
      <LoadingSkeleton lines={4} label="Memuat KPI…" />
      <LoadingSkeleton lines={4} label="Memuat persetujuan tertunda…" />
    </div>
  );
}
