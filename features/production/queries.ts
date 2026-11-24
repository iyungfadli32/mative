/**
 * Query baca Production Operations — features/production/queries.ts (Phase 3)
 * Semua query lewat Supabase client sesi (RLS menegakkan tenant + role).
 * Bila tabel belum ada (0009 belum diterapkan), kembalikan
 * { unavailable: true } — halaman menampilkan pesan jujur, BUKAN crash.
 * TIDAK ADA query yang menulis; TIDAK ADA service-role di sini.
 * Signed URL aset dibuat di sini (server-side, 1 jam) — TIDAK ADA URL
 * publik untuk aset (bucket privat).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryResult } from "@/features/planning/types";
import { listWorkspaceMembers } from "@/features/planning/queries";
import { ASSET_BUCKET, ASSET_SIGNED_URL_SECONDS } from "./constants";
import type {
  AppNotification,
  Asset,
  AssetVersion,
  BriefTemplate,
  Comment,
  ContentAsset,
  Task,
  TaskChecklistItem,
  TaskWithRelations,
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
        error: "Query gagal.",
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

/** Nama tampilan anggota workspace (untuk assignee/penulis/uploader). */
export async function memberNames(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Map<string, string>> {
  const members = await listWorkspaceMembers(supabase, workspaceId);
  return new Map(members.map((m) => [m.userId, m.displayName]));
}

// ============================================================================
// Tasks (P3-06)
// ============================================================================

export async function listTasks(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryResult<TaskWithRelations[]>> {
  const result = await runQuery<Task[]>(
    supabase
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200),
    [],
  );
  if (result.error || result.data.length === 0) return { ...result, data: result.data ?? [] };
  const names = await memberNames(supabase, workspaceId);
  const [checklists, parents] = await Promise.all([
    runQuery<TaskChecklistItem[]>(
      supabase
        .from("task_checklist_items")
        .select("*")
        .in(
          "task_id",
          result.data.map((t) => t.id),
        )
        .order("sort_order", { ascending: true }),
      [],
    ),
    Promise.all([
      runQuery<Array<{ id: string; title: string }>>(
        supabase
          .from("content_items")
          .select("id, title")
          .in(
            "id",
            result.data.filter((t) => t.parent_type === "content_item").map((t) => t.parent_id),
          ),
        [],
      ),
      runQuery<Array<{ id: string; name: string }>>(
        supabase
          .from("campaigns")
          .select("id, name")
          .in(
            "id",
            result.data.filter((t) => t.parent_type === "campaign").map((t) => t.parent_id),
          ),
        [],
      ),
    ]),
  ]);
  const byTask = new Map<string, TaskChecklistItem[]>();
  for (const c of checklists.data) {
    const list = byTask.get(c.task_id) ?? [];
    list.push(c);
    byTask.set(c.task_id, list);
  }
  const parentTitles = new Map<string, string>();
  for (const row of parents[0].data) parentTitles.set(row.id, row.title);
  for (const row of parents[1].data) parentTitles.set(row.id, row.name);
  return {
    data: result.data.map((t) => ({
      ...t,
      checklist: byTask.get(t.id) ?? [],
      parentTitle: parentTitles.get(t.parent_id) ?? null,
      assigneeName: t.assignee_user_id ? (names.get(t.assignee_user_id) ?? null) : null,
      creatorName: t.created_by ? (names.get(t.created_by) ?? null) : null,
    })),
    error: null,
    unavailable: false,
  };
}

/** Task milik saya (assignee = pemanggil) — tab "Tugas Saya". */
export async function listMyTasks(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<QueryResult<TaskWithRelations[]>> {
  const all = await listTasks(supabase, workspaceId);
  if (all.error) return all;
  return {
    data: all.data.filter((t) => t.assignee_user_id === userId),
    error: null,
    unavailable: false,
  };
}

export async function getTaskDetail(
  supabase: SupabaseClient,
  taskId: string,
): Promise<QueryResult<TaskWithRelations | null>> {
  const result = await runQuery<Task | null>(
    supabase.from("tasks").select("*").eq("id", taskId).single(),
    null,
  );
  if (result.error || !result.data) return result;
  const [checklist, names] = await Promise.all([
    runQuery<TaskChecklistItem[]>(
      supabase
        .from("task_checklist_items")
        .select("*")
        .eq("task_id", taskId)
        .order("sort_order", { ascending: true }),
      [],
    ),
    memberNames(supabase, result.data.workspace_id),
  ]);
  const t = result.data;
  return {
    data: {
      ...t,
      checklist: checklist.data,
      assigneeName: t.assignee_user_id ? (names.get(t.assignee_user_id) ?? null) : null,
      creatorName: t.created_by ? (names.get(t.created_by) ?? null) : null,
    },
    error: null,
    unavailable: false,
  };
}

// ============================================================================
// Brief templates (P3-05)
// ============================================================================

export async function listBriefTemplates(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryResult<BriefTemplate[]>> {
  return runQuery<BriefTemplate[]>(
    supabase
      .from("brief_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("is_default", { ascending: false })
      .order("name", { ascending: true }),
    [],
  );
}

/** Template default workspace; dibuat malas (lazy) oleh server action bila belum ada. */
export async function getDefaultBriefTemplate(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryResult<BriefTemplate | null>> {
  return runQuery<BriefTemplate | null>(
    supabase
      .from("brief_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_default", true)
      .single(),
    null,
  );
}

// ============================================================================
// Assets (P3-07, P3-08)
// ============================================================================

export async function listAssets(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryResult<Asset[]>> {
  // Batch 4 (T-5): hitung total agar halaman bisa memperingatkan bila
  // pengambilan 200 aset terpotong.
  let total = 0;
  try {
    const { count } = await supabase
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    total = count ?? 0;
  } catch {
    total = 0;
  }
  const result = await runQuery<Asset[]>(
    supabase
      .from("assets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200),
    [],
  );
  return {
    ...result,
    total,
    truncated: result.data.length >= 200 && total > result.data.length,
  };
}

export async function listContentAssets(
  supabase: SupabaseClient,
  contentItemId: string,
): Promise<QueryResult<ContentAsset[]>> {
  const result = await runQuery<ContentAsset[]>(
    supabase
      .from("content_assets")
      .select("*, asset:assets(*)")
      .eq("content_item_id", contentItemId)
      .order("sort_order", { ascending: true }),
    [],
  );
  return result;
}

/** Signed URL 1 jam untuk satu aset (bucket privat — TIDAK ADA URL publik). */
export async function getAssetSignedUrl(
  supabase: SupabaseClient,
  objectKey: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(ASSET_BUCKET)
      .createSignedUrl(objectKey, ASSET_SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

// ============================================================================
// Comments + mentions (P3-09)
// ============================================================================

export async function listComments(
  supabase: SupabaseClient,
  targetType: string,
  targetId: string,
): Promise<QueryResult<Comment[]>> {
  const result = await runQuery<Comment[]>(
    supabase
      .from("comments")
      .select("*")
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .order("created_at", { ascending: true })
      .limit(200),
    [],
  );
  if (result.error || result.data.length === 0) return result;
  const workspaceId = result.data[0]?.workspace_id;
  if (!workspaceId) return result;
  const names = await memberNames(supabase, workspaceId);
  const mentions = await runQuery<
    Array<{ id: string; comment_id: string; mentioned_user_id: string }>
  >(
    supabase
      .from("mentions")
      .select("id, comment_id, mentioned_user_id")
      .in(
        "comment_id",
        result.data.map((c) => c.id),
      ),
    [],
  );
  const byComment = new Map<string, Comment["mentions"]>();
  for (const m of mentions.data) {
    const list = byComment.get(m.comment_id) ?? [];
    list.push({
      id: m.id,
      mentioned_user_id: m.mentioned_user_id,
      mentionedName: names.get(m.mentioned_user_id) ?? null,
    });
    byComment.set(m.comment_id, list);
  }
  return {
    data: result.data.map((c) => ({
      ...c,
      authorName: c.author_user_id ? (names.get(c.author_user_id) ?? null) : null,
      mentions: byComment.get(c.id) ?? [],
    })),
    error: null,
    unavailable: false,
  };
}

// ============================================================================
// Notifications (P3-A6) + setting komentar klien (P3-09)
// ============================================================================

export async function listMyNotifications(
  supabase: SupabaseClient,
  userId: string,
  opts?: { limit?: number; offset?: number },
): Promise<QueryResult<AppNotification[]>> {
  // Perbaikan (c) T-4: daftar notifikasi bisa dipaginasi -- batas kaku 50
  // diganti limit/offset (default tetap 50 dari awal supaya pemanggil lama
  // tidak berubah perilakunya).
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  return runQuery<AppNotification[]>(
    supabase
      .from("notifications")
      .select("*")
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    [],
  );
}

export async function countUnreadNotifications(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  // Lonceng Topbar: gagal menghitung tidak boleh merusak halaman.
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", userId)
    .is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}

// Perbaikan (c) T-3: riwayat versi aset (terbaru dulu).
export async function listAssetVersions(
  supabase: SupabaseClient,
  assetId: string,
): Promise<QueryResult<AssetVersion[]>> {
  return runQuery<AssetVersion[]>(
    supabase
      .from("asset_versions")
      .select(
        "id, asset_id, version_number, storage_object_key, mime_type, byte_size, uploaded_by, created_at",
      )
      .eq("asset_id", assetId)
      .order("version_number", { ascending: false }),
    [],
  );
}

export async function listAssetVersionsByAssetIds(
  supabase: SupabaseClient,
  assetIds: string[],
): Promise<Map<string, AssetVersion[]>> {
  const versionsByAsset = new Map<string, AssetVersion[]>();
  if (assetIds.length === 0) return versionsByAsset;
  const result = await runQuery<AssetVersion[]>(
    supabase
      .from("asset_versions")
      .select(
        "id, asset_id, version_number, storage_object_key, mime_type, byte_size, uploaded_by, created_at",
      )
      .in("asset_id", assetIds)
      .order("version_number", { ascending: false }),
    [],
  );
  for (const version of result.data) {
    const list = versionsByAsset.get(version.asset_id) ?? [];
    list.push(version);
    versionsByAsset.set(version.asset_id, list);
  }
  return versionsByAsset;
}

/** Apakah workspace mengizinkan klien berkomentar (default: tidak). */
export async function getClientCommentsAllowed(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("workspace_settings")
      .select("value_json")
      .eq("workspace_id", workspaceId)
      .eq("key", "allow_client_comments")
      .single();
    if (error || !data) return false;
    return (data as { value_json: unknown }).value_json === true;
  } catch {
    return false;
  }
}
