/**
 * Server actions Planning Core — features/planning/actions.ts (P2-04 s.d. P2-14)
 * Aturan (pola Phase 1, features/tenancy/actions.ts):
 *  - Zod dulu (boundary), lalu sesi + peran dari DB (BUKAN dari body),
 *    lalu Supabase client sesi (RLS penegak terakhir).
 *  - Operasi multi-tulis (buat konten + v1, konversi ide, transisi,
 *    reschedule) lewat RPC 0008 — SATU transaksi Postgres.
 *  - TIDAK ADA publish, TIDAK ADA klaim "terhubung", remote_post_id /
 *    published_url TIDAK PERNAH diisi (CHECK 0007 menolaknya).
 *  - Brand TIDAK BISA pindah workspace (tidak ada action untuk itu; slug
 *    tidak bisa diubah setelah dibuat).
 */
"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";
import { brandInScope, can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import {
  audienceSchema,
  brandSchema,
  brandUpdateSchema,
  campaignSchema,
  channelSchema,
  contentItemSchema,
  contentItemUpdateSchema,
  distributionTransitionSchema,
  ideaSchema,
  pillarSchema,
  placementSchema,
  reschedulePlacementSchema,
  tagSchema,
  transitionContentSchema,
} from "@/lib/validation/schemas";
import { getCallerBrandScope, getCallerRole, PLANNING_TABLES_UNAVAILABLE_ID } from "./context";
import {
  canConvertIdea,
  canEditSpecificContent,
  isValidDistributionTransition,
  isValidProductionTransition,
  productionTransitionRequiresReason,
} from "./transitions";
import { findCollision } from "./calendar";
import type { ContentPlacement } from "./types";
import { zonedWallClockToUtcIso } from "../publishing/utils";

/**
 * Normalisasi jadwal placement ke UTC ISO. Wall-clock polos ("YYYY-MM-DDTHH:mm"
 * dari datetime-local) dibaca di zona placement; ISO ber-offset (jalur edit /
 * nilai lama dari DB) dipakai apa adanya sebagai instan absolut. JANGAN
 * `new Date(v)` untuk wall-clock polos — zona server UTC menggesernya 7 jam
 * untuk WIB (cacat Phase 6, A6.2: placement menyimpan 19:53 UTC padahal
 * pengguna maksud 19:53 WIB, lalu write-back job menembakkan trigger 0014).
 */
function placementScheduledAtToUtc(
  value: string | null | undefined,
  timeZone: string,
): string | null {
  if (!value) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return zonedWallClockToUtcIso(value, timeZone);
}

export type PlanningActionResult = {
  ok: boolean;
  message: string;
  collision?: boolean;
  contentItemId?: string;
  placementId?: string;
  versionNumber?: number;
};

const ok = (message: string, extra?: Partial<PlanningActionResult>): PlanningActionResult => ({
  ok: true,
  message,
  ...extra,
});
const fail = (message: string, extra?: Partial<PlanningActionResult>): PlanningActionResult => ({
  ok: false,
  message,
  ...extra,
});

function isMissingTableMessage(message: string): boolean {
  return /Could not find the table|does not exist|42P01|PGRST205|Could not find the function/i.test(
    message,
  );
}

function dbErrorMessage(error: { message?: string } | null, fallback: string): string {
  const message = error?.message ?? fallback;
  if (isMissingTableMessage(message)) return PLANNING_TABLES_UNAVAILABLE_ID;
  return `${fallback}: ${message}`;
}

async function requireUser() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { supabase: null, user: null };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Peran pemanggil di workspace; null bila bukan member / belum masuk. */
async function requireRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const role = await getCallerRole(workspaceId, userId);
  return (role as WorkspaceRole | null) ?? null;
}

function revalidatePlanning() {
  for (const p of [
    "/merek",
    "/channel",
    "/pilar",
    "/kampanye",
    "/ide",
    "/konten",
    "/konten/baru",
    "/kalender",
    "/board",
    "/cari",
    "/dashboard",
  ]) {
    revalidatePath(p);
  }
}

// ============================================================================
// P2-04 — Brands
// ============================================================================

export async function createBrandAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = brandSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description") ?? "",
    status: formData.get("status") ?? "active",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_brands_channels"))
    return fail("Hanya owner/admin/manager yang boleh membuat brand.");
  const { error } = await supabase.from("brands").insert({
    workspace_id: parsed.data.workspaceId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    description: parsed.data.description || null,
    status: parsed.data.status,
    brand_settings: {},
  });
  if (error) {
    if (error.code === "23505") return fail("Slug brand sudah dipakai di workspace ini.");
    return fail(dbErrorMessage(error, "Gagal membuat brand"));
  }
  revalidatePlanning();
  return ok("Brand dibuat.");
}

