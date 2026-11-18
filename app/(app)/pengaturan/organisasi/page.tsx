import { getCurrentUser, getSupabaseServerClient } from "@/lib/supabase/server";
import { signOutAction } from "@/features/identity/auth";
import { AppShell } from "@/components/layout/AppShell";
import OrganisasiClient from "@/app/(app)/pengaturan/organisasi/OrganisasiClient";
import { listMyWorkspaces } from "@/features/tenancy/actions";

export default async function PengaturanOrganisasiPage() {
  const user = await getCurrentUser();
  const workspaces = await listMyWorkspaces();
  let organizations: Array<{ id: string; name: string; slug: string }> = [];
  const supabase = await getSupabaseServerClient();
  if (supabase && user) {
    const { data } = await supabase
      .from("organization_members")
      .select("organizations(id, name, slug)")
      .eq("user_id", user.id)
      .eq("membership_status", "active");
    organizations = (data ?? []).map(
      (r) => r.organizations as unknown as { id: string; name: string; slug: string },
    );
  }
  return (
    <AppShell
      workspaceName={workspaces[0]?.workspace.name ?? "Belum ada workspace"}
      userEmail={user?.email ?? null}
      onSignOut={signOutAction}
    >
      <h1 className="text-2xl font-bold">Organisasi &amp; Workspace</h1>
      <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
        Buat organisasi, lalu workspace di dalamnya. Beralih workspace dilakukan dari daftar
        workspace Anda di Command Center.
      </p>
      <div className="mt-6">
        <OrganisasiClient organizations={organizations} />
      </div>
    </AppShell>
  );
}
