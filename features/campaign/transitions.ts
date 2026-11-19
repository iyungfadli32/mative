/**
 * Transisi status campaign — features/campaign/transitions.ts (P5-03, ASUMSI-5.5).
 * Enum CHECK 0007 (draft/active/completed/archived/cancelled) dikonfirmasi
 * apa adanya; yang dikunci di sini adalah GRAF transisinya.
 */
import type { CampaignStatus } from "@/features/planning/constants";

export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["active", "cancelled"],
  active: ["completed", "cancelled"],
  completed: ["archived"],
  archived: [],
  cancelled: [],
};

export function isValidCampaignTransition(from: string, to: string): boolean {
  const allowed = (CAMPAIGN_TRANSITIONS as Record<string, string[]>)[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/** Pembatalan wajib alasan (dicatat di activity_logs, bukan kolom baru). */
export function campaignTransitionRequiresReason(to: string): boolean {
  return to === "cancelled";
}
