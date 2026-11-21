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

describe("K-3 — keputusan scope saat buat konten & konversi ide (audit (b) K-3)", () => {
  // createContentAction / convertIdeaAction mendelegasikan keputusan
  // "boleh pakai brand ini?" ke brandInScope — predikat yang sama yang
  // dipakai createCampaignAction. Uji di sini memastikan keputusan itu
  // benar untuk tiap bentuk scope; penegakan di dalam RPC (migrasi 0026)
  // memakai helper SQL brand_in_scope (0016) yang semantiknya sama dan
  // diuji di pgTAP (supabase/tests/05_rls_phase5.sql).
  const brandA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const brandB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  it("anggota scope [Brand A] boleh membuat konten untuk Brand A", () => {
    expect(brandInScope([brandA], brandA)).toBe(true);
  });
  it("anggota scope [Brand A] TIDAK boleh membuat konten untuk Brand B", () => {
    expect(brandInScope([brandA], brandB)).toBe(false);
  });
  it("anggota tanpa batas (scope null) boleh untuk brand mana pun", () => {
    expect(brandInScope(null, brandA)).toBe(true);
    expect(brandInScope(null, brandB)).toBe(true);
  });
  it("anggota scope kosong [] tidak boleh membuat konten untuk brand apa pun", () => {
    expect(brandInScope([], brandA)).toBe(false);
    expect(brandInScope([], brandB)).toBe(false);
  });
  it("konversi ide: cek scope berlaku pada brand EFEKTIF (p_brand_id mengalahkan brand ide)", () => {
    // Ide ber-brand A dikonversi dengan p_brand_id = Brand B → yang
    // diperiksa adalah Brand B, bukan Brand A.
    expect(brandInScope([brandA], brandB)).toBe(false);
    expect(brandInScope([brandA, brandB], brandB)).toBe(true);
  });
  it("konversi ide tanpa brand (efektif null) tidak ditolak di lapis scope — RPC menolak bersih", () => {
    // brandId null selalu lolos brandInScope (tidak ada brand untuk
    // diperiksa); penolakan "Ide ini belum punya brand" datang dari RPC.
    expect(brandInScope([brandA], null)).toBe(true);
    expect(brandInScope([], null)).toBe(true);
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
