import { z } from "zod";
import { WORKSPACE_ROLES } from "@/lib/permissions";

/**
 * Skema validasi bersama (Zod) — lib/validation/schemas.ts
 * Dipakai di boundary aplikasi (server action / route handler) SEBELUM
 * data menyentuh database. RLS tetap penegak terakhir.
 */

export const emailSchema = z.string().email("Masukkan alamat email yang valid.");

export const passwordSchema = z.string().min(8, "Kata sandi minimal 8 karakter.");

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z
    .string()
    .trim()
    .min(2, "Nama tampilan minimal 2 karakter.")
    .max(80, "Nama tampilan maksimal 80 karakter."),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Masukkan kata sandi."),
});

export const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  locale: z.string().min(2).max(10).default("id"),
  timezone: z.string().min(1).max(64),
});

export const organizationSchema = z.object({
  name: z.string().trim().min(2, "Nama organisasi minimal 2 karakter.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug hanya huruf kecil, angka, dan tanda hubung.")
    .min(2)
    .max(80),
});

export const workspaceSchema = z.object({
  organizationId: z.string().uuid("organization_id tidak valid."),
  name: z.string().trim().min(2, "Nama workspace minimal 2 karakter.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug hanya huruf kecil, angka, dan tanda hubung.")
    .min(2)
    .max(80),
  timezone: z.string().min(1).max(64).default("Asia/Jakarta"),
  defaultLocale: z.string().min(2).max(10).default("id"),
});

export const invitationSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  email: emailSchema,
  role: z.enum(WORKSPACE_ROLES, { message: "Role tidak dikenal." }),
});

/** Jenis resource yang boleh dibagikan ke klien lewat portal (P1-16). */
export const SHAREABLE_RESOURCE_TYPES = ["content_item", "campaign"] as const;
export type ShareableResourceType = (typeof SHAREABLE_RESOURCE_TYPES)[number];

export const resourceShareSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  resourceType: z.enum(SHAREABLE_RESOURCE_TYPES),
  resourceId: z.string().uuid("resource_id tidak valid."),
  sharedWithUserId: z.string().uuid("shared_with_user_id tidak valid."),
});

// ============================================================================
// Skema Planning Core — Phase 2 (P2-04 s.d. P2-14)
// Nilai enum dikunci di sini (ADR-0008 §2); CHECK database menyusul bila
// Tuan mengunci enum final. connection_status channel HANYA
// not_connected/manual di fase ini — TIDAK ADA nilai "connected".
// ============================================================================

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug hanya huruf kecil, angka, dan tanda hubung.")
  .min(2)
  .max(80);

const optionalUuid = z
  .string()
  .trim()
  .refine((v) => v === "" || z.string().uuid().safeParse(v).success, {
    message: "ID tidak valid.",
  })
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalDatetime = z
  .string()
  .trim()
  .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), {
    message: "Tanggal/waktu tidak valid.",
  })
  .transform((v) => (v === "" ? null : new Date(v).toISOString()))
  .nullable()
  .optional();

/**
 * Jadwal wall-clock mentah dari input datetime-local ("YYYY-MM-DDTHH:mm").
 * SENGAJA TIDAK dikonversi di sini: `new Date(v)` memakai zona server (UTC)
 * sehingga wall-clock WIB bergeser 7 jam (cacat Phase 6, A6.2 — placement
 * menyimpan 19:53 UTC padahal pengguna maksud 19:53 WIB). Nilai mentah
 * dipertahankan; konversi ke UTC dilakukan di action dengan zona placement
 * (zonedWallClockToUtcIso). Terima juga ISO ber-offset — jalur edit mengirim
 * nilai lama dari DB apa adanya (diteruskan mentah, action yang
 * menormalkannya sebagai instan absolut).
 */
const WALL_CLOCK_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const optionalWallClock = z
  .string()
  .trim()
  .refine((v) => v === "" || WALL_CLOCK_RE.test(v) || !Number.isNaN(Date.parse(v)), {
    message: "Tanggal/waktu tidak valid.",
  })
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const brandSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  name: z.string().trim().min(2, "Nama brand minimal 2 karakter.").max(120),
  slug: slugField,
  description: z.string().trim().max(500).optional().default(""),
  status: z.enum(["active", "inactive", "archived"]).default("active"),
});

