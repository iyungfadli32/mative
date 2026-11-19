/**
 * 5 laporan analytics — features/analytics/components/AnalyticsReports.tsx (P7-03).
 * Ekspor CSV dulu (tanpa PDF di Phase 7). Tiap laporan menampilkan
 * sumbernya (snapshot impor / record nyata) — angka tanpa sumber tidak
 * pernah ditampilkan ke klien (v2 §8).
 */
import Link from "next/link";
import { ANALYTICS_REPORTS, METRIC_LABEL_BY_KEY } from "../constants";
import { computeEngagementRate, formatMetricValue } from "../metrics";
import type {
  AnalyticsSnapshot,
  CampaignMetric,
  ContentPerformanceRow,
  DashboardSummary,
} from "../types";

function exportHref(
  report: string,
  workspaceId: string,
  from: string,
  to: string,
  brandId: string | null,
): string {
  const params = new URLSearchParams({
    report,
    workspace: workspaceId,
    from,
    to,
  });
  if (brandId) params.set("brand", brandId);
  return `/api/v1/analytics/export?${params.toString()}`;
}

function ReportShell({
  id,
  title,
  description,
  href,
  children,
}: {
  id: string;
  title: string;
  description: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} id={`laporan-${id}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{description}</p>
        </div>
        <a
          href={href}
          className="rounded-lg border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-medium"
        >
          Unduh CSV
        </a>
      </div>
      {children}
    </section>
  );
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[];
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--mt-border)] text-left">
            {headers.map((h, i) => (
              <th key={h} className={`px-4 py-2 font-medium ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

function Row({ cells }: { cells: React.ReactNode[] }) {
  return (
    <tr className="border-b border-[var(--mt-border)] last:border-0">
      {cells.map((c, i) => (
        <td key={i} className={`px-4 py-2 ${i > 0 ? "text-right tabular-nums" : ""}`}>
          {c}
        </td>
      ))}
    </tr>
  );
}

export function AnalyticsReports({
  workspaceId,
  from,
  to,
  brandId,
  summary,
  campaignMetrics,
  campaignNames,
  contentRows,
  snapshots,
  publishingVolume,
}: {
  workspaceId: string;
  from: string;
  to: string;
  brandId: string | null;
  summary: DashboardSummary;
  campaignMetrics: CampaignMetric[];
  campaignNames: Array<{ id: string; name: string }>;
  contentRows: ContentPerformanceRow[];
  snapshots: AnalyticsSnapshot[];
  publishingVolume: { total: number; byStatus: Record<string, number> };
}) {
  const report = (id: string) =>
    ANALYTICS_REPORTS.find((r) => r.id === id) ?? { id, title: id, description: "" };
  const href = (id: string) => exportHref(id, workspaceId, from, to, brandId);
  const campaignName = new Map(campaignNames.map((c) => [c.id, c.name]));

  const byCampaign = new Map<string, CampaignMetric[]>();
  for (const m of campaignMetrics) {
    const list = byCampaign.get(m.campaign_id) ?? [];
    list.push(m);
    byCampaign.set(m.campaign_id, list);
  }

  const byChannel = new Map<string, { reach: number; engagements: number }>();
  for (const r of contentRows) {
    const key = `${r.channelPlatform ?? "(tanpa channel)"} / ${r.channelAccount ?? "-"}`;
    const cur = byChannel.get(key) ?? { reach: 0, engagements: 0 };
    cur.reach += r.reach;
    cur.engagements += r.engagements;
    byChannel.set(key, cur);
  }

  return (
    <div className="flex flex-col gap-8">
      <ReportShell
        id="workspace"
        title={report("workspace").title}
        description={report("workspace").description}
        href={href("workspace")}
      >
        {summary.totals.length === 0 ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Belum ada metrik di periode ini.{" "}
            <Link
              href={`/analitik/impor?workspace=${workspaceId}`}
              className="font-medium text-[var(--mt-teal-700)] underline"
            >
              Impor data →
            </Link>
          </p>
        ) : (
          <Table
            headers={["Metrik", "Nilai", "Satuan"]}
            rows={summary.totals.map((t) => (
              <Row
                key={t.metric_key}
                cells={[
                  <span key="l" className="font-medium">
                    {METRIC_LABEL_BY_KEY[t.metric_key as keyof typeof METRIC_LABEL_BY_KEY] ??
                      t.metric_key}
                  </span>,
                  formatMetricValue(t.value, t.unit),
                  t.unit,
                ]}
              />
            ))}
          />
        )}
        <h3 className="mt-2 font-medium">Snapshot impor di periode ini</h3>
        {snapshots.length === 0 ? (
          <p className="text-sm text-[var(--mt-text-muted)]">Belum ada snapshot.</p>
        ) : (
          <Table
            headers={["Periode", "Diambil", "Sumber"]}
            rows={snapshots.map((s) => (
              <Row
                key={s.id}
                cells={[
                  <span key="p" className="font-medium">
                    {s.period_start} s.d. {s.period_end}
                  </span>,
                  new Date(s.retrieved_at).toLocaleString("id-ID"),
                  s.raw_payload_reference ?? "—",
                ]}
              />
            ))}
          />
        )}
      </ReportShell>

      <ReportShell
        id="brand-channel"
        title={report("brand-channel").title}
        description={report("brand-channel").description}
        href={href("brand-channel")}
      >
        {summary.byBrand.length === 0 ? (
          <p className="text-sm text-[var(--mt-text-muted)]">Belum ada metrik per brand.</p>
        ) : (
          <Table
            headers={["Brand", "Reach", "Engagements", "Engagement rate"]}
            rows={summary.byBrand.map((b) => (
              <Row
                key={b.brandId}
                cells={[
                  <span key="b" className="font-medium">
                    {b.brandName}
                  </span>,
                  formatMetricValue(b.reach, "akun"),
                  formatMetricValue(b.engagements, "interaksi"),
                  b.engagementRate != null
                    ? `${formatMetricValue(b.engagementRate, "persen")} %`
                    : "—",
                ]}
              />
            ))}
          />
        )}
        <h3 className="mt-2 font-medium">Per channel (dari performa konten)</h3>
        {byChannel.size === 0 ? (
          <p className="text-sm text-[var(--mt-text-muted)]">Belum ada metrik per channel.</p>
        ) : (
          <Table
            headers={["Channel", "Reach", "Engagements", "Engagement rate"]}
            rows={[...byChannel.entries()].map(([channel, v]) => (
              <Row
                key={channel}
                cells={[
                  <span key="c" className="font-medium">
                    {channel}
                  </span>,
                  formatMetricValue(v.reach, "akun"),
                  formatMetricValue(v.engagements, "interaksi"),
                  (() => {
                    const rate = computeEngagementRate(v.engagements, v.reach);
                    return rate != null ? `${formatMetricValue(rate, "persen")} %` : "—";
                  })(),
                ]}
              />
            ))}
          />
        )}
      </ReportShell>

      <ReportShell
        id="campaign"
        title={report("campaign").title}
        description={report("campaign").description}
        href={href("campaign")}
      >
        {byCampaign.size === 0 ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Belum ada agregat campaign — agregat dihitung ulang tiap impor dari metrik konten
            yang terhubung ke campaign.
          </p>
        ) : (
          [...byCampaign.entries()].map(([campaignId, metrics]) => {
            const reach = metrics.find((m) => m.metric_key === "reach");
            const engagements = metrics.find((m) => m.metric_key === "engagements");
            const rate = computeEngagementRate(
              engagements ? Number(engagements.value) : null,
              reach ? Number(reach.value) : null,
            );
            return (
              <div key={campaignId} className="flex flex-col gap-2">
                <h3 className="font-medium">
                  {campaignName.get(campaignId) ?? campaignId}
                  {rate != null ? ` — engagement rate ${formatMetricValue(rate, "persen")} %` : ""}
                </h3>
                <Table
                  headers={["Metrik", "Nilai", "Satuan"]}
                  rows={metrics.map((m) => (
                    <Row
                      key={m.metric_key}
                      cells={[
                        <span key="l" className="font-medium">
                          {METRIC_LABEL_BY_KEY[m.metric_key as keyof typeof METRIC_LABEL_BY_KEY] ??
                            m.metric_key}
                        </span>,
                        formatMetricValue(Number(m.value), m.unit),
                        m.unit,
                      ]}
                    />
                  ))}
                />
              </div>
            );
          })
        )}
      </ReportShell>

      <ReportShell
        id="content"
        title={report("content").title}
        description={report("content").description}
        href={href("content")}
      >
        {contentRows.length === 0 ? (
          <p className="text-sm text-[var(--mt-text-muted)]">Belum ada performa konten.</p>
        ) : (
          <Table
            headers={["Konten / placement", "Brand", "Channel", "Reach", "Impressions", "Engagements", "Eng. rate"]}
            rows={contentRows.map((r) => (
              <Row
                key={`${r.subjectType}|${r.subjectId}`}
                cells={[
                  <span key="s" className="font-medium">
                    {r.subjectLabel}
                  </span>,
                  r.brandName ?? "—",
                  `${r.channelPlatform ?? "—"}${r.channelAccount ? ` / ${r.channelAccount}` : ""}`,
                  formatMetricValue(r.reach, "akun"),
                  formatMetricValue(r.impressions, "tayangan"),
                  formatMetricValue(r.engagements, "interaksi"),
                  r.engagementRate != null
                    ? `${formatMetricValue(r.engagementRate, "persen")} %`
                    : "—",
                ]}
              />
            ))}
          />
        )}
      </ReportShell>

      <ReportShell
        id="publishing"
        title={report("publishing").title}
        description={report("publishing").description}
        href={href("publishing")}
      >
        <p className="text-sm">
          Kepatuhan jadwal terbit:{" "}
          <strong>
            {summary.publishingAdherence.rate != null
              ? `${formatMetricValue(summary.publishingAdherence.rate, "persen")} %`
              : "—"}
          </strong>{" "}
          ({summary.publishingAdherence.publishedOnSchedule} dari{" "}
          {summary.publishingAdherence.plannedEligible} job tepat jadwal, toleransi ±15 menit
          dari scheduled_at).
        </p>
        {publishingVolume.total === 0 ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Belum ada job publishing berjadwal di periode ini.
          </p>
        ) : (
          <Table
            headers={["Status job", "Jumlah"]}
            rows={Object.entries(publishingVolume.byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => (
                <Row
                  key={status}
                  cells={[<span key="s" className="font-medium">{status}</span>, String(count)]}
                />
              ))}
          />
        )}
      </ReportShell>
    </div>
  );
}
