/**
 * Pemetaan CSV analytics — features/analytics/csv.ts (P7-03, ADR-0013 §6).
 * Format tetap (ASUMSI-7E): date, platform, account, subject_type,
 * subject_ref, metric_key, value, unit, source_notes.
 *
 * Aturan yang ditegakkan di sini (murni, tanpa DB — RPC 0021 menegakkan
 * ulang di server; pesan di sini membantu sebelum kirim):
 * - date wajib YYYY-MM-DD dan di dalam periode impor (satu CSV = satu
 *   snapshot = satu periode; tanggal per baris bersifat informatif).
 * - platform/account hanya LABEL sumber (bukan klaim integrasi) — digabung
 *   ke source_notes agar provenance tidak hilang.
 * - subject_ref wajib UUID (ID placement/content_item/published_post —
 *   lihat tabel referensi di halaman impor).
 * - metric_key wajib kunci impor (12); turunan ditolak (dihitung).
 * - unit wajib sama dengan unit kanonis kunci itu.
 * - value wajib angka ≥ 0 (regex sama dengan RPC: ^[0-9]+(\.[0-9]+)?$), KECUALI
 *   followers_net_change yang boleh negatif (mis. -5).
 * - Duplikat (subject + kunci) dalam satu file ditolak.
 */
import { parseCsv, serializeCsvRow } from "@/lib/csv";
import {
  ANALYTICS_CSV_COLUMNS,
  ANALYTICS_SUBJECT_TYPES,
  canonicalUnitForKey,
  isDerivedMetricKey,
  isMetricKey,
} from "./constants";

