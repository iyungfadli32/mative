"use server";

import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "node:crypto";
import { getSupabaseServerClient, getSupabaseAdminClient } from "@/lib/supabase/server";
import { organizationSchema, workspaceSchema, invitationSchema } from "@/lib/validation/schemas";
import { canInvite } from "@/lib/permissions";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";

/**
 * Server actions tenancy — features/tenancy/actions.ts (P1-08, P1-09).
 * Aturan: tenant/role TIDAK PERNAH dipercaya dari body request (Dok 06 §4).
 * user_id + role selalu dibaca dari sesi + workspace_members.
 * Undangan: berlaku 7 hari, bisa dicabut (P1-A5), satu kali pakai.
 * Token undangan disimpan sebagai HASH (sha256), bukan token mentah.
 */

export type ActionResult = { ok: boolean; message: string };

async function requireUser() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { supabase: null, user: null };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function createOrganizationAction(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = organizationSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return { ok: false, message: supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID };
  }
  const { error } = await supabase.from("organizations").insert({
    name: parsed.data.name,
    slug: parsed.data.slug,
    owner_user_id: user.id,
    status: "active",
  });
  if (error) return { ok: false, message: `Gagal membuat organisasi: ${error.message}` };
  revalidatePath("/pengaturan/organisasi");
  return { ok: true, message: "Organisasi dibuat." };
}

export async function createWorkspaceAction(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = workspaceSchema.safeParse({
    organizationId: formData.get("organizationId"),
    name: formData.get("name"),
    slug: formData.get("slug"),
    timezone: formData.get("timezone"),
    defaultLocale: formData.get("defaultLocale"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return { ok: false, message: supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID };
  }
  // RLS: hanya member organisasi yang bisa membuat workspace di dalamnya;
  // pembuat otomatis menjadi owner workspace (lihat migrasi 0003).
  const { error } = await supabase.from("workspaces").insert({
    organization_id: parsed.data.organizationId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    timezone: parsed.data.timezone,
    default_locale: parsed.data.defaultLocale,
  });
  if (error) return { ok: false, message: `Gagal membuat workspace: ${error.message}` };
  revalidatePath("/pengaturan/organisasi");
  return { ok: true, message: "Workspace dibuat." };
}

/** Daftar workspace yang bisa diakses pengguna saat ini (lewat RLS). */
export async function listMyWorkspaces() {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return [];
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_role, workspaces(id, name, slug, timezone)")
    .eq("user_id", user.id)
    .eq("membership_status", "active");
  return (data ?? []).map((row) => ({
    role: row.workspace_role as string,
    workspace: row.workspaces as unknown as {
      id: string;
      name: string;
      slug: string;
      timezone: string;
    },
  }));
}

export async function inviteMemberAction(
  _prevState: ActionResult & { inviteToken?: string },
  formData: FormData,
): Promise<ActionResult & { inviteToken?: string }> {
  const parsed = invitationSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return { ok: false, message: supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID };
  }
  // Peran pemanggil dibaca dari DB, BUKAN dari body (anti-tampering, Dok 06 §8 tes 2).
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_role")
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("user_id", user.id)
    .eq("membership_status", "active")
    .single();
  const callerRole = membership?.workspace_role as string | undefined;
  if (!callerRole || !canInvite(callerRole as never)) {
    return { ok: false, message: "Hanya owner/admin yang boleh mengundang anggota." };
  }
  // viewer_client TIDAK BOLEH diundang sebagai anggota workspace biasa?
  // Boleh — viewer_client adalah role baseline; aksesnya tetap dibatasi
  // ke resource yang dibagikan eksplisit (portal). Tidak ada pengecualian di sini.
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 hari (P1-A5)
  const { error } = await supabase.from("workspace_invitations").insert({
    workspace_id: parsed.data.workspaceId,
    email: parsed.data.email,
    role: parsed.data.role,
    token_hash: tokenHash,
    expires_at: expiresAt,
    invited_by: user.id,
    status: "pending",
  });
  if (error) return { ok: false, message: `Gagal membuat undangan: ${error.message}` };
  // Pengiriman email undangan mengikuti kemampuan Supabase Auth (inviteUserByEmail)
  // bila service-role tersedia; bila tidak, token ditampilkan SEKALI ke pengundang
  // untuk diteruskan manual — ini perilaku sementara fase ini, dicatat di laporan.
  const admin = getSupabaseAdminClient();
  if (admin) {
    await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
      data: { workspace_id: parsed.data.workspaceId, role: parsed.data.role },
    });
  }
  revalidatePath("/pengaturan/anggota");
  return {
    ok: true,
    message: admin
      ? "Undangan dibuat dan email undangan dikirim."
      : "Undangan dibuat (email otomatis belum dikonfigurasi — salin tautan di bawah untuk diteruskan manual).",
    inviteToken: admin ? undefined : token,
  };
}

/** Dipakai sebagai form action langsung (bukan useActionState). */
export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) return;
  const { supabase, user } = await requireUser();
  if (!supabase || !user) return;
  await supabase
    .from("workspace_invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .eq("status", "pending");
  revalidatePath("/pengaturan/anggota");
}

export async function acceptInvitationAction(token: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return { ok: false, message: supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID };
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  // Penerima BELUM menjadi member, jadi RLS menolak SELECT undangan langsung.
  // Satu-satunya jalan: fungsi accept_invitation() (SECURITY DEFINER, migrasi
  // 0003) — fungsi itu yang memvalidasi hash, status, kedaluwarsa, dan email.
  const { data, error } = await supabase.rpc("accept_invitation", {
    p_token_hash: tokenHash,
  });
  if (error) {
    return { ok: false, message: `Gagal menerima undangan: ${error.message}` };
  }
  const result = data as { ok: boolean; message: string } | null;
  if (!result?.ok) {
    return { ok: false, message: result?.message ?? "Undangan tidak dapat diterima." };
  }
  revalidatePath("/dashboard");
  return { ok: true, message: result.message };
}
