import { describe, expect, it } from "vitest";
import {
  canConvertIdea,
  canTransitionIdeaStatus,
  canCreateEditContent,
  canEditSpecificContent,
  canManageBrandsChannels,
  canManagePillarsCampaigns,
  canSchedule,
  isValidDistributionTransition,
  isValidProductionTransition,
  productionTransitionRequiresReason,
  validDistributionTargets,
  validProductionTargets,
} from "@/features/planning/transitions";
import type { ProductionStatus } from "@/features/planning/constants";

describe("Transisi production — Dok 05 §4 + ADR-0007 §2 (tanpa client_review)", () => {
  it("jalur maju satu langkah diizinkan", () => {
    const chain: Array<[ProductionStatus, ProductionStatus]> = [
      ["idea", "brief"],
      ["brief", "scripting"],
      ["scripting", "ready_for_production"],
      ["ready_for_production", "in_production"],
      ["in_production", "editing"],
      ["editing", "internal_review"],
      ["internal_review", "approved"],
      ["approved", "archived"],
    ];
    for (const [from, to] of chain) expect(isValidProductionTransition(from, to)).toBe(true);
  });

  it("mundur satu langkah diizinkan (kecuali dari archived)", () => {
    expect(isValidProductionTransition("brief", "idea")).toBe(true);
    expect(isValidProductionTransition("editing", "in_production")).toBe(true);
    expect(isValidProductionTransition("internal_review", "editing")).toBe(true);
  });

  it("lompat dua tahap DITOLAK", () => {
    expect(isValidProductionTransition("idea", "scripting")).toBe(false);
    expect(isValidProductionTransition("brief", "in_production")).toBe(false);
    expect(isValidProductionTransition("idea", "approved")).toBe(false);
  });

  it("client_review BUKAN production_status — bukan tujuan valid", () => {
    expect(
      isValidProductionTransition("internal_review", "client_review" as ProductionStatus),
    ).toBe(false);
    expect(validProductionTargets("internal_review")).not.toContain("client_review");
  });

  it("exception bisa dimasuki dari tahap normal mana pun", () => {
    for (const from of ["idea", "brief", "editing", "approved"] as ProductionStatus[]) {
      expect(isValidProductionTransition(from, "blocked")).toBe(true);
      expect(isValidProductionTransition(from, "changes_requested")).toBe(true);
      expect(isValidProductionTransition(from, "cancelled")).toBe(true);
    }
  });

  it("dari exception HANYA ke editing/idea", () => {
    for (const from of ["changes_requested", "blocked", "cancelled"] as ProductionStatus[]) {
      expect(isValidProductionTransition(from, "editing")).toBe(true);
      expect(isValidProductionTransition(from, "idea")).toBe(true);
      expect(isValidProductionTransition(from, "approved")).toBe(false);
      expect(isValidProductionTransition(from, "blocked")).toBe(false);
      expect(isValidProductionTransition(from, "cancelled")).toBe(false);
    }
  });

  it("archived hanya bisa kembali ke idea", () => {
    expect(isValidProductionTransition("archived", "idea")).toBe(true);
    expect(isValidProductionTransition("archived", "brief")).toBe(false);
    expect(isValidProductionTransition("approved", "archived")).toBe(true);
  });

  it("transisi ke status yang sama ditolak", () => {
    expect(isValidProductionTransition("brief", "brief")).toBe(false);
  });

  it("alasan WAJIB untuk masuk/keluar exception dan batal arsip", () => {
    expect(productionTransitionRequiresReason("editing", "blocked")).toBe(true);
    expect(productionTransitionRequiresReason("blocked", "editing")).toBe(true);
    expect(productionTransitionRequiresReason("archived", "idea")).toBe(true);
    expect(productionTransitionRequiresReason("brief", "scripting")).toBe(false);
    expect(productionTransitionRequiresReason("internal_review", "approved")).toBe(false);
  });
});