export const brandUpdateSchema = z.object({
  brandId: z.string().uuid("brand_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  name: z.string().trim().min(2, "Nama brand minimal 2 karakter.").max(120),
  description: z.string().trim().max(500).optional().default(""),
  status: z.enum(["active", "inactive", "archived"]),
});

export const channelSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  brandId: z.string().uuid("brand_id tidak valid."),
  platform: z.enum([
    "instagram",
    "tiktok",
    "youtube",
    "facebook",
    "linkedin",
    "x",
    "threads",
    "other",
  ]),
  accountName: z.string().trim().max(120).optional().default(""),
  handle: z.string().trim().max(120).optional().default(""),
  providerAccountId: z.string().trim().max(120).optional().default(""),
  connectionStatus: z.enum(["not_connected", "manual"]).default("not_connected"),
  timezone: z.string().min(1).max(64).default("Asia/Jakarta"),
});

export const pillarSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  brandId: optionalUuid,
  name: z.string().trim().min(2, "Nama pilar minimal 2 karakter.").max(120),
  description: z.string().trim().max(500).optional().default(""),
  colorToken: z
    .enum(["teal", "navy", "indigo", "amber", "rose", "mint", "slate"])
    .optional()
    .default("teal"),
  active: z.boolean().default(true),
});

/** Bentuk attributes audiens yang dikenal (ADR-0007 §5 + ADR-0008 §2). */
export const audienceAttributesSchema = z
  .object({
    age_range: z.string().max(80).optional(),
    gender: z.string().max(80).optional(),
    location: z.string().max(120).optional(),
    interests: z.array(z.string().max(80)).max(20).optional(),
    pain_points: z.array(z.string().max(200)).max(20).optional(),
    notes: z.string().max(1000).optional(),
  })
  .passthrough();

export const audienceSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  name: z.string().trim().min(2, "Nama audiens minimal 2 karakter.").max(120),
  description: z.string().trim().max(500).optional().default(""),
  attributes: audienceAttributesSchema.default({}),
});

/** target_metrics: bentuk minimal ASUMSI-5.3 (ADR-0011 §3) — hanya 3 field;
 * field lain DITOLAK. Menggantikan pemetaan kunci-metrik → angka bebas
 * (ADR-0007 §5 / ADR-0008 §5) yang membuat tiap campaign isinya berbeda.
 * CHECK database ditunda (preseden ADR-0008); pembacaan tetap toleran
 * terhadap baris lama lewat parseTargetMetricsLenient di bawah. */
export const campaignTargetMetricsSchema = z
  .object({
    target_deliverables: z
      .number()
      .int("Target deliverables harus bilangan bulat.")
      .min(0, "Target deliverables tidak boleh negatif.")
      .optional(),
    target_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Target date harus format YYYY-MM-DD.")
      .optional(),
    notes: z.string().trim().max(500, "Catatan target maksimal 500 karakter.").optional(),
  })
  .strict()
  .default({});

export type CampaignTargetMetrics = z.infer<typeof campaignTargetMetricsSchema>;

/** Baca target_metrics secara toleran (baris lama peta-metrik / {} tetap tampil). */
export function parseTargetMetricsLenient(value: unknown): CampaignTargetMetrics {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const out: CampaignTargetMetrics = {};
  if (
    typeof v.target_deliverables === "number" &&
    Number.isInteger(v.target_deliverables) &&
    v.target_deliverables >= 0
  ) {
    out.target_deliverables = v.target_deliverables;
  }
  if (typeof v.target_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.target_date)) {
    out.target_date = v.target_date;
  }
  if (typeof v.notes === "string" && v.notes.trim().length > 0) {
    out.notes = v.notes.trim().slice(0, 500);
  }
  return out;
}

/** Brand scope (P1-A7, 0016): null = semua brand; array UUID = hanya brand itu. */
export const brandScopeSchema = z
  .array(z.string().uuid("Brand scope harus berisi UUID brand."))
  .max(50, "Brand scope maksimal 50 brand.")
  .nullable();

