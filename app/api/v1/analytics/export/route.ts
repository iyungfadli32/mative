import { NextResponse, type NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { z } from "zod";
import {
  ANALYTICS_TABLES_UNAVAILABLE_ID,
  METRIC_LABEL_BY_KEY,
} from "@/features/analytics/constants";
import { buildAnalyticsTemplateCsv, exportReportCsv } from "@/features/analytics/csv";
import { computeEngagementRate, formatMetricValue } from "@/features/analytics/metrics";
import {
  getContentPerformance,
  getDashboardSummary,
  getPublishingVolume,
  listCampaignMetrics,
  listCampaignNames,
} from "@/features/analytics/queries";
import { errorJson, requireContext } from "../../publishing/helpers";

/**
 * API v1 analytics — ekspor CSV laporan (P7-05).
 * GET /api/v1/analytics/export?report=<id>&workspace=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD[&brand=<uuid>]
 * - report=template: template CSV impor (tanpa login — konten statis).
 * - 5 laporan lain: butuh login + peran export_data; angka dari query
 *   yang sama dengan halaman laporan (satu jalur kebenaran).
 * CSV dulu, tanpa PDF (Phase 7).
 */
const exportQuerySchema = z.object({
  report: z.enum(["workspace", "brand-channel", "campaign", "content", "publishing", "template"]),
  workspace: z.string().uuid("workspace_id tidak valid.").optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "from harus format YYYY-MM-DD.")
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "to harus format YYYY-MM-DD.")
    .optional(),
  brand: z.string().uuid("brand_id tidak valid.").optional(),
});

