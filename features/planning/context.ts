/**
 * Konteks perencanaan — features/planning/context.ts
 * Menentukan workspace aktif + peran pemanggil dari sesi (BUKAN dari body).
 * Workspace diambil dari query `?workspace=<id>` bila pemanggil memang
 * member di sana; bila tidak, dari cookie workspace aktif (diset saat
 * workspace dibuat); bila tidak ada, workspace pertama yang bisa diakses.
 */
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIVE_WORKSPACE_COOKIE } from "@/features/planning/active-workspace-cookie";
import { listMyWorkspaces } from "@/features/tenancy/actions";
import type { WorkspaceMembership } from "./types";

export type PlanningContext = {
  userId: string;
  userEmail: string | null;
  workspaces: WorkspaceMembership[];
  workspace: WorkspaceMembership;
  role: string;
  /** true bila ?workspace= diminta tetapi bukan milik pemanggil (Batch 4, T-1). */
  requestedWorkspaceNotMember: boolean;
};

/** Workspace aktif + peran; null bila belum masuk / belum ada workspace / Supabase belum siap. */
export async function getPlanningContext(
  requestedWorkspaceId?: string,
): Promise<PlanningContext | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const mine = await listMyWorkspaces();
  if (mine.length === 0) return null;
  const workspaces: WorkspaceMembership[] = mine.map((w) => ({
    workspaceId: w.workspace.id,
    workspaceName: w.workspace.name,
    workspaceSlug: w.workspace.slug,
    timezone: w.workspace.timezone,
    role: w.role,
  }));
  // Tanpa ?workspace=: pakai workspace aktif dari cookie (diset saat
  // workspace dibuat) bila pemanggil memang member di sana; bila tidak
  // ada / tidak valid, pakai workspace pertama (perilaku lama).
  const cookieWorkspaceId = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const workspace =
    (requestedWorkspaceId
      ? workspaces.find((w) => w.workspaceId === requestedWorkspaceId)
      : undefined) ??
    (cookieWorkspaceId
      ? workspaces.find((w) => w.workspaceId === cookieWorkspaceId)
      : undefined) ??
    workspaces[0];
  if (!workspace) return null;
  const requestedWorkspaceNotMember =
    requestedWorkspaceId != null &&
    requestedWorkspaceId !== "" &&
    !workspaces.some((w) => w.workspaceId === requestedWorkspaceId);
  return {
    userId: user.id,
    userEmail: user.email ?? null,
    workspaces,
    workspace,
    role: workspace.role,
    requestedWorkspaceNotMember,
  };
}

/** Peran pemanggil di satu workspace (dibaca dari DB — anti-tampering). */
export async function getCallerRole(workspaceId: string, userId: string): Promise<string | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("membership_status", "active")
    .single();
  return (data?.workspace_role as string | undefined) ?? null;
}

/**
 * Brand scope pemanggil di satu workspace (P1-A7, 0016).
 * null = semua brand (default, termasuk bila bukan member — pemanggil
 * tanpa keanggotaan ditolak di tempat lain); array = hanya brand itu
 * ([] = tidak ada brand). Elemen bukan UUID diabaikan (fail-closed).
 */
export async function getCallerBrandScope(
  workspaceId: string,
  userId: string,
): Promise<string[] | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("workspace_members")
    .select("brand_scope")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("membership_status", "active")
    .single();
  const scope = (data as { brand_scope?: unknown } | null)?.brand_scope;
  if (!Array.isArray(scope)) return null;
  return scope.filter(
    (v): v is string =>
      typeof v === "string" &&
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v),
  );
}

/** Pesan jujur bila tabel Planning Core belum tersedia di database live. */
export const PLANNING_TABLES_UNAVAILABLE_ID =
  "Tabel Planning Core (migrasi 0007) belum diterapkan ke database ini — minta koordinator menjalankan docs/phase-2-report.md §7, lalu muat ulang halaman ini.";