export async function updateBrandAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = brandUpdateSchema.safeParse({
    brandId: formData.get("brandId"),
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    status: formData.get("status"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_brands_channels"))
    return fail("Hanya owner/admin/manager yang boleh mengubah brand.");
  // Slug TIDAK diubah (identitas brand; pindah workspace TIDAK ADA jalurnya).
  const { error } = await supabase
    .from("brands")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      status: parsed.data.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.brandId)
    .eq("workspace_id", parsed.data.workspaceId);
  if (error) return fail(dbErrorMessage(error, "Gagal mengubah brand"));
  revalidatePlanning();
  return ok("Brand diubah.");
}

// ============================================================================
// P2-05 — Social Channel Registry (metadata SAJA)
// ============================================================================

export async function createChannelAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = channelSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    brandId: formData.get("brandId"),
    platform: formData.get("platform"),
    accountName: formData.get("accountName") ?? "",
    handle: formData.get("handle") ?? "",
    providerAccountId: formData.get("providerAccountId") ?? "",
    connectionStatus: formData.get("connectionStatus") ?? "not_connected",
    timezone: formData.get("timezone") ?? "Asia/Jakarta",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_brands_channels"))
    return fail("Hanya owner/admin/manager yang boleh menambah channel.");
  // Brand harus milik workspace ini (trigger scope juga memeriksa).
  const { data: brand } = await supabase
    .from("brands")
    .select("id, workspace_id")
    .eq("id", parsed.data.brandId)
    .single();
  if (!brand || brand.workspace_id !== parsed.data.workspaceId)
    return fail("Brand tidak ditemukan di workspace ini.");
  const { error } = await supabase.from("social_channels").insert({
    brand_id: parsed.data.brandId,
    platform: parsed.data.platform,
    account_name: parsed.data.accountName || null,
    handle: parsed.data.handle || null,
    provider_account_id: parsed.data.providerAccountId || null,
    // connection_status awal HANYA not_connected/manual; capability_snapshot
    // kosong = "belum diperiksa" (P2-A2). TIDAK ADA token/OAuth di sini.
    connection_status: parsed.data.connectionStatus,
    capability_snapshot: {},
    timezone: parsed.data.timezone,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal menambah channel"));
  revalidatePlanning();
  return ok("Channel dicatat sebagai metadata (belum terhubung).");
}

export async function updateChannelAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = channelSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    brandId: formData.get("brandId"),
    platform: formData.get("platform"),
    accountName: formData.get("accountName") ?? "",
    handle: formData.get("handle") ?? "",
    providerAccountId: formData.get("providerAccountId") ?? "",
    connectionStatus: formData.get("connectionStatus") ?? "not_connected",
    timezone: formData.get("timezone") ?? "Asia/Jakarta",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const channelId = String(formData.get("channelId") ?? "");
  if (!channelId) return fail("channel_id tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_brands_channels"))
    return fail("Hanya owner/admin/manager yang boleh mengubah channel.");
  const { error } = await supabase
    .from("social_channels")
    .update({
      account_name: parsed.data.accountName || null,
      handle: parsed.data.handle || null,
      provider_account_id: parsed.data.providerAccountId || null,
      connection_status: parsed.data.connectionStatus,
      timezone: parsed.data.timezone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", channelId);
  if (error) return fail(dbErrorMessage(error, "Gagal mengubah channel"));
  revalidatePlanning();
  return ok("Channel diubah.");
}

// ============================================================================
// P2-06 — Pillars + Audiences
// ============================================================================

export async function createPillarAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = pillarSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    brandId: formData.get("brandId") ?? "",
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    colorToken: formData.get("colorToken") ?? "teal",
    active: formData.get("active") !== "false",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Hanya owner/admin/manager/strategist yang boleh membuat pilar.");
  const { error } = await supabase.from("content_pillars").insert({
    workspace_id: parsed.data.workspaceId,
    brand_id: parsed.data.brandId ?? null,
    name: parsed.data.name,
    description: parsed.data.description || null,
    color_token: parsed.data.colorToken,
    active: parsed.data.active,
  });
  if (error) {
    if (error.code === "23505") return fail("Nama pilar sudah dipakai untuk brand ini.");
    return fail(dbErrorMessage(error, "Gagal membuat pilar"));
  }
  revalidatePlanning();
  return ok("Pilar dibuat.");
}

export async function updatePillarAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const pillarId = String(formData.get("pillarId") ?? "");
  const parsed = pillarSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    brandId: formData.get("brandId") ?? "",
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    colorToken: formData.get("colorToken") ?? "teal",
    active: formData.get("active") !== "false",
  });
  if (!parsed.success || !pillarId) return fail("Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Hanya owner/admin/manager/strategist yang boleh mengubah pilar.");
  const { error } = await supabase
    .from("content_pillars")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      color_token: parsed.data.colorToken,
      active: parsed.data.active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pillarId)
    .eq("workspace_id", parsed.data.workspaceId);
  if (error) return fail(dbErrorMessage(error, "Gagal mengubah pilar"));
  revalidatePlanning();
  return ok("Pilar diubah.");
}

