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

/** target_metrics: pemetaan kunci metrik → angka target (ADR-0007 §5). */
export const campaignTargetMetricsSchema = z.record(z.string(), z.number()).default({});

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
  scheduledAt: optionalDatetime,
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
