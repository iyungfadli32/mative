/**
 * Dashboard KPI — features/dashboard/kpis.ts (P1-13, Keputusan #6).
 * KPI dihitung dari record nyata SAJA. Di Phase 1 belum ada tabel content,
 * jadi kelima KPI operasional bernilai 0 + empty state — DILARANG hardcode.
 * Fungsi ini menerima hitungan dari query nyata; bila query gagal / belum
 * ada tabel, kembalikan 0 dan tandai `hasData: false`.
 */
export type DashboardKpis = {
  planned: number;
  inProduction: number;
  awaitingApproval: number;
  scheduled: number;
  published: number;
  /** false bila belum ada record content sama sekali (tampilkan empty state). */
  hasData: boolean;
};

export const EMPTY_KPIS: DashboardKpis = {
  planned: 0,
  inProduction: 0,
  awaitingApproval: 0,
  scheduled: 0,
  published: 0,
  hasData: false,
};

/**
 * Hitung KPI dari hitungan record nyata (diisi pemanggil dari query Supabase).
 * Di Phase 2 fungsi ini menerima count content_items/placements nyata.
 */
export function buildKpis(counts: Partial<Omit<DashboardKpis, "hasData">>): DashboardKpis {
  const planned = counts.planned ?? 0;
  const inProduction = counts.inProduction ?? 0;
  const awaitingApproval = counts.awaitingApproval ?? 0;
  const scheduled = counts.scheduled ?? 0;
  const published = counts.published ?? 0;
  return {
    planned,
    inProduction,
    awaitingApproval,
    scheduled,
    published,
    hasData: planned + inProduction + awaitingApproval + scheduled + published > 0,
  };
}
