/**
 * Query baca Review & Approval — features/approval/queries.ts (P4-04).
 * Semua query lewat Supabase client sesi (RLS menegakkan tenant + role).
 * Bila tabel belum ada (0013 belum diterapkan), kembalikan
 * { unavailable: true } — halaman menampilkan pesan jujur, BUKAN crash.
 * TIDAK ADA query yang menulis; TIDAK ADA service-role di sini.
 * Penugasan step ("menunggu saya") dihitung dari approval_steps:
 * step menugaskan pemanggil lewat assignee_user_id ATAU assignee_role
 * yang cocok dengan role pemanggil (ADR-0010 §6).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryResult } from "@/features/planning/types";
import { listWorkspaceMembers } from "@/features/planning/queries";
import { DEFAULT_CRITICAL_FIELDS } from "./constants";
import type {
  ApprovalDecision,
  ApprovalQueueTab,
  ApprovalRequest,
  ApprovalStep,
  ApprovalWorkflow,
} from "./types";

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /Could not find the table|does not exist|relation .* does not exist/i.test(error.message ?? "")
  );
}

async function runQuery<T>(
  query: PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>,
  empty: T,
): Promise<QueryResult<T>> {
  try {
    const { data, error } = await query;
    if (error) {
      return {
        data: empty,
        error: error.message ?? "Query gagal.",
        unavailable: isMissingTable(error),
      };
    }
    return { data: data ?? empty, error: null, unavailable: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Query gagal.";
    return {
      data: empty,
      error: message,
      unavailable: /does not exist|Could not find/i.test(message),
    };
  }
}

/** Nama tampilan anggota workspace (untuk submitter/approver). */
export async function approvalMemberNames(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Map<string, string>> {
  const members = await listWorkspaceMembers(supabase, workspaceId);
  return new Map(members.map((m) => [m.userId, m.displayName]));
}

// ============================================================================
// Workflows + steps
// ============================================================================

export async function listWorkflows(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryResult<ApprovalWorkflow[]>> {
  return runQuery(
    supabase
      .from("approval_workflows")
      .select("id, workspace_id, name, is_default, created_by, created_at")
      .eq("workspace_id", workspaceId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true }),
    [],
  );
}

export async function getDefaultWorkflow(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryResult<ApprovalWorkflow | null>> {
  const res = await runQuery(
    supabase
      .from("approval_workflows")
      .select("id, workspace_id, name, is_default, created_by, created_at")
      .eq("workspace_id", workspaceId)
      .eq("is_default", true)
      .limit(1),
    [],
  );
  return { data: res.data[0] ?? null, error: res.error, unavailable: res.unavailable };
}

export async function listWorkflowSteps(
  supabase: SupabaseClient,
  workflowId: string,
): Promise<QueryResult<ApprovalStep[]>> {
  return runQuery(
    supabase
      .from("approval_steps")
      .select(
        "id, workflow_id, step_order, step_type, assignee_role, assignee_user_id, required_count",
      )
      .eq("workflow_id", workflowId)
      .order("step_order", { ascending: true })
      .order("created_at", { ascending: true }),
    [],
  );
}

// ============================================================================
// Requests + decisions
// ============================================================================

export type ApprovalRequestWithRelations = ApprovalRequest & {
  content_title?: string | null;
  content_production_status?: string | null;
  version_number?: number | null;
  workflow_name?: string | null;
};

const REQUEST_COLUMNS =
  "id, workspace_id, target_type, target_id, content_version_id, placement_version_id, workflow_id, request_type, status, submitted_by, submitted_at, completed_at, current_step_order, created_at, updated_at";

/**
 * Antrean Approval Center (M4.1). Tab:
 * - menunggu_saya: request in_review yang step saat ini menugaskan pemanggil.
 * - semua_tertunda: semua request submitted/in_review/reapproval_required.
 * - disetujui / minta_revisi / ditolak: berdasarkan status request.
 * Penugasan dihitung di aplikasi (step assignee_user_id ATAU assignee_role
 * == role pemanggil) karena RLS tidak bisa mengekspresikan "step saat ini".
 */
export async function listApprovalQueue(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  role: string,
  tab: ApprovalQueueTab,
): Promise<QueryResult<ApprovalRequest[]>> {
  let query = supabase
    .from("approval_requests")
    .select(REQUEST_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (tab === "semua_tertunda") {
    query = query.in("status", ["submitted", "in_review", "reapproval_required"]);
  } else if (tab === "disetujui") {
    query = query.eq("status", "approved");
  } else if (tab === "minta_revisi") {
    query = query.eq("status", "changes_requested");
  } else if (tab === "ditolak") {
    query = query.eq("status", "rejected");
  } else {
    // menunggu_saya: in_review saja; penugasan difilter di bawah.
    query = query.eq("status", "in_review");
  }
  const res = await runQuery(query, [] as ApprovalRequest[]);
  if (res.unavailable || res.error || tab !== "menunggu_saya") return res;
  // Filter penugasan: step pada current_step_order yang menugaskan pemanggil.
  const requests = res.data;
  if (requests.length === 0) return res;
  const workflowIds = [...new Set(requests.map((r) => r.workflow_id))];
  const { data: steps } = await supabase
    .from("approval_steps")
    .select(
      "id, workflow_id, step_order, step_type, assignee_role, assignee_user_id, required_count",
    )
    .in("workflow_id", workflowIds);
  const stepsByWorkflow = new Map<string, ApprovalStep[]>();
  for (const s of (steps ?? []) as ApprovalStep[]) {
    const list = stepsByWorkflow.get(s.workflow_id) ?? [];
    list.push(s);
    stepsByWorkflow.set(s.workflow_id, list);
  }
  const mine = requests.filter((r) => {
    const atOrder = (stepsByWorkflow.get(r.workflow_id) ?? []).filter(
      (s) => s.step_order === r.current_step_order,
    );
    return atOrder.some(
      (s) =>
        s.assignee_user_id === userId || (s.assignee_role !== null && s.assignee_role === role),
    );
  });
  return { data: mine, error: null, unavailable: false };
}

/**
 * Request persetujuan yang masih in_review untuk satu workspace — panel
 * "Antrean persetujuan" dashboard (Phase 9). Diurutkan dari yang terbaru
 * diajukan; dibatasi (default 5). KPI "Menunggu persetujuan" menghitung
 * item dengan production_status internal_review; dalam alur normal
 * (RPC 0014) submit membuat request in_review SEKALIGUS memindahkan
 * item ke internal_review, jadi kedua angka ini selaras.
 */
export async function listPendingApprovalRequests(
  supabase: SupabaseClient,
  workspaceId: string,
  limit = 5,
): Promise<QueryResult<ApprovalRequest[]>> {
  return runQuery(
    supabase
      .from("approval_requests")
      .select(REQUEST_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("status", "in_review")
      .order("submitted_at", { ascending: false })
      .limit(limit),
    [] as ApprovalRequest[],
  );
}

export async function getApprovalRequest(
  supabase: SupabaseClient,
  requestId: string,
): Promise<QueryResult<ApprovalRequest | null>> {
  const res = await runQuery(
    supabase.from("approval_requests").select(REQUEST_COLUMNS).eq("id", requestId).limit(1),
    [] as ApprovalRequest[],
  );
  return { data: res.data[0] ?? null, error: res.error, unavailable: res.unavailable };
}

export async function listApprovalDecisions(
  supabase: SupabaseClient,
  requestId: string,
): Promise<QueryResult<ApprovalDecision[]>> {
  return runQuery(
    supabase
      .from("approval_decisions")
      .select("id, approval_request_id, step_id, approver_user_id, decision, comment, created_at")
      .eq("approval_request_id", requestId)
      .order("created_at", { ascending: true }),
    [],
  );
}

/** Semua request (aktif + selesai) untuk satu konten — tab approval editor. */
export async function listContentApprovalRequests(
  supabase: SupabaseClient,
  contentItemId: string,
): Promise<QueryResult<ApprovalRequest[]>> {
  return runQuery(
    supabase
      .from("approval_requests")
      .select(REQUEST_COLUMNS)
      .eq("target_type", "content_item")
      .eq("target_id", contentItemId)
      .order("created_at", { ascending: false }),
    [],
  );
}

/** Request aktif (satu-satunya yang bisa diputuskan) untuk satu konten+versi. */
export async function getActiveApprovalRequest(
  supabase: SupabaseClient,
  contentItemId: string,
  contentVersionId?: string,
): Promise<QueryResult<ApprovalRequest | null>> {
  let query = supabase
    .from("approval_requests")
    .select(REQUEST_COLUMNS)
    .eq("target_type", "content_item")
    .eq("target_id", contentItemId)
    .in("status", ["submitted", "in_review", "reapproval_required"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (contentVersionId) query = query.eq("content_version_id", contentVersionId);
  const res = await runQuery(query, [] as ApprovalRequest[]);
  return { data: res.data[0] ?? null, error: res.error, unavailable: res.unavailable };
}

/** Apakah gerbang client_review aktif di workspace ini? (default MATI.) */
export async function isClientReviewEnabled(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("workspace_settings")
    .select("value_json")
    .eq("workspace_id", workspaceId)
    .eq("key", "approval.client_review_enabled")
    .limit(1);
  const row = (data ?? [])[0] as { value_json?: { enabled?: boolean } } | undefined;
  return row?.value_json?.enabled === true;
}

/** Apakah workspace mengizinkan komentar klien di portal? (default TIDAK.) */
export async function isClientCommentAllowed(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("workspace_settings")
    .select("value_json")
    .eq("workspace_id", workspaceId)
    .eq("key", "approval.client_can_comment")
    .limit(1);
  const row = (data ?? [])[0] as { value_json?: { allowed?: boolean } } | undefined;
  return row?.value_json?.allowed === true;
}

/** Daftar field kritis workspace (default ADR-0010 bila belum dikonfigurasi). */
export async function getCriticalFields(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("workspace_settings")
    .select("value_json")
    .eq("workspace_id", workspaceId)
    .eq("key", "approval.critical_fields")
    .limit(1);
  const row = (data ?? [])[0] as { value_json?: { fields?: string[] } } | undefined;
  const fields = row?.value_json?.fields;
  if (Array.isArray(fields) && fields.length > 0) return fields;
  // Default ADR-0010 §3. (approval_critical_fields sengaja TIDAK di-grant
  // ke authenticated — helper internal trigger; jangan panggil via RPC.)
  return [...DEFAULT_CRITICAL_FIELDS];
}
