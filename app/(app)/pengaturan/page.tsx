import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { listMyWorkspaces } from "@/features/tenancy/actions";
import { signOutAction } from "@/features/identity/auth";
import { AppShell } from "@/components/layout/AppShell";

export default async function PengaturanPage() {
  const user = await getCurrentUser();
  const workspaces = await listMyWorkspaces();
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
    </AppShell>
  );
}
