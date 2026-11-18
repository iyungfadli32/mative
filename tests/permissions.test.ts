import { describe, expect, it } from "vitest";
import {
  can,
  canInvite,
  canViewOnly,
  isInvitableRole,
  isLimited,
  PERMISSION_MATRIX,
  WORKSPACE_ROLES,
} from "@/lib/permissions";

describe("RBAC — 9 role baseline (Dok 06 §2)", () => {
  it("memiliki tepat 9 role baseline", () => {
    expect(WORKSPACE_ROLES).toHaveLength(9);
    expect(WORKSPACE_ROLES).toContain("viewer_client");
  });

  it("owner bisa mengelola organisasi; admin tidak", () => {
    expect(can("owner", "manage_organization")).toBe(true);
    expect(can("admin", "manage_organization")).toBe(false);
  });

  it("manager 'limited' TIDAK boleh mengundang (P1-A6)", () => {
    expect(isLimited("manager", "invite_members")).toBe(true);
    expect(canInvite("manager")).toBe(false);
    expect(canInvite("owner")).toBe(true);
    expect(canInvite("admin")).toBe(true);
  });

  it("creator hanya 'limited' untuk edit konten (hanya yang ditugaskan)", () => {
    expect(isLimited("creator", "create_edit_content")).toBe(true);
    expect(can("creator", "create_edit_content")).toBe(true);
    expect(can("creator", "schedule_publish")).toBe(false);
  });

  it("viewer_client default TIDAK BOLEH berkomentar (Keputusan #12)", () => {
    expect(can("viewer_client", "comment")).toBe(false);
    expect(canViewOnly("viewer_client", "view_analytics")).toBe(true);
    expect(can("viewer_client", "view_analytics")).toBe(false);
  });

  it("viewer_client hanya melihat resource yang dibagikan (portal)", () => {
    expect(PERMISSION_MATRIX.view_portal_shared.viewer_client).toBe("shared");
    expect(can("viewer_client", "view_portal_shared")).toBe(false);
  });

  it("semua role bisa diundang; role di luar baseline ditolak", () => {
    for (const r of WORKSPACE_ROLES) expect(isInvitableRole(r)).toBe(true);
    expect(isInvitableRole("superadmin")).toBe(false);
    expect(isInvitableRole("custom_role")).toBe(false);
  });

  it("approver hanya bisa approve bila ditugaskan; owner/admin/manager limited", () => {
    expect(can("approver", "approve_assigned")).toBe(true);
    expect(isLimited("owner", "approve_assigned")).toBe(true);
    expect(can("creator", "approve_assigned")).toBe(false);
  });
});
