/**
 * Ringkasan analytics kecil di Command Center — (P7-03).
 * Hanya angka dari record nyata (snapshot impor); "belum terhubung" bila
 * belum ada snapshot. Komponen ini TIDAK dirender untuk viewer_client
 * (diputuskan pemanggil lewat can(view_analytics)).
 */
import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ANALYTICS_DATA_STATUS_LABELS } from "@/features/analytics/constants";
import { defaultDateRange, formatMetricValue } from "@/features/analytics/metrics";
import { getDashboardSummary } from "@/features/analytics/queries";

export async function DashboardAnalyticsSummary({
  workspaceId,
  timezone,
}: {
  workspaceId: string;
  timezone: string;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;
  const range = defaultDateRange(timezone);
  const res = await getDashboardSummary(supabase, workspaceId, {
    from: range.start,
    to: range.end,
  });
  if (!res.ok) return null;
  const s = res.data;
  const reach = s.totals.find((t) => t.metric_key === "reach");
  const engagements = s.totals.find((t) => t.metric_key === "engagements");
  return (
    <div className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
      <h2 className="font-semibold">Analitik (30 hari terakhir)</h2>
      {s.status === "not_connected" ? (
        <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
          Belum terhubung — belum ada data analytics. Impor CSV pertama untuk melihat angka
          di sini.
        </p>
      ) : (
        <p className="mt-2 text-sm">
          Reach <strong>{reach ? formatMetricValue(reach.value, "akun") : "0"}</strong> ·{" "}
          Engagements{" "}
          <strong>{engagements ? formatMetricValue(engagements.value, "interaksi") : "0"}</strong>{" "}
          · Engagement rate{" "}
          <strong>
            {s.engagementRate != null
              ? `${formatMetricValue(s.engagementRate, "persen")} %`
              : "—"}
          </strong>{" "}
          · Status: {ANALYTICS_DATA_STATUS_LABELS[s.status]}
          {s.lastRetrievedAt
            ? ` · Terakhir diperbarui ${new Date(s.lastRetrievedAt).toLocaleDateString("id-ID")}`
            : ""}
          {s.partialPeriodRows > 0
            ? ` · Catatan: ${s.partialPeriodRows} baris periode impor hanya sebagian masuk 30 hari terakhir sehingga tidak dihitung dalam total di atas.`
            : ""}
        </p>
      )}
      <p className="mt-2 text-sm">
        <Link
          href={`/analitik?workspace=${workspaceId}`}
          className="font-medium text-[var(--mt-teal-700)] underline"
        >
          Lihat analitik →
        </Link>
      </p>
    </div>
  );
}
