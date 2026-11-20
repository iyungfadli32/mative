import { getCurrentUser } from "@/lib/supabase/server";
import { listMyWorkspaces } from "@/features/tenancy/actions";
import { signOutAction } from "@/features/identity/auth";
import { AppShell } from "@/components/layout/AppShell";
import Link from "next/link";

/** Halaman "Lainnya" mobile — tautan ke semua halaman MaTive. */
export default async function LainnyaPage() {
  const user = await getCurrentUser();
  const workspaces = await listMyWorkspaces();
  const links = [
    { href: "/dashboard", label: "Command Center", desc: "KPI operasional + panel kerja." },
    { href: "/kalender", label: "Kalender", desc: "Placement terjadwal + backlog." },
    { href: "/board", label: "Board Produksi", desc: "Kanban stage produksi." },
    { href: "/konten", label: "Konten", desc: "Content item kanonis + versi." },
    { href: "/ide", label: "Ide", desc: "Tangkap ide + konversi ke konten." },
    { href: "/merek", label: "Merek", desc: "Brand per workspace." },
    { href: "/channel", label: "Channel", desc: "Registry channel (metadata saja)." },
    { href: "/pilar", label: "Pilar & Audiens", desc: "Pilar konten + audiens dasar." },
    { href: "/kampanye", label: "Campaign", desc: "Campaign dasar + brand." },
    { href: "/template", label: "Template", desc: "Template konten." },
    { href: "/cari", label: "Pencarian", desc: "Cari konten, campaign, ide, brand." },
    { href: "/tugas", label: "Tugas Saya", desc: "Tugas yang ditugaskan ke Anda." },
    { href: "/pustaka", label: "Pustaka Aset", desc: "Aset privat workspace." },
    { href: "/template-brief", label: "Template Brief", desc: "Template brief standar." },
    {
      href: "/publishing",
      label: "Publishing",
      desc: "Antrean publikasi manual + konfirmasi terbit.",
    },
    { href: "/portal", label: "Portal Klien", desc: "Konten yang dibagikan ke klien." },
    { href: "/analitik", label: "Analitik", desc: "Dashboard performa." },
    { href: "/analitik/laporan", label: "Laporan", desc: "Laporan performa." },
    { href: "/analitik/impor", label: "Impor Data", desc: "Impor metrik CSV." },
    { href: "/integrasi", label: "Integrasi", desc: "Koneksi platform." },
    { href: "/ai", label: "Asisten AI", desc: "Asisten AI (nonaktif — tanpa provider)." },
    {
      href: "/pengaturan/organisasi",
      label: "Organisasi & Workspace",
      desc: "Buat organisasi dan workspace.",
    },
    { href: "/pengaturan/anggota", label: "Tim & Peran", desc: "Undang anggota, cabut undangan." },
    { href: "/profil", label: "Profil saya", desc: "Nama tampilan, locale, timezone." },
    { href: "/pengaturan", label: "Pengaturan", desc: "Semua pengaturan." },
  ];
  return (
    <AppShell
      workspaceName={workspaces[0]?.workspace.name ?? "Belum ada workspace"}
      userEmail={user?.email ?? null}
      onSignOut={signOutAction}
    >
      <h1 className="text-2xl font-bold">Lainnya</h1>
      <p className="mt-1 text-sm text-[var(--mt-text-muted)]">Semua halaman MaTive.</p>
      <div className="mt-6 flex flex-col gap-3">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
          >
            <span className="font-semibold">{l.label}</span>
            <span className="block text-sm text-[var(--mt-text-muted)]">{l.desc}</span>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
