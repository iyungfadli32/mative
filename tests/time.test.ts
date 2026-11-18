import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
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
});
