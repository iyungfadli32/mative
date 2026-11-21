/**
 * Server actions Production Operations — features/production/actions.ts (P3-04 s.d. P3-11)
 * Aturan (pola Phase 2, features/planning/actions.ts):
 *  - Zod dulu (boundary), lalu sesi + peran dari DB (BUKAN dari body),
 *    lalu Supabase client sesi (RLS penegak terakhir).
 *  - Operasi multi-tulis (task + checklist, komentar + mention, restore
 *    versi, ganti template default) lewat RPC 0010 — SATU transaksi Postgres.
 *  - Brief/script disimpan lewat RPC 0008 (update_content_item_with_version)
 *    — SETIAP simpan membuat versi baru (P3-05/P3-10).
 *  - Upload aset: file TIDAK PERNAH lewat Server Action (batas body
 *    Next.js 1 MB — temuan (c) K-1). Alur signed URL: prepare (baris
 *    'uploading' + signed upload URL via service-role) → browser PUT
 *    langsung ke Storage → confirm (unduh via service-role, validasi
 *    ulang magic bytes + ukuran, lalu 'ready' + asset_versions v1;
 *    gagal → 'failed' + objek dihapus). Maks 10 MB tetap berlaku
 *    (ADR-0009 §4). MIME dicek dari ISI file, bukan ekstensi.
 *  - TIDAK ADA approval, publishing, integrasi provider, analytics, AI,
 *    billing di sini. TIDAK ADA klaim "terhubung".
 */
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase/server";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";
import { can, isLimited } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import {
  assetAttachSchema,
  assetConfirmUploadSchema,
  assetDeleteSchema,
  assetDetachSchema,
  assetPrepareUploadSchema,
  briefTemplateSchema,
  briefTemplateUpdateSchema,
  briefTemplateSchemaJson,
  clientCommentsSettingSchema,
  commentDeleteSchema,
  commentEditSchema,
  commentSchema,
  markNotificationReadSchema,
  restoreVersionSchema,
  setDefaultBriefTemplateSchema,
  taskChecklistSchema,
  taskChecklistToggleSchema,
  taskSchema,
  taskStatusSchema,
  updateBriefSchema,
} from "@/lib/validation/schemas";
import { getCallerRole, PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { canEditSpecificContent } from "@/features/planning/transitions";
import { isValidTaskTransition } from "./transitions";
import { ASSET_BUCKET, DEFAULT_BRIEF_TEMPLATE_FIELDS } from "./constants";
import { sanitizeFileName, validateAssetFile } from "./mime";
import type { BriefTemplate } from "./types";

export type ProductionActionResult = {
  ok: boolean;
  message: string;
  taskId?: string;
  commentId?: string;
  assetId?: string;
  templateId?: string;
  versionNumber?: number;
  contentItemId?: string;
};

/**
 * Hasil prepare upload: signed URL TIDAK PERNAH dibuat di client —
 * dibuat di server (service-role) dan hanya berlaku untuk SATU path
 * objek ini; tokennya sekali pakai (dihapus Storage sesudah PUT).
 */
export type PrepareAssetUploadResult = {
  ok: boolean;
  message: string;
  assetId?: string;
  objectKey?: string;
  signedUrl?: string;
};

const ok = (message: string, extra?: Partial<ProductionActionResult>): ProductionActionResult => ({
  ok: true,
  message,
  ...extra,
});
const fail = (
  message: string,
  extra?: Partial<ProductionActionResult>,
): ProductionActionResult => ({
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

function revalidateProduction() {
  for (const p of [
    "/tugas",
    "/pustaka",
    "/template-brief",
    "/ide",
    "/konten",
    "/kalender",
    "/board",
    "/pengaturan",
    "/dashboard",
  ]) {
    revalidatePath(p);
  }
}

/** Role yang boleh menulis template brief (cermin RLS 0009: owner/admin/manager/strategist). */
function canManageTemplates(role: WorkspaceRole): boolean {
  return ["owner", "admin", "manager", "strategist"].includes(role);
}

/** Role yang boleh menghapus template / aset (cermin RLS 0009: owner/admin/manager). */
function canDeleteProduction(role: WorkspaceRole): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

// ============================================================================
// P3-06 — Tasks
// ============================================================================

export async function createTaskAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const checklistRaw = formData.get("checklist");
  const checklist =
    typeof checklistRaw === "string" && checklistRaw.trim() !== ""
      ? checklistRaw
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const parsed = taskSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    parentType: formData.get("parentType"),
    parentId: formData.get("parentId"),
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    assigneeUserId: formData.get("assigneeUserId") ?? "",
    dueAt: formData.get("dueAt") ?? "",
    priority: formData.get("priority") ?? "medium",
    estimateMinutes: formData.get("estimateMinutes") ?? "",
    checklist,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_tasks")) return fail("Peran Anda tidak boleh membuat task.");
  if (
    isLimited(role, "manage_tasks") &&
    parsed.data.assigneeUserId &&
    parsed.data.assigneeUserId !== user.id
  ) {
    return fail("Anda hanya boleh menugaskan task kepada diri sendiri.");
  }
  const { data, error } = await supabase.rpc("create_task_with_checklist", {
    p_workspace_id: parsed.data.workspaceId,
    p_parent_type: parsed.data.parentType,
    p_parent_id: parsed.data.parentId,
    p_title: parsed.data.title,
    p_description: parsed.data.description || null,
    p_assignee_user_id: parsed.data.assigneeUserId,
    p_due_at: parsed.data.dueAt,
    p_priority: parsed.data.priority,
    p_estimate_minutes: parsed.data.estimateMinutes,
    p_checklist: parsed.data.checklist.map((title, i) => ({ title, sort_order: i })),
  });
  if (error) return fail(dbErrorMessage(error, "Gagal membuat task"));
  const result = data as { ok: boolean; message?: string; task_id?: string } | null;
  if (!result?.ok) return fail(result?.message ?? "Gagal membuat task.");
  revalidateProduction();
  return ok("Task dibuat.", { taskId: result.task_id });
}

export async function transitionTaskAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const parsed = taskStatusSchema.safeParse({
    taskId: formData.get("taskId"),
    workspaceId: formData.get("workspaceId"),
    toStatus: formData.get("toStatus"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_tasks"))
    return fail("Peran Anda tidak boleh mengubah status task.");
  const { data: task } = await supabase
    .from("tasks")
    .select("status")
    .eq("id", parsed.data.taskId)
    .single();
  if (task && !isValidTaskTransition(task.status as never, parsed.data.toStatus as never)) {
    return fail(
      `Transisi status dari "${task.status}" ke "${parsed.data.toStatus}" tidak diizinkan.`,
    );
  }
  const { data, error } = await supabase.rpc("transition_task_status", {
    p_task_id: parsed.data.taskId,
    p_new_status: parsed.data.toStatus,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal mengubah status task"));
  const result = data as { ok: boolean; message?: string } | null;
  if (!result?.ok) return fail(result?.message ?? "Gagal mengubah status task.");
  revalidateProduction();
  return ok("Status task diubah.", { taskId: parsed.data.taskId });
}

export async function addChecklistItemAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const parsed = taskChecklistSchema.safeParse({
    taskId: formData.get("taskId"),
    workspaceId: formData.get("workspaceId"),
    title: formData.get("title"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_tasks"))
    return fail("Peran Anda tidak boleh mengubah checklist task.");
  const { data: maxRow } = await supabase
    .from("task_checklist_items")
    .select("sort_order")
    .eq("task_id", parsed.data.taskId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();
  const { error } = await supabase.from("task_checklist_items").insert({
    task_id: parsed.data.taskId,
    title: parsed.data.title,
    sort_order: (maxRow?.sort_order ?? -1) + 1,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal menambah item checklist"));
  revalidateProduction();
  return ok("Item checklist ditambahkan.", { taskId: parsed.data.taskId });
}

export async function toggleChecklistItemAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const parsed = taskChecklistToggleSchema.safeParse({
    checklistItemId: formData.get("checklistItemId"),
    taskId: formData.get("taskId"),
    workspaceId: formData.get("workspaceId"),
    isDone: formData.get("isDone"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "manage_tasks"))
    return fail("Peran Anda tidak boleh mengubah checklist task.");
  const done = parsed.data.isDone === "true";
  const { error } = await supabase
    .from("task_checklist_items")
    .update({
      is_done: done,
      completed_by: done ? user.id : null,
      completed_at: done ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.checklistItemId)
    .eq("task_id", parsed.data.taskId);
  if (error) return fail(dbErrorMessage(error, "Gagal mengubah checklist"));
  revalidateProduction();
  return ok(done ? "Item ditandai selesai." : "Item dibuka lagi.", { taskId: parsed.data.taskId });
}

// ============================================================================
// P3-05 — Brief templates + brief
// ============================================================================

const BRIEF_TEMPLATE_COLUMNS =
  "id, workspace_id, name, is_default, schema_json, created_at, updated_at";

/**
 * Buat template default bila workspace belum punya (lazy, idempotent).
 * MENGEMBALIKAN baris template-nya: pemanggil JANGAN membaca ulang
 * dengan getDefaultBriefTemplate/listBriefTemplates sesudah memanggil
 * ini — Next.js me-memoize fetch GET yang sama dalam SATU render,
 * sehingga baca ulang mengembalikan daftar kosong dari sebelum insert
 * (cacat e2e 2026-11-19, repro deterministik: template tercatat di DB
 * live, tapi halaman tetap menampilkan "Belum ada template"). Baris
 * dari insert (.select() sesudah insert = POST, tidak kena memoize)
 * atau dari pemeriksaan awal adalah data segar yang bisa dipakai
 * langsung.
 */
export async function ensureDefaultBriefTemplate(
  workspaceId: string,
): Promise<{ ok: boolean; message: string; template?: BriefTemplate | null }> {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return { ok: false, message: "Anda harus masuk dulu." };
  const role = await requireRole(workspaceId, user.id);
  if (!role || !canManageTemplates(role)) return { ok: false, message: "Tidak berhak." };
  const { data: existing } = await supabase
    .from("brief_templates")
    .select(BRIEF_TEMPLATE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .single();
  if (existing) {
    return {
      ok: true,
      message: "Template default sudah ada.",
      template: existing as BriefTemplate,
    };
  }
  const { data: inserted, error } = await supabase
    .from("brief_templates")
    .insert({
      workspace_id: workspaceId,
      name: "Template Brief Standar",
      schema_json: { fields: DEFAULT_BRIEF_TEMPLATE_FIELDS },
      is_default: true,
    })
    .select(BRIEF_TEMPLATE_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") {
      // Balapan: template dibuat pemuatan lain di saat bersamaan —
      // baca dengan bentuk query berbeda (kolom penuh + order +
      // limit, bukan .single()) agar tidak kena memoize GET render ini.
      const { data: raced } = await supabase
        .from("brief_templates")
        .select(BRIEF_TEMPLATE_COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("is_default", true)
        .order("created_at", { ascending: true })
        .limit(1);
      return {
        ok: true,
        message: "Template default sudah ada.",
        template: (raced?.[0] as BriefTemplate | undefined) ?? null,
      };
    }
    return { ok: false, message: dbErrorMessage(error, "Gagal membuat template default") };
  }
  return {
    ok: true,
    message: "Template default dibuat.",
    template: inserted as BriefTemplate,
  };
}

export async function createBriefTemplateAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  let schemaJson: unknown = null;
  try {
    schemaJson = JSON.parse(String(formData.get("schemaJson") ?? ""));
  } catch {
    return fail("Skema template (JSON) tidak valid.");
  }
  const schemaParsed = briefTemplateSchemaJson.safeParse(schemaJson);
  if (!schemaParsed.success)
    return fail(schemaParsed.error.issues[0]?.message ?? "Skema template tidak valid.");
  const parsed = briefTemplateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    schemaJson: schemaParsed.data,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !canManageTemplates(role))
    return fail("Hanya owner/admin/manager/strategist yang boleh membuat template brief.");
  const { data, error } = await supabase
    .from("brief_templates")
    .insert({
      workspace_id: parsed.data.workspaceId,
      name: parsed.data.name,
      schema_json: parsed.data.schemaJson,
      is_default: false,
    })
    .select("id")
    .single();
  if (error) return fail(dbErrorMessage(error, "Gagal membuat template"));
  revalidateProduction();
  return ok("Template brief dibuat.", { templateId: (data as { id: string } | null)?.id });
}

export async function updateBriefTemplateAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  let schemaJson: unknown = null;
  try {
    schemaJson = JSON.parse(String(formData.get("schemaJson") ?? ""));
  } catch {
    return fail("Skema template (JSON) tidak valid.");
  }
  const schemaParsed = briefTemplateSchemaJson.safeParse(schemaJson);
  if (!schemaParsed.success)
    return fail(schemaParsed.error.issues[0]?.message ?? "Skema template tidak valid.");
  const parsed = briefTemplateUpdateSchema.safeParse({
    templateId: formData.get("templateId"),
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    schemaJson: schemaParsed.data,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !canManageTemplates(role))
    return fail("Hanya owner/admin/manager/strategist yang boleh mengubah template brief.");
  const { error } = await supabase
    .from("brief_templates")
    .update({
      name: parsed.data.name,
      schema_json: parsed.data.schemaJson,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.templateId)
    .eq("workspace_id", parsed.data.workspaceId);
  if (error) return fail(dbErrorMessage(error, "Gagal mengubah template"));
  revalidateProduction();
  return ok("Template brief diubah.", { templateId: parsed.data.templateId });
}

/** Hapus template (form biasa — tanpa pesan hasil; halaman dimuat ulang). */
export async function deleteBriefTemplateAction(formData: FormData): Promise<void> {
  const templateId = String(formData.get("templateId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!templateId || !workspaceId) return;
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return;
  const role = await requireRole(workspaceId, user.id);
  if (!role || !canDeleteProduction(role)) return;
  await supabase
    .from("brief_templates")
    .delete()
    .eq("id", templateId)
    .eq("workspace_id", workspaceId);
  revalidateProduction();
}

export async function setDefaultBriefTemplateAction(formData: FormData): Promise<void> {
  const parsed = setDefaultBriefTemplateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    templateId: formData.get("templateId"),
  });
  if (!parsed.success) return;
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return;
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !canManageTemplates(role)) return;
  await supabase.rpc("set_default_brief_template", {
    p_workspace_id: parsed.data.workspaceId,
    p_template_id: parsed.data.templateId,
  });
  revalidateProduction();
}

async function loadItemForVersionUpdate(
  supabase: NonNullable<Awaited<ReturnType<typeof requireUser>>["supabase"]>,
  contentItemId: string,
) {
  const { data: item } = await supabase
    .from("content_items")
    .select(
      "id, workspace_id, title, internal_description, objective, funnel_stage, priority, due_at, campaign_id, pillar_id, audience_id, owner_user_id",
    )
    .eq("id", contentItemId)
    .single();
  const { data: latest } = await supabase
    .from("content_versions")
    .select("brief_snapshot, script, caption, cta, creative_notes")
    .eq("content_item_id", contentItemId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();
  return { item, latest };
}

/** Simpan brief (P3-05): brief_snapshot baru + versi baru via RPC 0008. */
export async function updateBriefAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  let briefSnapshot: unknown = null;
  try {
    briefSnapshot = JSON.parse(String(formData.get("briefSnapshot") ?? ""));
  } catch {
    return fail("Isi brief (JSON) tidak valid.");
  }
  const parsed = updateBriefSchema.safeParse({
    contentItemId: formData.get("contentItemId"),
    workspaceId: formData.get("workspaceId"),
    briefSnapshot,
    changeSummary: formData.get("changeSummary"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  const { item, latest } = await loadItemForVersionUpdate(supabase, parsed.data.contentItemId);
  if (!item) return fail("Content item tidak ditemukan.");
  if (!role || !canEditSpecificContent(role, item.owner_user_id === user.id))
    return fail("Peran Anda tidak boleh mengedit konten ini.");
  const { data, error } = await supabase.rpc("update_content_item_with_version", {
    p_content_item_id: parsed.data.contentItemId,
    p_title: item.title,
    p_internal_description: item.internal_description,
    p_objective: item.objective,
    p_funnel_stage: item.funnel_stage,
    p_priority: item.priority,
    p_due_at: item.due_at,
    p_campaign_id: item.campaign_id,
    p_pillar_id: item.pillar_id,
    p_audience_id: item.audience_id,
    p_script: latest?.script ?? null,
    p_caption: latest?.caption ?? null,
    p_cta: latest?.cta ?? null,
    p_creative_notes: latest?.creative_notes ?? null,
    p_brief_snapshot: parsed.data.briefSnapshot,
    p_change_summary: parsed.data.changeSummary,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal menyimpan brief"));
  const result = data as { ok: boolean; message?: string; version_number?: number } | null;
  if (!result?.ok) return fail(result?.message ?? "Gagal menyimpan brief.");
  revalidateProduction();
  return ok(`Brief disimpan sebagai versi v${result.version_number}.`, {
    versionNumber: result.version_number,
    contentItemId: parsed.data.contentItemId,
  });
}

/** Simpan script/caption/CTA (tab Script, P3-11): versi baru via RPC 0008. */
export async function updateScriptAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const contentItemId = String(formData.get("contentItemId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const changeSummary = String(formData.get("changeSummary") ?? "").trim();
  if (!contentItemId || !workspaceId) return fail("Data tidak valid.");
  if (changeSummary.length < 2) return fail("Ringkasan perubahan wajib diisi.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(workspaceId, user.id);
  const { item, latest } = await loadItemForVersionUpdate(supabase, contentItemId);
  if (!item) return fail("Content item tidak ditemukan.");
  if (!role || !canEditSpecificContent(role, item.owner_user_id === user.id))
    return fail("Peran Anda tidak boleh mengedit konten ini.");
  const { data, error } = await supabase.rpc("update_content_item_with_version", {
    p_content_item_id: contentItemId,
    p_title: item.title,
    p_internal_description: item.internal_description,
    p_objective: item.objective,
    p_funnel_stage: item.funnel_stage,
    p_priority: item.priority,
    p_due_at: item.due_at,
    p_campaign_id: item.campaign_id,
    p_pillar_id: item.pillar_id,
    p_audience_id: item.audience_id,
    p_script: String(formData.get("script") ?? ""),
    p_caption: String(formData.get("caption") ?? ""),
    p_cta: String(formData.get("cta") ?? ""),
    p_creative_notes: String(formData.get("creativeNotes") ?? ""),
    p_brief_snapshot: latest?.brief_snapshot ?? {},
    p_change_summary: changeSummary,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal menyimpan script"));
  const result = data as { ok: boolean; message?: string; version_number?: number } | null;
  if (!result?.ok) return fail(result?.message ?? "Gagal menyimpan script.");
  revalidateProduction();
  return ok(`Script disimpan sebagai versi v${result.version_number}.`, {
    versionNumber: result.version_number,
    contentItemId,
  });
}

// ============================================================================
// P3-07 / P3-08 — Assets
// ============================================================================

/**
 * P3-07 — Siapkan unggahan aset (langkah 1 dari 3, perbaikan (c) K-1).
 * File TIDAK lewat sini: action ini hanya memvalidasi metadata yang
 * dideklarasikan klien (nama/ukuran/MIME), membuat baris aset
 * 'uploading', lalu mengembalikan signed upload URL (service-role)
 * agar browser PUT langsung ke Storage. Validasi yang menentukan
 * (magic bytes + ukuran sebenarnya) terjadi di confirmAssetUploadAction,
 * dari ISI file yang sudah sampai di Storage.
 *
 * Aset TIDAK di-scope per brand (keputusan desain — lihat audit (a) S-6):
 * yang ditegakkan di sini adalah keanggotaan workspace + peran upload,
 * sama seperti jalur upload lama.
 */
export async function prepareAssetUploadAction(input: {
  workspaceId: string;
  fileName: string;
  byteSize: number;
  mimeType: string;
}): Promise<PrepareAssetUploadResult> {
  const parsed = assetPrepareUploadSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return {
      ok: false,
      message: supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID,
    };
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "upload_assets"))
    return { ok: false, message: "Peran Anda tidak boleh mengunggah aset." };
  const admin = getSupabaseAdminClient();
  if (!admin) {
    // Tanpa service-role key, signed upload URL tidak bisa dibuat —
    // JANGAN diam-diam kembali ke jalur File lewat Server Action
    // (batas 1 MB). Pesan ini jujur: konfigurasi server yang kurang.
    return {
      ok: false,
      message:
        "Unggah aset belum bisa dipakai: kunci service-role belum dikonfigurasi di server.",
    };
  }
  const assetId = randomUUID();
  const objectKey = `${parsed.data.workspaceId}/${assetId}/${sanitizeFileName(parsed.data.fileName)}`;
  // Baris dibuat 'uploading' dulu (ADR-0009 §4). MIME/ukuran di sini
  // masih DEKLARASI klien (untuk memenuhi NOT NULL + CHECK 0009);
  // nilai yang dipercaya ditulis ulang oleh confirm dari isi file.
  const { error: rowError } = await supabase.from("assets").insert({
    id: assetId,
    workspace_id: parsed.data.workspaceId,
    storage_bucket: ASSET_BUCKET,
    object_key: objectKey,
    original_filename: parsed.data.fileName.slice(0, 200),
    mime_type: parsed.data.mimeType,
    byte_size: parsed.data.byteSize,
    width: null,
    height: null,
    duration_ms: null,
    checksum: null,
    uploaded_by: user.id,
    processing_status: "uploading",
  });
  if (rowError) return { ok: false, message: dbErrorMessage(rowError, "Gagal mencatat aset") };
  const { data: signed, error: signError } = await admin.storage
    .from(ASSET_BUCKET)
    .createSignedUploadUrl(objectKey);
  if (signError || !signed?.signedUrl) {
    // Baris sudah tercatat tapi tidak ada URL — tandai gagal supaya
    // tidak menggantung sebagai 'uploading' selamanya.
    await supabase
      .from("assets")
      .update({ processing_status: "failed", updated_at: new Date().toISOString() })
      .eq("id", assetId);
    return {
      ok: false,
      message: `Gagal menyiapkan unggahan: ${signError?.message ?? "tidak ada URL"}`,
    };
  }
  return { ok: true, message: "Siap mengunggah.", assetId, objectKey, signedUrl: signed.signedUrl };
}

/**
 * P3-07 — Konfirmasi unggahan aset (langkah 3 dari 3, perbaikan (c) K-1).
 * Dipanggil sesudah browser PUT file ke signed upload URL. Mengunduh
 * objek dari Storage (service-role), memvalidasi ULANG dari isinya
 * (magic bytes + ukuran ≤ 10 MB via validateAssetFile), lalu menandai
 * 'ready' + insert asset_versions v1. Bila validasi gagal: tandai
 * 'failed' + hapus objek Storage (jangan tinggalkan file yatim).
 *
 * Idempotent: confirm yang diulang untuk aset yang sudah 'ready'
 * mengembalikan sukses tanpa menulis versi ganda (insert v1 memakai
 * ON CONFLICT abaikan duplikat dari percobaan sebelumnya).
 */
export async function confirmAssetUploadAction(input: {
  assetId: string;
  workspaceId: string;
}): Promise<ProductionActionResult> {
  const parsed = assetConfirmUploadSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "upload_assets"))
    return fail("Peran Anda tidak boleh mengunggah aset.");
  const { data: asset } = await supabase
    .from("assets")
    .select("id, workspace_id, object_key, uploaded_by, processing_status")
    .eq("id", parsed.data.assetId)
    .eq("workspace_id", parsed.data.workspaceId)
    .single();
  if (!asset) return fail("Aset tidak ditemukan.");
  if (asset.processing_status === "ready")
    return ok("Aset diunggah.", { assetId: parsed.data.assetId });
  if (asset.processing_status !== "uploading")
    return fail("Unggahan ini sudah ditandai gagal — unggah ulang filenya.");
  if (asset.uploaded_by !== user.id)
    return fail("Hanya pengunggah aset ini yang boleh mengonfirmasi unggahannya.");
  const admin = getSupabaseAdminClient();
  if (!admin) {
    return fail(
      "Konfirmasi unggahan belum bisa dipakai: kunci service-role belum dikonfigurasi di server.",
    );
  }
  const objectKey = asset.object_key as string;
  const failUpload = async (message: string): Promise<ProductionActionResult> => {
    // Tandai gagal + hapus objek yang sempat terunggah (best-effort).
    await supabase
      .from("assets")
      .update({ processing_status: "failed", updated_at: new Date().toISOString() })
      .eq("id", parsed.data.assetId);
    await admin.storage.from(ASSET_BUCKET).remove([objectKey]);
    return fail(message);
  };
  const { data: blob, error: downloadError } = await admin.storage
    .from(ASSET_BUCKET)
    .download(objectKey);
  if (downloadError || !blob) {
    return failUpload(
      "File belum sampai ke penyimpanan — periksa koneksi lalu unggah ulang filenya.",
    );
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  const validated = validateAssetFile(buffer);
  if (!validated.ok) return failUpload(validated.message);
  // v1 dulu, baru 'ready': bila insert versi gagal, baris tetap
  // 'uploading' dan confirm bisa diulang dengan aman (duplikat v1
  // dari percobaan sebelumnya diabaikan, bukan error).
  const { error: versionError } = await supabase.from("asset_versions").insert({
    asset_id: parsed.data.assetId,
    version_number: 1,
    storage_object_key: objectKey,
    uploaded_by: user.id,
  });
  if (versionError && versionError.code !== "23505") {
    return fail(dbErrorMessage(versionError, "Gagal mencatat versi aset"));
  }
  const { error: readyError } = await supabase
    .from("assets")
    .update({
      mime_type: validated.detected.mimeType,
      byte_size: buffer.length,
      width: validated.detected.width,
      height: validated.detected.height,
      checksum: validated.detected.sha256,
      processing_status: "ready",
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.assetId);
  if (readyError) return fail(dbErrorMessage(readyError, "Gagal menandai aset siap"));
  revalidateProduction();
  return ok("Aset diunggah.", { assetId: parsed.data.assetId });
}

export async function attachAssetAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const parsed = assetAttachSchema.safeParse({
    contentItemId: formData.get("contentItemId"),
    workspaceId: formData.get("workspaceId"),
    assetId: formData.get("assetId"),
    usageRole: formData.get("usageRole") ?? "attachment",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  const { data: item } = await supabase
    .from("content_items")
    .select("owner_user_id")
    .eq("id", parsed.data.contentItemId)
    .single();
  if (!item) return fail("Content item tidak ditemukan.");
  if (!role || !canEditSpecificContent(role, item.owner_user_id === user.id))
    return fail("Peran Anda tidak boleh melampirkan aset ke konten ini.");
  const { error } = await supabase.from("content_assets").insert({
    content_item_id: parsed.data.contentItemId,
    asset_id: parsed.data.assetId,
    usage_role: parsed.data.usageRole,
  });
  if (error) {
    if (error.code === "23505") return fail("Aset ini sudah dilampirkan ke konten ini.");
    return fail(dbErrorMessage(error, "Gagal melampirkan aset"));
  }
  revalidateProduction();
  return ok("Aset dilampirkan ke konten.", { assetId: parsed.data.assetId });
}

export async function detachAssetAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const parsed = assetDetachSchema.safeParse({
    contentAssetId: formData.get("contentAssetId"),
    workspaceId: formData.get("workspaceId"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "create_edit_content"))
    return fail("Peran Anda tidak boleh melepas lampiran aset.");
  // Melepas lampiran TIDAK menghapus file aset (ADR-0009 §4).
  const { error } = await supabase
    .from("content_assets")
    .delete()
    .eq("id", parsed.data.contentAssetId);
  if (error) return fail(dbErrorMessage(error, "Gagal melepas lampiran"));
  revalidateProduction();
  return ok("Lampiran dilepas (file aset tetap tersimpan di pustaka).");
}

export async function deleteAssetAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const parsed = assetDeleteSchema.safeParse({
    assetId: formData.get("assetId"),
    workspaceId: formData.get("workspaceId"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !canDeleteProduction(role))
    return fail("Hanya owner/admin/manager yang boleh menghapus aset.");
  const { data: links, error: linkError } = await supabase
    .from("content_assets")
    .select("id")
    .eq("asset_id", parsed.data.assetId)
    .limit(1);
  if (linkError) return fail(dbErrorMessage(linkError, "Gagal memeriksa lampiran aset"));
  if ((links ?? []).length > 0) {
    return fail("Aset masih dilampirkan ke konten — lepas dulu lampirannya sebelum menghapus.");
  }
  const { data: asset } = await supabase
    .from("assets")
    .select("object_key")
    .eq("id", parsed.data.assetId)
    .single();
  const { error } = await supabase.from("assets").delete().eq("id", parsed.data.assetId);
  if (error) return fail(dbErrorMessage(error, "Gagal menghapus aset"));
  if (asset?.object_key) {
    // Best-effort: file yatim tidak terlihat aplikasi bila gagal dihapus.
    await supabase.storage.from(ASSET_BUCKET).remove([asset.object_key as string]);
  }
  revalidateProduction();
  return ok("Aset dihapus.");
}

// ============================================================================
// P3-09 — Comments + mentions
// ============================================================================

export async function createCommentAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const mentionedRaw = formData.getAll("mentionedUserIds");
  const parsed = commentSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    targetType: formData.get("targetType"),
    targetId: formData.get("targetId"),
    parentCommentId: formData.get("parentCommentId") ?? "",
    body: formData.get("body"),
    mentionedUserIds: mentionedRaw.map(String).filter(Boolean),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role) return fail("Anda bukan anggota workspace ini.");
  // viewer_client TIDAK dicek di sini — gerbang ganda (share + setting)
  // ditegakkan RPC 0010 (ADR-0009 §5). Peran lain wajib punya capability comment.
  if (role !== "viewer_client" && !can(role, "comment")) {
    return fail("Peran Anda tidak boleh berkomentar.");
  }
  const { data, error } = await supabase.rpc("create_comment_with_mentions", {
    p_workspace_id: parsed.data.workspaceId,
    p_target_type: parsed.data.targetType,
    p_target_id: parsed.data.targetId,
    p_parent_comment_id: parsed.data.parentCommentId,
    p_body: parsed.data.body,
    p_mentioned_user_ids: parsed.data.mentionedUserIds,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal mengirim komentar"));
  const result = data as { ok: boolean; message?: string; comment_id?: string } | null;
  if (!result?.ok) return fail(result?.message ?? "Gagal mengirim komentar.");
  revalidateProduction();
  return ok("Komentar dikirim.", { commentId: result.comment_id });
}

export async function updateCommentAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const parsed = commentEditSchema.safeParse({
    commentId: formData.get("commentId"),
    workspaceId: formData.get("workspaceId"),
    body: formData.get("body"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role) return fail("Anda bukan anggota workspace ini.");
  const { error } = await supabase
    .from("comments")
    .update({
      body: parsed.data.body,
      edited_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.commentId)
    .eq("workspace_id", parsed.data.workspaceId);
  if (error) return fail(dbErrorMessage(error, "Gagal mengubah komentar"));
  revalidateProduction();
  return ok("Komentar diubah.", { commentId: parsed.data.commentId });
}

export async function deleteCommentAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const parsed = commentDeleteSchema.safeParse({
    commentId: formData.get("commentId"),
    workspaceId: formData.get("workspaceId"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role) return fail("Anda bukan anggota workspace ini.");
  // Soft-delete (ADR-0009 §5): isi tampil sebagai "Komentar ini dihapus".
  const { error } = await supabase
    .from("comments")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.commentId)
    .eq("workspace_id", parsed.data.workspaceId);
  if (error) return fail(dbErrorMessage(error, "Gagal menghapus komentar"));
  revalidateProduction();
  return ok("Komentar dihapus.", { commentId: parsed.data.commentId });
}

// ============================================================================
// P3-10 — Restore versi
// ============================================================================

export async function restoreVersionAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const parsed = restoreVersionSchema.safeParse({
    contentItemId: formData.get("contentItemId"),
    workspaceId: formData.get("workspaceId"),
    versionNumber: formData.get("versionNumber"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  const { data: item } = await supabase
    .from("content_items")
    .select("owner_user_id")
    .eq("id", parsed.data.contentItemId)
    .single();
  if (!item) return fail("Content item tidak ditemukan.");
  if (!role || !canEditSpecificContent(role, item.owner_user_id === user.id))
    return fail("Peran Anda tidak boleh memulihkan versi konten ini.");
  const { data, error } = await supabase.rpc("restore_content_version", {
    p_content_item_id: parsed.data.contentItemId,
    p_version_number: parsed.data.versionNumber,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal memulihkan versi"));
  const result = data as {
    ok: boolean;
    message?: string;
    version_number?: number;
    restored_from_version?: number;
  } | null;
  if (!result?.ok) return fail(result?.message ?? "Gagal memulihkan versi.");
  revalidateProduction();
  return ok(
    `Versi v${result.restored_from_version} dipulihkan sebagai versi v${result.version_number}.`,
    { versionNumber: result.version_number, contentItemId: parsed.data.contentItemId },
  );
}

// ============================================================================
// P3-09 — Setting komentar klien + notifikasi
// ============================================================================

/** Toggle allow_client_comments (P3-09): hanya owner/admin (cermin RLS 0003). */
export async function toggleClientCommentsAction(
  _prev: ProductionActionResult,
  formData: FormData,
): Promise<ProductionActionResult> {
  const parsed = clientCommentsSettingSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    allowed: formData.get("allowed"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !["owner", "admin"].includes(role))
    return fail("Hanya owner/admin yang boleh mengatur komentar klien.");
  const allowed = parsed.data.allowed === "true";
  const { error } = await supabase.from("workspace_settings").upsert(
    {
      workspace_id: parsed.data.workspaceId,
      key: "allow_client_comments",
      value_json: allowed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,key" },
  );
  if (error) return fail(dbErrorMessage(error, "Gagal menyimpan pengaturan"));
  revalidateProduction();
  return ok(
    allowed
      ? "Komentar klien diizinkan (hanya untuk konten yang dibagikan eksplisit)."
      : "Komentar klien dimatikan.",
  );
}

/** Tandai satu notifikasi sudah dibaca (form biasa — tanpa pesan hasil). */
export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const parsed = markNotificationReadSchema.safeParse({
    notificationId: formData.get("notificationId"),
  });
  if (!parsed.success) return;
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return;
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", parsed.data.notificationId)
    .eq("recipient_user_id", user.id);
  revalidateProduction();
}
