/**
 * Aturan transisi status + izin perencanaan — features/planning/transitions.ts
 * Cermin APLIKASI dari tabel transisi di migrasi 0008 (fungsi
 * transition_content_item_status / change_placement_distribution).
 * Bila keduanya berbeda, yang DI DATABASE yang menang — perbaiki file ini.
 *
 * Aturan (ADR-0007 §2 + ADR-0008 §3, P2-A10 yang dikoreksi Keputusan #8):
 *  - `client_review` BUKAN production_status.
 *  - Exception (changes_requested/blocked/cancelled): masuk dari tahap
 *    normal mana pun dengan alasan WAJIB; keluar HANYA ke editing/idea
 *    dengan alasan WAJIB.
 *  - archived → idea (batal arsip) dengan alasan WAJIB.
 *  - Production dan distribution adalah dua jalur terpisah (R2-02).
 */
import {
  DISTRIBUTION_STATUSES,
  PRODUCTION_EXCEPTION_STATUSES,
  PRODUCTION_STATUSES,
  type DistributionStatus,
  type ProductionStatus,
} from "./constants";
import { can, type WorkspaceRole } from "@/lib/permissions";

/** Tahap normal (bukan exception): jalur maju satu langkah + mundur satu langkah. */
const PRODUCTION_NEXT: Record<string, ProductionStatus[]> = {
  idea: ["brief"],
  brief: ["scripting", "idea"],
  scripting: ["ready_for_production", "brief"],
  ready_for_production: ["in_production", "scripting"],
  in_production: ["editing", "ready_for_production"],
  editing: ["internal_review", "in_production"],
  internal_review: ["approved", "editing"],
  approved: ["archived"],
  archived: [],
};

const EXCEPTIONS: readonly ProductionStatus[] = PRODUCTION_EXCEPTION_STATUSES;

/** Daftar status produksi yang valid. */
export function isProductionStatus(value: string): value is ProductionStatus {
  return (PRODUCTION_STATUSES as readonly string[]).includes(value);
}

/** Daftar status distribusi yang valid. */
export function isDistributionStatus(value: string): value is DistributionStatus {
  return (DISTRIBUTION_STATUSES as readonly string[]).includes(value);
}

/**
 * Apakah transisi production from → to diizinkan (tanpa memeriksa izin role)?
 * Aturan exception didahulukan: dari exception hanya ke editing/idea.
 */
export function isValidProductionTransition(
  from: ProductionStatus,
  to: ProductionStatus,
  opts?: { hasReapprovalRequiredRequest?: boolean },
): boolean {
  if (from === to) return false;
  // Batch 5 (0031) F-02: konten approved yang berubah sesudah disetujui (ada request
  // berstatus reapproval_required) boleh kembali ke editing untuk diperbaiki lalu
  // diajukan ulang. RPC transition_content_item_status menegakkan syarat yang sama.
  if (from === "approved" && to === "editing" && opts?.hasReapprovalRequiredRequest) return true;
  // Batch 4 (0030) T-6: arsip dari status apa pun (selain archived), dengan alasan.
  if (to === "archived" && from !== "archived") return true;
  if ((EXCEPTIONS as readonly string[]).includes(from)) {
    return to === "editing" || to === "idea";
  }
  if ((EXCEPTIONS as readonly string[]).includes(to)) return true;
  if (from === "archived") return to === "idea";
  return (PRODUCTION_NEXT[from] ?? []).includes(to);
}

/** Semua tujuan yang valid dari satu status produksi (untuk UI pemilih). */
export function validProductionTargets(from: ProductionStatus): ProductionStatus[] {
  return PRODUCTION_STATUSES.filter((to) => isValidProductionTransition(from, to));
}

