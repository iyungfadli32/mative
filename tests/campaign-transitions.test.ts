/**
 * Uji transisi status campaign — features/campaign/transitions.ts (P5-03, ASUMSI-5.5).
 * Graf: draft → active → completed → archived; draft/active → cancelled.
 */
import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_TRANSITIONS,
  campaignTransitionRequiresReason,
  isValidCampaignTransition,
} from "@/features/campaign/transitions";

describe("isValidCampaignTransition — graf status campaign", () => {
  it("jalur utama draft → active → completed → archived", () => {
    expect(isValidCampaignTransition("draft", "active")).toBe(true);
    expect(isValidCampaignTransition("active", "completed")).toBe(true);
    expect(isValidCampaignTransition("completed", "archived")).toBe(true);
  });

  it("pembatalan hanya dari draft/active", () => {
    expect(isValidCampaignTransition("draft", "cancelled")).toBe(true);
    expect(isValidCampaignTransition("active", "cancelled")).toBe(true);
    expect(isValidCampaignTransition("completed", "cancelled")).toBe(false);
    expect(isValidCampaignTransition("archived", "cancelled")).toBe(false);
  });

  it("tidak ada jalan mundur dan tidak ada keluar dari status akhir", () => {
    expect(isValidCampaignTransition("active", "draft")).toBe(false);
    expect(isValidCampaignTransition("completed", "active")).toBe(false);
    expect(isValidCampaignTransition("archived", "draft")).toBe(false);
    expect(isValidCampaignTransition("cancelled", "draft")).toBe(false);
    expect(CAMPAIGN_TRANSITIONS.archived).toEqual([]);
    expect(CAMPAIGN_TRANSITIONS.cancelled).toEqual([]);
  });

  it("status tak dikenal ditolak", () => {
    expect(isValidCampaignTransition("live", "active")).toBe(false);
    expect(isValidCampaignTransition("draft", "live")).toBe(false);
  });
});

describe("campaignTransitionRequiresReason — alasan wajib hanya untuk batal", () => {
  it("cancelled wajib alasan; yang lain tidak", () => {
    expect(campaignTransitionRequiresReason("cancelled")).toBe(true);
    expect(campaignTransitionRequiresReason("active")).toBe(false);
    expect(campaignTransitionRequiresReason("completed")).toBe(false);
    expect(campaignTransitionRequiresReason("archived")).toBe(false);
  });
});
