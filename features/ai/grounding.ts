/**
 * Grounding analytics — features/ai/grounding.ts (P8-05, ADR-0014 §6).
 * Insight AI (campaign_summary) memakai HANYA structured metric payload
 * dari query database nyata. UI menampilkan metrik + periode persis yang
 * dipakai; bila data hilang, tampilkan "data tidak tersedia".
 * Grounding 100% (ASUMSI-8F): angka + periode yang dikutip HARUS cocok
 * dengan payload — bila ada satu angka yang tidak cocok, aksi gagal.
 */
import type { AiGroundedMetric, AiMetricPayload } from "./types";

export type CampaignMetricRow = {
  metric_key: string;
  value: number | string;
  unit: string;
  period_start: string;
  period_end: string;
  snapshot_id: string | null;
};

/**
 * Bangun payload grounding dari baris campaign_metrics nyata.
 * source = `snapshot:<id>` bila ada, atau `manual:<campaign>:<periode>`.
 */
export function buildMetricPayload(input: {
  campaignId: string;
  campaignName: string | null;
  periodStart: string;
  periodEnd: string;
  rows: CampaignMetricRow[];
}): AiMetricPayload {
  const metrics: AiGroundedMetric[] = input.rows.map((r) => ({
    metricKey: r.metric_key,
    value: Number(r.value),
    unit: r.unit,
    source: r.snapshot_id
      ? `snapshot:${r.snapshot_id}`
      : `manual:${input.campaignId}:${r.period_start}..${r.period_end}`,
    periodStart: r.period_start,
    periodEnd: r.period_end,
  }));
  return {
    campaignId: input.campaignId,
    campaignName: input.campaignName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    metrics,
  };
}

/** Angka yang dikutip dalam rangkuman (metric_key + value). */
export type CitedNumber = { metricKey: string; value: number };

/**
 * Verifikasi grounding: setiap angka yang dikutip HARUS sama persis
 * dengan payload (100%). Mengembalikan daftar ketidakcocokan — kosong
 * berarti lolos.
 */
export function verifyGroundingNumbers(
  payload: AiMetricPayload,
  cited: CitedNumber[],
): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  const byKey = new Map<string, number>();
  for (const m of payload.metrics) byKey.set(m.metricKey, m.value);
  for (const c of cited) {
    const actual = byKey.get(c.metricKey);
    if (actual === undefined) {
      mismatches.push(`${c.metricKey}: dikutip ${c.value} tetapi metrik tidak ada di payload`);
    } else if (actual !== c.value) {
      mismatches.push(`${c.metricKey}: dikutip ${c.value} tetapi nilai sebenarnya ${actual}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** Label metrik untuk tampilan ("reach: 1500 (periode 2026-11-01 s.d. 2026-11-30)"). */
export function formatGroundedMetric(m: AiGroundedMetric): string {
  return `${m.metricKey}: ${m.value} ${m.unit} (periode ${m.periodStart} s.d. ${m.periodEnd}, sumber ${m.source})`;
}
