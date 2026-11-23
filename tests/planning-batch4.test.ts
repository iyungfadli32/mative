import { describe, expect, it } from "vitest";

import { carrySearchParams } from "@/features/planning/search";
import {
  isValidProductionTransition,
  productionTransitionRequiresReason,
  validProductionTargets,
} from "@/features/planning/transitions";
import { withWorkspace } from "@/features/planning/workspace-url";
import { wallClockToUtcIso } from "@/features/publishing/utils";
import { campaignUpdateSchema, placementSchema } from "@/lib/validation/schemas";

const WS_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const CHANNEL_ID = "33333333-3333-4333-8333-333333333333";

describe("Batch 4 — konteks workspace (T-1/T-2)", () => {
  it("withWorkspace menambahkan ?workspace= bila belum ada", () => {
    expect(withWorkspace("/konten", WS_ID)).toBe(`/konten?workspace=${WS_ID}`);
  });
  it("withWorkspace menambahkan &workspace= bila sudah ada query", () => {
    expect(withWorkspace("/konten?status=idea", WS_ID)).toBe(
      `/konten?status=idea&workspace=${WS_ID}`,
    );
  });
  it("withWorkspace tidak menduplikasi workspace yang sudah ada", () => {
    expect(withWorkspace(`/konten?workspace=${WS_ID}`, "lain")).toBe(`/konten?workspace=${WS_ID}`);
  });
  it("withWorkspace membiarkan URL absolut dan anchor", () => {
    expect(withWorkspace("https://example.com/a", WS_ID)).toBe("https://example.com/a");
    expect(withWorkspace("#bagian", WS_ID)).toBe("#bagian");
  });
  it("withWorkspace membiarkan href bila workspace kosong", () => {
    expect(withWorkspace("/konten", null)).toBe("/konten");
    expect(withWorkspace("/konten", undefined)).toBe("/konten");
  });
});

describe("Batch 4 — status awal placement (T-3)", () => {
  const base = {
    workspaceId: WS_ID,
    contentItemId: ITEM_ID,
    socialChannelId: CHANNEL_ID,
    scheduledAt: "2026-12-01T09:00",
  };
  it("menolak distributionStatus published", () => {
    expect(placementSchema.safeParse({ ...base, distributionStatus: "published" }).success).toBe(
      false,
    );
  });
  it("menerima draft dan ready, default draft", () => {
    expect(placementSchema.safeParse({ ...base, distributionStatus: "ready" }).success).toBe(true);
    const parsed = placementSchema.safeParse({ ...base });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.distributionStatus).toBe("draft");
  });
  it("scheduledAt diteruskan mentah (wall-clock, bukan ISO-Z)", () => {
    const parsed = placementSchema.safeParse({ ...base, distributionStatus: "ready" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.scheduledAt).toBe("2026-12-01T09:00");
  });
});

describe("Batch 4 — wall-clock ke UTC (T-4)", () => {
  it("wall-clock Asia/Jakarta digeser ke UTC", () => {
    expect(wallClockToUtcIso("2026-12-01T09:00", "Asia/Jakarta")).toBe("2026-12-01T02:00:00.000Z");
  });
  it("ISO ber-offset dipakai sebagai instan absolut", () => {
    expect(wallClockToUtcIso("2026-12-01T09:00:00Z", "Asia/Jakarta")).toBe(
      "2026-12-01T09:00:00.000Z",
    );
    expect(wallClockToUtcIso("2026-12-01T09:00:00+07:00", "Asia/Jakarta")).toBe(
      "2026-12-01T02:00:00.000Z",
    );
  });
  it("kosong atau tidak valid menghasilkan null", () => {
    expect(wallClockToUtcIso("", "Asia/Jakarta")).toBeNull();
    expect(wallClockToUtcIso(null, "Asia/Jakarta")).toBeNull();
    expect(wallClockToUtcIso("bukan-tanggal", "Asia/Jakarta")).toBeNull();
  });
  it("skema campaign meneruskan startAt mentah (tanpa parse UTC)", () => {
    const parsed = campaignUpdateSchema.safeParse({
      campaignId: ITEM_ID,
      workspaceId: WS_ID,
      name: "Kampanye Uji",
      startAt: "2026-12-01T09:00",
      endAt: "2026-12-31T09:00",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.startAt).toBe("2026-12-01T09:00");
  });
});

describe("Batch 4 — arsip dari status apa pun (T-6)", () => {
  it("mengizinkan arsip dari idea, scripting, dan editing", () => {
    expect(isValidProductionTransition("idea", "archived")).toBe(true);
    expect(isValidProductionTransition("scripting", "archived")).toBe(true);
    expect(isValidProductionTransition("editing", "archived")).toBe(true);
  });
  it("tidak mengizinkan arsip dari archived", () => {
    expect(isValidProductionTransition("archived", "archived")).toBe(false);
  });
  it("arsip wajib alasan dan ditawarkan dari semua status", () => {
    expect(productionTransitionRequiresReason("idea", "archived")).toBe(true);
    expect(validProductionTargets("editing")).toContain("archived");
    expect(validProductionTargets("idea")).toContain("archived");
  });
});

describe("Batch 4 — parameter filter dipertahankan (T-8)", () => {
  it("carrySearchParams membawa parameter non-render dan membuang workspace/render", () => {
    expect(
      carrySearchParams(
        {
          workspace: WS_ID,
          q: "promo",
          brandId: "b1",
          priority: "high",
          month: "2026-11",
          view: "agenda",
          empty: "",
        },
        ["q", "brandId"],
      ),
    ).toEqual({ priority: "high", month: "2026-11", view: "agenda" });
  });
  it("carrySearchParams mengambil nilai pertama dari array", () => {
    expect(carrySearchParams({ priority: ["high", "low"] }, [])).toEqual({
      priority: "high",
    });
  });
});
