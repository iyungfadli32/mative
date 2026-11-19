import Link from "next/link";
import { getCurrentUser, getSupabaseServerClient } from "@/lib/supabase/server";
import { listMyWorkspaces } from "@/features/tenancy/actions";
import { signOutAction } from "@/features/identity/auth";
import { AppShell } from "@/components/layout/AppShell";
import { getClientCommentsAllowed } from "@/features/production/queries";
import { ClientCommentsToggle } from "@/features/production/components/ClientCommentsToggle";

export default async function PengaturanPage() {
  const user = await getCurrentUser();
  const workspaces = await listMyWorkspaces();
  const supabase = await getSupabaseServerClient();
  const clientComments = supabase
    ? await Promise.all(
        workspaces.map(async (w) => ({
          workspaceId: w.workspace.id,
          workspaceName: w.workspace.name,
          role: w.role,
          allowed: await getClientCommentsAllowed(supabase, w.workspace.id),
        })),
      )
    : [];
  const links = [
    {
      href: "/pengaturan/organisasi",
      label: "Organisasi & Workspace",
      desc: "Buat organisasi dan workspace, atur timezone.",
    },
    {
      href: "/pengaturan/anggota",
      label: "Tim & Peran",
      desc: "Undang anggota dengan 9 role baseline, cabut undangan.",
    },
    { href: "/profil", label: "Profil saya", desc: "Nama tampilan, locale, dan timezone Anda." },
    {
      href: "/portal",
      label: "Portal Klien",
      desc: "Lihat resource yang dibagikan ke klien (viewer_client).",
    },
  ];
  return (
    <AppShell
      workspaceName={workspaces[0]?.workspace.name ?? "Belum ada workspace"}
      userEmail={user?.email ?? null}
      onSignOut={signOutAction}
    >
      <h1 className="text-2xl font-bold">Pengaturan</h1>
      <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
        Pengaturan workspace, tim, dan profil. Pengaturan lanjutan (brand, channel, integrasi,
        notifikasi) hadir di fasenya.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-5 hover:border-[var(--mt-teal-700)]"
          >
            <h2 className="font-semibold">{l.label}</h2>
            <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{l.desc}</p>
          </Link>
        ))}
      </div>
      {clientComments.filter((c) => c.role === "owner" || c.role === "admin").length > 0 ? (
        <div className="mt-6 flex flex-col gap-4">
          <h2 className="text-lg font-bold">Komentar klien (Phase 3)</h2>
          {clientComments
            .filter((c) => c.role === "owner" || c.role === "admin")
            .map((c) => (
              <ClientCommentsToggle
                key={c.workspaceId}
                workspaceId={c.workspaceId}
                workspaceName={c.workspaceName}
                allowed={c.allowed}
              />
            ))}
        </div>
      ) : null}
    </AppShell>
  );
}
