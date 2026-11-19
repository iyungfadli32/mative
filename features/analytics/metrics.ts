/**
 * Fungsi murni analytics — features/analytics/metrics.ts (P7-03).
 * Semua rumus di sini HARUS sama dengan definisi 0021/ADR-0013 §3 —
 * diuji di tests/analytics.test.ts. Tidak ada akses DB di file ini.
 */
import {
  ANALYTICS_ADHERENCE_TOLERANCE_MINUTES,
  ANALYTICS_BACKOFF_SECONDS,
  ANALYTICS_DEFAULT_RANGE_DAYS,
  ANALYTICS_SNAPSHOT_TTL_HOURS,
} from "./constants";
import type { AggregatedMetricRow } from "./types";

/**
 * Engagement rate = engagements / reach × 100 (4 desimal, seperti RPC
 * 0021). null bila reach ≤ 0 atau komponen tidak tersedia — angka TIDAK
 * BOLEH ditampilkan sebagai 0% palsu.
 */
export function computeEngagementRate(
  engagements: number | null | undefined,
  reach: number | null | undefined,
): number | null {
  if (engagements == null || reach == null || reach <= 0 || engagements < 0) return null;
  return Math.round((engagements / reach) * 100 * 10000) / 10000;
}

export type AdherenceJobInput = {
  placement_id: string;
  scheduled_at: string | null;
  status: string;
};

export type AdherencePostInput = {
  placement_id: string;
  published_at: string;
};

/**
 * Kepatuhan jadwal terbit (ADR-0013 §3): published sesuai jadwal /
 * planned eligible × 100. Eligible = job berjadwal (scheduled_at terisi)
 * dan tidak dibatalkan. Sesuai jadwal = job berstatus published DAN
 * published_posts.published_at dalam ±15 menit dari scheduled_at.
 * Job tanpa published_post (belum dikonfirmasi) TIDAK dihitung sesuai
 * jadwal — status job saja tidak cukup (bukti terbit = published_posts).
 */
export function computePublishingAdherence(
  jobs: AdherenceJobInput[],
  posts: AdherencePostInput[],
): { publishedOnSchedule: number; plannedEligible: number; rate: number | null } {
  const toleranceMs = ANALYTICS_ADHERENCE_TOLERANCE_MINUTES * 60 * 1000;
  const postByPlacement = new Map<string, AdherencePostInput>();
  for (const p of posts) postByPlacement.set(p.placement_id, p);
  let plannedEligible = 0;
  let publishedOnSchedule = 0;
  for (const job of jobs) {
    if (!job.scheduled_at || job.status === "cancelled") continue;
    plannedEligible++;
    if (job.status !== "published") continue;
    const post = postByPlacement.get(job.placement_id);
    if (!post) continue;
    const scheduled = new Date(job.scheduled_at).getTime();
    const published = new Date(post.published_at).getTime();
    if (Number.isNaN(scheduled) || Number.isNaN(published)) continue;
    if (Math.abs(published - scheduled) <= toleranceMs) publishedOnSchedule++;
  }
  return {
    publishedOnSchedule,
    plannedEligible,
    rate:
      plannedEligible > 0
        ? Math.round((publishedOnSchedule / plannedEligible) * 100 * 10000) / 10000
        : null,
  };
}

export type LatestWinsRowInput = {
  subject_type: string;
  subject_id: string;
  metric_key: string;
  value: number;
  period_start: string;
  period_end: string;
  retrieved_at: string;
};

/**
 * Agregasi latest-wins (ADR-0013 §3): impor ulang slice yang sama
 * MENIMPA nilai lama — per (subject, kunci, periode) hanya snapshot
 * dengan retrieved_at terbaru yang dihitung, lalu dijumlahkan per
 * kunci metrik. Baris dari snapshot lama tetap tersimpan (audit), tapi
 * tidak ikut total.
 */
export function aggregateLatestWins(rows: LatestWinsRowInput[]): AggregatedMetricRow[] {
  const latest = new Map<string, LatestWinsRowInput>();
  for (const row of rows) {
    const key = [
      row.subject_type,
      row.subject_id,
      row.metric_key,
      row.period_start,
      row.period_end,
    ].join("|");
    const prev = latest.get(key);
    if (!prev || new Date(row.retrieved_at).getTime() >= new Date(prev.retrieved_at).getTime()) {
      latest.set(key, row);
    }
  }
  const totals = new Map<string, { unit: string; value: number; sources: number }>();
  for (const row of latest.values()) {
    const cur = totals.get(row.metric_key) ?? { unit: "", value: 0, sources: 0 };
    totals.set(row.metric_key, {
      unit: cur.unit,
      value: cur.value + row.value,
      sources: cur.sources + 1,
    });
  }
  return [...totals.entries()]
    .map(([metric_key, t]) => ({ metric_key, unit: t.unit, value: t.value, sources: t.sources }))
    .sort((a, b) => a.metric_key.localeCompare(b.metric_key));
}

/** Jumlah sederhana per kunci (dipakai bila baris sudah latest-wins). */
export function sumByMetric(
  rows: Array<{ metric_key: string; value: number }>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.metric_key, (totals.get(row.metric_key) ?? 0) + row.value);
  }
  return totals;
}

/** Backoff retry integrasi (ASUMSI-7D) — cermin fungsi SQL 0021. */
export function integrationBackoffSeconds(attemptNumber: number): number {
  if (attemptNumber <= 1) return ANALYTICS_BACKOFF_SECONDS[0];
  if (attemptNumber === 2) return ANALYTICS_BACKOFF_SECONDS[1];
  return ANALYTICS_BACKOFF_SECONDS[2];
}

/** TTL snapshot 24 jam (ASUMSI-7D) — cermin fungsi SQL 0021. */
export function isSnapshotStale(retrievedAt: string, now: Date = new Date()): boolean {
  const retrieved = new Date(retrievedAt).getTime();
  if (Number.isNaN(retrieved)) return true;
  return now.getTime() - retrieved > ANALYTICS_SNAPSHOT_TTL_HOURS * 60 * 60 * 1000;
}

function dateInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Rentang default dashboard: 30 hari terakhir termasuk hari ini, di zona
 * workspace (bukan zona server UTC — pelajaran Phase 6 soal wall-clock).
 */
export function defaultDateRange(
  timezone: string,
  now: Date = new Date(),
): { start: string; end: string } {
  const end = dateInTimezone(now, timezone);
  const startDate = new Date(now.getTime() - (ANALYTICS_DEFAULT_RANGE_DAYS - 1) * 86400000);
  return { start: dateInTimezone(startDate, timezone), end };
}

/** Format nilai untuk tampilan (id-ID): hitungan bulat, persen 2 desimal. */
export function formatMetricValue(value: number, unit: string): string {
  if (unit === "persen") {
    return value.toLocaleString("id-ID", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

/** Status kelengkapan data dashboard (ADR-0013 §4). */
export function analyticsDataStatus(
  snapshotCount: number,
  placementsWithMetrics: number,
  totalPlacements: number,
): "not_connected" | "partial" | "complete" {
  if (snapshotCount === 0) return "not_connected";
  if (placementsWithMetrics < totalPlacements) return "partial";
  return "complete";
}