export async function createAudienceAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  // Atribut dirakit di server dari field form (bukan JSON mentah dari klien).
  const splitList = (v: FormDataEntryValue | null): string[] =>
    String(v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const attributes: Record<string, unknown> = {};
  const ageRange = String(formData.get("ageRange") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const interests = splitList(formData.get("interests"));
  const painPoints = splitList(formData.get("painPoints"));
  if (ageRange) attributes.age_range = ageRange;
  if (location) attributes.location = location;
  if (interests.length > 0) attributes.interests = interests;
  if (painPoints.length > 0) attributes.pain_points = painPoints;
  const parsed = audienceSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    attributes,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Hanya owner/admin/manager/strategist yang boleh membuat audiens.");
  const { error } = await supabase.from("audiences").insert({
    workspace_id: parsed.data.workspaceId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    attributes: parsed.data.attributes,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal membuat audiens"));
  revalidatePlanning();
  return ok("Audiens dibuat.");
}

// ============================================================================
// P2-07 — Campaigns (+ campaign_brands)
// ============================================================================

export async function createCampaignAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  // Target: bentuk minimal 3 field (ASUMSI-5.3) — bukan lagi JSON bebas.
  const targetMetrics: Record<string, unknown> = {};
  const targetDeliverablesRaw = String(formData.get("targetDeliverables") ?? "").trim();
  if (targetDeliverablesRaw !== "") {
    targetMetrics.target_deliverables = Number(targetDeliverablesRaw);
  }
  const targetDateRaw = String(formData.get("targetDate") ?? "").trim();
  if (targetDateRaw !== "") targetMetrics.target_date = targetDateRaw;
  const targetNotesRaw = String(formData.get("targetNotes") ?? "").trim();
  if (targetNotesRaw !== "") targetMetrics.notes = targetNotesRaw;
  const parsed = campaignSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    objective: formData.get("objective") ?? "",
    audienceId: formData.get("audienceId") ?? "",
    startAt: formData.get("startAt") ?? "",
    endAt: formData.get("endAt") ?? "",
    status: formData.get("status") ?? "draft",
    targetMetrics,
    brandIds: formData.getAll("brandIds").map(String),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  if (parsed.data.startAt && parsed.data.endAt && parsed.data.endAt < parsed.data.startAt) {
    return fail("Tanggal selesai tidak boleh sebelum tanggal mulai.");
  }
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Hanya owner/admin/manager/strategist yang boleh membuat campaign.");
  const scope = await getCallerBrandScope(parsed.data.workspaceId, user.id);
  for (const brandId of parsed.data.brandIds) {
    if (!brandInScope(scope, brandId)) {
      return fail("Salah satu brand yang dipilih di luar scope Anda.");
    }
  }
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: parsed.data.workspaceId,
      name: parsed.data.name,
      objective: parsed.data.objective || null,
      audience_id: parsed.data.audienceId ?? null,
      start_at: parsed.data.startAt ?? null,
      end_at: parsed.data.endAt ?? null,
      status: parsed.data.status,
      owner_user_id: user.id,
      target_metrics: parsed.data.targetMetrics,
    })
    .select("id")
    .single();
  if (error || !campaign) return fail(dbErrorMessage(error, "Gagal membuat campaign"));
  if (parsed.data.brandIds.length > 0) {
    const { error: linkError } = await supabase
      .from("campaign_brands")
      .insert(
        parsed.data.brandIds.map((brandId) => ({ campaign_id: campaign.id, brand_id: brandId })),
      );
    if (linkError)
      return fail(dbErrorMessage(linkError, "Campaign dibuat, tetapi tautan brand gagal"));
  }
  revalidatePlanning();
  return ok("Campaign dibuat.");
}

export async function unlinkCampaignBrandAction(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!campaignId || !brandId || !workspaceId) return;
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return;
  const role = await requireRole(workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns")) return;
  await supabase
    .from("campaign_brands")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("brand_id", brandId);
  revalidatePlanning();
}

// ============================================================================
// P2-08 — Ideas (tangkap minimal) + konversi transaksional
// ============================================================================

