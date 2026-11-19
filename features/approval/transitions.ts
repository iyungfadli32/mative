/**
 * Logika approval murni (tanpa DB) — features/approval/transitions.ts (P4-04).
 * Cermin APLIKASI dari aturan di migrasi 0013/0014 + ADR-0010.
 * Bila keduanya berbeda, yang DI DATABASE yang menang — perbaiki file ini.
 *
 * Aturan:
 *  - Request "aktif" = submitted / in_review / reapproval_required
 *    (indeks parsial 0013): hanya satu request aktif per (target, versi).
 *  - Request "basi" (stale) = versi yang ditinjau bukan versi terbaru
 *    (content ATAU placement) — keputusan atasnya DITOLAK server.
 *  - Kuorum step terpenuhi bila jumlah approver BERBEDA yang menyetujui
 *    step itu >= required_count (ASUMSI-4.7; default 1).
 *  - Step paralel (step_order sama): semua step di order itu harus
 *    memenuhi kuorum sebelum request maju/selesai.
 *  - Critical change (ASUMSI-4.6): field kritis yang berubah antara versi
 *    yang disetujui dan versi baru → reapproval_required.
 */
import { DEFAULT_CRITICAL_FIELDS } from "./constants";
import type { ApprovalDecision, ApprovalRequest, ApprovalStep } from "./types";

export const ACTIVE_REQUEST_STATUSES: readonly string[] = [
  "submitted",
  "in_review",
  "reapproval_required",
];

/** Apakah status request masih aktif (belum selesai)? */
export function isActiveRequestStatus(status: string): boolean {
  return (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(status);
}

/** Apakah request menunjuk versi terbaru (tidak basi)? */
export function isCurrentVersionRequest(
  request: Pick<ApprovalRequest, "content_version_id" | "placement_version_id">,
  latestContentVersionId: string,
  latestPlacementVersionId: string | null,
): boolean {
  if (request.content_version_id !== latestContentVersionId) return false;
  if (
    request.placement_version_id !== null &&
    request.placement_version_id !== latestPlacementVersionId
  )
    return false;
  return true;
}

/**
 * Apakah kuorum satu step terpenuhi? Hitung approver BERBEDA yang
 * menyetujui step itu (keputusan 'approved' saja).
 */
export function isStepQuorumMet(
  step: Pick<ApprovalStep, "id" | "required_count">,
  decisions: Pick<ApprovalDecision, "step_id" | "approver_user_id" | "decision">[],
): boolean {
  const approvers = new Set(
    decisions
      .filter((d) => d.step_id === step.id && d.decision === "approved")
      .map((d) => d.approver_user_id),
  );
  return approvers.size >= step.required_count;
}

/**
 * Step-step di satu order yang BELUM memenuhi kuorum (dipakai untuk
 * menentukan apakah request boleh maju ke order berikut / selesai).
 */
export function openStepsAtOrder(
  steps: Pick<ApprovalStep, "id" | "step_order" | "required_count">[],
  decisions: Pick<ApprovalDecision, "step_id" | "approver_user_id" | "decision">[],
  order: number,
): Pick<ApprovalStep, "id" | "step_order" | "required_count">[] {
  return steps.filter((s) => s.step_order === order && !isStepQuorumMet(s, decisions));
}

/** Apakah semua step di semua order sudah memenuhi kuorum? */
export function isWorkflowComplete(
  steps: Pick<ApprovalStep, "id" | "step_order" | "required_count">[],
  decisions: Pick<ApprovalDecision, "step_id" | "approver_user_id" | "decision">[],
): boolean {
  return steps.length > 0 && steps.every((s) => isStepQuorumMet(s, decisions));
}

export type ContentVersionSnapshot = {
  script: string | null;
  caption: string | null;
  cta: string | null;
};

export type PlacementPayloadSnapshot = {
  platform_format?: string | null;
  platform_caption?: string | null;
  scheduled_at?: string | null;
  [key: string]: unknown;
};

/**
 * Field kritis yang berubah antara versi yang disetujui dan versi baru.
 * Cermin trigger 0014 (yang DI DATABASE yang menang):
 * - script/caption/cta: bandingkan kolom content_versions.
 * - format/caption/scheduled_time (placement): bandingkan
 *   payload_snapshot placement (platform_format / platform_caption /
 *   scheduled_at).
 * - asset: lampiran aset berubah (link baru / lepas).
 * - channel: placement BARU ditambahkan ke konten yang sudah disetujui.
 * Mengembalikan daftar field yang berubah (subset dari criticalFields).
 */
export function criticalFieldsChanged(
  approvedVersion: ContentVersionSnapshot | null,
  newVersion: ContentVersionSnapshot | null,
  approvedPlacement: PlacementPayloadSnapshot | null,
  newPlacement: PlacementPayloadSnapshot | null,
  approvedAssetCount: number | null,
  newAssetCount: number | null,
  newPlacementAdded = false,
  criticalFields: readonly string[] = DEFAULT_CRITICAL_FIELDS,
): string[] {
  const changed: string[] = [];
  if (approvedVersion && newVersion) {
    if (criticalFields.includes("script") && approvedVersion.script !== newVersion.script)
      changed.push("script");
    if (criticalFields.includes("caption") && approvedVersion.caption !== newVersion.caption)
      changed.push("caption");
    if (criticalFields.includes("cta") && approvedVersion.cta !== newVersion.cta)
      changed.push("cta");
  }
  if (approvedPlacement && newPlacement) {
    if (
      criticalFields.includes("format") &&
      (approvedPlacement.platform_format ?? null) !== (newPlacement.platform_format ?? null)
    )
      changed.push("format");
    if (
      criticalFields.includes("caption") &&
      (approvedPlacement.platform_caption ?? null) !== (newPlacement.platform_caption ?? null)
    )
      changed.push("caption");
    if (
      criticalFields.includes("scheduled_time") &&
      (approvedPlacement.scheduled_at ?? null) !== (newPlacement.scheduled_at ?? null)
    )
      changed.push("scheduled_time");
  }
  if (
    criticalFields.includes("asset") &&
    approvedAssetCount !== null &&
    newAssetCount !== null &&
    approvedAssetCount !== newAssetCount
  )
    changed.push("asset");
  if (criticalFields.includes("channel") && newPlacementAdded) changed.push("channel");
  return changed;
}

/** Apakah perubahan versi baru memicu reapproval (ada field kritis berubah)? */
export function needsReapproval(
  approvedVersion: ContentVersionSnapshot | null,
  newVersion: ContentVersionSnapshot | null,
  approvedPlacement: PlacementPayloadSnapshot | null,
  newPlacement: PlacementPayloadSnapshot | null,
  approvedAssetCount: number | null,
  newAssetCount: number | null,
  newPlacementAdded = false,
  criticalFields: readonly string[] = DEFAULT_CRITICAL_FIELDS,
): boolean {
  return (
    criticalFieldsChanged(
      approvedVersion,
      newVersion,
      approvedPlacement,
      newPlacement,
      approvedAssetCount,
      newAssetCount,
      newPlacementAdded,
      criticalFields,
    ).length > 0
  );
}

/** Order step berikutnya setelah order saat ini (null bila sudah di akhir). */
export function nextStepOrder(
  steps: Pick<ApprovalStep, "step_order">[],
  currentOrder: number,
): number | null {
  const orders = [...new Set(steps.map((s) => s.step_order))].sort((a, b) => a - b);
  const next = orders.find((o) => o > currentOrder);
  return next ?? null;
}
