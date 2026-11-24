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

// S-3: kuota anti-penyalahgunaan di sisi aplikasi. CAPTCHA + batas laju
// Supabase Auth hanya bisa diatur di dashboard Supabase (lihat laporan
// batch S-1); kuota di sini membatasi pembuatan organisasi & undangan.
const MAX_ORGANIZATIONS_PER_USER = 10;
const MAX_PENDING_INVITATIONS_PER_WORKSPACE = 20;

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
  // S-3: kuota organisasi per pengguna.
  const { count: ownedCount, error: countError } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("organization_role", "owner");
  if (countError) {
    console.error("[tenancy] hitung organisasi gagal", countError.message);
    return { ok: false, message: "Gagal membuat organisasi. Coba lagi." };
  }
  if ((ownedCount ?? 0) >= MAX_ORGANIZATIONS_PER_USER) {
    return {
      ok: false,
      message:
        "Batas maksimum " +
        String(MAX_ORGANIZATIONS_PER_USER) +
        " organisasi per pengguna tercapai.",
    };
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
  if (error) {
    console.error("[tenancy] gagal membuat organisasi", error.message);
    return { ok: false, message: "Gagal membuat organisasi. Coba lagi." };
  }
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
    console.error("[tenancy] keanggotaan owner gagal", memberError.message);
    return {
      ok: false,
      message: "Organisasi dibuat, tetapi keanggotaan owner gagal. Coba lagi.",
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
  if (error) {
    console.error("[tenancy] gagal membuat workspace", error.message);
    return { ok: false, message: "Gagal membuat workspace. Coba lagi." };
  }
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
    // S-8: tolak duplikat dengan pesan ramah sebelum insert (constraint unique
    // tetap jadi penahan terakhir; lihat pemetaan error 23505 di bawah).
    const { data: pendingInvite } = await supabase
      .from("workspace_invitations")
      .select("id")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("email", parsed.data.email)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (pendingInvite) {
      return {
        ok: false,
        message:
          "Undangan untuk email ini masih menunggu. Cabut undangan lama sebelum mengirim yang baru.",
      };
    }
    const { count: pendingCount } = await supabase
      .from("workspace_invitations")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString());
    if ((pendingCount ?? 0) >= MAX_PENDING_INVITATIONS_PER_WORKSPACE) {
      return {
        ok: false,
        message:
          "Batas " +
          String(MAX_PENDING_INVITATIONS_PER_WORKSPACE) +
          " undangan menunggu per workspace tercapai. Cabut undangan lama sebelum mengirim yang baru.",
      };
    }
    const adminForCheck = getSupabaseAdminClient();
    if (adminForCheck) {
      const { data: listedUsers } = await adminForCheck.auth.admin.listUsers({
        perPage: 1000,
      });
      const existingUser = listedUsers?.users.find(
        (candidate) => candidate.email?.toLowerCase() === parsed.data.email.toLowerCase(),
      );
      if (existingUser) {
        const { data: existingMember } = await supabase
          .from("workspace_members")
          .select("id")
          .eq("workspace_id", parsed.data.workspaceId)
.eq("user_id", existingUser.id)
          .eq("membership_status", "active")
          .maybeSingle();
        if (existingMember) {
          return {
            ok: false,
            message: "Email ini sudah menjadi anggota aktif workspace.",
          };
        }
      }
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
    if (error) {
      console.error("[tenancy] gagal membuat undangan", error.message);
      if (error.code === "23505") {
        return {
          ok: false,
          message:
            "Undangan untuk email ini masih menunggu. Cabut undangan lama sebelum mengirim yang baru.",
        };
      }
      return { ok: false, message: "Gagal membuat undangan. Coba lagi." };
    }
    // S-5: email adalah jalur utama bila service-role tersedia; bila
    // pengiriman email gagal (atau service-role belum terpasang), token
    // ditampilkan SEKALI ke pengundang untuk diteruskan manual.
    const admin = getSupabaseAdminClient();
    const emailResult = admin
      ? await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
          data: { workspace_id: parsed.data.workspaceId, role: parsed.data.role },
        })
      : null;
    if (emailResult?.error) {
      console.error("[tenancy] gagal mengirim email undangan", emailResult.error.message);
    }
    revalidatePath("/pengaturan/anggota");
    if (admin && !emailResult?.error) {
      return { ok: true, message: "Undangan dibuat dan email undangan dikirim." };
    }
    return {
      ok: true,
      message: admin
        ? "Undangan dibuat, tetapi email gagal dikirim. Salin tautan undangan di bawah untuk diteruskan manual."
        : "Undangan dibuat (email otomatis belum dikonfigurasi — salin tautan di bawah untuk diteruskan manual).",
      inviteToken: token,
    };
}

/** S-7: mencabut undangan dengan pemeriksaan peran + hasil yang jujur. */
export async function revokeInvitationAction(
  prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  void prevState;
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) {
    return { ok: false, message: "Undangan tidak ditemukan." };
  }
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return { ok: false, message: "Anda harus masuk dulu." };
  }
  const { data: invitation } = await supabase
    .from("workspace_invitations")
    .select("workspace_id")
    .eq("id", invitationId)
    .maybeSingle();
  if (!invitation) {
    return { ok: false, message: "Undangan tidak ditemukan atau sudah tidak berlaku." };
  }
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_role")
    .eq("workspace_id", invitation.workspace_id)
    .eq("user_id", user.id)
    .eq("membership_status", "active")
    .single();
  const callerRole = membership?.workspace_role as string | undefined;
  if (!callerRole || !canInvite(callerRole as never)) {
    return { ok: false, message: "Hanya owner atau admin yang boleh mencabut undangan." };
  }
  const { data: revoked, error } = await supabase
    .from("workspace_invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .eq("status", "pending")
    .select("id");
  if (error) {
    console.error("[tenancy] gagal mencabut undangan", error.message);
    return { ok: false, message: "Gagal mencabut undangan. Coba lagi." };
  }
  if (!revoked || revoked.length === 0) {
    return { ok: false, message: "Undangan tidak ditemukan atau sudah tidak berlaku." };
  }
  revalidatePath("/pengaturan/anggota");
  return { ok: true, message: "Undangan dicabut." };
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
    console.error("[tenancy] gagal menghapus anggota", error.message);
    return { ok: false, message: "Gagal menghapus anggota. Coba lagi." };
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
    console.error("[tenancy] gagal menerima undangan", error.message);
    return { ok: false, message: "Gagal menerima undangan. Coba lagi." };
  }
  const result = data as { ok: boolean; message: string } | null;
  if (!result?.ok) {
    return { ok: false, message: result?.message ?? "Undangan tidak dapat diterima." };
  }
  revalidatePath("/dashboard");
  return { ok: true, message: result.message };
}
