/**
 * Pemetaan CSV campaign — features/campaign/csv.ts (P5-07, ADR-0011 §8).
 * Format tetap (ASUMSI-5.6): name, objective, audience_name, start_at,
 * end_at, status, owner_email, target_deliverables, target_date, notes,
 * brands, deliverables. Validasi format di sini (murni, tanpa DB);
 * resolusi nama → UUID (brand/audience/deliverable/owner) di actions.ts.
 */
import { parseCsv, serializeCsvRow } from "@/lib/csv";
import { CAMPAIGN_CSV_COLUMNS, CAMPAIGN_STATUSES } from "./constants";

export type CampaignExportRow = {
  name: string;
  objective: string;
  audienceName: string;
  startAt: string;
  endAt: string;
  status: string;
  ownerEmail: string;
  targetDeliverables: string;
  targetDate: string;
  notes: string;
  brands: string;
  deliverables: string;
};

export function exportCampaignsCsv(rows: CampaignExportRow[]): string {
  const lines = [serializeCsvRow([...CAMPAIGN_CSV_COLUMNS])];
  for (const r of rows) {
    lines.push(
      serializeCsvRow([
        r.name,
        r.objective,
        r.audienceName,
        r.startAt,
        r.endAt,
        r.status,
        r.ownerEmail,
        r.targetDeliverables,
        r.targetDate,
        r.notes,
        r.brands,
        r.deliverables,
      ]),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export type ValidatedCampaignCsvRow = {
  name: string;
  objective: string;
  audienceName: string;
  startAt: string;
  endAt: string;
  status: string;
  ownerEmail: string;
  targetDeliverables: number | null;
  targetDate: string;
  notes: string;
  brandNames: string[];
  deliverableTitles: string[];
};

function parseCsvDate(
  value: string,
  field: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const v = value.trim();
  if (v === "") return { ok: true, value: "" };
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(v);
  if (!dateOnly && !dateTime) {
    return { ok: false, error: `${field} harus tanggal YYYY-MM-DD atau datetime ISO.` };
  }
  const d = new Date(dateOnly ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: `${field} bukan tanggal yang valid.` };
  }
  return { ok: true, value: dateOnly ? `${v}T00:00:00Z` : d.toISOString() };
}

function splitList(value: string): string[] {
  return value
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/** Validasi satu baris (format saja). Pesan TIDAK memakai prefix "Baris N:"
 * — nomor baris ditambahkan pemanggil (actions/UI) agar tidak ganda. */
export function validateCampaignCsvRow(
  row: Record<string, string>,
): { ok: true; data: ValidatedCampaignCsvRow } | { ok: false; error: string } {
  const fail = (message: string) => ({ ok: false as const, error: message });
  const name = (row.name ?? "").trim();
  if (name.length < 2) return fail("name wajib diisi (minimal 2 karakter).");
  if (name.length > 120) return fail("name maksimal 120 karakter.");
  const objective = (row.objective ?? "").trim();
  if (objective.length > 500) return fail("objective maksimal 500 karakter.");
  const status = (row.status ?? "").trim() === "" ? "draft" : (row.status ?? "").trim();
  if (!(CAMPAIGN_STATUSES as readonly string[]).includes(status)) {
    return fail(`status '${status}' tidak dikenal (draft/active/completed/archived/cancelled).`);
  }
  const start = parseCsvDate(row.start_at ?? "", "start_at");
  if (!start.ok) return fail(start.error);
  const end = parseCsvDate(row.end_at ?? "", "end_at");
  if (!end.ok) return fail(end.error);
  if (start.value !== "" && end.value !== "" && new Date(start.value) > new Date(end.value)) {
    return fail("start_at tidak boleh sesudah end_at.");
  }
  let targetDeliverables: number | null = null;
  const tdRaw = (row.target_deliverables ?? "").trim();
  if (tdRaw !== "") {
    const n = Number(tdRaw);
    if (!Number.isInteger(n) || n < 0) {
      return fail("target_deliverables harus bilangan bulat ≥ 0.");
    }
    targetDeliverables = n;
  }
  const targetDate = (row.target_date ?? "").trim();
  if (targetDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return fail("target_date harus format YYYY-MM-DD.");
  }
  const notes = (row.notes ?? "").trim();
  if (notes.length > 500) return fail("notes maksimal 500 karakter.");
  return {
    ok: true,
    data: {
      name,
      objective,
      audienceName: (row.audience_name ?? "").trim(),
      startAt: start.value,
      endAt: end.value,
      status,
      ownerEmail: (row.owner_email ?? "").trim().toLowerCase(),
      targetDeliverables,
      targetDate,
      notes,
      brandNames: splitList(row.brands ?? ""),
      deliverableTitles: splitList(row.deliverables ?? ""),
    },
  };
}

export type ParsedCampaignCsv = {
  /** Header lengkap dan sesuai urutan kanonis. */
  headersOk: boolean;
  missingColumns: string[];
  rows: Array<Record<string, string>>;
  rowNumbers: number[];
};

export function parseCampaignCsv(text: string): ParsedCampaignCsv {
  const { headers, rows, rowNumbers } = parseCsv(text);
  const missingColumns = CAMPAIGN_CSV_COLUMNS.filter((c) => !headers.includes(c));
  const data: Array<Record<string, string>> = rows.map((values) => {
    const rec: Record<string, string> = {};
    CAMPAIGN_CSV_COLUMNS.forEach((col, i) => {
      rec[col] = values[i] ?? "";
    });
    return rec;
  });
  return { headersOk: missingColumns.length === 0, missingColumns, rows: data, rowNumbers };
}