describe("Transisi distribusi — terpisah dari produksi (R2-02)", () => {
  it("jalur distribusi maju diizinkan (tanpa target manual published/uploaded)", () => {
    expect(isValidDistributionTransition("draft", "ready")).toBe(true);
    expect(isValidDistributionTransition("ready", "scheduled_locally")).toBe(true);
    expect(isValidDistributionTransition("scheduled_locally", "sending")).toBe(true);
    // (e) T-3 — published dan uploaded_or_draft_created hanya boleh ditulis lewat alur publishing (RPC confirm), bukan transisi manual.
    expect(isValidDistributionTransition("sending", "uploaded_or_draft_created")).toBe(false);
    expect(isValidDistributionTransition("uploaded_or_draft_created", "published")).toBe(false);
  });

  it("gagal / perlu tindakan manual bisa kembali ke ready", () => {
    expect(isValidDistributionTransition("failed", "ready")).toBe(true);
    expect(isValidDistributionTransition("needs_manual_action", "ready")).toBe(true);
    expect(isValidDistributionTransition("sending", "failed")).toBe(true);
  });

  it("published terminal; lompat tahap ditolak", () => {
    expect(validDistributionTargets("published")).toEqual([]);
    expect(isValidDistributionTransition("draft", "scheduled_locally")).toBe(false);
    expect(isValidDistributionTransition("draft", "published")).toBe(false);
  });

  it("cancelled bisa dibuka kembali ke ready", () => {
    expect(isValidDistributionTransition("cancelled", "ready")).toBe(true);
    expect(isValidDistributionTransition("cancelled", "draft")).toBe(false);
  });
});

describe("Izin perencanaan — cermin matriks Dok 06 §3", () => {
  it("brand/channel hanya owner/admin/manager", () => {
    expect(canManageBrandsChannels("owner")).toBe(true);
    expect(canManageBrandsChannels("manager")).toBe(true);
    expect(canManageBrandsChannels("strategist")).toBe(false);
    expect(canManageBrandsChannels("creator")).toBe(false);
  });

  it("pilar/campaign boleh strategist, tidak boleh creator", () => {
    expect(canManagePillarsCampaigns("strategist")).toBe(true);
    expect(canManagePillarsCampaigns("creator")).toBe(false);
    expect(canManagePillarsCampaigns("approver")).toBe(false);
  });

  it("creator/editor hanya konten milik sendiri (P1-A6)", () => {
    expect(canCreateEditContent("creator")).toBe(true);
    expect(canEditSpecificContent("creator", true)).toBe(true);
    expect(canEditSpecificContent("creator", false)).toBe(false);
    expect(canEditSpecificContent("editor", false)).toBe(false);
    expect(canEditSpecificContent("approver", true)).toBe(false);
    expect(canEditSpecificContent("viewer_client", true)).toBe(false);
    expect(canEditSpecificContent("manager", false)).toBe(true);
  });

  it("jadwal ulang hanya owner/admin/manager/strategist (limited)", () => {
    expect(canSchedule("manager")).toBe(true);
    expect(canSchedule("strategist")).toBe(true);
    expect(canSchedule("creator")).toBe(false);
    expect(canSchedule("analyst")).toBe(false);
  });
});

describe("Konversi ide — anti-ganda (P2-08)", () => {
  it("ide baru bisa dikonversi; yang sudah converted tidak", () => {
    expect(canConvertIdea({ status: "new", converted_content_item_id: null })).toBe(true);
    expect(canConvertIdea({ status: "considering", converted_content_item_id: null })).toBe(true);
    expect(canConvertIdea({ status: "converted", converted_content_item_id: "x" })).toBe(false);
    expect(canConvertIdea({ status: "new", converted_content_item_id: "x" })).toBe(false);
  });
});

describe("Transisi status ide (S-2)", () => {
  it("dropped bisa dipulihkan ke new; new/considering bisa dibatalkan", () => {
    expect(canTransitionIdeaStatus("dropped", "new")).toBe(true);
    expect(canTransitionIdeaStatus("new", "considering")).toBe(true);
    expect(canTransitionIdeaStatus("new", "dropped")).toBe(true);
    expect(canTransitionIdeaStatus("considering", "new")).toBe(true);
    expect(canTransitionIdeaStatus("considering", "dropped")).toBe(true);
  });
  it("converted terminal; converted tidak bisa jadi target", () => {
    expect(canTransitionIdeaStatus("converted", "new")).toBe(false);
    expect(canTransitionIdeaStatus("converted", "considering")).toBe(false);
    expect(canTransitionIdeaStatus("converted", "dropped")).toBe(false);
    expect(canTransitionIdeaStatus("new", "converted")).toBe(false);
    expect(canTransitionIdeaStatus("considering", "converted")).toBe(false);
  });
  it("dropped tidak bisa langsung ke considering; status tak dikenal ditolak", () => {
    expect(canTransitionIdeaStatus("dropped", "considering")).toBe(false);
    expect(canTransitionIdeaStatus("unknown", "new")).toBe(false);
  });
});
