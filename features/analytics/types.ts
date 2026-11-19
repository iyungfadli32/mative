/**
 * Tipe domain Analytics Foundation — features/analytics/types.ts (P7-03).
 * Kolom mengikuti migrasi 0021 (ADR-0013).
 */
import type { AnalyticsDataStatus, AnalyticsReportId, MetricKey } from "./constants";

export type { AnalyticsDataStatus, AnalyticsReportId, MetricKey };

export type MetricDefinition = {
  id: string;
  workspace_id: string | null;
  source_platform: string;
  metric_key: string;
  label: string;
  unit: string;
  formula: string | null;
  notes: string | null;
  compatibility_group: string | null;
  is_derived: boolean;
  created_at: string;
};

export type AnalyticsSnapshot = {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  source: string;
  period_start: string;
  period_end: string;
  retrieved_at: string;
  raw_payload_reference: string | null;
  created_by: string | null;
  created_at: string;
};

export type ContentMetric = {
  id: string;
  snapshot_id: string;
  workspace_id: string;
  brand_id: string;
  subject_type: "placement" | "content_item" | "published_post";
  subject_id: string;
  metric_key: string;
  value: number;
  unit: string;
  period_start: string;
  period_end: string;
  source_notes: string | null;
  created_at: string;
};

export type CampaignMetric = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  brand_id: string | null;
  metric_key: string;
  value: number;
  unit: string;
  aggregation_rule: string;
  period_start: string;
  period_end: string;
  snapshot_id: string | null;
  created_at: string;
};

export type IntegrationEvent = {
  id: string;
  workspace_id: string;
  event_type: string;
  actor_user_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type ChannelCapability = {
  id: string;
  brand_id: string;
  brand_name: string | null;
  platform: string;
  account_name: string | null;
  connection_status: "not_connected" | "manual" | "disabled";
  capability_snapshot: Record<string, unknown> | null;
  capability_checked_at: string | null;
};

/** Satu baris metrik sesudah agregasi latest-wins (untuk dashboard/laporan). */
export type AggregatedMetricRow = {
  metric_key: string;
  unit: string;
  value: number;
  /** Jumlah baris sumber yang dijumlahkan (0 = turunan yang dihitung). */
  sources: number;
};

/** Ringkasan dashboard /analitik. */
export type DashboardSummary = {
  status: AnalyticsDataStatus;
  periodStart: string;
  periodEnd: string;
  snapshotCount: number;
  lastRetrievedAt: string | null;
  lastSourceReference: string | null;
  totals: AggregatedMetricRow[];
  engagementRate: number | null;
  publishingAdherence: {
    publishedOnSchedule: number;
    plannedEligible: number;
    rate: number | null;
  };
  byBrand: Array<{
    brandId: string;
    brandName: string;
    reach: number;
    engagements: number;
    engagementRate: number | null;
  }>;
  /** Jumlah placement di workspace vs yang punya metrik di periode ini. */
  placementCoverage: { withMetrics: number; total: number };
};

/** Satu baris laporan performa konten. */
export type ContentPerformanceRow = {
  subjectType: "placement" | "content_item" | "published_post";
  subjectId: string;
  subjectLabel: string;
  brandName: string | null;
  channelPlatform: string | null;
  channelAccount: string | null;
  reach: number;
  impressions: number;
  engagements: number;
  engagementRate: number | null;
  sourceReference: string | null;
};

/** Hasil aksi impor (server action + API). */
export type AnalyticsActionResult = {
  ok: boolean;
  message: string;
  snapshotId?: string;
  inserted?: number;
  campaigns?: number;
  /** Kode RPC 0021 (FORBIDDEN, INVALID_METRIC, …) — dipakai pemetaan status HTTP API. */
  code?: string;
};

/** Hasil RPC import_analytics_snapshot (jsonb). */
export type ImportRpcResult = {
  ok: boolean;
  code: string;
  message: string;
  snapshot_id?: string | null;
  inserted?: number;
  campaigns?: number;
};
