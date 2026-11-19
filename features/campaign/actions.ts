/**
 * Server actions Campaign & Visual Planning — features/campaign/actions.ts (P5-03 s.d. P5-08).
 * Pola Phase 2/3/4: Zod dulu (boundary), lalu sesi + peran dari DB (BUKAN
 * dari body), lalu Supabase client sesi (RLS penegak terakhir).
 * Brand scope (0016) dicek juga di lapis aplikasi lewat getCallerBrandScope
 * agar pesan galatnya jelas — RLS tetap penegak terakhir.
 * - Status campaign HANYA lewat transitionCampaignAction (graf ADR-0011 §4).
 * - Urutan visual HANYA lewat RPC set_visual_order (visual-planner/actions).
 * - TIDAK ADA penutupan otomatis request basi (keputusan terbuka Phase 4).
 * - Form yang menampilkan pesan hasil aksi HARUS tetap mounted
 *   (pelajaran e2e Phase 3/4: jangan sembunyikan form useActionState
 *   berdasarkan hasil aksinya sendiri).
 */
"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";
import { brandInScope, can, canInvite } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import {
  campaignStatusTransitionSchema,
  campaignTemplateSchema,
  campaignUpdateSchema,
  contentTemplateSchema,
  createCampaignFromTemplateSchema,
  createContentFromTemplateSchema,
  memberBrandScopeSchema,
  parseTargetMetricsLenient,
} from "@/lib/validation/schemas";
import {
  getCallerBrandScope,
  getCallerRole,
  PLANNING_TABLES_UNAVAILABLE_ID,
} from "@/features/planning/context";
import { listCampaigns } from "@/features/planning/queries";
import type { Campaign } from "@/features/planning/types";
import { CAMPAIGN_TABLES_UNAVAILABLE_ID } from "./constants";
import { exportCampaignsCsv, parseCampaignCsv, validateCampaignCsvRow } from "./csv";
import { getCampaign, listCampaignBrands, listCampaignDeliverables } from "./queries";
import { campaignTransitionRequiresReason, isValidCampaignTransition } from "./transitions";
import type { CsvImportReport } from "./types";

export type CampaignActionResult = {
  ok: boolean;
  message: string;
  campaignId?: string;
  contentItemId?: string;
  csv?: string;
  report?: CsvImportReport;
};

