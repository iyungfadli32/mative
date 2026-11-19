/**
 * Tipe Production Operations — features/production/types.ts (Phase 3)
 * Cermin kolom migrasi 0009 (Dok 05 §3). QueryResult dipakai ulang dari
 * features/planning/types (pola yang sama).
 */
import type { QueryResult } from "@/features/planning/types";
import type { BriefSnapshot, BriefTemplateField } from "@/lib/validation/schemas";

export type { QueryResult, BriefSnapshot, BriefTemplateField };

export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskParentType = "content_item" | "campaign";
export type AssetUsageRole = "primary" | "reference" | "thumbnail" | "attachment";
export type CommentTargetType = "content_item" | "campaign" | "task";
export type NotificationType = "mention" | "task_assigned" | "task_status_change" | "comment_reply";
export type AssetProcessingStatus = "uploading" | "ready" | "failed";

export type Task = {
  id: string;
  workspace_id: string;
  parent_type: TaskParentType;
  parent_id: string;
  title: string;
  description: string | null;
  assignee_user_id: string | null;
  created_by: string | null;
  due_at: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  estimate_minutes: number | null;
  created_at: string;
  updated_at: string;
};

export type TaskChecklistItem = {
  id: string;
  task_id: string;
  title: string;
  sort_order: number;
  is_done: boolean;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskWithRelations = Task & {
  checklist?: TaskChecklistItem[];
  parentTitle?: string | null;
  assigneeName?: string | null;
  creatorName?: string | null;
};

export type BriefTemplate = {
  id: string;
  workspace_id: string;
  name: string;
  schema_json: { fields: BriefTemplateField[] };
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type Asset = {
  id: string;
  workspace_id: string;
  storage_bucket: string;
  object_key: string;
  original_filename: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  checksum: string | null;
  rights_notes: string | null;
  license_expiry_at: string | null;
  uploaded_by: string | null;
  processing_status: AssetProcessingStatus;
  created_at: string;
  updated_at: string;
};

export type AssetVersion = {
  id: string;
  asset_id: string;
  version_number: number;
  storage_object_key: string;
  uploaded_by: string | null;
  created_at: string;
};

export type ContentAsset = {
  id: string;
  content_item_id: string;
  asset_id: string;
  usage_role: AssetUsageRole;
  sort_order: number;
  created_at: string;
  updated_at: string;
  asset?: Asset | null;
};

export type Comment = {
  id: string;
  workspace_id: string;
  target_type: CommentTargetType;
  target_id: string;
  parent_comment_id: string | null;
  body: string;
  author_user_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
  authorName?: string | null;
  mentions?: Array<{ id: string; mentioned_user_id: string; mentionedName?: string | null }>;
};

export type AppNotification = {
  id: string;
  workspace_id: string;
  recipient_user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  target_type: string;
  target_id: string;
  read_at: string | null;
  created_at: string;
  updated_at: string;
};
