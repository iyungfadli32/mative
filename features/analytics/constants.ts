/**
 * Konstanta domain Analytics — features/analytics/constants.ts (P7-03).
 * Sumber: ADR-0013 + ASUMSI-7B s.d. 7F + seed migrasi 0021.
 *
 * ATURAN KERAS: katalog 14 kunci di sini HARUS sama persis dengan seed
 * `supabase/migrations/0021_analytics_foundation.sql` (kunci, label,
 * unit, formula, grup, is_derived) — diuji paritas di
 * tests/analytics.test.ts. Bila Tuan menetapkan kunci baru, ubah seed
 * (migrasi baru) DAN katalog ini bersamaan.
 *
 * Adapter platform DISABLED (ASUMSI-7B): tidak ada platform yang
 * diklaim "didukung"; data hanya dari record nyata + impor manual/CSV
 * berlabel. Daftar platform + blocker ada di
 * features/integrations/constants.ts.
 */
import { DEFAULT_TIMEZONE } from "@/lib/time";

export type MetricKey =
  | "reach"
  | "impressions"
  | "views"
  | "video_views"
  | "engagements"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "clicks"
  | "followers_net_change"
  | "conversions"
  | "engagement_rate"
  | "publishing_adherence";

export type MetricDefinitionEntry = {
  key: MetricKey;
  label: string;
  unit: string;
  formula: string;
  notes: string;
  group: "audiens" | "interaksi" | "hasil" | "rasio" | "kepatuhan";
  isDerived: boolean;
};

/** 14 definisi metrik — salinan kanonis seed 0021 (sumber 'manual'). */
export const METRIC_DEFINITIONS: readonly MetricDefinitionEntry[] = [
  {
    key: "reach",
    label: "Reach",
    unit: "akun",
    formula:
      "Jumlah akun unik yang dijangkau (angka dari sumber impor); tidak sama dengan impressions.",
    notes: "Sumber: angka dari laporan platform yang diimpor. Bukan total pengikut.",
    group: "audiens",
    isDerived: false,
  },
  {
    key: "impressions",
    label: "Impressions",
    unit: "tayangan",
    formula:
      "Total tayangan yang ditampilkan (angka dari sumber impor); tidak sama dengan reach.",
    notes: "Satu akun bisa menyumbang banyak impressions.",
    group: "audiens",
    isDerived: false,
  },
  {
    key: "views",
    label: "Views",
    unit: "tayangan",
    formula:
      "Jumlah tayangan menurut arti penyedia pada sumber impor; arti persis dicatat di notes impor.",
    notes: 'Arti "view" berbeda per penyedia — jangan bandingkan antar sumber tanpa notes.',
    group: "audiens",
    isDerived: false,
  },
  {
    key: "video_views",
    label: "Video views",
    unit: "tayangan",
    formula:
      "Tayangan video menurut ambang/definisi penyedia pada sumber impor; bila ambang tidak diketahui, kunci ini tidak ditampilkan.",
    notes: "Wajib sebut ambang di source_notes bila nilai ini dipakai.",
    group: "audiens",
    isDerived: false,
  },
  {
    key: "engagements",
    label: "Engagements",
    unit: "interaksi",
    formula:
      "Jumlah interaksi yang didukung = likes + comments + shares + saves; hanya komponen yang tersedia yang dijumlahkan.",
    notes: "Komponen yang tidak tersedia tidak dihitung (bukan dianggap 0).",
    group: "interaksi",
    isDerived: false,
  },
  {
    key: "likes",
    label: "Likes",
    unit: "interaksi",
    formula: "Jumlah likes (angka dari sumber impor).",
    notes: "",
    group: "interaksi",
    isDerived: false,
  },
  {
    key: "comments",
    label: "Comments",
    unit: "interaksi",
    formula: "Jumlah komentar (angka dari sumber impor).",
    notes: "",
    group: "interaksi",
    isDerived: false,
  },
  {
    key: "shares",
    label: "Shares",
    unit: "interaksi",
    formula: "Jumlah dibagikan (angka dari sumber impor).",
    notes: "",
    group: "interaksi",
    isDerived: false,
  },
  {
    key: "saves",
    label: "Saves",
    unit: "interaksi",
    formula: "Jumlah disimpan (angka dari sumber impor).",
    notes: "",
    group: "interaksi",
    isDerived: false,
  },
  {
    key: "clicks",
    label: "Clicks",
    unit: "klik",
    formula:
      "Jumlah klik (tautan/profil/CTA); jenis klik dicatat di notes impor; tanpa jenis klik, nilai tidak dibandingkan antar sumber.",
    notes: "Sebut jenis klik di source_notes.",
    group: "interaksi",
    isDerived: false,
  },
  {
    key: "followers_net_change",
    label: "Perubahan pengikut (neto)",
    unit: "akun",
    formula: "Selisih pengikut selama periode (akhir - awal), bukan total pengikut.",
    notes: "Bukan total pengikut — selalu selisih.",
    group: "audiens",
    isDerived: false,
  },
  {
    key: "conversions",
    label: "Conversions",
    unit: "konversi",
    formula:
      "Hanya bila ada sumber attribution/event; window/model attribution dicatat di notes impor. Tanpa sumber attribution, kunci ini tidak ditampilkan.",
    notes: "Wajib sebut window/model attribution di source_notes bila nilai ini dipakai.",
    group: "hasil",
    isDerived: false,
  },
  {
    key: "engagement_rate",
    label: "Engagement rate",
    unit: "persen",
    formula:
      "engagements / reach x 100; hanya bila reach > 0 dan kedua komponen dari periode + sumber yang sama. DIHITUNG, bukan diimpor.",
    notes: "Turunan — RPC impor menolak kunci ini.",
    group: "rasio",
    isDerived: true,
  },
  {
    key: "publishing_adherence",
    label: "Kepatuhan jadwal terbit",
    unit: "persen",
    formula:
      "published sesuai jadwal / planned eligible content x 100; toleransi ±15 menit dari scheduled_at; dihitung dari publishing_jobs + published_posts nyata. DIHITUNG, bukan diimpor.",
    notes: "Turunan — RPC impor menolak kunci ini; dihitung di kode aplikasi.",
    group: "kepatuhan",
    isDerived: true,
  },
];

