import { describe, expect, it } from "vitest";
import {
  invitationSchema,
  organizationSchema,
  resourceShareSchema,
  signUpSchema,
  workspaceSchema,
} from "@/lib/validation/schemas";

describe("Validasi Zod — boundary aplikasi", () => {
  it("sign up menolak email buruk dan kata sandi pendek", () => {
    expect(
      signUpSchema.safeParse({ email: "bukan-email", password: "123", displayName: "A" }).success,
    ).toBe(false);
    expect(
      signUpSchema.safeParse({ email: "a@b.co", password: "rahasia123", displayName: "Ayu" })
        .success,
    ).toBe(true);
  });

  it("slug organisasi hanya huruf kecil/angka/tanda hubung", () => {
    expect(organizationSchema.safeParse({ name: "Studio", slug: "Studio Keren!" }).success).toBe(
      false,
    );
    expect(organizationSchema.safeParse({ name: "Studio", slug: "studio-keren" }).success).toBe(
      true,
    );
  });

  it("workspace menolak timezone kosong; default Asia/Jakarta", () => {
    const bad = workspaceSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "WS",
      slug: "ws",
      timezone: "",
      defaultLocale: "id",
    });
    expect(bad.success).toBe(false);
    const ok = workspaceSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "WS",
      slug: "ws",
      defaultLocale: "id",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.timezone).toBe("Asia/Jakarta");
  });

  it("undangan menolak role di luar 9 baseline", () => {
    expect(
      invitationSchema.safeParse({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        email: "x@y.co",
        role: "superadmin",
      }).success,
    ).toBe(false);
    expect(
      invitationSchema.safeParse({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        email: "x@y.co",
        role: "viewer_client",
      }).success,
    ).toBe(true);
  });

  it("share portal hanya menerima content_item/campaign + UUID valid", () => {
    const base = {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      resourceId: "22222222-2222-4222-8222-222222222222",
      sharedWithUserId: "33333333-3333-4333-8333-333333333333",
    };
    expect(resourceShareSchema.safeParse({ ...base, resourceType: "asset" }).success).toBe(false);
    expect(resourceShareSchema.safeParse({ ...base, resourceType: "content_item" }).success).toBe(
      true,
    );
  });
});