/** Update campaign (tanpa status — status hanya lewat transisi). */
export const campaignUpdateSchema = z.object({
  campaignId: z.string().uuid("campaign_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  name: z.string().trim().min(2, "Nama campaign minimal 2 karakter.").max(120),
  objective: z.string().trim().max(500).optional().default(""),
  audienceId: optionalUuid,
  startAt: optionalDatetime,
  endAt: optionalDatetime,
  targetMetrics: campaignTargetMetricsSchema,
  brandIds: z.array(z.string().uuid()).max(20).default([]),
});

/** Transisi status campaign (ASUMSI-5.5; cancelled wajib alasan). */
export const campaignStatusTransitionSchema = z.object({
  campaignId: z.string().uuid("campaign_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  toStatus: z.enum(["draft", "active", "completed", "archived", "cancelled"]),
  reason: z.string().trim().max(500).optional().default(""),
});

/** Urutan visual: daftar placement (UUID) untuk satu (brand, channel). */
export const visualOrderSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  brandId: z.string().uuid("brand_id tidak valid."),
  channelId: z.string().uuid("channel_id tidak valid."),
  placementIds: z.array(z.string().uuid()).max(200).default([]),
});

/** Template campaign (simpan) + buat campaign dari template. */
export const campaignTemplateSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  name: z.string().trim().min(2, "Nama template minimal 2 karakter.").max(120),
  sourceCampaignId: optionalUuid,
  objective: z.string().trim().max(500).optional().default(""),
  audienceId: optionalUuid,
  targetMetrics: campaignTargetMetricsSchema,
  brandIds: z.array(z.string().uuid()).max(20).default([]),
});

export const createCampaignFromTemplateSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  templateId: z.string().uuid("template_id tidak valid."),
  name: z.string().trim().min(2, "Nama campaign minimal 2 karakter.").max(120),
});

/** Template konten (simpan) + buat konten dari template.
 * Bila sourceContentItemId diisi, judul/brand/naskah/caption/channel
 * diambil dari konten sumber di server (form hanya mengirim nama template)
 * — field form menjadi opsional. Bila tidak ada sumber, field form wajib. */
export const contentTemplateSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  name: z.string().trim().min(2, "Nama template minimal 2 karakter.").max(120),
  sourceContentItemId: optionalUuid,
  title: z.string().trim().min(2, "Judul template minimal 2 karakter.").max(200).optional(),
  brandId: z.string().uuid("brand_id tidak valid.").optional(),
  pillarId: optionalUuid,
  script: z.string().trim().max(20000).optional().default(""),
  caption: z.string().trim().max(5000).optional().default(""),
  placementChannels: z
    .array(
      z.object({
        channelId: z.string().uuid(),
        format: z.string().trim().max(60).optional().default(""),
      }),
    )
    .max(20)
    .default([]),
});

export const createContentFromTemplateSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  templateId: z.string().uuid("template_id tidak valid."),
  title: z.string().trim().min(2, "Judul konten minimal 2 karakter.").max(200),
});

/** Atur brand scope anggota (hanya owner/admin; null = semua brand). */
export const memberBrandScopeSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  memberUserId: z.string().uuid("member_user_id tidak valid."),
  brandScope: brandScopeSchema,
});

export const campaignSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  name: z.string().trim().min(2, "Nama campaign minimal 2 karakter.").max(120),
  objective: z.string().trim().max(500).optional().default(""),
  audienceId: optionalUuid,
  startAt: optionalDatetime,
  endAt: optionalDatetime,
  status: z.enum(["draft", "active", "completed", "archived", "cancelled"]).default("draft"),
  targetMetrics: campaignTargetMetricsSchema,
  brandIds: z.array(z.string().uuid()).max(20).default([]),
});

export const ideaSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  brandId: optionalUuid,
  title: z.string().trim().min(2, "Judul ide minimal 2 karakter.").max(200),
  sourceType: z
    .enum(["chat", "meeting", "social", "research", "internal", "other"])
    .optional()
    .default("other"),
  notes: z.string().trim().max(2000).optional().default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  status: z.enum(["new", "considering", "converted", "dropped"]).default("new"),
});

export const contentItemSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  brandId: z.string().uuid("brand_id tidak valid."),
  campaignId: optionalUuid,
  pillarId: optionalUuid,
  audienceId: optionalUuid,
  originIdeaId: optionalUuid,
  title: z.string().trim().min(2, "Judul konten minimal 2 karakter.").max(200),
  internalDescription: z.string().trim().max(2000).optional().default(""),
  objective: z.string().trim().max(500).optional().default(""),
  funnelStage: z
    .enum(["awareness", "consideration", "conversion", "retention", "advocacy"])
    .nullable()
    .optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
  dueAt: optionalDatetime,
  timezone: z.string().min(1).max(64).default("Asia/Jakarta"),
  script: z.string().trim().max(10000).optional().default(""),
  caption: z.string().trim().max(5000).optional().default(""),
  cta: z.string().trim().max(300).optional().default(""),
  creativeNotes: z.string().trim().max(2000).optional().default(""),
  changeSummary: z.string().trim().min(2, "Ringkasan perubahan wajib diisi.").max(500),
});