/** Alasan wajib bila masuk ATAU keluar dari exception, batal arsip, atau mengarsipkan. */
export function productionTransitionRequiresReason(
  from: ProductionStatus,
  to: ProductionStatus,
): boolean {
  if ((EXCEPTIONS as readonly string[]).includes(to)) return true;
  if ((EXCEPTIONS as readonly string[]).includes(from)) return true;
  if (from === "archived" && to === "idea") return true;
  // Batch 4 (0030) T-6: arsip dari status apa pun wajib beralasan.
  if (to === "archived") return true;
  return false;
}

/** Jalur distribusi: maju + mundur satu langkah + gagal/manual → ready. */
const DISTRIBUTION_NEXT: Record<DistributionStatus, DistributionStatus[]> = {
  draft: ["ready", "cancelled"],
  ready: ["scheduled_locally", "draft", "cancelled"],
  scheduled_locally: ["sending", "ready", "cancelled"],
  sending: ["failed", "needs_manual_action"],
  uploaded_or_draft_created: ["failed", "needs_manual_action"],
  published: [],
  failed: ["ready", "cancelled"],
  needs_manual_action: ["ready", "cancelled"],
  cancelled: ["ready"],
};

export function isValidDistributionTransition(
  from: DistributionStatus,
  to: DistributionStatus,
): boolean {
  if (from === to) return false;
  return (DISTRIBUTION_NEXT[from] ?? []).includes(to);
}

export function validDistributionTargets(from: DistributionStatus): DistributionStatus[] {
  return DISTRIBUTION_STATUSES.filter((to) => isValidDistributionTransition(from, to));
}

/** Apakah status ini terminal (tidak bisa maju lagi)? */
export function isTerminalProductionStatus(status: ProductionStatus): boolean {
  return status === "archived";
}

// --- Izin perencanaan (cermin server; penegakan sesungguhnya di RLS + RPC) ---

/** Role yang boleh mengelola brand/channel (Dok 06 §3: owner/admin/manager). */
export function canManageBrandsChannels(role: WorkspaceRole): boolean {
  return can(role, "manage_brands_channels");
}

/** Role yang boleh mengelola pillar/audience/campaign/tag. */
export function canManagePillarsCampaigns(role: WorkspaceRole): boolean {
  return can(role, "manage_pillars_campaigns");
}

/** Role yang boleh membuat ide (creator/editor boleh, approver/analyst tidak). */
export function canCreateIdeas(role: WorkspaceRole): boolean {
  return can(role, "create_ideas_briefs");
}

/** Role yang boleh membuat/mengedit konten (creator/editor = hanya milik sendiri). */
export function canCreateEditContent(role: WorkspaceRole): boolean {
  return can(role, "create_edit_content");
}

/**
 * Apakah role ini boleh mengedit content item tertentu?
 * creator/editor: hanya bila owner_user_id = dirinya (P1-A6).
 * approver/analyst/viewer_client: tidak boleh mengedit.
 */
export function canEditSpecificContent(role: WorkspaceRole, isOwner: boolean): boolean {
  if (role === "creator" || role === "editor") return isOwner;
  return can(role, "create_edit_content");
}

/** Role yang boleh menjadwalkan placement (owner/admin/manager penuh; strategist limited). */
export function canSchedule(role: WorkspaceRole): boolean {
  return can(role, "schedule_publish");
}

/** Ide boleh dikonversi bila belum converted dan belum punya content hasil konversi. */
export function canConvertIdea(idea: {
  status: string | null;
  converted_content_item_id: string | null;
}): boolean {
  return idea.status !== "converted" && idea.converted_content_item_id === null;
}

/**
 * Transisi status ide yang diizinkan (S-2). "converted" terminal;
 * "dropped" bisa dipulihkan ke "new".
 */
export const IDEA_STATUS_TRANSITIONS: Record<string, string[]> = {
  new: ["considering", "dropped"],
  considering: ["new", "dropped"],
  dropped: ["new"],
  converted: [],
};

export function canTransitionIdeaStatus(from: string, to: string): boolean {
  return (IDEA_STATUS_TRANSITIONS[from] ?? []).includes(to);
}
