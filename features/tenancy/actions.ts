"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ACTIVE_WORKSPACE_COOKIE } from "@/features/planning/active-workspace-cookie";
import { createHash, randomBytes } from "node:crypto";
import { getSupabaseServerClient, getSupabaseAdminClient } from "@/lib/supabase/server";
import {
  organizationSchema,
  workspaceSchema,
  invitationSchema,
  removeMemberSchema,
} from "@/lib/validation/schemas";
import { canInvite } from "@/lib/permissions";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";
import { getCallerRole } from "@/features/planning/context";

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
  const { data: org, error } = await supabase
    .from("organizations")
    .insert({
      name: parsed.data.name,
      slug: parsed.data.slug,
      owner_user_id: user.id,
      status: "active",
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Gagal membuat organisasi: ${error.message}` };
  // Keanggotaan owner dibuat terpisah (lihat kebijakan RLS 0002
  // "org_members_insert_owner_or_admin" butir (a)): tanpa baris ini
  // organisasi tidak pernah muncul di daftar pengguna dan tombol
  // "Buat workspace" tetap nonaktif (defect e2e 2026-11-19).
  const { error: memberError } = await supabase.from("organization_members").insert({
    organization_id: org.id,
    user_id: user.id,
    organization_role: "owner",
    membership_status: "active",
    joined_at: new Date().toISOString(),
  });
  if (memberError) {
    return {
      ok: false,
      message: `Organisasi dibuat, tetapi keanggotaan owner gagal: ${memberError.message}`,
    };
  }
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
  // Pembuatan workspace + keanggotaan owner dilakukan ATOMIK di dalam RPC
  // create_workspace_with_owner (SECURITY DEFINER, migrasi 0024): insert
  // langsung ke workspace_members dari client TIDAK LAGI diizinkan policy
  // RLS (perbaikan K-1 — cabang self-insert di policy dihapus; jalur itu
  // memungkinkan anggota org biasa mengangkat diri jadi owner workspace
  // mana pun). RPC memeriksa pemanggil member organisasi, lalu menyisipkan
  // baris workspace + baris owner dalam satu transaksi — jadi tidak ada
  // lagi jendela workspace tanpa owner, dan tidak ada lagi insert
  // workspace_members terpisah yang bisa gagal sesudah workspace tercipta.
  // ID TIDAK dibuat di server action lagi: RPC mengembalikan workspace_id.
  const { data, error } = await supabase.rpc("create_workspace_with_owner", {
    p_organization_id: parsed.data.organizationId,
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_timezone: parsed.data.timezone,
    p_default_locale: parsed.data.defaultLocale,
  });
  if (error) return { ok: false, message: `Gagal membuat workspace: ${error.message}` };
  const result = data as { ok: boolean; message: string; workspace_id?: string } | null;
  if (!result?.ok) {
    return { ok: false, message: result?.message ?? "Gagal membuat workspace." };
  }
  // Workspace yang baru dibuat menjadi workspace aktif (lihat
  // features/planning/active-workspace-cookie.ts): navigasi berikutnya tanpa
  // `?workspace=` memakai workspace ini, bukan workspaces[0].
  if (typeof result.workspace_id === "string" && result.workspace_id.length > 0) {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, result.workspace_id, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
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
    .eq("membership_status", "active")
    // Urutan DETERMINISTIK (defect e2e 2026-11-19): tanpa ORDER BY,
    // "workspace pertama" (dipakai getPlanningContext + AppShell saat
    // tidak ada pilihan eksplisit) bisa berubah antar pemuatan halaman
    // bila pengguna punya 2+ workspace — brand yang dibuat di halaman
    // Merek lalu tidak tampil di halaman Channel.
    .order("created_at", { ascending: true });
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
    // T-3: hanya owner workspace yang boleh mengundang owner baru.
    if (parsed.data.role === "owner" && callerRole !== "owner") {
      return { ok: false, message: "Hanya owner workspace yang boleh mengundang owner baru." };
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

/**
 * Hapus anggota workspace — pencabutan akses (Phase 9, Dok 06 §8 butir 5).
 * Sebelumnya tidak ada jalur penghapusan anggota di aplikasi: owner hanya
 * bisa mencabut UNDANGAN (pra-gabung), bukan anggota yang sudah bergabung.
 * Aturan: hanya owner; role pemanggil dibaca dari sesi + workspace_members
 * (tidak pernah dari body); diri sendiri tidak bisa dihapus; owner tidak
 * bisa dihapus (mencegah workspace tanpa owner). Baris dihapus dari
 * workspace_members sehingga seluruh pemeriksaan RLS is_ws_member langsung
 * gagal — akses tercabut seketika. Kebijakan RLS delete (0006,
 * ws_members_delete_owner) menegakkan hal yang sama di lapisan DB.
 */
export async function removeMemberAction(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = removeMemberSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    memberId: formData.get("memberId"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return { ok: false, message: supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID };
  }
  const callerRole = await getCallerRole(parsed.data.workspaceId, user.id);
  if (callerRole !== "owner") {
    return { ok: false, message: "Hanya owner workspace yang dapat menghapus anggota." };
  }
  const { data: target, error: targetError } = await supabase
    .from("workspace_members")
    .select("id, user_id, workspace_role")
    .eq("id", parsed.data.memberId)
    .eq("workspace_id", parsed.data.workspaceId)
    .single();
  if (targetError || !target) {
    return { ok: false, message: "Anggota tidak ditemukan di workspace ini." };
  }
  if (target.user_id === user.id) {
    return { ok: false, message: "Anda tidak dapat menghapus diri sendiri." };
  }
  if (target.workspace_role === "owner") {
    return { ok: false, message: "Owner workspace tidak dapat dihapus." };
  }
  const { error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("id", parsed.data.memberId)
    .eq("workspace_id", parsed.data.workspaceId);
  if (error) {
    return { ok: false, message: `Gagal menghapus anggota: ${error.message}` };
  }
  revalidatePath("/pengaturan/anggota");
  return { ok: true, message: "Anggota dihapus — aksesnya ke workspace ini tercabut seketika." };
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