export type ValidatedAnalyticsCsvRow = {
  /** Nomor baris file CSV (1-based, header = 1) — untuk pesan galat. */
  rowNumber: number;
  date: string;
  platform: string;
  account: string;
  subjectType: "placement" | "content_item" | "published_post";
  subjectRef: string;
  metricKey: string;
  value: number;
  unit: string;
  /** source_notes gabungan: label platform/akun + catatan asli. */
  sourceNotes: string;
};

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const VALUE_RE = /^[0-9]+(\.[0-9]+)?$/;
const NEGATIVE_VALUE_RE = /^-?[0-9]+(\.[0-9]+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Gabung label sumber ke source_notes (provenance, bukan klaim integrasi). */
export function buildSourceNotes(platform: string, account: string, notes: string): string {
  const label = [platform, account].filter((v) => v !== "").join("/");
  if (!label) return notes;
  return notes ? `${label} — ${notes}` : label;
}

/** Validasi satu baris (format saja). Nomor baris ditambahkan pemanggil. */
export function validateAnalyticsCsvRow(
  row: Record<string, string>,
  periodStart: string,
  periodEnd: string,
  rowNumber: number,
): { ok: true; data: ValidatedAnalyticsCsvRow } | { ok: false; error: string } {
  const fail = (message: string) => ({ ok: false as const, error: message });
  const date = (row.date ?? "").trim();
  if (!DATE_RE.test(date)) return fail("date harus format YYYY-MM-DD.");
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return fail("date bukan tanggal yang valid.");
  if (date < periodStart || date > periodEnd) {
    return fail(`date ${date} di luar periode impor (${periodStart} s.d. ${periodEnd}).`);
  }
  const platform = (row.platform ?? "").trim();
  if (platform.length > 64) return fail("platform maksimal 64 karakter.");
  const account = (row.account ?? "").trim();
  if (account.length > 120) return fail("account maksimal 120 karakter.");
  const subjectType = (row.subject_type ?? "").trim();
  if (
    !(ANALYTICS_SUBJECT_TYPES as readonly string[]).includes(subjectType)
  ) {
    return fail(
      `subject_type '${subjectType}' tidak dikenal (placement/content_item/published_post).`,
    );
  }
  const subjectRef = (row.subject_ref ?? "").trim();
  if (!UUID_RE.test(subjectRef)) {
    return fail("subject_ref harus UUID ID placement/konten/postingan (lihat tabel referensi).");
  }
  const metricKey = (row.metric_key ?? "").trim();
  if (isDerivedMetricKey(metricKey)) {
    return fail(`metric_key '${metricKey}' adalah metrik turunan — dihitung, bukan diimpor.`);
  }
  if (!isMetricKey(metricKey)) {
    return fail(`metric_key '${metricKey}' tidak dikenal (lihat katalog 14 kunci).`);
  }
  const valueRaw = (row.value ?? "").trim();
  const valueRe = metricKey === "followers_net_change" ? NEGATIVE_VALUE_RE : VALUE_RE;
  if (!valueRe.test(valueRaw)) {
    return fail(
      metricKey === "followers_net_change"
        ? "value harus angka (boleh negatif, mis. -5)."
        : "value harus angka ≥ 0 (mis. 1000 atau 12.5).",
    );
  }
  const value = Number(valueRaw);
  if (!Number.isFinite(value) || (value < 0 && metricKey !== "followers_net_change")) {
    return fail("value harus angka ≥ 0.");
  }
  const unit = (row.unit ?? "").trim();
  const canonical = canonicalUnitForKey(metricKey);
  if (unit !== canonical) {
    return fail(`unit untuk '${metricKey}' harus '${canonical}' (bukan '${unit}').`);
  }
  const sourceNotesRaw = (row.source_notes ?? "").trim();
  if (sourceNotesRaw.length > 500) return fail("source_notes maksimal 500 karakter.");
  // ASUMSI-7C: video_views/conversions hanya bermakna bila ambang/window
  // attribution-nya dicatat — tanpa itu nilainya tidak ditampilkan.
  if (
    (metricKey === "video_views" || metricKey === "conversions") &&
    sourceNotesRaw === ""
  ) {
    return fail(
      `metric_key '${metricKey}' wajib menyebut ambang/window attribution di source_notes.`,
    );
  }
  return {
    ok: true,
    data: {
      rowNumber,
      date,
      platform,
      account,
      subjectType: subjectType as ValidatedAnalyticsCsvRow["subjectType"],
      subjectRef,
      metricKey,
      value,
      unit,
      sourceNotes: buildSourceNotes(platform, account, sourceNotesRaw),
    },
  };
}

export type ParsedAnalyticsCsv = {
  /** Header lengkap dan sesuai urutan kanonis. */
  headersOk: boolean;
  missingColumns: string[];
  rows: Array<Record<string, string>>;
  rowNumbers: number[];
};

export function parseAnalyticsCsv(text: string): ParsedAnalyticsCsv {
  const { headers, rows, rowNumbers } = parseCsv(text);
  const missingColumns = [...ANALYTICS_CSV_COLUMNS].filter((c) => !headers.includes(c));
  const data: Array<Record<string, string>> = rows.map((values) => {
    const rec: Record<string, string> = {};
    ANALYTICS_CSV_COLUMNS.forEach((col, i) => {
      rec[col] = values[i] ?? "";
    });
    return rec;
  });
  return { headersOk: missingColumns.length === 0, missingColumns, rows: data, rowNumbers };
}

/**
 * Validasi SELURUH file: format per baris + duplikat dalam file.
 * Mengembalikan baris tervalidasi (siap kirim ke RPC) atau satu pesan
 * galat dengan nomor baris file.
 */
export function validateAnalyticsCsvFile(
  parsed: ParsedAnalyticsCsv,
  periodStart: string,
  periodEnd: string,
): { ok: true; data: ValidatedAnalyticsCsvRow[] } | { ok: false; error: string } {
  if (!parsed.headersOk) {
    return {
      ok: false,
      error: `Header CSV tidak lengkap — kolom hilang: ${parsed.missingColumns.join(", ")}. Unduh template dulu.`,
    };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, error: "CSV tidak berisi baris data." };
  }
  if (parsed.rows.length > 500) {
    return { ok: false, error: "CSV maksimal 500 baris per impor." };
  }
  const seen = new Map<string, number>();
  const data: ValidatedAnalyticsCsvRow[] = [];
  for (let i = 0; i < parsed.rows.length; i++) {
    const rowNumber = parsed.rowNumbers[i] ?? i + 2;
    const result = validateAnalyticsCsvRow(parsed.rows[i], periodStart, periodEnd, rowNumber);
    if (!result.ok) {
      return { ok: false, error: `Baris ${rowNumber}: ${result.error}` };
    }
    const dupKey = `${result.data.subjectType}|${result.data.subjectRef}|${result.data.metricKey}`;
    const prev = seen.get(dupKey);
    if (prev !== undefined) {
      return {
        ok: false,
        error: `Baris ${rowNumber}: duplikat (subject + metric_key) dengan baris ${prev} dalam file yang sama — impor ulang slice yang sama dilakukan lewat impor baru, bukan dua baris sekaligus.`,
      };
    }
    seen.set(dupKey, rowNumber);
    data.push(result.data);
  }
  return { ok: true, data };
}

/** Template CSV impor (header + 2 baris contoh — ganti subject_ref dengan ID asli). */
export function buildAnalyticsTemplateCsv(): string {
  const lines = [serializeCsvRow([...ANALYTICS_CSV_COLUMNS])];
  lines.push(
    serializeCsvRow([
      "2026-11-15",
      "instagram",
      "@akun-contoh",
      "placement",
      "11111111-1111-1111-1111-111111111111",
      "reach",
      "1000",
      "akun",
      "laporan IG Nov",
    ]),
  );
  lines.push(
    serializeCsvRow([
      "2026-11-15",
      "instagram",
      "@akun-contoh",
      "placement",
      "11111111-1111-1111-1111-111111111111",
      "engagements",
      "120",
      "interaksi",
      "",
    ]),
  );
  return lines.join("\r\n") + "\r\n";
}

/** Serializer CSV untuk ekspor laporan (header + baris). */
export function exportReportCsv(columns: string[], rows: string[][]): string {
  const lines = [serializeCsvRow(columns)];
  for (const row of rows) lines.push(serializeCsvRow(row));
  return lines.join("\r\n") + "\r\n";
}
