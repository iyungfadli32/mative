/**
 * Unit test Analytics Foundation (P7-03).
 * Menangkap rumus kanonis ADR-0013 §3 (engagement rate, kepatuhan
 * jadwal, latest-wins), validasi CSV (ASUMSI-7E), angka operasional
 * (ASUMSI-7D), dan paritas katalog 14 kunci dengan seed 0021.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  aggregateLatestWins,
  analyticsDataStatus,
  computeEngagementRate,
  computePublishingAdherence,
  defaultDateRange,
  formatMetricValue,
  integrationBackoffSeconds,
  isSnapshotStale,
  sumByMetric,
} from "@/features/analytics/metrics";
import {
  buildAnalyticsTemplateCsv,
  parseAnalyticsCsv,
  validateAnalyticsCsvFile,
  validateAnalyticsCsvRow,
} from "@/features/analytics/csv";
import {
  ANALYTICS_CSV_COLUMNS,
  DERIVED_METRIC_KEYS,
  IMPORTABLE_METRIC_KEYS,
  METRIC_DEFINITIONS,
} from "@/features/analytics/constants";
import { parseAnalyticsParams } from "@/features/analytics/params";

describe("computeEngagementRate (ADR-0013 §3)", () => {
  it("120/1000 = 12 (4 desimal, seperti RPC 0021)", () => {
    expect(computeEngagementRate(120, 1000)).toBe(12);
    expect(computeEngagementRate(120, 1500)).toBe(8);
  });

  it("reach 0 atau kosong = null (bukan 0% palsu)", () => {
    expect(computeEngagementRate(120, 0)).toBeNull();
    expect(computeEngagementRate(120, null)).toBeNull();
    expect(computeEngagementRate(null, 1000)).toBeNull();
    expect(computeEngagementRate(undefined, 1000)).toBeNull();
  });

  it("engagements negatif = null", () => {
    expect(computeEngagementRate(-5, 1000)).toBeNull();
  });
});

describe("computePublishingAdherence (ADR-0013 §3, toleransi ±15 menit)", () => {
  const job = (scheduled_at: string | null, status: string) => ({
    placement_id: "p1",
    scheduled_at,
    status,
  });
  const post = (published_at: string) => ({ placement_id: "p1", published_at });

  it("tepat jadwal: published + post dalam ±15 menit", () => {
    const r = computePublishingAdherence(
      [job("2026-11-01T10:00:00Z", "published")],
      [post("2026-11-01T10:10:00Z")],
    );
    expect(r).toEqual({ publishedOnSchedule: 1, plannedEligible: 1, rate: 100 });
  });

  it("terlambat > 15 menit = tidak sesuai jadwal", () => {
    const r = computePublishingAdherence(
      [job("2026-11-01T10:00:00Z", "published")],
      [post("2026-11-01T10:16:00Z")],
    );
    expect(r.publishedOnSchedule).toBe(0);
    expect(r.plannedEligible).toBe(1);
    expect(r.rate).toBe(0);
  });

  it("job cancelled tidak eligible; job tanpa post tidak sesuai jadwal", () => {
    const r = computePublishingAdherence(
      [
        { placement_id: "p1", scheduled_at: "2026-11-01T10:00:00Z", status: "cancelled" },
        { placement_id: "p2", scheduled_at: "2026-11-01T11:00:00Z", status: "published" },
        { placement_id: "p3", scheduled_at: null, status: "ready" },
      ],
      [post("2026-11-01T10:00:00Z")],
    );
    expect(r.plannedEligible).toBe(1);
    expect(r.publishedOnSchedule).toBe(0);
    expect(r.rate).toBe(0);
  });

  it("tanpa job eligible = rate null", () => {
    expect(computePublishingAdherence([], [])).toEqual({
      publishedOnSchedule: 0,
      plannedEligible: 0,
      rate: null,
    });
  });
});

describe("aggregateLatestWins (impor ulang menimpa)", () => {
  const row = (over: Record<string, unknown>) => ({
    subject_type: "placement",
    subject_id: "c1",
    metric_key: "reach",
    value: 1000,
    period_start: "2026-11-01",
    period_end: "2026-11-30",
    retrieved_at: "2026-12-01T10:00:00Z",
    ...over,
  });

  it("snapshot terbaru menang untuk slice yang sama", () => {
    const totals = aggregateLatestWins([
      row({ value: 1000, retrieved_at: "2026-12-01T10:00:00Z" }),
      row({ value: 1500, retrieved_at: "2026-12-02T10:00:00Z" }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0].value).toBe(1500);
    expect(totals[0].sources).toBe(1);
  });

  it("periode berbeda dijumlahkan terpisah (bukan ditimpa)", () => {
    const totals = aggregateLatestWins([
      row({ value: 1000, period_start: "2026-11-01", period_end: "2026-11-30" }),
      row({ value: 3000, period_start: "2026-10-01", period_end: "2026-10-31" }),
    ]);
    expect(totals[0].value).toBe(4000);
    expect(totals[0].sources).toBe(2);
  });

  it("subject berbeda dijumlahkan; kunci berbeda jadi baris sendiri", () => {
    const totals = aggregateLatestWins([
      row({ subject_id: "c1", metric_key: "reach", value: 1000 }),
      row({ subject_id: "c2", metric_key: "reach", value: 500 }),
      row({ subject_id: "c1", metric_key: "engagements", value: 120 }),
    ]);
    expect(totals.find((t) => t.metric_key === "reach")?.value).toBe(1500);
    expect(totals.find((t) => t.metric_key === "engagements")?.value).toBe(120);
  });
});

describe("sumByMetric", () => {
  it("menjumlahkan per kunci", () => {
    const m = sumByMetric([
      { metric_key: "reach", value: 100 },
      { metric_key: "reach", value: 50 },
      { metric_key: "likes", value: 7 },
    ]);
    expect(m.get("reach")).toBe(150);
    expect(m.get("likes")).toBe(7);
  });
});

describe("angka operasional ASUMSI-7D", () => {
  it("backoff 1 → 60, 2 → 300, 3+ → 900 (cermin SQL 0021)", () => {
    expect(integrationBackoffSeconds(1)).toBe(60);
    expect(integrationBackoffSeconds(2)).toBe(300);
    expect(integrationBackoffSeconds(3)).toBe(900);
    expect(integrationBackoffSeconds(9)).toBe(900);
  });

  it("TTL snapshot 24 jam", () => {
    const now = new Date("2026-12-02T10:00:00Z");
    expect(isSnapshotStale("2026-12-02T09:00:00Z", now)).toBe(false);
    expect(isSnapshotStale("2026-12-01T10:00:00Z", now)).toBe(false); // tepat 24 jam
    expect(isSnapshotStale("2026-12-01T09:59:59Z", now)).toBe(true); // 24 jam + 1 detik
    expect(isSnapshotStale("bukan-tanggal", now)).toBe(true);
  });
});

describe("defaultDateRange (30 hari, zona workspace)", () => {
  it("20 Nov 2026 10:00 UTC = 17:00 WIB → akhir 2026-11-20, awal 2026-10-22", () => {
    const r = defaultDateRange("Asia/Jakarta", new Date("2026-11-20T10:00:00Z"));
    expect(r).toEqual({ start: "2026-10-22", end: "2026-11-20" });
  });
});

describe("formatMetricValue (id-ID)", () => {
  it("hitungan bulat pakai pemisah ribuan; persen 2 desimal", () => {
    expect(formatMetricValue(1500, "akun")).toBe("1.500");
    expect(formatMetricValue(12, "persen")).toBe("12,00");
    expect(formatMetricValue(8.5, "persen")).toBe("8,50");
  });
});

describe("analyticsDataStatus", () => {
  it("0 snapshot = not_connected; sebagian = partial; penuh = complete", () => {
    expect(analyticsDataStatus(0, 0, 5)).toBe("not_connected");
    expect(analyticsDataStatus(2, 3, 5)).toBe("partial");
    expect(analyticsDataStatus(2, 5, 5)).toBe("complete");
    expect(analyticsDataStatus(1, 0, 0)).toBe("complete");
  });
});

describe("CSV analytics (ASUMSI-7E)", () => {
  const validRow = {
    date: "2026-11-15",
    platform: "instagram",
    account: "@akun-contoh",
    subject_type: "placement",
    subject_ref: "11111111-1111-1111-1111-111111111111",
    metric_key: "reach",
    value: "1000",
    unit: "akun",
    source_notes: "laporan IG Nov",
  };

  it("template: header kanonis + 2 baris contoh", () => {
    const csv = buildAnalyticsTemplateCsv();
    const firstLine = csv.split("\r\n")[0];
    expect(firstLine).toBe([...ANALYTICS_CSV_COLUMNS].join(","));
    expect(csv).toContain("11111111-1111-1111-1111-111111111111");
  });

  it("parse: header lengkap lolos; header hilang dilaporkan", () => {
    const full = parseAnalyticsCsv(buildAnalyticsTemplateCsv());
    expect(full.headersOk).toBe(true);
    expect(full.rows).toHaveLength(2);
    const short = parseAnalyticsCsv("date,metric_key\n2026-11-15,reach\n");
    expect(short.headersOk).toBe(false);
    expect(short.missingColumns).toContain("subject_ref");
  });

  it("baris valid lolos + source_notes digabung label platform/akun", () => {
    const r = validateAnalyticsCsvRow(validRow, "2026-11-01", "2026-11-30", 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.value).toBe(1000);
      expect(r.data.sourceNotes).toBe("instagram/@akun-contoh — laporan IG Nov");
    }
  });

  it("metrik turunan ditolak; kunci tak dikenal ditolak; unit salah ditolak", () => {
    expect(
      validateAnalyticsCsvRow({ ...validRow, metric_key: "engagement_rate", unit: "persen" }, "2026-11-01", "2026-11-30", 2),
    ).toMatchObject({ ok: false, error: expect.stringContaining("turunan") });
    expect(
      validateAnalyticsCsvRow({ ...validRow, metric_key: "foobar" }, "2026-11-01", "2026-11-30", 2),
    ).toMatchObject({ ok: false });
    expect(
      validateAnalyticsCsvRow({ ...validRow, unit: "tayangan" }, "2026-11-01", "2026-11-30", 2),
    ).toMatchObject({ ok: false, error: expect.stringContaining("'akun'") });
  });

  it("nilai negatif / bukan angka / tanggal di luar periode / subject_ref bukan UUID ditolak", () => {
    expect(
      validateAnalyticsCsvRow({ ...validRow, value: "-5" }, "2026-11-01", "2026-11-30", 2),
    ).toMatchObject({ ok: false });
    expect(
      validateAnalyticsCsvRow({ ...validRow, value: "abc" }, "2026-11-01", "2026-11-30", 2),
    ).toMatchObject({ ok: false });
    expect(
      validateAnalyticsCsvRow({ ...validRow, date: "2026-10-15" }, "2026-11-01", "2026-11-30", 2),
    ).toMatchObject({ ok: false, error: expect.stringContaining("di luar periode") });
    expect(
      validateAnalyticsCsvRow({ ...validRow, subject_ref: "bukan-uuid" }, "2026-11-01", "2026-11-30", 2),
    ).toMatchObject({ ok: false });
  });

  it("duplikat dalam satu file ditolak dengan nomor baris", () => {
    const parsed = parseAnalyticsCsv(
      [
        [...ANALYTICS_CSV_COLUMNS].join(","),
        "2026-11-15,instagram,,placement,11111111-1111-1111-1111-111111111111,reach,1000,akun,",
        "2026-11-16,instagram,,placement,11111111-1111-1111-1111-111111111111,reach,2000,akun,",
      ].join("\n"),
    );
    const r = validateAnalyticsCsvFile(parsed, "2026-11-01", "2026-11-30");
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Baris 3: duplikat") });
  });

  it("file kosong dan > 500 baris ditolak", () => {
    const empty = parseAnalyticsCsv([...ANALYTICS_CSV_COLUMNS].join(",") + "\n");
    expect(validateAnalyticsCsvFile(empty, "2026-11-01", "2026-11-30")).toMatchObject({
      ok: false,
    });
  });
});

describe("katalog 14 kunci — paritas dengan seed 0021", () => {
  const seed = readFileSync(
    path.resolve(__dirname, "../supabase/migrations/0021_analytics_foundation.sql"),
    "utf8",
  );

  it("tepat 14 kunci: 12 impor + 2 turunan", () => {
    expect(METRIC_DEFINITIONS).toHaveLength(14);
    expect(IMPORTABLE_METRIC_KEYS).toHaveLength(12);
    expect(DERIVED_METRIC_KEYS).toEqual(["engagement_rate", "publishing_adherence"]);
    expect(new Set(METRIC_DEFINITIONS.map((d) => d.key)).size).toBe(14);
  });

  it("setiap entri katalog sama persis dengan seed (kunci, label, unit, formula, turunan)", () => {
    for (const d of METRIC_DEFINITIONS) {
      expect(seed, `seed harus berisi kunci ${d.key}`).toContain(`'${d.key}'`);
      expect(seed, `seed harus berisi label ${d.label}`).toContain(`'${d.label}'`);
      expect(seed, `seed harus berisi unit ${d.unit} untuk ${d.key}`).toContain(`'${d.unit}'`);
      expect(seed, `seed harus berisi formula ${d.key}`).toContain(d.formula);
      // Baris seed kunci itu diakhiri boolean is_derived yang sama.
      const rowRe = new RegExp(`'${d.key}'[\\s\\S]{0,800}?,\\s*${d.isDerived}\\s*\\)`);
      expect(seed, `seed baris ${d.key} harus is_derived=${d.isDerived}`).toMatch(rowRe);
    }
  });
});

describe("parseAnalyticsParams", () => {
  it("from/to/brand valid dipakai; tidak valid → default 30 hari; brand bukan UUID → null", () => {
    const r = parseAnalyticsParams(
      { from: "2026-11-01", to: "2026-11-30", brand: "11111111-1111-1111-1111-111111111111" },
      "Asia/Jakarta",
    );
    expect(r).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
      brandId: "11111111-1111-1111-1111-111111111111",
    });
    const bad = parseAnalyticsParams(
      { from: "2026-11-30", to: "2026-11-01", brand: "bukan-uuid" },
      "Asia/Jakarta",
    );
    expect(bad.from <= bad.to).toBe(true);
    expect(bad.brandId).toBeNull();
  });
});
