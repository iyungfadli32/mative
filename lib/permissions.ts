/**
 * RBAC dasar — lib/permissions.ts
 * Sumber: Dok 06 §2 (9 role baseline) + §3 (matriks izin) + P1-A6/P1-A7
 * (Keputusan #9: "limited" = lihat + edit yang ditugaskan saja;
 *  brand scope DITEGAKKAN sejak 0016 — lihat brandInScope di bawah;
 *  penegakan sesungguhnya di RLS, di sini cermin + pre-validasi).
 *
 * ATURAN KERAS: matriks ini adalah cermin UI/server-action SAJA.
 * Penegakan sesungguhnya ada di RLS database (supabase/migrations/).
 * Jangan pernah menerima `role` dari body request sebagai identitas tepercaya
 * (Dok 06 §4) — role selalu dibaca dari workspace_members lewat sesi.
 */

export const WORKSPACE_ROLES = [
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

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export type Capability =
  | "manage_organization"
  | "manage_workspace_settings"
  | "invite_members"
  | "manage_brands_channels"
  | "manage_pillars_campaigns"
  | "create_ideas_briefs"
  | "create_edit_content"
  | "manage_tasks"
  | "upload_assets"
  | "comment"
  | "approve_assigned"
  | "schedule_publish"
  | "view_analytics"
  | "export_data"
  | "view_portal_shared";

/**
 * Matriks Dok 06 §3. Nilai:
 *  - true  = diizinkan penuh
 *  - "limited" = lihat + edit yang ditugaskan saja (P1-A6); TIDAK boleh
 *    mengubah settings, mengundang/mengubah member, menghapus, mengubah role,
 *    atau mengakses tenant lain.
 *  - "view" = hanya membaca
 *  - "shared" = hanya resource yang dibagikan eksplisit (viewer_client)
 *  - false = tidak diizinkan
 */
export const PERMISSION_MATRIX: Record<
  Capability,
  Record<WorkspaceRole, boolean | "limited" | "view" | "shared">
> = {
  manage_organization: {
    owner: true,
    admin: false,
    manager: false,
    strategist: false,
    creator: false,
    editor: false,
    approver: false,
    analyst: false,
    viewer_client: false,
  },
  manage_workspace_settings: {
    owner: true,
    admin: true,
    manager: "limited",
    strategist: false,
    creator: false,
    editor: false,
    approver: false,
    analyst: false,
    viewer_client: false,
  },
  invite_members: {
    owner: true,
    admin: true,
    manager: "limited",
    strategist: false,
    creator: false,
    editor: false,
    approver: false,
    analyst: false,
    viewer_client: false,
  },
  manage_brands_channels: {
    owner: true,
    admin: true,
    manager: "limited",
    strategist: "view",
    creator: false,
    editor: false,
    approver: false,
    analyst: "view",
    viewer_client: false,
  },
  manage_pillars_campaigns: {
    owner: true,
    admin: true,
    manager: true,
    strategist: true,
    creator: "view",
    editor: "view",
    approver: "view",
    analyst: "view",
    viewer_client: "shared",
  },
  create_ideas_briefs: {
    owner: true,
    admin: true,
    manager: true,
    strategist: true,
    creator: true,
    editor: true,
    approver: false,
    analyst: false,
    viewer_client: false,
  },
  create_edit_content: {
    owner: true,
    admin: true,
    manager: true,
    strategist: true,
    creator: "limited",
    editor: "limited",
    approver: false,
    analyst: false,
    viewer_client: false,
  },
  manage_tasks: {
    owner: true,
    admin: true,
    manager: true,
    strategist: "limited",
    creator: "limited",
    editor: "limited",
    approver: "limited",
    analyst: "view",
    viewer_client: false,
  },
  upload_assets: {
    owner: true,
    admin: true,
    manager: true,
    strategist: true,
    creator: "limited",
    editor: "limited",
    approver: "view",
    analyst: false,
    viewer_client: false,
  },
  comment: {
    owner: true,
    admin: true,
    manager: true,
    strategist: true,
    creator: true,
    editor: true,
    approver: true,
    analyst: false,
    viewer_client: false, // default TIDAK BOLEH berkomentar (Keputusan #12)
  },
  approve_assigned: {
    owner: "limited", // hanya bila workflow mengizinkan / ditugaskan eksplisit
    admin: "limited",
    manager: "limited",
    strategist: false,
    creator: false,
    editor: false,
    approver: true,
    analyst: false,
    viewer_client: false,
  },
  schedule_publish: {
    owner: true,
    admin: true,
    manager: true,
    strategist: "limited",
    creator: false,
    editor: false,
    approver: false,
    analyst: false,
    viewer_client: false,
  },
  view_analytics: {
    owner: true,
    admin: true,
    manager: true,
    strategist: true,
    creator: "limited",
    editor: "limited",
    approver: "limited",
    analyst: true,
    viewer_client: "shared",
  },
  export_data: {
    owner: true,
    admin: true,
    manager: true,
    strategist: "limited",
    creator: false,
    editor: false,
    approver: false,
    analyst: true,
    viewer_client: false,
  },
  view_portal_shared: {
    owner: false,
    admin: false,
    manager: false,
    strategist: false,
    creator: false,
    editor: false,
    approver: false,
    analyst: false,
    viewer_client: "shared", // P1-16: hanya resource yang dibagikan eksplisit
  },
};

/** Apakah role punya capability (penuh ATAU limited)? "view"/"shared" bukan izin mutasi. */
export function can(role: WorkspaceRole, capability: Capability): boolean {
  const v = PERMISSION_MATRIX[capability][role];
  return v === true || v === "limited";
}

/** Apakah role hanya boleh membaca capability ini? */
export function canViewOnly(role: WorkspaceRole, capability: Capability): boolean {
  const v = PERMISSION_MATRIX[capability][role];
  return v === "view" || v === "shared";
}

/** Apakah role ini "limited" untuk capability ini (hanya yang ditugaskan)? */
export function isLimited(role: WorkspaceRole, capability: Capability): boolean {
  return PERMISSION_MATRIX[capability][role] === "limited";
}

/** Role yang boleh mengundang anggota (owner/admin penuh; manager limited = TIDAK boleh undang). */
export function canInvite(role: WorkspaceRole): boolean {
  // P1-A6: "limited" TIDAK boleh mengundang/mengubah member.
  return PERMISSION_MATRIX.invite_members[role] === true;
}

/** Role yang boleh diberi lewat undangan (semua 9 role baseline; custom role TIDAK ada). */
export function isInvitableRole(role: string): role is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(role);
}

/**
 * Brand scope (P1-A7, ditegakkan 0016, ADR-0011 §2).
 * `null` = semua brand di workspace; array UUID = hanya brand itu
 * (array kosong = tidak ada brand). `brandId` null = baris tanpa brand
 * (ide/pilar tanpa brand) — selalu terlihat semua member.
 */
export type BrandScope = string[] | null;

export function brandInScope(scope: BrandScope, brandId: string | null | undefined): boolean {
  if (!brandId) return true;
  if (scope === null) return true;
  return scope.includes(brandId);
}

/** Label Bahasa Indonesia untuk role (UI). */
export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Pemilik",
  admin: "Admin",
  manager: "Manajer",
  strategist: "Strategist",
  creator: "Creator",
  editor: "Editor",
  approver: "Approver",
  analyst: "Analis",
  viewer_client: "Klien (Viewer)",
};
