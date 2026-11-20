import { getCurrentUser } from "@/lib/supabase/server";
import { listMyWorkspaces } from "@/features/tenancy/actions";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { signOutAction } from "@/features/identity/auth";
import { AppShell } from "@/components/layout/AppShell";
import AnggotaClient, {
  type MemberRow,
  type InvitationRow,
  type BrandRow,
} from "@/app/(app)/pengaturan/anggota/AnggotaClient";
import { canInvite, type WorkspaceRole } from "@/lib/permissions";
import { EmptyState } from "@/components/ui/States";

export default async function PengaturanAnggotaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  const workspaces = await listMyWorkspaces();
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  // Workspace aktif mengikuti ?workspace= bila pemanggil memang member di
  // sana (pola dashboard, perbaikan ed5d2c3); bila tidak, workspace pertama.
  // Sebelum perbaikan ini halaman ini selalu memakai workspaces[0] sehingga
  // anggota workspace lain tidak pernah bisa dikelola lewat UI.
  const ws =
    (workspaceParam ? workspaces.find((w) => w.workspace.id === workspaceParam) : undefined) ??
    workspaces[0];
  const supabase = await getSupabaseServerClient();

  let members: MemberRow[] = [];
  let invitations: InvitationRow[] = [];
  let brands: BrandRow[] = [];
  if (supabase && user && ws) {
    const { data: memberRows } = await supabase
      .from("workspace_members")
      .select("id, user_id, workspace_role, membership_status, brand_scope")
      .eq("workspace_id", ws.workspace.id)
      .order("created_at", { ascending: true });
    // PERBAIKAN Phase 9: join embed `profiles(display_name)` DIHAPUS — tidak
    // ada FK workspace_members → profiles di skema, jadi PostgREST selalu
    // gagal (PGRST200) dan daftar anggota SELALU kosong sejak Phase 1.
    // display_name diambil lewat query kedua (RLS profiles mengizinkan
    // profil sendiri + sesama anggota workspace aktif); fallback user_id
    // bila profil belum ada (akun dibuat via API tanpa upsert profil).
    const userIds = (memberRows ?? []).map((m) => m.user_id as string);
    const nameByUserId = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds);
      for (const p of profileRows ?? []) {
        if ((p.display_name as string) !== "") {
          nameByUserId.set(p.id as string, p.display_name as string);
        }
      }
    }
    members = (memberRows ?? []).map((m) => ({
      id: m.id as string,
      userId: m.user_id as string,
      email: nameByUserId.get(m.user_id as string) ?? (m.user_id as string),
      role: m.workspace_role as WorkspaceRole,
      status: m.membership_status as string,
      brandScope: (m.brand_scope as string[] | null) ?? null,
    }));
    const { data: brandRows } = await supabase
      .from("brands")
      .select("id, name")
      .eq("workspace_id", ws.workspace.id)
      .order("name", { ascending: true });
    brands = (brandRows ?? []).map((b) => ({ id: b.id as string, name: b.name as string }));
    const { data: invRows } = await supabase
      .from("workspace_invitations")
      .select("id, email, role, status, expires_at")
      .eq("workspace_id", ws.workspace.id)
      .order("created_at", { ascending: false });
    invitations = (invRows ?? []).map((r) => ({
      id: r.id as string,
      email: r.email as string,
      role: r.role as WorkspaceRole,
      status: r.status as string,
      expiresAt: r.expires_at as string,
    }));
  }

  return (
    <AppShell
      workspaceName={ws?.workspace.name ?? "Belum ada workspace"}
      userEmail={user?.email ?? null}
      onSignOut={signOutAction}
    >
      <h1 className="text-2xl font-bold">Tim &amp; Peran</h1>
      <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
        Anggota workspace pertama Anda dan undangan yang masih berlaku.
      </p>
      <div className="mt-6">
        {!ws ? (
          <EmptyState
            title="Belum ada workspace"
            description="Buat organisasi + workspace dulu sebelum mengundang anggota."
            icon="🏢"
          />
        ) : (
          <AnggotaClient
            workspaceId={ws.workspace.id}
            workspaceName={ws.workspace.name}
            members={members}
            invitations={invitations}
            brands={brands}
            canInvite={canInvite(ws.role as WorkspaceRole)}
            canManageScope={canInvite(ws.role as WorkspaceRole)}
            canRemoveMember={ws.role === "owner"}
            currentUserId={user?.id ?? null}
          />
        )}
      </div>
    </AppShell>
  );
}