export async function createIdeaAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = ideaSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    brandId: formData.get("brandId") ?? "",
    title: formData.get("title"),
    sourceType: formData.get("sourceType") ?? "other",
    notes: formData.get("notes") ?? "",
    tags: formData
      .getAll("tags")
      .map(String)
      .flatMap((t) =>
        t
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    status: formData.get("status") ?? "new",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "create_ideas_briefs"))
    return fail("Peran Anda tidak boleh menangkap ide.");
  const { error } = await supabase.from("ideas").insert({
    workspace_id: parsed.data.workspaceId,
    brand_id: parsed.data.brandId ?? null,
    title: parsed.data.title,
    source_type: parsed.data.sourceType,
    notes: parsed.data.notes || null,
    tags: parsed.data.tags,
    status: parsed.data.status,
    owner_user_id: user.id,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal menyimpan ide"));
  revalidatePlanning();
  return ok("Ide ditangkap.");
}

export async function updateIdeaStatusAction(formData: FormData): Promise<void> {
  const ideaId = String(formData.get("ideaId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!ideaId || !workspaceId || !["new", "considering", "dropped"].includes(status)) return;
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return;
  const role = await requireRole(workspaceId, user.id);
  if (!role || !can(role, "create_ideas_briefs")) return;
  await supabase
    .from("ideas")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", ideaId)
    .eq("workspace_id", workspaceId);
  revalidatePlanning();
}

/**
 * Konversi ide → content item baru (RPC 0008: satu transaksi, anti-ganda).
 * Dipakai DUA cara: langsung sebagai form action (`<form action={...}>`,
 * React memanggil dengan FormData sebagai argumen pertama) dan lewat
 * useActionState (prevState, formData).
 */
export async function convertIdeaAction(
  prevOrForm: PlanningActionResult | FormData,
  maybeFormData?: FormData,
): Promise<PlanningActionResult> {
  const formData = maybeFormData ?? (prevOrForm as FormData);
  const ideaId = String(formData.get("ideaId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const title = String(formData.get("title") ?? "").trim() || undefined;
  const brandIdRaw = String(formData.get("brandId") ?? "").trim();
  if (!ideaId || !workspaceId) return fail("Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(workspaceId, user.id);
  if (!role || !can(role, "create_ideas_briefs"))
    return fail("Peran Anda tidak boleh mengonversi ide.");
  const { data: idea } = await supabase
    .from("ideas")
    .select("status, converted_content_item_id, brand_id")
    .eq("id", ideaId)
    .single();
  if (
    idea &&
    !canConvertIdea(idea as { status: string | null; converted_content_item_id: string | null })
  ) {
    return fail("Ide ini sudah dikonversi dan tidak bisa dikonversi ulang.");
  }
  // (b) K-3: brand efektif = p_brand_id (bila diisi) atau brand ide.
  // Cek scope terhadap brand efektif itu — sama seperti createCampaignAction.
  // Bila belum ada brand efektif, biarkan RPC menolak dengan pesan bersih.
  const effectiveBrandId =
    brandIdRaw || (idea?.brand_id as string | null | undefined) || null;
  if (effectiveBrandId) {
    const scope = await getCallerBrandScope(workspaceId, user.id);
    if (!brandInScope(scope, effectiveBrandId)) {
      return fail("Brand konten hasil konversi di luar scope Anda.");
    }
  }
  const { data, error } = await supabase.rpc("convert_idea_to_content", {
    p_idea_id: ideaId,
    p_title: title ?? null,
    p_brand_id: brandIdRaw || null,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal mengonversi ide"));
  const result = data as { ok: boolean; message?: string; content_item_id?: string } | null;
  if (!result?.ok) return fail(result?.message ?? "Gagal mengonversi ide.");
  revalidatePlanning();
  return ok("Ide dikonversi menjadi konten baru (v1).", {
    contentItemId: result.content_item_id,
  });
}

// ============================================================================
// P2-09 — Content Items + versi baseline (RPC 0008)
// ============================================================================

export async function createContentAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = contentItemSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    brandId: formData.get("brandId"),
    campaignId: formData.get("campaignId") ?? "",
    pillarId: formData.get("pillarId") ?? "",
    audienceId: formData.get("audienceId") ?? "",
    originIdeaId: formData.get("originIdeaId") ?? "",
    title: formData.get("title"),
    internalDescription: formData.get("internalDescription") ?? "",
    objective: formData.get("objective") ?? "",
    funnelStage: formData.get("funnelStage") || null,
    priority: formData.get("priority") || null,
    dueAt: formData.get("dueAt") ?? "",
    timezone: formData.get("timezone") ?? "Asia/Jakarta",
    script: formData.get("script") ?? "",
    caption: formData.get("caption") ?? "",
    cta: formData.get("cta") ?? "",
    creativeNotes: formData.get("creativeNotes") ?? "",
    changeSummary: formData.get("changeSummary") ?? "Versi awal (v1)",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "create_edit_content"))
    return fail("Peran Anda tidak boleh membuat konten.");
  // (b) K-3: brand scope (pola createCampaignAction) — anggota dengan
  // brand_scope terbatas hanya boleh membuat konten untuk brand di scope-nya.
  const scope = await getCallerBrandScope(parsed.data.workspaceId, user.id);
  if (!brandInScope(scope, parsed.data.brandId)) {
    return fail("Brand yang dipilih di luar scope Anda.");
  }
  const { data, error } = await supabase.rpc("create_content_item_with_version", {
    p_workspace_id: parsed.data.workspaceId,
    p_brand_id: parsed.data.brandId,
    p_title: parsed.data.title,
    p_campaign_id: parsed.data.campaignId ?? null,
    p_pillar_id: parsed.data.pillarId ?? null,
    p_audience_id: parsed.data.audienceId ?? null,
    p_internal_description: parsed.data.internalDescription || null,
    p_objective: parsed.data.objective || null,
    p_funnel_stage: parsed.data.funnelStage ?? null,
    p_priority: parsed.data.priority ?? null,
    p_due_at: parsed.data.dueAt ?? null,
    p_timezone: parsed.data.timezone,
    p_origin_idea_id: parsed.data.originIdeaId ?? null,
    p_script: parsed.data.script || null,
    p_caption: parsed.data.caption || null,
    p_cta: parsed.data.cta || null,
    p_creative_notes: parsed.data.creativeNotes || null,
    p_brief_snapshot: {},
    p_change_summary: parsed.data.changeSummary,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal membuat konten"));
  const result = data as { ok: boolean; message?: string; content_item_id?: string } | null;
  if (!result?.ok) return fail(result?.message ?? "Gagal membuat konten.");
  revalidatePlanning();
  return ok("Konten dibuat beserta versi v1.", { contentItemId: result.content_item_id });
}

export async function updateContentAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = contentItemUpdateSchema.safeParse({
    contentItemId: formData.get("contentItemId"),
    workspaceId: formData.get("workspaceId"),
    brandId: formData.get("brandId"),
    campaignId: formData.get("campaignId") ?? "",
    pillarId: formData.get("pillarId") ?? "",
    audienceId: formData.get("audienceId") ?? "",
    originIdeaId: formData.get("originIdeaId") ?? "",
    title: formData.get("title"),
    internalDescription: formData.get("internalDescription") ?? "",
    objective: formData.get("objective") ?? "",
    funnelStage: formData.get("funnelStage") || null,
    priority: formData.get("priority") || null,
    dueAt: formData.get("dueAt") ?? "",
    timezone: formData.get("timezone") ?? "Asia/Jakarta",
    script: formData.get("script") ?? "",
    caption: formData.get("caption") ?? "",
    cta: formData.get("cta") ?? "",
    creativeNotes: formData.get("creativeNotes") ?? "",
    changeSummary: formData.get("changeSummary") ?? "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "create_edit_content"))
    return fail("Peran Anda tidak boleh mengedit konten.");
  const { data: item } = await supabase
    .from("content_items")
    .select("owner_user_id")
    .eq("id", parsed.data.contentItemId)
    .single();
  if (!item) return fail("Content item tidak ditemukan.");
  if (!canEditSpecificContent(role, item.owner_user_id === user.id))
    return fail("Anda hanya boleh mengedit konten yang ditugaskan kepada Anda.");
  // (b) K-1: brief_snapshot TIDAK dikirim form Overview (ContentForm tidak
  // punya field brief) — baca dari versi terbaru dan teruskan, seperti
  // updateBriefAction/updateScriptAction (loadItemForVersionUpdate).
  // Mengirim {} di sini akan MENGHAPUS brief yang sudah diisi di tab Brief.
  const { data: latestVersion } = await supabase
    .from("content_versions")
    .select("brief_snapshot")
    .eq("content_item_id", parsed.data.contentItemId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();
  const { data, error } = await supabase.rpc("update_content_item_with_version", {
    p_content_item_id: parsed.data.contentItemId,
    p_title: parsed.data.title,
    p_internal_description: parsed.data.internalDescription || null,
    p_objective: parsed.data.objective || null,
    p_funnel_stage: parsed.data.funnelStage ?? null,
    p_priority: parsed.data.priority ?? null,
    p_due_at: parsed.data.dueAt ?? null,
    p_campaign_id: parsed.data.campaignId ?? null,
    p_pillar_id: parsed.data.pillarId ?? null,
    p_audience_id: parsed.data.audienceId ?? null,
    p_script: parsed.data.script || null,
    p_caption: parsed.data.caption || null,
    p_cta: parsed.data.cta || null,
    p_creative_notes: parsed.data.creativeNotes || null,
    p_brief_snapshot: latestVersion?.brief_snapshot ?? {},
    p_change_summary: parsed.data.changeSummary,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal menyimpan perubahan"));
  const result = data as { ok: boolean; message?: string; version_number?: number } | null;
  if (!result?.ok) return fail(result?.message ?? "Gagal menyimpan perubahan.");
  revalidatePlanning();
  return ok(`Perubahan disimpan sebagai versi v${result.version_number}.`, {
    versionNumber: result.version_number,
  });
}

// ============================================================================
// P2-12/P2-14 — Transisi production + distribusi (RPC 0008)
// ============================================================================

export async function transitionContentAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = transitionContentSchema.safeParse({
    contentItemId: formData.get("contentItemId"),
    workspaceId: formData.get("workspaceId"),
    toStatus: formData.get("toStatus"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "create_edit_content"))
    return fail("Peran Anda tidak boleh mengubah status konten.");
  const { data: item } = await supabase
    .from("content_items")
    .select("owner_user_id, production_status")
    .eq("id", parsed.data.contentItemId)
    .single();
  if (!item) return fail("Content item tidak ditemukan.");
  if (!canEditSpecificContent(role, item.owner_user_id === user.id))
    return fail("Anda hanya boleh mengubah status konten yang ditugaskan kepada Anda.");
  const from = item.production_status as Parameters<typeof isValidProductionTransition>[0];
  const to = parsed.data.toStatus;
  if (!isValidProductionTransition(from, to))
    return fail(`Transisi ${from} → ${to} tidak diizinkan.`);
  if (productionTransitionRequiresReason(from, to) && !parsed.data.reason.trim())
    return fail("Alasan wajib diisi untuk transisi ini.");
  const { data, error } = await supabase.rpc("transition_content_item_status", {
    p_content_item_id: parsed.data.contentItemId,
    p_to_status: to,
    p_reason: parsed.data.reason || null,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal mengubah status"));
  const result = data as { ok: boolean; message?: string } | null;
  if (!result?.ok) return fail(result?.message ?? "Gagal mengubah status.");
  revalidatePlanning();
  return ok(`Status produksi diubah: ${from} → ${to}.`);
}

export async function transitionDistributionAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = distributionTransitionSchema.safeParse({
    placementId: formData.get("placementId"),
    workspaceId: formData.get("workspaceId"),
    toStatus: formData.get("toStatus"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "create_edit_content"))
    return fail("Peran Anda tidak boleh mengubah status distribusi.");
  const { data: placement } = await supabase
    .from("content_placements")
    .select("distribution_status, content_items(owner_user_id)")
    .eq("id", parsed.data.placementId)
    .single();
  if (!placement) return fail("Placement tidak ditemukan.");
  const ownerId = (placement.content_items as unknown as { owner_user_id: string } | null)
    ?.owner_user_id;
  if (!canEditSpecificContent(role, ownerId === user.id))
    return fail("Anda hanya boleh mengubah placement konten yang ditugaskan kepada Anda.");
  const from = placement.distribution_status as Parameters<typeof isValidDistributionTransition>[0];
  if (!isValidDistributionTransition(from, parsed.data.toStatus))
    return fail(`Transisi distribusi ${from} → ${parsed.data.toStatus} tidak diizinkan.`);
  const { data, error } = await supabase.rpc("change_placement_distribution", {
    p_placement_id: parsed.data.placementId,
    p_to_status: parsed.data.toStatus,
    p_reason: parsed.data.reason || null,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal mengubah status distribusi"));
  const result = data as { ok: boolean; message?: string } | null;
  if (!result?.ok) return fail(result?.message ?? "Gagal mengubah status distribusi.");
  revalidatePlanning();
  return ok(`Status distribusi diubah: ${from} → ${parsed.data.toStatus}.`);
}

// ============================================================================
// P2-10/P2-11 — Placements + reschedule (RPC 0008 untuk reschedule)
// ============================================================================

export async function createPlacementAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = placementSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentItemId: formData.get("contentItemId"),
    socialChannelId: formData.get("socialChannelId"),
    platformFormat: formData.get("platformFormat") || null,
    platformCaption: formData.get("platformCaption") ?? "",
    platformHashtags: formData
      .getAll("platformHashtags")
      .map(String)
      .flatMap((t) =>
        t
          .split(",")
          .map((s) => s.trim().replace(/^#/, ""))
          .filter(Boolean),
      ),
    scheduledAt: formData.get("scheduledAt") ?? "",
    timezone: formData.get("timezone") ?? "Asia/Jakarta",
    distributionStatus: formData.get("distributionStatus") ?? "draft",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  // Jadwal wall-clock → UTC di zona placement (BUKAN new Date(v) — lihat
  // placementScheduledAtToUtc). Bila konversi gagal, tolak dengan jelas.
  const scheduledAtUtc = placementScheduledAtToUtc(
    parsed.data.scheduledAt,
    parsed.data.timezone,
  );
  if (parsed.data.scheduledAt && !scheduledAtUtc) return fail("Tanggal/waktu tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "create_edit_content"))
    return fail("Peran Anda tidak boleh menambah placement.");
  // Validasi scope: channel harus milik brand yang sama dengan item
  // (trigger 0007 juga menolak; diperiksa di sini agar pesannya jelas).
  const { data: item } = await supabase
    .from("content_items")
    .select("id, brand_id, owner_user_id, workspace_id")
    .eq("id", parsed.data.contentItemId)
    .single();
  if (!item || item.workspace_id !== parsed.data.workspaceId)
    return fail("Content item tidak ditemukan di workspace ini.");
  if (!canEditSpecificContent(role, item.owner_user_id === user.id))
    return fail("Anda hanya boleh menambah placement pada konten yang ditugaskan kepada Anda.");
  const { data: channel } = await supabase
    .from("social_channels")
    .select("id, brand_id")
    .eq("id", parsed.data.socialChannelId)
    .single();
  if (!channel || channel.brand_id !== item.brand_id)
    return fail("Channel harus milik brand yang sama dengan konten ini.");
  // Collision: peringatan dini di server (keputusan akhir tetap di tangan pengguna lewat `force`).
  if (scheduledAtUtc) {
    const { data: siblings } = await supabase
      .from("content_placements")
      .select("id, social_channel_id, scheduled_at, content_item_id")
      .eq("content_item_id", parsed.data.contentItemId);
    const clash = findCollision(
      (siblings ?? []) as ContentPlacement[],
      parsed.data.socialChannelId,
      scheduledAtUtc,
    );
    if (clash) {
      return fail(
        "Sudah ada placement lain di channel ini pada waktu yang sama persis. Pilih waktu lain.",
      );
    }
  }
  const { data: placement, error } = await supabase
    .from("content_placements")
    .insert({
      content_item_id: parsed.data.contentItemId,
      social_channel_id: parsed.data.socialChannelId,
      platform_format: parsed.data.platformFormat ?? null,
      platform_caption: parsed.data.platformCaption || null,
      platform_hashtags: parsed.data.platformHashtags,
      scheduled_at: scheduledAtUtc,
      timezone: parsed.data.timezone,
      distribution_status: parsed.data.distributionStatus,
      platform_metadata: {},
      // remote_post_id / published_url TIDAK PERNAH diisi di fase ini.
      remote_post_id: null,
      published_url: null,
    })
    .select("id")
    .single();
  if (error || !placement) return fail(dbErrorMessage(error, "Gagal menambah placement"));
  // Placement version v1 (lineage untuk approval Phase 4). Bila gagal,
  // hapus placement yang barusan dibuat agar tidak ada record setengah jadi.
  const { error: versionError } = await supabase.from("placement_versions").insert({
    placement_id: placement.id,
    version_number: 1,
    payload_snapshot: {
      platform_format: parsed.data.platformFormat ?? null,
      platform_caption: parsed.data.platformCaption || null,
      platform_hashtags: parsed.data.platformHashtags,
      scheduled_at: scheduledAtUtc,
      timezone: parsed.data.timezone,
      distribution_status: parsed.data.distributionStatus,
    },
    created_by: user.id,
  });
  if (versionError) {
    await supabase.from("content_placements").delete().eq("id", placement.id);
    return fail(dbErrorMessage(versionError, "Gagal mencatat versi placement"));
  }
  revalidatePlanning();
  return ok("Placement ditambahkan (versi v1).", { placementId: placement.id });
}

export async function updatePlacementAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const placementId = String(formData.get("placementId") ?? "");
  const parsed = placementSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentItemId: formData.get("contentItemId"),
    socialChannelId: formData.get("socialChannelId"),
    platformFormat: formData.get("platformFormat") || null,
    platformCaption: formData.get("platformCaption") ?? "",
    platformHashtags: formData
      .getAll("platformHashtags")
      .map(String)
      .flatMap((t) =>
        t
          .split(",")
          .map((s) => s.trim().replace(/^#/, ""))
          .filter(Boolean),
      ),
    scheduledAt: formData.get("scheduledAt") ?? "",
    timezone: formData.get("timezone") ?? "Asia/Jakarta",
    distributionStatus: formData.get("distributionStatus") ?? "draft",
  });
  if (!parsed.success || !placementId) return fail("Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "create_edit_content"))
    return fail("Peran Anda tidak boleh mengubah placement.");
  const { data: current } = await supabase
    .from("content_placements")
    .select("id, distribution_status, scheduled_at, content_items(owner_user_id)")
    .eq("id", placementId)
    .single();
  if (!current) return fail("Placement tidak ditemukan.");
  const ownerId = (current.content_items as unknown as { owner_user_id: string } | null)
    ?.owner_user_id;
  if (!canEditSpecificContent(role, ownerId === user.id))
    return fail("Anda hanya boleh mengubah placement konten yang ditugaskan kepada Anda.");
  // Jadwal + status distribusi TIDAK diubah di sini (jalur RPC masing-masing).
  const { error } = await supabase
    .from("content_placements")
    .update({
      platform_format: parsed.data.platformFormat ?? null,
      platform_caption: parsed.data.platformCaption || null,
      platform_hashtags: parsed.data.platformHashtags,
      timezone: parsed.data.timezone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", placementId);
  if (error) return fail(dbErrorMessage(error, "Gagal mengubah placement"));
  const { data: versions } = await supabase
    .from("placement_versions")
    .select("version_number")
    .eq("placement_id", placementId)
    .order("version_number", { ascending: false })
    .limit(1);
  const nextVersion = ((versions?.[0]?.version_number as number | undefined) ?? 0) + 1;
  const { error: versionError } = await supabase.from("placement_versions").insert({
    placement_id: placementId,
    version_number: nextVersion,
    payload_snapshot: {
      platform_format: parsed.data.platformFormat ?? null,
      platform_caption: parsed.data.platformCaption || null,
      platform_hashtags: parsed.data.platformHashtags,
      scheduled_at: current.scheduled_at,
      timezone: parsed.data.timezone,
      distribution_status: current.distribution_status,
    },
    created_by: user.id,
  });
  if (versionError)
    return fail(dbErrorMessage(versionError, "Placement diubah, tetapi versi baru gagal dicatat"));
  revalidatePlanning();
  return ok(`Placement diubah (versi v${nextVersion}).`, { versionNumber: nextVersion });
}

export async function deletePlacementAction(formData: FormData): Promise<void> {
  const placementId = String(formData.get("placementId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!placementId || !workspaceId) return;
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return;
  const role = await requireRole(workspaceId, user.id);
  if (!role || !can(role, "create_edit_content")) return;
  // RLS: placement hanya bisa dihapus oleh editor konten induknya.
  await supabase.from("content_placements").delete().eq("id", placementId);
  revalidatePlanning();
}

/** Jadwalkan ulang satu placement (RPC 0008). Kembalikan collision bila ada. */
export async function reschedulePlacementAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = reschedulePlacementSchema.safeParse({
    placementId: formData.get("placementId"),
    workspaceId: formData.get("workspaceId"),
    scheduledAt: formData.get("scheduledAt"),
    timezone: formData.get("timezone") ?? "Asia/Jakarta",
    force: formData.get("force") === "true",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "schedule_publish"))
    return fail("Hanya owner/admin/manager/strategist yang boleh menjadwalkan ulang.");
  const { data, error } = await supabase.rpc("reschedule_placement", {
    p_placement_id: parsed.data.placementId,
    p_scheduled_at: new Date(parsed.data.scheduledAt).toISOString(),
    p_timezone: parsed.data.timezone,
    p_force: parsed.data.force,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal menjadwalkan ulang"));
  const result = data as {
    ok: boolean;
    message?: string;
    collision?: boolean;
    version_number?: number;
  } | null;
  if (!result?.ok) {
    return fail(result?.message ?? "Gagal menjadwalkan ulang.", {
      collision: result?.collision ?? false,
    });
  }
  revalidatePlanning();
  return ok("Jadwal placement diubah.", { versionNumber: result.version_number });
}

// ============================================================================
// Tags (ternormalisasi) — P2-02/ P2-09
// ============================================================================

export async function createTagAction(
  _prev: PlanningActionResult,
  formData: FormData,
): Promise<PlanningActionResult> {
  const parsed = tagSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Hanya owner/admin/manager/strategist yang boleh membuat tag.");
  const { error } = await supabase.from("tags").insert({
    workspace_id: parsed.data.workspaceId,
    name: parsed.data.name,
    slug: parsed.data.slug,
  });
  if (error) {
    if (error.code === "23505") return fail("Slug tag sudah dipakai di workspace ini.");
    return fail(dbErrorMessage(error, "Gagal membuat tag"));
  }
  revalidatePlanning();
  return ok("Tag dibuat.");
}

export async function linkTagAction(formData: FormData): Promise<void> {
  const contentItemId = String(formData.get("contentItemId") ?? "");
  const tagId = String(formData.get("tagId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!contentItemId || !tagId || !workspaceId) return;
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return;
  const role = await requireRole(workspaceId, user.id);
  if (!role || !can(role, "create_edit_content")) return;
  await supabase.from("content_tags").insert({ content_item_id: contentItemId, tag_id: tagId });
  revalidatePlanning();
}

export async function unlinkTagAction(formData: FormData): Promise<void> {
  const contentItemId = String(formData.get("contentItemId") ?? "");
  const tagId = String(formData.get("tagId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!contentItemId || !tagId || !workspaceId) return;
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return;
  const role = await requireRole(workspaceId, user.id);
  if (!role || !can(role, "create_edit_content")) return;
  await supabase
    .from("content_tags")
    .delete()
    .eq("content_item_id", contentItemId)
    .eq("tag_id", tagId);
  revalidatePlanning();
}
