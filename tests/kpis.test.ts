import { describe, expect, it } from "vitest";
import { buildKpis, EMPTY_KPIS } from "@/features/dashboard/kpis";

describe("KPI dashboard — hanya dari record nyata (Keputusan #6)", () => {
  it("EMPTY_KPIS semuanya 0 dan hasData false (Phase 1: belum ada tabel content)", () => {
    expect(EMPTY_KPIS).toEqual({
      planned: 0,
      inProduction: 0,
      awaitingApproval: 0,
      scheduled: 0,
      published: 0,
      hasData: false,
    });
  });

  it("buildKpis menghitung hasData dari jumlah record nyata", () => {
    expect(buildKpis({}).hasData).toBe(false);
    const k = buildKpis({ planned: 3, scheduled: 1 });
    expect(k.planned).toBe(3);
    expect(k.scheduled).toBe(1);
    expect(k.published).toBe(0);
    expect(k.hasData).toBe(true);
  });
});
