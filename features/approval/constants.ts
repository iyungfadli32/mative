/**
 * Konstanta approval — features/approval/constants.ts (P4-04).
 * Label + tab Approval Center (M4.1) + default ADR-0010.
 */
import type { ApprovalDecisionKind, ApprovalQueueTab, ApprovalRequestStatus } from "./types";

export const APPROVAL_QUEUE_TABS: readonly ApprovalQueueTab[] = [
  "menunggu_saya",
  "semua_tertunda",
  "disetujui",
  "minta_revisi",
  "ditolak",
] as const;

export const APPROVAL_QUEUE_TAB_LABELS: Record<ApprovalQueueTab, string> = {
  menunggu_saya: "Menunggu saya",
  semua_tertunda: "Semua tertunda",
  disetujui: "Disetujui",
  minta_revisi: "Minta revisi",
  ditolak: "Ditolak",
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalRequestStatus, string> = {
  submitted: "Diajukan",
  in_review: "Sedang ditinjau",
  approved: "Disetujui",
  changes_requested: "Minta revisi",
  rejected: "Ditolak",
  reapproval_required: "Butuh persetujuan ulang",
};

export const APPROVAL_DECISION_LABELS: Record<ApprovalDecisionKind, string> = {
  approved: "Setujui",
  changes_requested: "Minta revisi",
  rejected: "Tolak",
};

/** Daftar field kritis default (ASUMSI-4.6, ADR-0010 §3). */
export const DEFAULT_CRITICAL_FIELDS = [
  "script",
  "caption",
  "cta",
  "asset",
  "channel",
  "format",
  "scheduled_time",
] as const;

/** Kuorum default per step (ASUMSI-4.7, ADR-0010 §4): 1 persetujuan. */
export const DEFAULT_REQUIRED_COUNT = 1;

/** Pesan pemulihan saat approve versi basi / stale (R4.1). */
export const STALE_APPROVAL_MESSAGE =
  "Versi ini sudah bukan versi terbaru. Buka versi terbaru konten lalu ajukan ulang.";