/** Kunci yang BOLEH diimpor (12) — turunan DIHITUNG, bukan diimpor. */
export const IMPORTABLE_METRIC_KEYS: readonly MetricKey[] = METRIC_DEFINITIONS.filter(
  (d) => !d.isDerived,
).map((d) => d.key);

/** Kunci turunan (2) — RPC impor menolaknya dengan INVALID_METRIC. */
export const DERIVED_METRIC_KEYS: readonly MetricKey[] = METRIC_DEFINITIONS.filter(
  (d) => d.isDerived,
).map((d) => d.key);

export const METRIC_UNIT_BY_KEY: Record<MetricKey, string> = Object.fromEntries(
  METRIC_DEFINITIONS.map((d) => [d.key, d.unit]),
) as Record<MetricKey, string>;

export const METRIC_LABEL_BY_KEY: Record<MetricKey, string> = Object.fromEntries(
  METRIC_DEFINITIONS.map((d) => [d.key, d.label]),
) as Record<MetricKey, string>;

export function isMetricKey(value: string): value is MetricKey {
  return (METRIC_DEFINITIONS as readonly MetricDefinitionEntry[]).some((d) => d.key === value);
}

export function isDerivedMetricKey(value: string): boolean {
  return (DERIVED_METRIC_KEYS as readonly string[]).includes(value);
}

export function canonicalUnitForKey(key: string): string | null {
  const def = METRIC_DEFINITIONS.find((d) => d.key === key);
  return def ? def.unit : null;
}

/** Kolom template CSV impor (ASUMSI-7E) — urutan kanonis, jangan diubah. */
export const ANALYTICS_CSV_COLUMNS = [
  "date",
  "platform",
  "account",
  "subject_type",
  "subject_ref",
  "metric_key",
  "value",
  "unit",
  "source_notes",
] as const;

