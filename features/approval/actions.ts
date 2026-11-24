/**
 * Server actions Review & Approval — features/approval/actions.ts (P4-04 s.d. P4-11)
 * Aturan (pola Phase 2/3):
 *  - Zod dulu (boundary), lalu sesi + peran dari DB (BUKAN dari body),
 *    lalu Supabase client sesi (RLS penegak terakhir).
 *  - Operasi multi-tulis (submit, decide, client review, komentar klien)
 *    lewat RPC 0014 — SATU transaksi Postgres; RPC mengembalikan
 *    {ok, code, message} dan TIDAK melempar (kecuali exception DB).
 *  - TIDAK ADA perubahan status approval langsung dari client — satu-
 *    satunya jalan sah adalah RPC (ADR-0010 §6).
 *  - Komentar klien TIDAK PERNAH menjadi keputusan approval (Keputusan #12).
 *  - TIDAK ADA publishing, integrasi provider, analytics, AI, billing di sini.
 *  - Form yang menampilkan pesan hasil aksi HARUS tetap mounted
 *    (pelajaran e2e Phase 3: jangan sembunyikan form useActionState
 *    berdasarkan hasil aksinya sendiri).
 */
"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import {
  assignWorkflowStepSchema,
  clientCommentSchema,
  decideApprovalSchema,
  submitApprovalSchema,
  submitClientReviewSchema,
  updateApprovalSettingsSchema,
} from "@/lib/validation/schemas";
import { getCallerRole, PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import type { ApprovalRpcResult } from "./types";

export type ApprovalActionResult = {
  ok: boolean;
  message: string;
  requestId?: string;
  versionNumber?: number;
};

const ok = (message: string, extra?: Partial<ApprovalActionResult>): ApprovalActionResult => ({
  ok: true,
  message,
  ...extra,
});
const fail = (message: string, extra?: Partial<ApprovalActionResult>): ApprovalActionResult => ({
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
  // S-4: jangan bocorkan pesan database mentah ke UI; detail hanya ke log server.
  if (error?.message) console.error("[db]", fallback, error.message);
  return fallback;
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

function revalidateApproval() {
  for (const p of [
    "/persetujuan",
    "/konten",
    "/portal",
    "/tugas",
    "/pustaka",
    "/ide",
    "/kalender",
    "/board",
    "/pengaturan",
    "/dashboard",
  ]) {
    revalidatePath(p);
  }
}

/** Role yang boleh mengubah workflow/settings approval (cermin RLS 0013: owner/admin/manager). */
function canManageApproval(role: WorkspaceRole): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

function rpcResult(data: unknown): ApprovalRpcResult | null {
  if (!data || typeof data !== "object") return null;
  return data as ApprovalRpcResult;
}

// ============================================================================
// P4-04 — Submit konten untuk review internal
// ============================================================================

export async function submitForApprovalAction(
  _prev: ApprovalActionResult,
  formData: FormData,
): Promise<ApprovalActionResult> {
  const parsed = submitApprovalSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentItemId: formData.get("contentItemId"),
    contentVersionId: formData.get("contentVersionId"),
    placementVersionId: formData.get("placementVersionId") ?? "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "create_edit_content"))
    return fail("Peran Anda tidak boleh mengajukan konten untuk approval.");
  const { data, error } = await supabase.rpc("create_approval_request", {
    p_content_item_id: parsed.data.contentItemId,
    p_content_version_id: parsed.data.contentVersionId,
    p_placement_version_id: parsed.data.placementVersionId || null,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal mengajukan approval"));
  const result = rpcResult(data);
  if (!result?.ok) return fail(result?.message ?? "Gagal mengajukan approval.");
  revalidateApproval();
  return ok("Konten diajukan untuk approval (versi terbaru).", {
    requestId: result.request_id ?? undefined,
    versionNumber: result.version_number ?? undefined,
  });
}

// ============================================================================
// P4-04 — Keputusan approval (approve / minta revisi / tolak)
// ============================================================================

export async function decideApprovalAction(
  _prev: ApprovalActionResult,
  formData: FormData,
): Promise<ApprovalActionResult> {
  const parsed = decideApprovalSchema.safeParse({
    requestId: formData.get("requestId"),
    workspaceId: formData.get("workspaceId"),
    decision: formData.get("decision"),
    comment: formData.get("comment") ?? "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  // Matriks hanya gerbang awal; penugasan step + 7 poin ditegakkan RPC.
  if (!role || !can(role, "approve_assigned"))
    return fail("Peran Anda tidak boleh memutuskan approval.");
  const { data, error } = await supabase.rpc("decide_approval_request", {
    p_request_id: parsed.data.requestId,
    p_decision: parsed.data.decision,
    p_comment: parsed.data.comment || null,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal mencatat keputusan"));
  const result = rpcResult(data);
  if (!result?.ok) return fail(result?.message ?? "Gagal mencatat keputusan.");
  revalidateApproval();
  const label =
    parsed.data.decision === "approved"
      ? "disetujui"
      : parsed.data.decision === "changes_requested"
        ? "dikembalikan untuk revisi"
        : "ditolak";
  return ok(`Keputusan tercatat: konten ${label}.`, { requestId: parsed.data.requestId });
}

// ============================================================================
// P4-04 — Submit untuk client review (gerbang SETELAH internal approved)
// ============================================================================

export async function submitClientReviewAction(
  _prev: ApprovalActionResult,
  formData: FormData,
): Promise<ApprovalActionResult> {
  const parsed = submitClientReviewSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    contentItemId: formData.get("contentItemId"),
    contentVersionId: formData.get("contentVersionId"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !can(role, "create_edit_content"))
    return fail("Peran Anda tidak boleh mengajukan client review.");
  const { data, error } = await supabase.rpc("submit_content_for_client_review", {
    p_content_item_id: parsed.data.contentItemId,
    p_content_version_id: parsed.data.contentVersionId,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal mengajukan client review"));
  const result = rpcResult(data);
  if (!result?.ok) return fail(result?.message ?? "Gagal mengajukan client review.");
  revalidateApproval();
  return ok("Konten diajukan untuk client review.", {
    requestId: result.request_id ?? undefined,
  });
}

// ============================================================================
// P4-08 — Penugasan step workflow default (agar workspace baru bisa punya
// approver yang ditugaskan; tanpa ini request default tidak pernah bisa
// diputuskan karena step menugaskan role 'approver' yang belum ada
// membernya). Hanya owner/admin/manager.
// ============================================================================

export async function assignWorkflowStepAction(
  _prev: ApprovalActionResult,
  formData: FormData,
): Promise<ApprovalActionResult> {
  const parsed = assignWorkflowStepSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    stepId: formData.get("stepId"),
    assigneeRole: formData.get("assigneeRole") ?? "",
    assigneeUserId: formData.get("assigneeUserId") ?? "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !canManageApproval(role))
    return fail("Hanya owner/admin/manager yang boleh mengatur penugasan workflow.");
  // Batch 5 (0031) F-03: jangan tugaskan submitter request aktif ke langkah workflow
  // itu (pemisahan tugas) - kecuali workspace mengizinkan self-approval.
  if (parsed.data.assigneeUserId) {
    const { data: stepRow } = await supabase
      .from("approval_steps")
      .select("workflow_id")
      .eq("id", parsed.data.stepId)
      .single();
    if (stepRow) {
      const { data: selfApprovalRow } = await supabase
        .from("workspace_settings")
        .select("value_json")
        .eq("workspace_id", parsed.data.workspaceId)
        .eq("key", "approval.allow_self_approval")
        .limit(1);
      const allowSelfApproval =
        ((selfApprovalRow ?? [])[0]?.value_json as { enabled?: boolean } | undefined)?.enabled ??
        false;
      if (!allowSelfApproval) {
        const { data: ownRequest } = await supabase
          .from("approval_requests")
          .select("id")
          .eq("workflow_id", stepRow.workflow_id)
          .eq("workspace_id", parsed.data.workspaceId)
          .eq("submitted_by", parsed.data.assigneeUserId)
          .eq("status", "in_review")
          .limit(1)
          .maybeSingle();
        if (ownRequest)
          return fail(
            "Pengguna tersebut sedang mengajukan approval pada workflow ini - tugaskan approver lain (pemisahan tugas).",
          );
      }
    }
  }
  const { error } = await supabase
    .from("approval_steps")
    .update({
      assignee_role: parsed.data.assigneeRole || null,
      assignee_user_id: parsed.data.assigneeUserId || null,
    })
    .eq("id", parsed.data.stepId);
  if (error) return fail(dbErrorMessage(error, "Gagal menyimpan penugasan step"));
  revalidateApproval();
  return ok("Penugasan step workflow disimpan.");
}

// ============================================================================
// P4-10 — Pengaturan approval workspace (gerbang client_review, komentar
// klien, daftar field kritis). Hanya owner/admin/manager.
// ============================================================================

export async function updateApprovalSettingsAction(
  _prev: ApprovalActionResult,
  formData: FormData,
): Promise<ApprovalActionResult> {
  const parsed = updateApprovalSettingsSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientReviewEnabled: formData.get("clientReviewEnabled") ?? "",
    clientCanComment: formData.get("clientCanComment") ?? "",
    allowSelfApproval: formData.get("allowSelfApproval") ?? "",
    criticalFields: formData.get("criticalFields") ?? "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const role = await requireRole(parsed.data.workspaceId, user.id);
  if (!role || !canManageApproval(role))
    return fail("Hanya owner/admin/manager yang boleh mengatur approval.");
  const rows: { workspace_id: string; key: string; value_json: unknown }[] = [];
  if (parsed.data.clientReviewEnabled !== "") {
    rows.push({
      workspace_id: parsed.data.workspaceId,
      key: "approval.client_review_enabled",
      value_json: { enabled: parsed.data.clientReviewEnabled === "true" },
    });
  }
  if (parsed.data.clientCanComment !== "") {
    rows.push({
      workspace_id: parsed.data.workspaceId,
      key: "approval.client_can_comment",
      value_json: { allowed: parsed.data.clientCanComment === "true" },
    });
  }
  if (parsed.data.allowSelfApproval !== "") {
    rows.push({
      workspace_id: parsed.data.workspaceId,
      key: "approval.allow_self_approval",
      value_json: { enabled: parsed.data.allowSelfApproval === "true" },
    });
  }
  if (parsed.data.criticalFields !== "") {
    const fields = parsed.data.criticalFields
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    rows.push({
      workspace_id: parsed.data.workspaceId,
      key: "approval.critical_fields",
      value_json: { fields },
    });
  }
  if (rows.length === 0) return fail("Tidak ada pengaturan yang diubah.");
  const { error } = await supabase
    .from("workspace_settings")
    .upsert(rows, { onConflict: "workspace_id,key" });
  if (error) return fail(dbErrorMessage(error, "Gagal menyimpan pengaturan approval"));
  revalidateApproval();
  return ok("Pengaturan approval disimpan.");
}

// ============================================================================
// P4-14 — Komentar klien di portal (BUKAN keputusan approval).
// ============================================================================

export async function clientCommentAction(
  _prev: ApprovalActionResult,
  formData: FormData,
): Promise<ApprovalActionResult> {
  const parsed = clientCommentSchema.safeParse({
    shareId: formData.get("shareId"),
    body: formData.get("body"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  const { supabase, user } = await requireUser();
  if (!supabase || !user)
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  const { data, error } = await supabase.rpc("create_client_comment", {
    p_share_id: parsed.data.shareId,
    p_body: parsed.data.body,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal mengirim komentar"));
  const result = rpcResult(data);
  if (!result?.ok) return fail(result?.message ?? "Gagal mengirim komentar.");
  revalidateApproval();
  return ok("Komentar terkirim. Komentar klien tidak mengubah keputusan approval.");
}