const ok = (message: string, extra?: Partial<CampaignActionResult>): CampaignActionResult => ({
  ok: true,
  message,
  ...extra,
});
const fail = (message: string, extra?: Partial<CampaignActionResult>): CampaignActionResult => ({
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

async function requireRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const role = await getCallerRole(workspaceId, userId);
  return (role as WorkspaceRole | null) ?? null;
}

function revalidateCampaign(campaignId?: string) {
  for (const p of [
    "/kampanye",
    "/kalender",
    "/dashboard",
    "/template",
    ...(campaignId ? [`/kampanye/${campaignId}`, `/kampanye/${campaignId}/visual`] : []),
  ]) {
    revalidatePath(p);
  }
}

async function logActivity(
  supabase: NonNullable<Awaited<ReturnType<typeof requireUser>>["supabase"]>,
  input: {
    workspaceId: string;
    actorUserId: string;
    entityType: string;
    entityId: string | null;
    action: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
) {
  // Jejak audit best-effort: gagal log tidak boleh menggagalkan aksi utama.
  await supabase.from("activity_logs").insert({
    workspace_id: input.workspaceId,
    actor_user_id: input.actorUserId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    before_snapshot: input.before ?? null,
    after_snapshot: input.after ?? null,
    metadata: input.metadata ?? {},
  });
}

/** Ubah campaign (nama, tujuan, audiens, tanggal, target, brand) — tanpa status. */
export async function updateCampaignAction(
  _prev: CampaignActionResult,
  formData: FormData,
): Promise<CampaignActionResult> {
  const parsed = campaignUpdateSchema.safeParse({
    campaignId: formData.get("campaignId"),
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    objective: formData.get("objective") ?? "",
    audienceId: formData.get("audienceId") || null,
    startAt: formData.get("startAt") || null,
    endAt: formData.get("endAt") || null,
    targetMetrics: {
      target_deliverables:
        formData.get("targetDeliverables") === "" || formData.get("targetDeliverables") == null
          ? undefined
          : Number(formData.get("targetDeliverables")),
      target_date: (formData.get("targetDate") as string) || undefined,
      notes: (formData.get("targetNotes") as string) || undefined,
    },
    brandIds: formData.getAll("brandIds"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Peran Anda tidak boleh mengubah campaign.");
  const scope = await getCallerBrandScope(parsed.data.workspaceId, user.id);
  for (const brandId of parsed.data.brandIds) {
    if (!brandInScope(scope, brandId)) {
      return fail("Salah satu brand yang dipilih di luar scope Anda.");
    }
  }
  const campaignOutcome = await getCampaign(supabase, parsed.data.campaignId);
  if (!campaignOutcome.ok) return fail(CAMPAIGN_TABLES_UNAVAILABLE_ID);
  const campaign = campaignOutcome.data;
  if (!campaign || campaign.workspace_id !== parsed.data.workspaceId) {
    return fail("Campaign tidak ditemukan di workspace ini.");
  }
  const metrics = parsed.data.targetMetrics;
  const targetMetrics: Record<string, unknown> = {};
  if (metrics.target_deliverables !== undefined) targetMetrics.target_deliverables = metrics.target_deliverables;
  if (metrics.target_date !== undefined) targetMetrics.target_date = metrics.target_date;
  if (metrics.notes !== undefined) targetMetrics.notes = metrics.notes;
  const { error } = await supabase
    .from("campaigns")
    .update({
      name: parsed.data.name,
      objective: parsed.data.objective || null,
      audience_id: parsed.data.audienceId ?? null,
      start_at: parsed.data.startAt ?? null,
      end_at: parsed.data.endAt ?? null,
      target_metrics: targetMetrics,
    })
    .eq("id", parsed.data.campaignId);
  if (error) return fail(dbErrorMessage(error, "Gagal mengubah campaign"));
  // Ganti tautan brand (tautan brand di luar scope pemanggil TIDAK ikut
  // terhapus — RLS melindunginya; batas jujur ADR-0011 §2, dicatat di laporan).
  const { error: deleteError } = await supabase
    .from("campaign_brands")
    .delete()
    .eq("campaign_id", parsed.data.campaignId);
  if (deleteError) return fail(dbErrorMessage(deleteError, "Gagal mengganti brand campaign"));
  if (parsed.data.brandIds.length > 0) {
    const { error: linkError } = await supabase.from("campaign_brands").insert(
      parsed.data.brandIds.map((brandId) => ({
        campaign_id: parsed.data.campaignId,
        brand_id: brandId,
      })),
    );
    if (linkError) return fail(dbErrorMessage(linkError, "Gagal menautkan brand campaign"));
  }
  await logActivity(supabase, {
    workspaceId: parsed.data.workspaceId,
    actorUserId: user.id,
    entityType: "campaign",
    entityId: parsed.data.campaignId,
    action: "campaign.updated",
    before: { name: campaign.name, status: campaign.status },
    after: { name: parsed.data.name },
  });
  revalidateCampaign(parsed.data.campaignId);
  return ok("Campaign diperbarui.", { campaignId: parsed.data.campaignId });
}

/** Transisi status campaign (graf ADR-0011 §4; cancelled wajib alasan). */
export async function transitionCampaignAction(
  _prev: CampaignActionResult,
  formData: FormData,
): Promise<CampaignActionResult> {
  const parsed = campaignStatusTransitionSchema.safeParse({
    campaignId: formData.get("campaignId"),
    workspaceId: formData.get("workspaceId"),
    toStatus: formData.get("toStatus"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Peran Anda tidak boleh mengubah status campaign.");
  const campaignOutcome = await getCampaign(supabase, parsed.data.campaignId);
  if (!campaignOutcome.ok) return fail(CAMPAIGN_TABLES_UNAVAILABLE_ID);
  const campaign = campaignOutcome.data;
  if (!campaign || campaign.workspace_id !== parsed.data.workspaceId) {
    return fail("Campaign tidak ditemukan di workspace ini.");
  }
  if (campaign.status === parsed.data.toStatus) {
    return fail(`Campaign sudah berstatus ${campaign.status}.`);
  }
  if (!isValidCampaignTransition(campaign.status, parsed.data.toStatus)) {
    return fail(
      `Transisi ${campaign.status} → ${parsed.data.toStatus} tidak diizinkan. ` +
        `Dari ${campaign.status}, yang bisa dipilih: ` +
        `${["draft", "active", "completed", "archived", "cancelled"].filter((s) => isValidCampaignTransition(campaign.status, s)).join(", ") || "tidak ada"}.`,
    );
  }
  if (campaignTransitionRequiresReason(parsed.data.toStatus) && !parsed.data.reason) {
    return fail("Alasan pembatalan wajib diisi.");
  }
  const { error } = await supabase
    .from("campaigns")
    .update({ status: parsed.data.toStatus })
    .eq("id", parsed.data.campaignId);
  if (error) return fail(dbErrorMessage(error, "Gagal mengubah status campaign"));
  await logActivity(supabase, {
    workspaceId: parsed.data.workspaceId,
    actorUserId: user.id,
    entityType: "campaign",
    entityId: parsed.data.campaignId,
    action: "campaign.status_changed",
    before: { status: campaign.status },
    after: { status: parsed.data.toStatus, reason: parsed.data.reason || undefined },
  });
  revalidateCampaign(parsed.data.campaignId);
  return ok(`Status campaign diubah menjadi ${parsed.data.toStatus}.`, {
    campaignId: parsed.data.campaignId,
  });
}

/** Tautkan konten ke campaign (brand konten harus masuk scope pemanggil). */
export async function linkCampaignContentAction(
  _prev: CampaignActionResult,
  formData: FormData,
): Promise<CampaignActionResult> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const contentItemId = String(formData.get("contentItemId") ?? "");
  if (!campaignId || !workspaceId || !contentItemId) return fail("Data tidak lengkap.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Peran Anda tidak boleh mengubah campaign.");
  const { data: item, error: itemError } = await supabase
    .from("content_items")
    .select("id, brand_id, campaign_id, workspace_id")
    .eq("id", contentItemId)
    .single();
  if (itemError || !item || item.workspace_id !== workspaceId) {
    return fail("Konten tidak ditemukan di workspace ini (atau di luar scope Anda).");
  }
  const scope = await getCallerBrandScope(workspaceId, user.id);
  if (!brandInScope(scope, item.brand_id)) {
    return fail("Brand konten ini di luar scope Anda.");
  }
  if (item.campaign_id === campaignId) return ok("Konten sudah terhubung ke campaign ini.");
  const { error } = await supabase
    .from("content_items")
    .update({ campaign_id: campaignId })
    .eq("id", contentItemId);
  if (error) return fail(dbErrorMessage(error, "Gagal menautkan konten"));
  revalidateCampaign(campaignId);
  return ok("Konten ditautkan ke campaign.", { campaignId });
}

/** Lepas konten dari campaign. */
export async function unlinkCampaignContentAction(
  _prev: CampaignActionResult,
  formData: FormData,
): Promise<CampaignActionResult> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const contentItemId = String(formData.get("contentItemId") ?? "");
  if (!campaignId || !workspaceId || !contentItemId) return fail("Data tidak lengkap.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Peran Anda tidak boleh mengubah campaign.");
  const { data: item } = await supabase
    .from("content_items")
    .select("id, campaign_id, workspace_id")
    .eq("id", contentItemId)
    .single();
  if (!item || item.workspace_id !== workspaceId || item.campaign_id !== campaignId) {
    return fail("Konten tidak terhubung ke campaign ini.");
  }
  const { error } = await supabase
    .from("content_items")
    .update({ campaign_id: null })
    .eq("id", contentItemId);
  if (error) return fail(dbErrorMessage(error, "Gagal melepas konten"));
  revalidateCampaign(campaignId);
  return ok("Konten dilepas dari campaign.", { campaignId });
}

/** Tautkan brand ke campaign (brand harus masuk scope pemanggil). */
export async function linkCampaignBrandAction(
  _prev: CampaignActionResult,
  formData: FormData,
): Promise<CampaignActionResult> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  if (!campaignId || !workspaceId || !brandId) return fail("Data tidak lengkap.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Peran Anda tidak boleh mengubah campaign.");
  const scope = await getCallerBrandScope(workspaceId, user.id);
  if (!brandInScope(scope, brandId)) return fail("Brand ini di luar scope Anda.");
  const { error } = await supabase
    .from("campaign_brands")
    .insert({ campaign_id: campaignId, brand_id: brandId });
  if (error) {
    if (error.code === "23505") return ok("Brand sudah terhubung ke campaign ini.");
    return fail(dbErrorMessage(error, "Gagal menautkan brand"));
  }
  revalidateCampaign(campaignId);
  return ok("Brand ditautkan ke campaign.", { campaignId });
}

/** Simpan campaign sebagai template (salinan saja, ASUMSI-5.4). */
export async function saveCampaignAsTemplateAction(
  _prev: CampaignActionResult,
  formData: FormData,
): Promise<CampaignActionResult> {
  const parsed = campaignTemplateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    sourceCampaignId: formData.get("sourceCampaignId") || null,
    objective: formData.get("objective") ?? "",
    audienceId: formData.get("audienceId") || null,
    targetMetrics: {
      target_deliverables:
        formData.get("targetDeliverables") === "" || formData.get("targetDeliverables") == null
          ? undefined
          : Number(formData.get("targetDeliverables")),
      target_date: (formData.get("targetDate") as string) || undefined,
      notes: (formData.get("targetNotes") as string) || undefined,
    },
    brandIds: formData.getAll("brandIds"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Peran Anda tidak boleh menyimpan template.");
  const scope = await getCallerBrandScope(parsed.data.workspaceId, user.id);
  for (const brandId of parsed.data.brandIds) {
    if (!brandInScope(scope, brandId)) {
      return fail("Template tidak boleh berisi brand di luar scope Anda.");
    }
  }
  const { data: template, error } = await supabase
    .from("campaign_templates")
    .insert({
      workspace_id: parsed.data.workspaceId,
      name: parsed.data.name,
      source_campaign_id: parsed.data.sourceCampaignId ?? null,
      objective: parsed.data.objective || null,
      audience_id: parsed.data.audienceId ?? null,
      target_metrics: parsed.data.targetMetrics,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return fail(dbErrorMessage(error, "Gagal menyimpan template"));
  if (parsed.data.brandIds.length > 0) {
    const { error: linkError } = await supabase.from("campaign_template_brands").insert(
      parsed.data.brandIds.map((brandId) => ({ template_id: template.id, brand_id: brandId })),
    );
    if (linkError) return fail(dbErrorMessage(linkError, "Gagal menautkan brand template"));
  }
  revalidatePath("/template");
  return ok("Template campaign disimpan.");
}

/** Buat campaign baru dari template (salinan saja, ASUMSI-5.4). */
export async function createCampaignFromTemplateAction(
  _prev: CampaignActionResult,
  formData: FormData,
): Promise<CampaignActionResult> {
  const parsed = createCampaignFromTemplateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    templateId: formData.get("templateId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Peran Anda tidak boleh membuat campaign.");
  const { data: template, error: templateError } = await supabase
    .from("campaign_templates")
    .select("id, workspace_id, objective, audience_id, target_metrics, campaign_template_brands(brand_id)")
    .eq("id", parsed.data.templateId)
    .single();
  if (templateError || !template || template.workspace_id !== parsed.data.workspaceId) {
    return fail("Template tidak ditemukan di workspace ini (atau di luar scope Anda).");
  }
  const scope = await getCallerBrandScope(parsed.data.workspaceId, user.id);
  const brandIds = (template.campaign_template_brands as Array<{ brand_id: string }>).map(
    (b) => b.brand_id,
  );
  for (const brandId of brandIds) {
    if (!brandInScope(scope, brandId)) {
      return fail("Template ini berisi brand di luar scope Anda.");
    }
  }
  const { data: existing } = await supabase
    .from("campaigns")
    .select("id")
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("name", parsed.data.name)
    .limit(1);
  if ((existing ?? []).length > 0) {
    return fail("Nama campaign sudah dipakai di workspace ini.");
  }
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: parsed.data.workspaceId,
      name: parsed.data.name,
      objective: template.objective,
      audience_id: template.audience_id,
      status: "draft",
      owner_user_id: user.id,
      target_metrics: parseTargetMetricsLenient(template.target_metrics),
    })
    .select("id")
    .single();
  if (error) return fail(dbErrorMessage(error, "Gagal membuat campaign dari template"));
  if (brandIds.length > 0) {
    const { error: linkError } = await supabase.from("campaign_brands").insert(
      brandIds.map((brandId) => ({ campaign_id: campaign.id, brand_id: brandId })),
    );
    if (linkError) return fail(dbErrorMessage(linkError, "Gagal menautkan brand campaign"));
  }
  revalidateCampaign(campaign.id);
  return ok("Campaign dibuat dari template.", { campaignId: campaign.id });
}

/** Simpan konten sebagai template (salinan saja, ASUMSI-5.4).
 * Bila sourceContentItemId diisi, isi template diambil dari konten sumber
 * di server (judul/brand/naskah/caption/channel) — form hanya mengirim nama. */
export async function saveContentAsTemplateAction(
  _prev: CampaignActionResult,
  formData: FormData,
): Promise<CampaignActionResult> {
  const parsed = contentTemplateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    sourceContentItemId: formData.get("sourceContentItemId") || null,
    title: (formData.get("title") as string) || undefined,
    brandId: (formData.get("brandId") as string) || undefined,
    pillarId: formData.get("pillarId") || null,
    script: formData.get("script") ?? "",
    caption: formData.get("caption") ?? "",
    placementChannels: JSON.parse(String(formData.get("placementChannelsJson") ?? "[]")),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "create_edit_content"))
    return fail("Peran Anda tidak boleh menyimpan template konten.");
  const scope = await getCallerBrandScope(parsed.data.workspaceId, user.id);
  // Resolve isi template: dari konten sumber (bila ada) atau dari form.
  let title = parsed.data.title ?? "";
  let brandId = parsed.data.brandId ?? "";
  let pillarId = parsed.data.pillarId ?? null;
  let script = parsed.data.script ?? "";
  let caption = parsed.data.caption ?? "";
  let placementChannels = parsed.data.placementChannels;
  if (parsed.data.sourceContentItemId) {
    const { data: item, error: itemError } = await supabase
      .from("content_items")
      .select("id, title, brand_id, pillar_id, script, caption, workspace_id")
      .eq("id", parsed.data.sourceContentItemId)
      .single();
    if (itemError || !item || item.workspace_id !== parsed.data.workspaceId) {
      return fail("Konten sumber tidak ditemukan di workspace ini (atau di luar scope Anda).");
    }
    title = item.title;
    brandId = item.brand_id;
    pillarId = item.pillar_id;
    script = item.script ?? "";
    caption = item.caption ?? "";
    const { data: placements } = await supabase
      .from("content_placements")
      .select("social_channel_id, platform_format")
      .eq("content_item_id", item.id);
    placementChannels = (placements ?? []).map((p) => ({
      channelId: p.social_channel_id,
      format: p.platform_format ?? "",
    }));
  }
  if (!title || !brandId) {
    return fail("Judul dan brand template wajib diisi (atau pilih konten sumber).");
  }
  if (!brandInScope(scope, brandId)) {
    return fail("Brand konten ini di luar scope Anda.");
  }
  const { data: template, error } = await supabase
    .from("content_templates")
    .insert({
      workspace_id: parsed.data.workspaceId,
      name: parsed.data.name,
      source_content_item_id: parsed.data.sourceContentItemId ?? null,
      title,
      brand_id: brandId,
      pillar_id: pillarId,
      script: script || null,
      caption: caption || null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return fail(dbErrorMessage(error, "Gagal menyimpan template konten"));
  if (placementChannels.length > 0) {
    const { error: linkError } = await supabase.from("content_template_placements").insert(
      placementChannels.map((p) => ({
        template_id: template.id,
        social_channel_id: p.channelId,
        format: p.format || null,
      })),
    );
    if (linkError) return fail(dbErrorMessage(linkError, "Gagal menyimpan channel template"));
  }
  revalidatePath("/template");
  return ok("Template konten disimpan.");
}

/** Buat konten baru dari template (salinan saja; placement TANPA jadwal). */
export async function createContentFromTemplateAction(
  _prev: CampaignActionResult,
  formData: FormData,
): Promise<CampaignActionResult> {
  const parsed = createContentFromTemplateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    templateId: formData.get("templateId"),
    title: formData.get("title"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "create_edit_content"))
    return fail("Peran Anda tidak boleh membuat konten.");
  const { data: template, error: templateError } = await supabase
    .from("content_templates")
    .select(
      "id, workspace_id, brand_id, pillar_id, script, caption, content_template_placements(social_channel_id, format)",
    )
    .eq("id", parsed.data.templateId)
    .single();
  if (templateError || !template || template.workspace_id !== parsed.data.workspaceId) {
    return fail("Template tidak ditemukan di workspace ini (atau di luar scope Anda).");
  }
  const scope = await getCallerBrandScope(parsed.data.workspaceId, user.id);
  if (!brandInScope(scope, template.brand_id)) {
    return fail("Brand template ini di luar scope Anda.");
  }
  const { data, error } = await supabase.rpc("create_content_item_with_version", {
    p_workspace_id: parsed.data.workspaceId,
    p_brand_id: template.brand_id,
    p_title: parsed.data.title,
    p_campaign_id: null,
    p_pillar_id: template.pillar_id ?? null,
    p_audience_id: null,
    p_internal_description: null,
    p_objective: null,
    p_funnel_stage: null,
    p_priority: null,
    p_due_at: null,
    p_timezone: "Asia/Jakarta",
    p_origin_idea_id: null,
    p_script: template.script || null,
    p_caption: template.caption || null,
    p_cta: null,
    p_creative_notes: null,
    p_brief_snapshot: {},
    p_change_summary: `Dibuat dari template konten`,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal membuat konten dari template"));
  const result = data as { ok: boolean; message?: string; content_item_id?: string } | null;
  if (!result?.ok || !result.content_item_id) {
    return fail(result?.message ?? "Gagal membuat konten dari template.");
  }
  const channels = template.content_template_placements as Array<{
    social_channel_id: string;
    format: string | null;
  }>;
  if (channels.length > 0) {
    const { error: placementError } = await supabase.from("content_placements").insert(
      channels.map((c) => ({
        content_item_id: result.content_item_id,
        social_channel_id: c.social_channel_id,
        platform_format: c.format ?? null,
        scheduled_at: null,
        timezone: "Asia/Jakarta",
      })),
    );
    if (placementError) {
      return fail(dbErrorMessage(placementError, "Konten dibuat, tetapi placement template gagal dibuat"));
    }
  }
  revalidatePath("/konten");
  revalidatePath("/template");
  return ok("Konten dibuat dari template.", { contentItemId: result.content_item_id });
}

/** Ekspor semua campaign workspace sebagai CSV (format tetap, ASUMSI-5.6). */
export async function exportCampaignsCsvAction(formData: FormData): Promise<CampaignActionResult> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!workspaceId) return fail("Data tidak lengkap.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(workspaceId, user.id);
  if (!role || !can(role, "export_data"))
    return fail("Peran Anda tidak boleh mengekspor campaign.");
  const campaignsOutcome = await listCampaigns(supabase, workspaceId);
  if (campaignsOutcome.unavailable) return fail(PLANNING_TABLES_UNAVAILABLE_ID);
  const campaigns = campaignsOutcome.data as Campaign[];
  const { data: audiences } = await supabase
    .from("audiences")
    .select("id, name")
    .eq("workspace_id", workspaceId);
  const audienceById = new Map((audiences ?? []).map((a) => [a.id, a.name]));
  const rows = [];
  for (const campaign of campaigns) {
    const brandsOutcome = await listCampaignBrands(supabase, campaign.id);
    const deliverablesOutcome = await listCampaignDeliverables(supabase, campaign.id);
    const metrics = parseTargetMetricsLenient(campaign.target_metrics);
    rows.push({
      name: campaign.name,
      objective: campaign.objective ?? "",
      audienceName: campaign.audience_id ? (audienceById.get(campaign.audience_id) ?? "") : "",
      startAt: campaign.start_at ?? "",
      endAt: campaign.end_at ?? "",
      status: campaign.status,
      // Batas jujur: email member lain tidak bisa dibaca dari klien aplikasi
      // (auth.users hanya admin); hanya email pemanggil sendiri yang diisi.
      ownerEmail:
        campaign.owner_user_id === user.id ? (user.email ?? "") : "",
      targetDeliverables:
        metrics.target_deliverables !== undefined ? String(metrics.target_deliverables) : "",
      targetDate: metrics.target_date ?? "",
      notes: metrics.notes ?? "",
      brands: brandsOutcome.ok ? brandsOutcome.data.map((b) => b.name).join("; ") : "",
      deliverables: deliverablesOutcome.ok
        ? deliverablesOutcome.data.map((d) => d.title).join("; ")
        : "",
    });
  }
  return ok(`Diekspor ${rows.length} campaign.`, { csv: exportCampaignsCsv(rows) });
}

/**
 * Impor campaign dari CSV — per baris gagal tidak membatalkan baris lain
 * (R5.4). Laporan {total, imported, failed, errors, linkedDeliverables,
 * skippedDeliverables} + satu jejak activity_logs.
 * Batas jujur MVP: owner_email hanya bisa diverifikasi bila sama dengan
 * email pemanggil (email member lain tidak terbaca dari klien aplikasi);
 * email lain ditolak per baris dengan pesan jelas.
 */
export async function importCampaignsCsvAction(
  _prev: CampaignActionResult,
  formData: FormData,
): Promise<CampaignActionResult> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const file = formData.get("file");
  if (!workspaceId) return fail("Data tidak lengkap.");
  if (!(file instanceof File) || file.size === 0) return fail("Pilih file CSV yang berisi data.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(workspaceId, user.id);
  if (!role || !can(role, "manage_pillars_campaigns"))
    return fail("Peran Anda tidak boleh mengimpor campaign.");
  const text = await file.text();
  const parsedCsv = parseCampaignCsv(text);
  if (!parsedCsv.headersOk) {
    return fail(
      `Header CSV tidak lengkap — kolom yang hilang: ${parsedCsv.missingColumns.join(", ")}. ` +
        `Pakai format ekspor (urutan kolom tetap).`,
    );
  }
  const scope = await getCallerBrandScope(workspaceId, user.id);
  const callerEmail = (user.email ?? "").toLowerCase();
  const { data: brands } = await supabase
    .from("brands")
    .select("id, name")
    .eq("workspace_id", workspaceId);
  const { data: audiences } = await supabase
    .from("audiences")
    .select("id, name")
    .eq("workspace_id", workspaceId);
  const { data: existingCampaigns } = await supabase
    .from("campaigns")
    .select("name")
    .eq("workspace_id", workspaceId);
  const existingNames = new Set((existingCampaigns ?? []).map((c) => c.name.toLowerCase()));
  const importedNames = new Set<string>();
  const report: CsvImportReport = {
    total: 0,
    imported: 0,
    failed: 0,
    errors: [],
    linkedDeliverables: 0,
    skippedDeliverables: [],
  };
  const resolveByName = <T extends { id: string; name: string }>(
    list: T[] | null,
    name: string,
  ): { found: T | null; ambiguous: boolean } => {
    const matches = (list ?? []).filter((x) => x.name.toLowerCase() === name.toLowerCase());
    if (matches.length === 1) return { found: matches[0], ambiguous: false };
    if (matches.length > 1) return { found: null, ambiguous: true };
    return { found: null, ambiguous: false };
  };
  for (let i = 0; i < parsedCsv.rows.length; i++) {
    const row = parsedCsv.rows[i];
    const rowNumber = parsedCsv.rowNumbers[i];
    if (Object.values(row).every((v) => v.trim() === "")) continue;
    report.total += 1;
    const validated = validateCampaignCsvRow(row, rowNumber);
    if (!validated.ok) {
      report.failed += 1;
      report.errors.push({ row: rowNumber, message: validated.error });
      continue;
    }
    const d = validated.data;
    // owner_email: kosong = pemanggil; sama dengan email pemanggil = pemanggil;
    // email lain TIDAK bisa diverifikasi dari klien aplikasi → tolak baris.
    if (d.ownerEmail !== "" && d.ownerEmail !== callerEmail) {
      report.failed += 1;
      report.errors.push({
        row: rowNumber,
        message: `Baris ${rowNumber}: owner_email '${d.ownerEmail}' bukan email Anda — hanya email Anda sendiri yang bisa dipakai sebagai owner di impor ini (email member lain tidak terbaca).`,
      });
      continue;
    }
    // Audiens: wajib ketemu (bila diisi) dan tidak ambigu.
    let audienceId: string | null = null;
    if (d.audienceName !== "") {
      const { found, ambiguous } = resolveByName(audiences, d.audienceName);
      if (ambiguous) {
        report.failed += 1;
        report.errors.push({ row: rowNumber, message: `Baris ${rowNumber}: audience '${d.audienceName}' ambigu (ada lebih dari satu dengan nama itu).` });
        continue;
      }
      if (!found) {
        report.failed += 1;
        report.errors.push({ row: rowNumber, message: `Baris ${rowNumber}: audience '${d.audienceName}' tidak ditemukan di workspace ini.` });
        continue;
      }
      audienceId = found.id;
    }
    // Brand: semua nama wajib ketemu, tidak ambigu, dan masuk scope.
    const brandIds: string[] = [];
    let brandFailed = false;
    for (const brandName of d.brandNames) {
      const { found, ambiguous } = resolveByName(brands, brandName);
      if (ambiguous) {
        report.failed += 1;
        report.errors.push({ row: rowNumber, message: `Baris ${rowNumber}: brand '${brandName}' ambigu (ada lebih dari satu dengan nama itu).` });
        brandFailed = true;
        break;
      }
      if (!found) {
        report.failed += 1;
        report.errors.push({ row: rowNumber, message: `Baris ${rowNumber}: brand '${brandName}' tidak ditemukan di workspace ini (atau di luar scope Anda).` });
        brandFailed = true;
        break;
      }
      if (!brandInScope(scope, found.id)) {
        report.failed += 1;
        report.errors.push({ row: rowNumber, message: `Baris ${rowNumber}: brand '${brandName}' di luar scope Anda.` });
        brandFailed = true;
        break;
      }
      brandIds.push(found.id);
    }
    if (brandFailed) continue;
    // Nama duplikat (di DB maupun di file yang sama) ditolak per baris.
    const nameKey = d.name.toLowerCase();
    if (existingNames.has(nameKey) || importedNames.has(nameKey)) {
      report.failed += 1;
      report.errors.push({ row: rowNumber, message: `Baris ${rowNumber}: nama campaign '${d.name}' sudah dipakai di workspace ini.` });
      continue;
    }
    const metrics: Record<string, unknown> = {};
    if (d.targetDeliverables !== null) metrics.target_deliverables = d.targetDeliverables;
    if (d.targetDate !== "") metrics.target_date = d.targetDate;
    if (d.notes !== "") metrics.notes = d.notes;
    const { data: campaign, error: insertError } = await supabase
      .from("campaigns")
      .insert({
        workspace_id: workspaceId,
        name: d.name,
        objective: d.objective || null,
        audience_id: audienceId,
        start_at: d.startAt || null,
        end_at: d.endAt || null,
        status: d.status,
        owner_user_id: user.id,
        target_metrics: metrics,
      })
      .select("id")
      .single();
    if (insertError || !campaign) {
      report.failed += 1;
      report.errors.push({
        row: rowNumber,
        message: `Baris ${rowNumber}: gagal menyimpan campaign (${insertError?.message ?? "tidak diketahui"}).`,
      });
      continue;
    }
    importedNames.add(nameKey);
    if (brandIds.length > 0) {
      await supabase.from("campaign_brands").insert(
        brandIds.map((brandId) => ({ campaign_id: campaign.id, brand_id: brandId })),
      );
    }
    // Deliverable: resolve per judul — tak ditemukan/ambigu dilewati + dicatat.
    for (const title of d.deliverableTitles) {
      const { data: items } = await supabase
        .from("content_items")
        .select("id, title, brand_id")
        .eq("workspace_id", workspaceId)
        .ilike("title", title);
      const matches = (items ?? []).filter(
        (it) => it.title.toLowerCase() === title.toLowerCase(),
      );
      if (matches.length === 0) {
        report.skippedDeliverables.push({ row: rowNumber, title, reason: "tidak ditemukan" });
        continue;
      }
      if (matches.length > 1) {
        report.skippedDeliverables.push({ row: rowNumber, title, reason: "ambigu (lebih dari satu)" });
        continue;
      }
      const item = matches[0];
      if (!brandInScope(scope, item.brand_id)) {
        report.skippedDeliverables.push({ row: rowNumber, title, reason: "brand di luar scope Anda" });
        continue;
      }
      const { error: linkError } = await supabase
        .from("content_items")
        .update({ campaign_id: campaign.id })
        .eq("id", item.id);
      if (linkError) {
        report.skippedDeliverables.push({ row: rowNumber, title, reason: `gagal ditautkan (${linkError.message})` });
        continue;
      }
      report.linkedDeliverables += 1;
    }
    report.imported += 1;
  }
  await logActivity(supabase, {
    workspaceId,
    actorUserId: user.id,
    entityType: "campaign",
    entityId: null,
    action: "campaign.csv_import",
    metadata: {
      total: report.total,
      imported: report.imported,
      failed: report.failed,
      linkedDeliverables: report.linkedDeliverables,
    },
  });
  revalidateCampaign();
  return ok(
    `Impor selesai: ${report.imported} campaign diimpor, ${report.failed} baris gagal, ${report.linkedDeliverables} deliverable ditautkan, ${report.skippedDeliverables.length} deliverable dilewati.`,
    { report },
  );
}

/**
 * Atur brand scope anggota (P1-A7, 0016) — hanya owner/admin.
 * scopeMode "all" = NULL (semua brand); "custom" = array UUID yang dipilih
 * (array kosong = tidak ada brand). Owner tidak boleh membatasi dirinya
 * sendiri menjadi tanpa brand? — dibolehkan (batas jujur: owner tetap bisa
 * mengubahnya kembali; RLS tidak menghalangi owner membaca keanggotaan).
 */
export async function setMemberBrandScopeAction(
  _prev: CampaignActionResult,
  formData: FormData,
): Promise<CampaignActionResult> {
  const scopeMode = String(formData.get("scopeMode") ?? "all");
  const parsed = memberBrandScopeSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    memberUserId: formData.get("memberUserId"),
    brandScope: scopeMode === "all" ? null : formData.getAll("brandIds").map(String),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !canInvite(role)) {
    return fail("Hanya owner/admin yang boleh mengatur brand scope anggota.");
  }
  // Brand yang dipilih harus benar-benar milik workspace ini.
  if (parsed.data.brandScope !== null && parsed.data.brandScope.length > 0) {
    const { data: brands } = await supabase
      .from("brands")
      .select("id")
      .eq("workspace_id", parsed.data.workspaceId);
    const validIds = new Set((brands ?? []).map((b) => b.id));
    for (const brandId of parsed.data.brandScope) {
      if (!validIds.has(brandId)) return fail("Salah satu brand tidak ada di workspace ini.");
    }
  }
  const { error } = await supabase
    .from("workspace_members")
    .update({ brand_scope: parsed.data.brandScope })
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("user_id", parsed.data.memberUserId)
    .eq("membership_status", "active");
  if (error) return fail(dbErrorMessage(error, "Gagal mengatur brand scope"));
  revalidatePath("/pengaturan/anggota");
  return ok(
    parsed.data.brandScope === null
      ? "Brand scope diubah: anggota ini bisa melihat semua brand."
      : parsed.data.brandScope.length === 0
        ? "Brand scope diubah: anggota ini tidak bisa melihat brand apa pun."
        : `Brand scope diubah: anggota ini hanya bisa melihat ${parsed.data.brandScope.length} brand.`,
  );
}