function csvResponse(filename: string, csv: string) {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const parsed = exportQuerySchema.safeParse({
    report: params.get("report") ?? "",
    workspace: params.get("workspace") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    brand: params.get("brand") ?? undefined,
  });
  if (!parsed.success) {
    return errorJson("INVALID_QUERY", parsed.error.issues[0]?.message ?? "Query tidak valid.", 400);
  }
  const { report } = parsed.data;
  if (report === "template") {
    return csvResponse("analytics-template.csv", buildAnalyticsTemplateCsv());
  }
  const workspaceId = parsed.data.workspace;
  const from = parsed.data.from;
  const to = parsed.data.to;
  if (!workspaceId || !from || !to || from > to) {
    return errorJson(
      "INVALID_QUERY",
      "Parameter workspace, from, dan to wajib diisi (from ≤ to).",
      400,
    );
  }
  const { supabase, ctx } = await requireContext(workspaceId);
  if (!supabase) return errorJson("UNAVAILABLE", "Supabase belum dikonfigurasi.", 503);
  if (!ctx) return errorJson("UNAUTHENTICATED", "Anda harus masuk dulu.", 401);
  if (!can(ctx.role as WorkspaceRole, "export_data")) {
    return errorJson("FORBIDDEN", "Peran Anda tidak boleh mengekspor data.", 403);
  }
  const brandId = parsed.data.brand ?? null;
  const range = { from, to, brandId };
  const filename = `mative-analytics-${report}-${from}-${to}.csv`;

  if (report === "workspace") {
    const [summaryRes] = await Promise.all([
      getDashboardSummary(supabase, workspaceId, range),
    ]);
    if (!summaryRes.ok) {
      return errorJson("UNAVAILABLE", ANALYTICS_TABLES_UNAVAILABLE_ID, 503);
    }
    const source = summaryRes.data.lastSourceReference ?? "";
    const lines: string[][] = summaryRes.data.totals.map((t) => [
      METRIC_LABEL_BY_KEY[t.metric_key as keyof typeof METRIC_LABEL_BY_KEY] ?? t.metric_key,
      String(t.value),
      t.unit,
      source,
    ]);
    if (summaryRes.data.partialPeriodRows > 0) {
      lines.push([
        "Catatan periode",
        `${summaryRes.data.partialPeriodRows} baris periode impor hanya sebagian masuk rentang ${from} s.d. ${to} sehingga tidak dihitung dalam total di atas.`,
        "",
        "",
      ]);
    }
    return csvResponse(filename, exportReportCsv(["Metrik", "Nilai", "Satuan", "Sumber"], lines));
  }

  if (report === "brand-channel") {
    const [summaryRes, contentRes] = await Promise.all([
      getDashboardSummary(supabase, workspaceId, range),
      getContentPerformance(supabase, workspaceId, range),
    ]);
    if (!summaryRes.ok || !contentRes.ok) {
      return errorJson("UNAVAILABLE", ANALYTICS_TABLES_UNAVAILABLE_ID, 503);
    }
    const lines: string[][] = summaryRes.data.byBrand.map((b) => [
      b.brandName,
      String(b.reach),
      String(b.engagements),
      b.engagementRate != null ? formatMetricValue(b.engagementRate, "persen") : "",
    ]);
    lines.push([]);
    lines.push(["Channel", "Reach", "Engagements", "Engagement rate (%)"]);
    const byChannel = new Map<string, { reach: number; engagements: number }>();
    for (const r of contentRes.data) {
      const key = `${r.channelPlatform ?? "(tanpa channel)"} / ${r.channelAccount ?? "-"}`;
      const cur = byChannel.get(key) ?? { reach: 0, engagements: 0 };
      cur.reach += r.reach;
      cur.engagements += r.engagements;
      byChannel.set(key, cur);
    }
    for (const [channel, v] of byChannel) {
      const rate = computeEngagementRate(v.engagements, v.reach);
      lines.push([
        channel,
        String(v.reach),
        String(v.engagements),
        rate != null ? formatMetricValue(rate, "persen") : "",
      ]);
    }
    return csvResponse(
      filename,
      exportReportCsv(["Brand", "Reach", "Engagements", "Engagement rate (%)"], lines),
    );
  }

  if (report === "campaign") {
    const [metricsRes, namesRes] = await Promise.all([
      listCampaignMetrics(supabase, workspaceId, range),
      listCampaignNames(supabase, workspaceId),
    ]);
    if (!metricsRes.ok || !namesRes.ok) {
      return errorJson("UNAVAILABLE", ANALYTICS_TABLES_UNAVAILABLE_ID, 503);
    }
    const nameById = new Map(namesRes.data.map((c) => [c.id, c.name]));
    const lines = metricsRes.data.map((m) => [
      nameById.get(m.campaign_id) ?? m.campaign_id,
      METRIC_LABEL_BY_KEY[m.metric_key as keyof typeof METRIC_LABEL_BY_KEY] ?? m.metric_key,
      String(m.value),
      m.unit,
      `${m.period_start} s.d. ${m.period_end}`,
    ]);
    return csvResponse(
      filename,
      exportReportCsv(["Campaign", "Metrik", "Nilai", "Satuan", "Periode"], lines),
    );
  }

  if (report === "content") {
    const contentRes = await getContentPerformance(supabase, workspaceId, range);
    if (!contentRes.ok) {
      return errorJson("UNAVAILABLE", ANALYTICS_TABLES_UNAVAILABLE_ID, 503);
    }
    const lines = contentRes.data.map((r) => [
      r.subjectLabel,
      r.subjectType,
      r.brandName ?? "",
      `${r.channelPlatform ?? ""}${r.channelAccount ? ` / ${r.channelAccount}` : ""}`,
      String(r.reach),
      String(r.impressions),
      String(r.engagements),
      r.engagementRate != null ? formatMetricValue(r.engagementRate, "persen") : "",
    ]);
    return csvResponse(
      filename,
      exportReportCsv(
        ["Konten / placement", "Jenis", "Brand", "Channel", "Reach", "Impressions", "Engagements", "Engagement rate (%)"],
        lines,
      ),
    );
  }

  // report === "publishing"
  const [summaryRes, volumeRes] = await Promise.all([
    getDashboardSummary(supabase, workspaceId, range),
    getPublishingVolume(supabase, workspaceId, range),
  ]);
  if (!summaryRes.ok || !volumeRes.ok) {
    return errorJson("UNAVAILABLE", ANALYTICS_TABLES_UNAVAILABLE_ID, 503);
  }
  const lines: string[][] = [
    [
      "Kepatuhan jadwal (%)",
      summaryRes.data.publishingAdherence.rate != null
        ? formatMetricValue(summaryRes.data.publishingAdherence.rate, "persen")
        : "",
    ],
    [
      "Tepat jadwal",
      String(summaryRes.data.publishingAdherence.publishedOnSchedule),
    ],
    [
      "Eligible",
      String(summaryRes.data.publishingAdherence.plannedEligible),
    ],
    [],
    ["Status job", "Jumlah"],
  ];
  for (const [status, count] of Object.entries(volumeRes.data.byStatus)) {
    lines.push([status, String(count)]);
  }
  return csvResponse(filename, exportReportCsv(["Ukuran", "Nilai"], lines));
}