export const contentItemUpdateSchema = contentItemSchema.extend({
  contentItemId: z.string().uuid("content_item_id tidak valid."),
});

export const placementSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  contentItemId: z.string().uuid("content_item_id tidak valid."),
  socialChannelId: z.string().uuid("social_channel_id tidak valid."),
  platformFormat: z
    .enum(["feed", "reel", "story", "carousel", "video", "short", "live", "article", "other"])
    .nullable()
    .optional(),
  platformCaption: z.string().trim().max(5000).optional().default(""),
  platformHashtags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  scheduledAt: optionalWallClock,
  timezone: z.string().min(1).max(64).default("Asia/Jakarta"),
  distributionStatus: z
    .enum([
      "draft",
      "ready",
      "scheduled_locally",
      "sending",
      "uploaded_or_draft_created",
      "published",
      "failed",
      "needs_manual_action",
      "cancelled",
    ])
    .default("draft"),
});

export const reschedulePlacementSchema = z.object({
  placementId: z.string().uuid("placement_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  scheduledAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
    message: "Waktu jadwal tidak valid.",
  }),
  timezone: z.string().min(1).max(64).default("Asia/Jakarta"),
  /** true = pengguna sudah melihat peringatan collision dan memilih "tetap". */
  force: z.boolean().default(false),
});

export const transitionContentSchema = z.object({
  contentItemId: z.string().uuid("content_item_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  toStatus: z.enum([
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
  ]),
  reason: z.string().trim().max(500).optional().default(""),
});

export const distributionTransitionSchema = z.object({
  placementId: z.string().uuid("placement_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  toStatus: z.enum([
    "draft",
    "ready",
    "scheduled_locally",
    "sending",
    "uploaded_or_draft_created",
    "published",
    "failed",
    "needs_manual_action",
    "cancelled",
  ]),
  reason: z.string().trim().max(500).optional().default(""),
});

export const tagSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  name: z.string().trim().min(2, "Nama tag minimal 2 karakter.").max(60),
  slug: slugField,
});

// ============================================================================
// Skema Production Operations — Phase 3 (P3-04 s.d. P3-11)
// Nilai enum dikunci di sini (ADR-0009 §1/§2); CHECK database 0009
// menegakkan nilai yang sama. MIME + ukuran file dicek dari ISI file
// (features/production/mime.ts) — bukan dari ekstensi nama file.
// ============================================================================

/** Snapshot brief (ADR-0009 §6): struktur tetap, tersimpan di content_versions.brief_snapshot. */
export const briefSnapshotSchema = z.object({
  objective: z.string().trim().max(500).optional().default(""),
  audience: z.string().trim().max(200).optional().default(""),
  angle: z.string().trim().max(500).optional().default(""),
  format: z.string().trim().max(120).optional().default(""),
  keyMessages: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  cta: z.string().trim().max(300).optional().default(""),
  references: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
});
export type BriefSnapshot = z.infer<typeof briefSnapshotSchema>;

/** Satu field template brief: { key, label, type, required } (ADR-0009 §6). */
export const briefTemplateFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*$/, "Key field hanya huruf kecil, angka, dan garis bawah.")
    .min(2)
    .max(40),
  label: z.string().trim().min(2, "Label field minimal 2 karakter.").max(80),
  type: z.enum(["text", "list"]),
  required: z.boolean().default(false),
});
export type BriefTemplateField = z.infer<typeof briefTemplateFieldSchema>;

/** schema_json template: { fields: [...] } — maksimal 12 field. */
export const briefTemplateSchemaJson = z.object({
  fields: z.array(briefTemplateFieldSchema).min(1, "Template wajib punya minimal 1 field.").max(12),
});

export const briefTemplateSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  name: z.string().trim().min(2, "Nama template minimal 2 karakter.").max(120),
  schemaJson: briefTemplateSchemaJson,
});

export const briefTemplateUpdateSchema = briefTemplateSchema.extend({
  templateId: z.string().uuid("template_id tidak valid."),
});

export const setDefaultBriefTemplateSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  templateId: z.string().uuid("template_id tidak valid."),
});

/** Simpan brief ke content item (membuat versi baru via RPC 0008 — P3-05). */
export const updateBriefSchema = z.object({
  contentItemId: z.string().uuid("content_item_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  briefSnapshot: briefSnapshotSchema,
  changeSummary: z.string().trim().min(2, "Ringkasan perubahan wajib diisi.").max(500),
});

export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const TASK_PARENT_TYPES = ["content_item", "campaign"] as const;

export const taskSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  parentType: z.enum(TASK_PARENT_TYPES),
  parentId: z.string().uuid("parent_id tidak valid."),
  title: z.string().trim().min(2, "Judul task minimal 2 karakter.").max(200),
  description: z.string().trim().max(2000).optional().default(""),
  assigneeUserId: optionalUuid,
  dueAt: optionalDatetime,
  priority: z.enum(TASK_PRIORITIES).default("medium"),
  estimateMinutes: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d+$/.test(v), { message: "Estimasi harus angka menit." })
    .transform((v) => (v === "" ? null : Number(v)))
    .nullable()
    .optional(),
  checklist: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
});

export const taskStatusSchema = z.object({
  taskId: z.string().uuid("task_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  toStatus: z.enum(TASK_STATUSES),
});

export const taskChecklistSchema = z.object({
  taskId: z.string().uuid("task_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  title: z.string().trim().min(1, "Judul item checklist wajib diisi.").max(200),
});

export const taskChecklistToggleSchema = z.object({
  checklistItemId: z.string().uuid("checklist_item_id tidak valid."),
  taskId: z.string().uuid("task_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  isDone: z.enum(["true", "false"]),
});

export const COMMENT_TARGET_TYPES = ["content_item", "campaign", "task"] as const;

export const commentSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  targetType: z.enum(COMMENT_TARGET_TYPES),
  targetId: z.string().uuid("target_id tidak valid."),
  parentCommentId: optionalUuid,
  body: z.string().trim().min(1, "Isi komentar wajib diisi.").max(5000),
  mentionedUserIds: z.array(z.string().uuid()).max(20).default([]),
});

export const commentEditSchema = z.object({
  commentId: z.string().uuid("comment_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  body: z.string().trim().min(1, "Isi komentar wajib diisi.").max(5000),
});

export const commentDeleteSchema = z.object({
  commentId: z.string().uuid("comment_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
});

export const ASSET_USAGE_ROLES = ["primary", "reference", "thumbnail", "attachment"] as const;

export const assetAttachSchema = z.object({
  contentItemId: z.string().uuid("content_item_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  assetId: z.string().uuid("asset_id tidak valid."),
  usageRole: z.enum(ASSET_USAGE_ROLES).default("attachment"),
});

export const assetDetachSchema = z.object({
  contentAssetId: z.string().uuid("content_asset_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
});

export const assetDeleteSchema = z.object({
  assetId: z.string().uuid("asset_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
});

export const restoreVersionSchema = z.object({
  contentItemId: z.string().uuid("content_item_id tidak valid."),
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  versionNumber: z.coerce.number().int().positive("Nomor versi tidak valid."),
});

export const clientCommentsSettingSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  allowed: z.enum(["true", "false"]),
});

export const markNotificationReadSchema = z.object({
  notificationId: z.string().uuid("notification_id tidak valid."),
});

// ============================================================================
// Approval (Phase 4 — ADR-0010, migrasi 0013/0014)
// ============================================================================

export const APPROVAL_REQUEST_STATUSES = [
  "submitted",
  "in_review",
  "approved",
  "changes_requested",
  "rejected",
  "reapproval_required",
] as const;

export const APPROVAL_DECISIONS = ["approved", "changes_requested", "rejected"] as const;

export const APPROVAL_ROLES = [
  "owner",
  "admin",
  "manager",
  "strategist",
  "creator",
  "editor",
  "approver",
  "analyst",
  "viewer_client",
] as const;

export const submitApprovalSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  contentItemId: z.string().uuid("content_item_id tidak valid."),
  contentVersionId: z.string().uuid("content_version_id tidak valid."),
  placementVersionId: optionalUuid.default(null),
});

export const decideApprovalSchema = z
  .object({
    requestId: z.string().uuid("request_id tidak valid."),
    workspaceId: z.string().uuid("workspace_id tidak valid."),
    decision: z.enum(APPROVAL_DECISIONS),
    comment: z.string().trim().max(5000, "Komentar maksimal 5000 karakter.").default(""),
  })
  .refine(
    (v) => v.decision === "approved" || v.comment.length > 0,
    "Minta revisi / tolak wajib disertai komentar.",
  );

export const submitClientReviewSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  contentItemId: z.string().uuid("content_item_id tidak valid."),
  contentVersionId: z.string().uuid("content_version_id tidak valid."),
});

