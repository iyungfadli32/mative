"use client";

import Link from "next/link";
import { withWorkspace, useActiveWorkspaceId } from "@/features/planning/workspace-url";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * AppSidebar — Dok 02 §2 / Dok 03 §5.
 * Desktop: tetap 240–260px (collapse 72–80px). Tablet: collapsible/overlay.
 * Modul yang BELUM ada di Phase 1 ditampilkan DISABLED dengan alasan
 * "belum tersedia di fase ini" — DILARANG tombol palsu (P1-13).
 */

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** false = modul belum dibangun di fase ini (tombol disabled + alasan). */
  available: boolean;
  unavailableReason?: string;
  unavailableBadge?: string;
};

export const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Utama",
    items: [
      { href: "/dashboard", label: "Command Center", icon: "🏠", available: true },
      { href: "/kalender", label: "Kalender", icon: "📅", available: true },
      { href: "/board", label: "Board Produksi", icon: "🗂️", available: true },
      { href: "/cari", label: "Pencarian", icon: "🔍", available: true },
    ],
  },
  {
    title: "Perencanaan",
    items: [
      { href: "/merek", label: "Merek", icon: "🏷️", available: true },
      { href: "/channel", label: "Channel", icon: "📣", available: true },
      { href: "/pilar", label: "Pilar & Audiens", icon: "🧱", available: true },
      { href: "/kampanye", label: "Campaign", icon: "🎯", available: true },
      { href: "/template", label: "Template", icon: "📋", available: true },
      { href: "/konten", label: "Konten", icon: "📝", available: true },
      { href: "/ide", label: "Ide", icon: "💡", available: true },
    ],
  },
  {
    title: "Produksi",
    items: [
      { href: "/tugas", label: "Tugas Saya", icon: "✅", available: true },
      { href: "/pustaka", label: "Pustaka Aset", icon: "🖼️", available: true },
      { href: "/template-brief", label: "Template Brief", icon: "📝", available: true },
      { href: "/publishing", label: "Publishing", icon: "🚀", available: true },
    ],
  },
  {
    title: "Kolaborasi",
    items: [
      {
        href: "/persetujuan",
        label: "Approval Center",
        icon: "✔️",
        available: true,
      },
      { href: "/portal", label: "Portal Klien", icon: "🧑‍💼", available: true },
    ],
  },
  {
    title: "Analisis",
    items: [
      { href: "/analitik", label: "Analitik", icon: "📊", available: true },
      { href: "/analitik/laporan", label: "Laporan", icon: "📄", available: true },
      { href: "/analitik/impor", label: "Impor Data", icon: "📥", available: true },
      { href: "/integrasi", label: "Integrasi", icon: "🔌", available: true },
    ],
  },
  {
    title: "AI",
    items: [{ href: "/ai", label: "Asisten AI (nonaktif)", icon: "🤖", available: false, unavailableReason: "Asisten AI nonaktif — belum ada provider AI yang dipasang.", unavailableBadge: "nonaktif" }],
  },
  {
    title: "Administrasi",
    items: [
      {
        href: "/pengaturan/organisasi",
        label: "Organisasi & Workspace",
        icon: "🏢",
        available: true,
      },
      { href: "/pengaturan/anggota", label: "Tim & Peran", icon: "👥", available: true },
      { href: "/pengaturan", label: "Pengaturan", icon: "⚙️", available: true },
    ],
  },
];

export function AppSidebar({
  collapsed,
  onToggleCollapse,
  workspaceName,
  workspaceId,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  workspaceName: string;
  workspaceId?: string | null;
}) {
  const pathname = usePathname();
  // Batch 4 (T-1): workspace aktif dari prop, atau dari ?workspace= URL.
  const urlWorkspaceId = useActiveWorkspaceId();
  const activeWorkspaceId = workspaceId ?? urlWorkspaceId;
  return (
    <aside
      aria-label="Navigasi utama"
      className={cn(
        "hidden h-full flex-col bg-[var(--mt-navy-950)] text-white md:flex",
        collapsed ? "w-[76px]" : "w-[248px]",
      )}
    >
      <div className="flex items-center justify-between px-4 py-4">
        <Link
          href={withWorkspace("/dashboard", activeWorkspaceId)}
          className="flex items-center gap-2"
          aria-label="MaTive — ke Command Center"
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--mt-teal-700)] text-lg font-bold"
          >
            M
          </span>
          {!collapsed && (
            <span className="leading-tight">
              <span className="block text-base font-bold">MaTive</span>
              <span className="block text-[11px] text-white/60">Content Operations</span>
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Bentangkan sidebar" : "Ciutkan sidebar"}
          aria-expanded={!collapsed}
          className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white"
        >
          {collapsed ? "→" : "←"}
        </button>
      </div>

      <div className="px-4 pb-3">
        <p className="text-[11px] uppercase tracking-wide text-white/50">
          {collapsed ? "WS" : "Workspace"}
        </p>
        <p className="truncate text-sm font-medium" title={workspaceName}>
          {collapsed ? workspaceName.slice(0, 2).toUpperCase() : workspaceName}
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Menu utama">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mt-4 first:mt-1">
            {!collapsed && (
              <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-white/50">
                {section.title}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href;
                const content = (
                  <>
                    <span aria-hidden="true" className="text-base">
                      {item.icon}
                    </span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </>
                );
                const cls = cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                  active
                    ? "bg-[var(--mt-teal-700)] font-medium text-white"
                    : "text-white/80 hover:bg-white/10 hover:text-white",
                  !item.available && "cursor-not-allowed opacity-50",
                );
                return (
                  <li key={item.href}>
                    {item.available ? (
                      <Link
                        href={withWorkspace(item.href, activeWorkspaceId)}
                        className={cls}
                        aria-current={active ? "page" : undefined}
                      >
                        {content}
                      </Link>
                    ) : (
                      <span
                        className={cls}
                        title={item.unavailableReason ?? "Belum tersedia di fase ini."}
                        aria-disabled="true"
                      >
                        {content}
                        {!collapsed && (
                          <span className="ml-auto text-[10px] text-white/50">{item.unavailableBadge ?? "segera"}</span>
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <p className="px-4 py-3 text-[11px] text-white/40">
        {collapsed ? "v0.9" : "MaTive v0.9.0 — Phase 9 (DRAF)"}
      </p>
    </aside>
  );
}