export const ANALYTICS_CSV_FILENAME = "analytics-template.csv";

/** subject_type yang didukung impor (sama dengan CHECK 0021). */
export const ANALYTICS_SUBJECT_TYPES = ["placement", "content_item", "published_post"] as const;

export type AnalyticsSubjectType = (typeof ANALYTICS_SUBJECT_TYPES)[number];

/** Angka operasional (ASUMSI-7D, diputuskan ADR-0013 §5). */
export const ANALYTICS_MAX_RETRY = 3;
export const ANALYTICS_BACKOFF_SECONDS = [60, 300, 900] as const;
export const ANALYTICS_LEASE_MINUTES = 5;
export const ANALYTICS_SNAPSHOT_TTL_HOURS = 24;
export const ANALYTICS_PROVIDER_TIMEOUT_SECONDS = 30;
/** Toleransi kepatuhan jadwal: ±15 menit dari scheduled_at. */
export const ANALYTICS_ADHERENCE_TOLERANCE_MINUTES = 15;
/** Rentang default dashboard: 30 hari terakhir (termasuk hari ini). */
export const ANALYTICS_DEFAULT_RANGE_DAYS = 30;

/** Kode galat yang dikembalikan RPC 0021 (dipakai UI + API + tes). */
export const ANALYTICS_ERROR_CODES = [
  "FORBIDDEN",
  "INVALID_PERIOD",
  "INVALID_REFERENCE",
  "EMPTY_METRICS",
  "INVALID_ROW",
  "INVALID_SUBJECT",
  "INVALID_METRIC",
  "INVALID_UNIT",
  "DUPLICATE_METRIC",
] as const;

/** Status kelengkapan data dashboard. */
export type AnalyticsDataStatus = "not_connected" | "partial" | "complete";

export const ANALYTICS_DATA_STATUS_LABELS: Record<AnalyticsDataStatus, string> = {
  not_connected: "Belum terhubung",
  partial: "Data sebagian",
  complete: "Lengkap",
};

/** 5 laporan awal (v2 §7 langkah 7.12). */
export const ANALYTICS_REPORTS = [
  {
    id: "workspace",
    title: "Ringkasan workspace",
    description: "Total per metrik untuk periode ini + jumlah snapshot + terakhir diperbarui.",
  },
  {
    id: "brand-channel",
    title: "Per brand & channel",
    description: "Total reach, engagements, dan engagement rate per brand dan channel.",
  },
  {
    id: "campaign",
    title: "Laporan campaign",
    description: "Agregat per campaign dari campaign_metrics (dihitung ulang tiap impor).",
  },
  {
    id: "content",
    title: "Performa konten",
    description: "Per content item dan placement — urutan reach tertinggi.",
  },
  {
    id: "publishing",
    title: "Volume publishing + kepatuhan jadwal",
    description:
      "Jumlah job per status + kepatuhan jadwal terbit (±15 menit) dari publishing_jobs dan published_posts nyata.",
  },
] as const;

export type AnalyticsReportId = (typeof ANALYTICS_REPORTS)[number]["id"];

/** Zona waktu default bila workspace tidak punya (tidak pernah terjadi — kolom NOT NULL). */
export const ANALYTICS_DEFAULT_TIMEZONE = DEFAULT_TIMEZONE;

/** Pesan bila tabel Phase 7 belum tersedia di database live. */
export const ANALYTICS_TABLES_UNAVAILABLE_ID =
  "Tabel Analytics Foundation (migrasi 0021) belum diterapkan ke database ini — minta koordinator menjalankan docs/phase-7-report.md §8, lalu muat ulang halaman ini.";

/** Pesan penolakan viewer_client (v2 §8 — analytics tidak dibagikan ke klien). */
export const ANALYTICS_VIEWER_CLIENT_DENIED_ID =
  "Peran klien (viewer) tidak bisa melihat analytics — angka performa tidak pernah tampil ke klien tanpa dibagikan eksplisit.";