export const assignWorkflowStepSchema = z
  .object({
    workspaceId: z.string().uuid("workspace_id tidak valid."),
    stepId: z.string().uuid("step_id tidak valid."),
    assigneeRole: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .pipe(z.enum(APPROVAL_ROLES).nullable())
      .default(null),
    assigneeUserId: optionalUuid.default(null),
  })
  .refine(
    (v) => v.assigneeRole !== null || v.assigneeUserId !== null,
    "Pilih role atau pengguna yang ditugaskan (minimal satu terisi).",
  );

export const updateApprovalSettingsSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  clientReviewEnabled: z.enum(["true", "false", ""]).default(""),
  clientCanComment: z.enum(["true", "false", ""]).default(""),
  criticalFields: z.string().default(""),
});

export const clientCommentSchema = z.object({
  shareId: z.string().uuid("share_id tidak valid."),
  body: z.string().trim().min(1, "Isi komentar wajib diisi.").max(5000),
});

/** Skema publishing (Phase 6, ADR-0012). Jadwal memakai wall-clock
 * "YYYY-MM-DDTHH:mm" — konversi ke UTC dilakukan server action dengan zona
 * placement secara eksplisit (features/publishing/utils.ts), BUKAN dengan
 * `new Date(v)` (zona server = UTC, akan geser 7 jam untuk WIB). */
const wallClockDatetime = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v), {
    message: "Format tanggal/waktu tidak valid (YYYY-MM-DDTHH:mm).",
  });

export const createPublishingJobSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  placementId: z.string().uuid("placement_id tidak valid."),
  scheduledAt: wallClockDatetime
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .default(null),
  timezone: z.string().trim().max(64, "Zona waktu maksimal 64 karakter.").default(""),
});

export const retryPublishingJobSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  jobId: z.string().uuid("job_id tidak valid."),
});

export const cancelPublishingJobSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  jobId: z.string().uuid("job_id tidak valid."),
  reason: z
    .string()
    .trim()
    .min(1, "Alasan pembatalan wajib diisi.")
    .max(500, "Alasan pembatalan maksimal 500 karakter."),
});

export const confirmPublishingJobSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  jobId: z.string().uuid("job_id tidak valid."),
  canonicalUrl: z
    .string()
    .trim()
    .min(1, "URL publikasi wajib diisi.")
    .max(2048, "URL publikasi maksimal 2048 karakter.")
    .refine((v) => /^https?:\/\/[^/\s]+[^\s]*$/.test(v), {
      message: "URL publikasi tidak valid — isi URL lengkap (http:// atau https://) tanpa spasi.",
    }),
  publishedAt: wallClockDatetime,
});

export const reschedulePublishingJobSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  jobId: z.string().uuid("job_id tidak valid."),
  scheduledAt: wallClockDatetime,
  timezone: z.string().trim().max(64, "Zona waktu maksimal 64 karakter.").default(""),
});

/**
 * Impor analytics CSV (Phase 7): satu snapshot = satu periode.
 * brandId kosong = impor multi-brand (brand_id NULL di snapshot);
 * RPC tetap menegakkan scope per subject.
 */
export const importAnalyticsCsvSchema = z
  .object({
    workspaceId: z.string().uuid("workspace_id tidak valid."),
    brandId: z
      .string()
      .uuid("brand_id tidak valid.")
      .nullable()
      .optional()
      .default(null),
    periodStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Periode awal harus format YYYY-MM-DD."),
    periodEnd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Periode akhir harus format YYYY-MM-DD."),
    rawReference: z
      .string()
      .trim()
      .max(200, "Referensi file maksimal 200 karakter.")
      .default(""),
    csvText: z.string().min(1, "Isi CSV wajib diisi — tempel CSV atau unggah file."),
  })
  .refine((v) => v.periodStart <= v.periodEnd, {
    message: "Periode awal tidak boleh sesudah periode akhir.",
    path: ["periodEnd"],
  });
