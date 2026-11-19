/**
 * Uji rumus progres campaign — features/campaign/progress.ts (P5-03, ASUMSI-5.2).
 * Progres dihitung dari linked content setiap kali dibaca; tidak ada
 * persentase yang disimpan/diketik manual.
 */
import { describe, expect, it } from "vitest";
import { computeCampaignProgress } from "@/features/campaign/progress";

describe("computeCampaignProgress — rumus tunggal progres campaign", () => {
  it("campaign kosong: total 0, persen 0", () => {
    expect(computeCampaignProgress([])).toEqual({
      total: 0,
      ready: 0,
      inProduction: 0,
      waitingApproval: 0,
      notStarted: 0,
      exception: 0,
      archived: 0,
      readyPercent: 0,
    });
  });

  it("mengelompokkan tiap production_status ke kategori yang benar", () => {
    const progress = computeCampaignProgress([
      { production_status: "approved" },
      { production_status: "approved" },
      { production_status: "ready_for_production" },
      { production_status: "in_production" },
      { production_status: "editing" },
      { production_status: "internal_review" },
      { production_status: "idea" },
      { production_status: "brief" },
      { production_status: "scripting" },
      { production_status: "changes_requested" },
      { production_status: "blocked" },
      { production_status: "cancelled" },
      { production_status: "archived" },
    ]);
    expect(progress).toEqual({
      total: 13,
      ready: 2,
      inProduction: 3,
      waitingApproval: 1,
      notStarted: 3,
      exception: 3,
      archived: 1,
      readyPercent: 15,
    });
  });

  it("persen = ready/total dibulatkan (1 dari 3 = 33%)", () => {
    const progress = computeCampaignProgress([
      { production_status: "approved" },
      { production_status: "idea" },
      { production_status: "idea" },
    ]);
    expect(progress.readyPercent).toBe(33);
  });

  it("status tak dikenal dihitung di total saja (tidak masuk kategori)", () => {
    const progress = computeCampaignProgress([
      { production_status: "approved" },
      { production_status: "client_review" },
    ]);
    expect(progress.total).toBe(2);
    expect(progress.ready).toBe(1);
    expect(progress.readyPercent).toBe(50);
  });
});
