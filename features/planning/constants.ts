/**
 * Konstanta domain Planning Core — features/planning/constants.ts
 * Sumber: Dok 05 §3/§4, ADR-0007, ADR-0008, rencana detail Phase 2.
 *
 * Nilai yang DIKUNCI di fase ini (ADR-0008 §2 — sebelumnya teks bebas di
 * 0007, kini dikunci di aplikasi; CHECK database menyusul bila Tuan
 * mengunci enum final):
 *  - priority: low | medium | high | urgent
 *  - funnel_stage: awareness | consideration | conversion | retention | advocacy
 *  - ideas.status: new | considering | converted | dropped
 *  - ideas.source_type: chat | meeting | social | research | internal | other
 *  - social_channels.platform: instagram | tiktok | youtube | facebook |
 *    linkedin | x | threads | other
 *  - content_placements.platform_format: feed | reel | story | carousel |
 *    video | short | live | article | other
 * Nilai production_status / distribution_status / campaigns.status berasal
 * dari CHECK 0007 (ADR-0007 §2–§4) — JANGAN diubah di sini tanpa migrasi.
 */

export const PRODUCTION_STATUSES = [
  "idea",
  "brief",
  "scripting",
  "ready_for_production",
  "in_production",
  "editing",
  "internal_review",
  "approved",
  "archived",
  "changes_requested",
  "blocked",
  "cancelled",
] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

/** Status exception (P2-A10 + Keputusan #8): masuk dari mana pun dengan alasan wajib. */
export const PRODUCTION_EXCEPTION_STATUSES = ["changes_requested", "blocked", "cancelled"] as const;

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, { label: string; icon: string }> = {
  idea: { label: "Ide", icon: "💡" },
  brief: { label: "Brief", icon: "📝" },
  scripting: { label: "Scripting", icon: "✍️" },
  ready_for_production: { label: "Siap Produksi", icon: "✅" },
  in_production: { label: "Dalam Produksi", icon: "🎬" },
  editing: { label: "Editing", icon: "✂️" },
  internal_review: { label: "Review Internal", icon: "👀" },
  approved: { label: "Disetujui", icon: "✔️" },
  archived: { label: "Diarsipkan", icon: "🗄️" },
  changes_requested: { label: "Minta Revisi", icon: "↩️" },
  blocked: { label: "Terblokir", icon: "⛔" },
  cancelled: { label: "Dibatalkan", icon: "✕" },
};

export const DISTRIBUTION_STATUSES = [
  "draft",
  "ready",
  "scheduled_locally",
  "sending",
  "uploaded_or_draft_created",
  "published",
  "failed",
  "needs_manual_action",
  "cancelled",
] as const;
export type DistributionStatus = (typeof DISTRIBUTION_STATUSES)[number];

export const DISTRIBUTION_STATUS_LABELS: Record<
  DistributionStatus,
  { label: string; icon: string }
> = {
  draft: { label: "Draf", icon: "📝" },
  ready: { label: "Siap Dijadwalkan", icon: "✅" },
  scheduled_locally: { label: "Terjadwal (Lokal)", icon: "📅" },
  sending: { label: "Mengirim", icon: "📤" },
  uploaded_or_draft_created: { label: "Terunggah / Draf Dibuat", icon: "☁️" },
  published: { label: "Terbit", icon: "🌐" },
  failed: { label: "Gagal", icon: "⚠️" },
  needs_manual_action: { label: "Perlu Tindakan Manual", icon: "✋" },
  cancelled: { label: "Dibatalkan", icon: "✕" },
};

export const CAMPAIGN_STATUSES = ["draft", "active", "completed", "archived", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draf",
  active: "Aktif",
  completed: "Selesai",
  archived: "Diarsipkan",
  cancelled: "Dibatalkan",
};

export const BRAND_STATUSES = ["active", "inactive", "archived"] as const;
export type BrandStatus = (typeof BRAND_STATUSES)[number];

export const IDEA_STATUSES = ["new", "considering", "converted", "dropped"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  new: "Baru",
  considering: "Dipertimbangkan",
  converted: "Dikonversi",
  dropped: "Dibatalkan",
};

export const IDEA_SOURCE_TYPES = [
  "chat",
  "meeting",
  "social",
  "research",
  "internal",
  "other",
] as const;
export type IdeaSourceType = (typeof IDEA_SOURCE_TYPES)[number];
export const IDEA_SOURCE_TYPE_LABELS: Record<IdeaSourceType, string> = {
  chat: "Chat / DM",
  meeting: "Rapat",
  social: "Media sosial",
  research: "Riset",
  internal: "Internal",
  other: "Lainnya",
};

export const PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
  "linkedin",
  "x",
  "threads",
  "other",
] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  threads: "Threads",
  other: "Lainnya",
};

export const PLATFORM_FORMATS = [
  "feed",
  "reel",
  "story",
  "carousel",
  "video",
  "short",
  "live",
  "article",
  "other",
] as const;
export type PlatformFormat = (typeof PLATFORM_FORMATS)[number];
export const PLATFORM_FORMAT_LABELS: Record<PlatformFormat, string> = {
  feed: "Feed",
  reel: "Reel",
  story: "Story",
  carousel: "Carousel",
  video: "Video",
  short: "Short",
  live: "Live",
  article: "Artikel",
  other: "Lainnya",
};

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type PriorityValue = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<PriorityValue, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
  urgent: "Mendesak",
};

export const FUNNEL_STAGES = [
  "awareness",
  "consideration",
  "conversion",
  "retention",
  "advocacy",
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  conversion: "Conversion",
  retention: "Retention",
  advocacy: "Advocacy",
};

/** Token warna pilar (Dok 03 §3 — hanya token yang ada; tanpa hex baru). */
export const PILLAR_COLOR_TOKENS = [
  "teal",
  "navy",
  "indigo",
  "amber",
  "rose",
  "mint",
  "slate",
] as const;
export type PillarColorToken = (typeof PILLAR_COLOR_TOKENS)[number];

/** WIP limit board default: tanpa batas (P2-A6). */
export const DEFAULT_WIP_LIMIT: number | null = null;

/** Label zona waktu default workspace. */
export const DEFAULT_WORKSPACE_TIMEZONE = "Asia/Jakarta";
