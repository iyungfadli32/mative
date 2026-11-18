import { describe, expect, it } from "vitest";
import {
  applyContentFilters,
  buildPlanningQueryString,
  matchesContentSearch,
  parsePlanningFilters,
  type FilterableContent,
  type PlanningFilters,
} from "@/features/planning/search";

const baseFilters: PlanningFilters = {
  workspaceId: "ws-1",
  q: "",
  brandId: "",
  channelId: "",
  platform: "",
  format: "",
  productionStatus: "",
  distributionStatus: "",
  pillarId: "",
  campaignId: "",
  ownerId: "",
  priority: "",
  month: "2026-11",
  unscheduledOnly: false,
};

const items: FilterableContent[] = [
  {
    brand_id: "b1",
    campaign_id: "c1",
    pillar_id: "p1",
    production_status: "editing",
    priority: "high",
    owner_user_id: "u1",
    placements: [
      {
        social_channel_id: "ch-ig",
        platform_format: "reel",
        distribution_status: "scheduled_locally",
      },
    ],
    channelPlatforms: { "ch-ig": "instagram" },
  },
  {
    brand_id: "b2",
    campaign_id: null,
    pillar_id: null,
    production_status: "idea",
    priority: "low",
    owner_user_id: "u2",
    placements: [
      { social_channel_id: "ch-tt", platform_format: "video", distribution_status: "draft" },
    ],
    channelPlatforms: { "ch-tt": "tiktok" },
  },
  {
    brand_id: "b1",
    campaign_id: "c1",
    pillar_id: null,
    production_status: "approved",
    priority: null,
    owner_user_id: "u1",
    placements: [],
    channelPlatforms: {},
  },
];

describe("Filter URL — P2-13 (tercermin di query parameters)", () => {
  it("parse + build round-trip mempertahankan filter", () => {
    const params = new URLSearchParams(
      "workspace=ws-1&brandId=b1&productionStatus=editing&month=2026-11",
    );
    const parsed = parsePlanningFilters(params, "ws-1");
    expect(parsed.brandId).toBe("b1");
    expect(parsed.productionStatus).toBe("editing");
    expect(parsed.month).toBe("2026-11");
    const qs = buildPlanningQueryString(parsed);
    expect(qs).toContain("brandId=b1");
    expect(qs).toContain("productionStatus=editing");
    expect(qs).toContain("workspace=ws-1");
  });

  it("bulan default = bulan berjalan bila tidak ada di URL", () => {
    const parsed = parsePlanningFilters(new URLSearchParams("workspace=ws-1"), "ws-1");
    expect(parsed.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("nilai kosong dihilangkan dari query string", () => {
    const qs = buildPlanningQueryString({ ...baseFilters, q: "promo" });
    expect(qs).toContain("q=promo");
    expect(qs).not.toContain("brandId=");
  });
});

describe("Pencarian + filter konten (murni)", () => {
  it("matchesContentSearch: semua kata harus cocok, tanpa peduli huruf besar", () => {
    const item = {
      title: "Promo Skincare November",
      internal_description: "Edukasi bahan aktif",
      objective: "Awareness",
    };
    expect(matchesContentSearch(item, "promo skincare")).toBe(true);
    expect(matchesContentSearch(item, "PROMO")).toBe(true);
    expect(matchesContentSearch(item, "promo makeup")).toBe(false);
    expect(matchesContentSearch(item, "")).toBe(true);
  });

  it("applyContentFilters: brand + status + owner", () => {
    expect(applyContentFilters(items, { ...baseFilters, brandId: "b1" })).toHaveLength(2);
    expect(applyContentFilters(items, { ...baseFilters, productionStatus: "idea" })).toHaveLength(
      1,
    );
    expect(applyContentFilters(items, { ...baseFilters, ownerId: "u1" })).toHaveLength(2);
    expect(
      applyContentFilters(items, { ...baseFilters, brandId: "b1", productionStatus: "approved" }),
    ).toHaveLength(1);
  });

  it("applyContentFilters: filter placement (platform/format/distribusi)", () => {
    expect(applyContentFilters(items, { ...baseFilters, platform: "instagram" })).toHaveLength(1);
    expect(applyContentFilters(items, { ...baseFilters, format: "reel" })).toHaveLength(1);
    expect(
      applyContentFilters(items, { ...baseFilters, distributionStatus: "draft" }),
    ).toHaveLength(1);
    // Item tanpa placement tidak lolos filter placement.
    expect(applyContentFilters(items, { ...baseFilters, channelId: "ch-ig" })).toHaveLength(1);
  });

  it("applyContentFilters: prioritas + campaign + pilar", () => {
    expect(applyContentFilters(items, { ...baseFilters, priority: "high" })).toHaveLength(1);
    expect(applyContentFilters(items, { ...baseFilters, campaignId: "c1" })).toHaveLength(2);
    expect(applyContentFilters(items, { ...baseFilters, pillarId: "p1" })).toHaveLength(1);
  });
});
