import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  formatAge,
  formatDateOnly,
  formatInTimezone,
  isValidTimezone,
  nowUtcIso,
} from "@/lib/time";

describe("Waktu — UTC disimpan, Asia/Jakarta dirender (Keputusan #13)", () => {
  it("timezone default adalah Asia/Jakarta", () => {
    expect(DEFAULT_TIMEZONE).toBe("Asia/Jakarta");
  });

  it("formatInTimezone menggeser UTC +7 jam ke WIB", () => {
    // 2026-11-19T00:00:00Z = 19 Nov 2026 07:00 WIB.
    const out = formatInTimezone("2026-11-19T00:00:00.000Z", "Asia/Jakarta", "id-ID");
    expect(out).toContain("19 Nov 2026");
    expect(out).toContain("07.00");
  });

  it("formatDateOnly memakai nama hari/bulan Indonesia", () => {
    const out = formatDateOnly("2026-11-19T00:00:00.000Z", "Asia/Jakarta", "id-ID");
    expect(out).toContain("Kamis");
    expect(out).toContain("19 November 2026");
  });

  it("tanggal tidak valid tidak melempar, memberi pesan", () => {
    expect(formatInTimezone("bukan-tanggal")).toBe("tanggal tidak valid");
  });

  it("isValidTimezone menolak zona waktu karangan", () => {
    expect(isValidTimezone("Asia/Jakarta")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });

  it("nowUtcIso berakhiran Z (UTC)", () => {
    expect(nowUtcIso()).toMatch(/Z$/);
  });

  it("formatAge memakai Bahasa Indonesia relatif (panel Antrean persetujuan)", () => {
    const now = new Date("2026-11-20T10:00:00.000Z");
    expect(formatAge("2026-11-20T09:59:30.000Z", now)).toBe("baru saja");
    expect(formatAge("2026-11-20T09:45:00.000Z", now)).toBe("15 menit lalu");
    expect(formatAge("2026-11-20T07:00:00.000Z", now)).toBe("3 jam lalu");
    expect(formatAge("2026-11-18T10:00:00.000Z", now)).toBe("2 hari lalu");
    // Di atas 30 hari tampil tanggal saja (bukan "45 hari lalu").
    expect(formatAge("2026-10-01T10:00:00.000Z", now)).toContain("Oktober 2026");
    expect(formatAge("bukan-tanggal", now)).toBe("tanggal tidak valid");
  });
});
