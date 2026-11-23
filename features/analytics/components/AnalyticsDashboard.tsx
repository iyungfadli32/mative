/**
 * Dashboard analytics — features/analytics/components/AnalyticsDashboard.tsx (P7-03).
 * Angka HANYA dari record nyata (snapshot impor + publishing_jobs nyata).
 * TIDAK ADA periode pembanding (tidak ada jendela pembanding yang
 * dijamin) dan TIDAK ADA chart library — tabel berlabel + ringkasan
 * teks + bar CSS sederhana (Recharts tidak terinstal).
 */
import Link from "next/link";
import { ANALYTICS_DATA_STATUS_LABELS, METRIC_LABEL_BY_KEY } from "../constants";
import { formatMetricValue } from "../metrics";
import type { DashboardSummary } from "../types";

function StatCard({
  label,
  display,
  hint,
  icon,
}: {
  label: string;
  display: string;
  hint: string;
  icon?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-[var(--mt-text-muted)]">{label}</p>
        {icon ? (
          <span aria-hidden="true" className="text-lg">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums text-[var(--mt-text)]">{display}</p>
      <p className="mt-1 text-xs text-[var(--mt-text-muted)]">{hint}</p>
    </div>
  );
}

export function AnalyticsDashboard({
  summary,
  workspaceId,
  canImport,
}: {
  summary: DashboardSummary;
  workspaceId: string;
  canImport: boolean;
}) {
  const totals = summary.totals;
  const reach = totals.find((t) => t.metric_key === "reach");
  const engagements = totals.find((t) => t.metric_key === "engagements");
  const followers = totals.find((t) => t.metric_key === "followers_net_change");
  const maxCount = Math.max(
    0,
    ...totals.filter((t) => t.unit !== "persen").map((t) => t.value),
  );
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Status data">
        <div
          role="status"
          className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          <p>
            <strong>Status data: {ANALYTICS_DATA_STATUS_LABELS[summary.status]}</strong>
            {" · "}
            Periode {summary.periodStart} s.d. {summary.periodEnd}
            {" · "}
            {summary.snapshotCount} snapshot
            {summary.lastRetrievedAt
              ? ` · Terakhir diperbarui ${new Date(summary.lastRetrievedAt).toLocaleString("id-ID")}`
              : ""}
            {summary.lastSourceReference ? ` · Sumber: ${summary.lastSourceReference}` : ""}
          </p>
          <p className="mt-1 text-[var(--mt-text-muted)]">
            {summary.status === "not_connected"
              ? "Belum ada data analytics — belum ada snapshot impor di workspace ini. Semua angka di bawah adalah 0 sampai impor pertama masuk."
              : summary.status === "partial"
                ? `Data sebagian: ${summary.placementCoverage.withMetrics} dari ${summary.placementCoverage.total} placement punya metrik di periode ini. Placement tanpa metrik tidak dihitung (bukan dianggap 0).`
                : `Lengkap: ${summary.placementCoverage.withMetrics} dari ${summary.placementCoverage.total} placement punya metrik di periode ini.`}
          </p>
          <p className="mt-2">
            Total di atas hanya menjumlah periode impor yang sepenuhnya berada
            dalam rentang yang dipilih
            {summary.partialPeriodRows > 0
              ? ` — ${summary.partialPeriodRows} baris periode impor hanya sebagian masuk rentang ini sehingga tidak dihitung.`
              : "."}{" "}
            Semua angka dari impor manual/CSV berlabel — tanpa periode
            pembanding di Phase 7.
          </p>
        </div>
      </section>

      {summary.status === "not_connected" ? (
        <section aria-label="Belum ada data">
          <div className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4 text-center">
            <p className="text-4xl" aria-hidden="true">
              📊
            </p>
            <h2 className="mt-2 font-semibold">Belum ada data analytics</h2>
            <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
              Impor CSV pertama dari laporan platform — dashboard akan menampilkan reach,
              engagements, dan engagement rate sesudahnya.
            </p>
            {canImport ? (
              <p className="mt-3">
                <Link
                  href={`/analitik/impor?workspace=${workspaceId}`}
                  className="font-medium text-[var(--mt-teal-700)] underline"
                >
                  Impor data pertama →
                </Link>
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          <section
            aria-label="KPI analytics"
            className="grid grid-cols-2 gap-3 lg:grid-cols-5"
          >
            <StatCard
              label="Reach"
              display={reach ? formatMetricValue(reach.value, "akun") : "0"}
              hint="akun (latest-wins)"
              icon="👁️"
            />
            <StatCard
              label="Engagements"
              display={engagements ? formatMetricValue(engagements.value, "interaksi") : "0"}
              hint="interaksi (latest-wins)"
              icon="💬"
            />
            <StatCard
              label="Engagement rate"
              display={
                summary.engagementRate != null
                  ? `${formatMetricValue(summary.engagementRate, "persen")} %`
                  : "—"
              }
              hint="dihitung: engagements/reach"
              icon="📈"
            />
            <StatCard
              label="Perubahan pengikut"
              display={followers ? formatMetricValue(followers.value, "akun") : "0"}
              hint="neto selama periode"
              icon="👥"
            />
            <StatCard
              label="Kepatuhan jadwal"
              display={
                summary.publishingAdherence.rate != null
                  ? `${formatMetricValue(summary.publishingAdherence.rate, "persen")} %`
                  : "—"
              }
              hint={`${summary.publishingAdherence.publishedOnSchedule} dari ${summary.publishingAdherence.plannedEligible} job tepat jadwal (±15 mnt)`}
              icon="⏱️"
            />
          </section>

          <section aria-label="Total per metrik">
            <h2 className="text-lg font-semibold">Total per metrik</h2>
            <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
              Jumlah dari snapshot terbaru per subject (impor ulang menimpa nilai lama).
              Engagement rate dan kepatuhan jadwal dihitung, bukan diimpor.
            </p>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--mt-border)] text-left">
                    <th className="px-4 py-2 font-medium">Metrik</th>
                    <th className="px-4 py-2 text-right font-medium">Nilai</th>
                    <th className="px-4 py-2 font-medium">Satuan</th>
                    <th className="px-4 py-2 font-medium">Perbandingan</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((t) => {
                    const pct =
                      t.unit === "persen"
                        ? Math.min(100, t.value)
                        : maxCount > 0
                          ? (t.value / maxCount) * 100
                          : 0;
                    return (
                      <tr key={t.metric_key} className="border-b border-[var(--mt-border)] last:border-0">
                        <td className="px-4 py-2 font-medium">
                          {METRIC_LABEL_BY_KEY[t.metric_key as keyof typeof METRIC_LABEL_BY_KEY] ??
                            t.metric_key}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatMetricValue(t.value, t.unit)}
                        </td>
                        <td className="px-4 py-2 text-[var(--mt-text-muted)]">{t.unit}</td>
                        <td className="px-4 py-2">
                          <div
                            className="h-2.5 w-full min-w-24 rounded-full bg-[var(--mt-surface-muted)]"
                            role="img"
                            aria-label={`${METRIC_LABEL_BY_KEY[t.metric_key as keyof typeof METRIC_LABEL_BY_KEY] ?? t.metric_key}: ${formatMetricValue(t.value, t.unit)} ${t.unit}`}
                          >
                            <div
                              className="h-2.5 rounded-full bg-[var(--mt-teal-700)]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-label="Per brand">
            <h2 className="text-lg font-semibold">Per brand</h2>
            {summary.byBrand.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
                Belum ada metrik per brand di periode ini.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--mt-border)] text-left">
                      <th className="px-4 py-2 font-medium">Brand</th>
                      <th className="px-4 py-2 text-right font-medium">Reach</th>
                      <th className="px-4 py-2 text-right font-medium">Engagements</th>
                      <th className="px-4 py-2 text-right font-medium">Engagement rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byBrand.map((b) => (
                      <tr key={b.brandId} className="border-b border-[var(--mt-border)] last:border-0">
                        <td className="px-4 py-2 font-medium">{b.brandName}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatMetricValue(b.reach, "akun")}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatMetricValue(b.engagements, "interaksi")}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {b.engagementRate != null
                            ? `${formatMetricValue(b.engagementRate, "persen")} %`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <section aria-label="Tautan analytics" className="flex flex-wrap gap-3 text-sm">
        <Link
          href={`/analitik/laporan?workspace=${workspaceId}`}
          className="font-medium text-[var(--mt-teal-700)] underline"
        >
          Lihat 5 laporan →
        </Link>
        {canImport ? (
          <Link
            href={`/analitik/impor?workspace=${workspaceId}`}
            className="font-medium text-[var(--mt-teal-700)] underline"
          >
            Impor data →
          </Link>
        ) : null}
        <Link
          href={`/integrasi?workspace=${workspaceId}`}
          className="font-medium text-[var(--mt-teal-700)] underline"
        >
          Status integrasi (DISABLED) →
        </Link>
      </section>
    </div>
  );
}
