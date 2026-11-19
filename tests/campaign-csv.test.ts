/**
 * Uji CSV — lib/csv.ts (parser RFC 4180) + features/campaign/csv.ts
 * (format tetap ASUMSI-5.6 + validasi per baris, P5-07).
 */
import { describe, expect, it } from "vitest";
import { csvEscape, parseCsv, serializeCsvRow } from "@/lib/csv";
import {
  exportCampaignsCsv,
  parseCampaignCsv,
  validateCampaignCsvRow,
} from "@/features/campaign/csv";
import { CAMPAIGN_CSV_COLUMNS } from "@/features/campaign/constants";

describe("parseCsv — RFC 4180", () => {
  it("baris sederhana + CRLF", () => {
    const { headers, rows, rowNumbers } = parseCsv("a,b,c\r\n1,2,3\r\n4,5,6\r\n");
    expect(headers).toEqual(["a", "b", "c"]);
    expect(rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
    expect(rowNumbers).toEqual([2, 3]);
  });
  it("kutip ganda di dalam field + koma di dalam field + baris baru di dalam field", () => {
    const { rows } = parseCsv('a,b\r\n"halo, dunia","kutip ""dalam"""\r\n"baris\nbaru",x\r\n');
    expect(rows).toEqual([
      ["halo, dunia", 'kutip "dalam"'],
      ["baris\nbaru", "x"],
    ]);
  });
  it("field kosong + baris kosong di akhir diabaikan", () => {
    const { rows } = parseCsv("a,b\n1,\n\n");
    expect(rows).toEqual([["1", ""]]);
  });
});

describe("serializeCsvRow / csvEscape — kuote bila perlu", () => {
  it("tanpa karakter khusus: apa adanya; koma/kutip/baris baru: dikuote", () => {
    expect(serializeCsvRow(["a", "b,c", 'd"e', "f\ng"])).toBe('a,"b,c","d""e","f\ng"');
    expect(csvEscape("biasa")).toBe("biasa");
  });
});

describe("exportCampaignsCsv — header tetap + round-trip impor", () => {
  it("header = 12 kolom kanonis, urutan tetap", () => {
    const csv = exportCampaignsCsv([]);
    expect(csv.split("\r\n")[0]).toBe([...CAMPAIGN_CSV_COLUMNS].join(","));
  });
  it("hasil ekspor bisa diimpor kembali (parseCampaignCsv)", () => {
    const csv = exportCampaignsCsv([
      {
        name: "Launch, Q4",
        objective: 'Tujuan "besar"',
        audienceName: "Ibu muda",
        startAt: "2026-10-01T00:00:00Z",
        endAt: "",
        status: "draft",
        ownerEmail: "a@b.id",
        targetDeliverables: "10",
        targetDate: "2026-12-31",
        notes: "catatan\ndua baris",
        brands: "Brand A; Brand B",
        deliverables: "Konten 1; Konten 2",
      },
    ]);
    const parsed = parseCampaignCsv(csv);
    expect(parsed.headersOk).toBe(true);
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].name).toBe("Launch, Q4");
    expect(parsed.rows[0].objective).toBe('Tujuan "besar"');
    expect(parsed.rows[0].brands).toBe("Brand A; Brand B");
    expect(parsed.rows[0].notes).toBe("catatan\ndua baris");
  });
  it("header tidak lengkap terdeteksi + kolom yang hilang disebut", () => {
    const parsed = parseCampaignCsv("name,objective\nLaunch,x\n");
    expect(parsed.headersOk).toBe(false);
    expect(parsed.missingColumns).toContain("brands");
    expect(parsed.missingColumns).toContain("deliverables");
  });
});

describe("validateCampaignCsvRow — validasi per baris", () => {
  const validRow = (): Record<string, string> => ({
    name: "Launch Q4",
    objective: "Kenalan",
    audience_name: "Ibu muda",
    start_at: "2026-10-01",
    end_at: "2026-12-31",
    status: "draft",
    owner_email: "a@b.id",
    target_deliverables: "10",
    target_date: "2026-12-31",
    notes: "catatan",
    brands: "Brand A; Brand B",
    deliverables: "Konten 1; Konten 2",
  });

  it("baris valid lolos + daftar dipisah titik-koma", () => {
    const result = validateCampaignCsvRow(validRow(), 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Launch Q4");
      expect(result.data.brandNames).toEqual(["Brand A", "Brand B"]);
      expect(result.data.deliverableTitles).toEqual(["Konten 1", "Konten 2"]);
      expect(result.data.targetDeliverables).toBe(10);
      expect(result.data.startAt).toBe("2026-10-01T00:00:00Z");
    }
  });
  it("status kosong = draft; status tak dikenal ditolak", () => {
    const row = validRow();
    row.status = "";
    expect(validateCampaignCsvRow(row, 2).ok).toBe(true);
    row.status = "live";
    const bad = validateCampaignCsvRow(row, 2);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("Baris 2");
  });
  it("nama < 2 karakter, tanggal tidak valid, mulai > selesai ditolak", () => {
    expect(validateCampaignCsvRow({ ...validRow(), name: "A" }, 3).ok).toBe(false);
    expect(validateCampaignCsvRow({ ...validRow(), start_at: "01-10-2026" }, 3).ok).toBe(false);
    expect(
      validateCampaignCsvRow({ ...validRow(), start_at: "2026-12-31", end_at: "2026-10-01" }, 3)
        .ok,
    ).toBe(false);
  });
  it("target_deliverables negatif/pecahan dan target_date salah format ditolak", () => {
    expect(validateCampaignCsvRow({ ...validRow(), target_deliverables: "-1" }, 4).ok).toBe(false);
    expect(validateCampaignCsvRow({ ...validRow(), target_deliverables: "2.5" }, 4).ok).toBe(false);
    expect(validateCampaignCsvRow({ ...validRow(), target_date: "31-12-2026" }, 4).ok).toBe(false);
  });
  it("notes > 500 karakter ditolak", () => {
    expect(validateCampaignCsvRow({ ...validRow(), notes: "x".repeat(501) }, 5).ok).toBe(false);
  });
});
