/**
 * Tipe approval — features/approval/types.ts (P4-04).
 * Cermin tipe database migrasi 0013 (approval_workflows, approval_steps,
 * approval_requests, approval_decisions) + 0014 (RPC approval).
 */
export const APPROVAL_REQUEST_STATUSES = [
  "submitted",
  "in_review",
  "approved",
  "changes_requested",
  "rejected",
  "reapproval_required",
] as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number];

export const APPROVAL_DECISIONS = ["approved", "changes_requested", "rejected"] as const;
export type ApprovalDecisionKind = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_REQUEST_TYPES = ["internal", "client"] as const;
export type ApprovalRequestType = (typeof APPROVAL_REQUEST_TYPES)[number];

export const APPROVAL_TARGET_TYPES = ["content_item", "placement"] as const;
export type ApprovalTargetType = (typeof APPROVAL_TARGET_TYPES)[number];

export const APPROVAL_STEP_TYPES = ["sequential", "parallel"] as const;
export type ApprovalStepType = (typeof APPROVAL_STEP_TYPES)[number];

export type ApprovalWorkflow = {
  id: string;
  workspace_id: string;
  name: string;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
};

export type ApprovalStep = {
  id: string;
  workflow_id: string;
  step_order: number;
  step_type: ApprovalStepType;
  assignee_role: string | null;
  assignee_user_id: string | null;
  required_count: number;
};

export type ApprovalRequest = {
  id: string;
  workspace_id: string;
  target_type: ApprovalTargetType;
  target_id: string;
  content_version_id: string;
  placement_version_id: string | null;
  workflow_id: string;
  request_type: ApprovalRequestType;
  status: ApprovalRequestStatus;
  submitted_by: string;
  submitted_at: string;
  completed_at: string | null;
  current_step_order: number;
  created_at: string;
  updated_at: string;
};

export type ApprovalDecision = {
  id: string;
  approval_request_id: string;
  step_id: string;
  approver_user_id: string;
  decision: ApprovalDecisionKind;
  comment: string | null;
  created_at: string;
};

export type ApprovalQueueTab =
  | "menunggu_saya"
  | "semua_tertunda"
  | "disetujui"
  | "minta_revisi"
  | "ditolak";

/** Hasil RPC approval (jsonb {ok, code, message, ...} dari 0014). */
export type ApprovalRpcResult = {
  ok: boolean;
  code?: string | null;
  message?: string | null;
  request_id?: string | null;
  version_number?: number | null;
  [key: string]: unknown;
};
