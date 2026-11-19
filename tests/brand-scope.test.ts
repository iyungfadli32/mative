/**
 * Uji brand scope + pembacaan target_metrics toleran (P5-03).
 * brandInScope: lib/permissions.ts (P1-A7). parseTargetMetricsLenient:
 * lib/validation/schemas.ts — baris lama (peta metrik bebas) tetap tampil.
 */
import { describe, expect, it } from "vitest";
import { brandInScope } from "@/lib/permissions";
import { parseTargetMetricsLenient } from "@/lib/validation/schemas";

describe("brandInScope — null = semua brand, [] = tidak ada brand", () => {
  const brand = "11111111-1111-4111-8111-111111111111";
  it("scope null melihat semua brand", () => {
    expect(brandInScope(null, brand)).toBe(true);
  });
  it("array berisi brand → terlihat; tidak berisi → tidak terlihat", () => {
    expect(brandInScope([brand], brand)).toBe(true);
    expect(brandInScope(["22222222-2222-4222-8222-222222222222"], brand)).toBe(false);
  });
  it("array kosong = tidak ada brand", () => {
    expect(brandInScope([], brand)).toBe(false);
  });
  it("baris tanpa brand (null) selalu terlihat semua member", () => {
    expect(brandInScope([], null)).toBe(true);
    expect(brandInScope([], undefined)).toBe(true);
  });
});

describe("parseTargetMetricsLenient — baca toleran baris lama", () => {
  it("bentuk 3 field valid dibaca apa adanya", () => {
    expect(
      parseTargetMetricsLenient({
        target_deliverables: 10,
        target_date: "2026-12-31",
        notes: "Q4",
      }),
    ).toEqual({ target_deliverables: 10, target_date: "2026-12-31", notes: "Q4" });
  });
  it("peta metrik lama ({reach: 10000}) dibaca sebagai kosong (tidak crash)", () => {
    expect(parseTargetMetricsLenient({ reach: 10000, leads: 50 })).toEqual({});
  });
  it("nilai tidak valid dibuang per field (yang valid tetap dibaca)", () => {
    expect(
      parseTargetMetricsLenient({
        target_deliverables: -1,
        target_date: "31-12-2026",
        notes: "ok",
      }),
    ).toEqual({ notes: "ok" });
    expect(parseTargetMetricsLenient({ target_deliverables: 2.5 })).toEqual({});
  });
  it("non-objek dibaca sebagai kosong", () => {
    expect(parseTargetMetricsLenient(null)).toEqual({});
    expect(parseTargetMetricsLenient("reach")).toEqual({});
    expect(parseTargetMetricsLenient([])).toEqual({});
  });
  it("notes dipotong 500 karakter", () => {
    expect(parseTargetMetricsLenient({ notes: "x".repeat(600) }).notes?.length).toBe(500);
  });
});
