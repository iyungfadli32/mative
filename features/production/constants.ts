/**
 * Konstanta Production Operations — features/production/constants.ts (Phase 3)
 * Sumber: Dok 05 §3/§6, ADR-0009 §1/§2/§4/§6. Nilai enum di sini HARUS
 * sama dengan CHECK 0009 — bila berbeda, database yang menang.
 */
import type {
  AssetUsageRole,
  CommentTargetType,
  NotificationType,
  TaskPriority,
  TaskStatus,
} from "./types";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];

export const TASK_STATUS_LABELS: Record<TaskStatus, { label: string; icon: string }> = {
  todo: { label: "Belum dikerjakan", icon: "⬜" },
  in_progress: { label: "Dikerjakan", icon: "🔨" },
  in_review: { label: "Dalam review", icon: "👀" },
  done: { label: "Selesai", icon: "✅" },
  blocked: { label: "Terkendala", icon: "⛔" },
  cancelled: { label: "Dibatalkan", icon: "✕" },
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, { label: string; icon: string }> = {
  low: { label: "Rendah", icon: "↓" },
  medium: { label: "Sedang", icon: "→" },
  high: { label: "Tinggi", icon: "↑" },
  urgent: { label: "Mendesak", icon: "🔥" },
};

export const ASSET_USAGE_ROLE_LABELS: Record<AssetUsageRole, string> = {
  primary: "Utama",
  reference: "Referensi",
  thumbnail: "Thumbnail",
  attachment: "Lampiran",
};

export const COMMENT_TARGET_LABELS: Record<CommentTargetType, string> = {
  content_item: "Konten",
  campaign: "Campaign",
  task: "Task",
};

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  mention: "Disebut",
  task_assigned: "Task baru",
  task_status_change: "Status task berubah",
  comment_reply: "Balasan komentar",
  comment_created: "Komentar baru",
};

/** Bucket privat aset (migrasi 0009). Akses hanya lewat signed URL 1 jam. */
export const ASSET_BUCKET = "mative-assets";
/** Batas ukuran file aset (CHECK 0009: byte_size <= 10485760). */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
/** Masa berlaku signed URL aset (detik). */
export const ASSET_SIGNED_URL_SECONDS = 3600;
/** MIME yang diizinkan — dicek dari ISI file (magic bytes), bukan ekstensi. */
export const ALLOWED_ASSET_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/webm",
  "application/pdf",
] as const;

/** Field template brief standar (dibuat malas bila workspace belum punya default — P3-05). */
export const DEFAULT_BRIEF_TEMPLATE_FIELDS = [
  { key: "objective", label: "Tujuan konten", type: "text", required: true },
  { key: "audience", label: "Audiens", type: "text", required: false },
  { key: "angle", label: "Sudut pandang", type: "text", required: false },
  { key: "format", label: "Format", type: "text", required: false },
  { key: "key_messages", label: "Pesan kunci", type: "list", required: false },
  { key: "cta", label: "Ajakan (CTA)", type: "text", required: false },
] as const;

/** Tab Content Workspace / Editor (P3-11, P4-04). Default: overview. */
export const EDITOR_TABS = [
  "overview",
  "brief",
  "script",
  "media",
  "placements",
  "tasks",
  "comments",
  "versions",
  "approval",
] as const;
export type EditorTab = (typeof EDITOR_TABS)[number];

export const EDITOR_TAB_LABELS: Record<EditorTab, string> = {
  overview: "Ringkasan",
  brief: "Brief",
  script: "Script",
  media: "Media",
  placements: "Platform placements",
  tasks: "Task",
  comments: "Komentar",
  versions: "Versi",
  approval: "Approval",
};
