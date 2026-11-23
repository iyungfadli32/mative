"use client";

import { useState, type ReactNode } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Topbar } from "@/components/layout/Topbar";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { withWorkspace, useActiveWorkspaceId } from "@/features/planning/workspace-url";

/**
 * AppShell — Dok 02 §2 / Dok 03 §8.
 * Desktop: sidebar 248px (collapse 76px) + topbar.
 * Tablet: sidebar collapsible (md ke atas; di bawah md disembunyikan → bottom nav).
 * Mobile: topbar ringkas + bottom nav (Home/Calendar/Create/Approval/More).
 */
export function AppShell({
  children,
  workspaceName,
  workspaceId,
  requestedWorkspaceNotMember,
  userEmail,
  onSignOut,
}: {
  children: ReactNode;
  workspaceName: string;
  workspaceId?: string | null;
  requestedWorkspaceNotMember?: boolean;
  userEmail: string | null;
  onSignOut: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  // Batch 4 (T-1): workspace aktif dari prop halaman, atau dari ?workspace= URL.
  const urlWorkspaceId = useActiveWorkspaceId();
  const activeWorkspaceId = workspaceId ?? urlWorkspaceId;

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--mt-canvas)]">
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        workspaceName={workspaceName}
        workspaceId={activeWorkspaceId}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          workspaceName={workspaceName}
          workspaceId={activeWorkspaceId}
          userEmail={userEmail}
          onSignOut={onSignOut}
        />
        {requestedWorkspaceNotMember ? (
          <div
            role="alert"
            className="bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 md:px-6"
          >
            Workspace yang diminta bukan milik Anda; menampilkan workspace pertama yang dapat
            diakses.
          </div>
        ) : null}
        <main className="flex-1 overflow-y-auto px-4 pb-24 pt-4 md:px-6 md:pb-8 md:pt-6">
          {children}
        </main>
      </div>
      <MobileBottomNav
        workspaceId={activeWorkspaceId}
        onQuickCreate={() => setQuickCreateOpen(true)}
      />
      <Dialog
        open={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        title="Buat cepat"
        description="Aksi yang tersedia saat ini."
      >
        {/* prefetch={false}: lihat catatan yang sama di Topbar.tsx (D3) —
            tautan dialog diklik segera setelah terbuka; prefetch yang masih
            berjalan membuat router menunggu tanpa umpan balik. */}
        <div className="flex flex-col gap-2">
          <Button
            href={withWorkspace("/konten/baru", activeWorkspaceId)}
            prefetch={false}
            variant="secondary"
            className="w-full justify-start"
            onClick={() => setQuickCreateOpen(false)}
          >
            📝 Buat konten
          </Button>
          <Button
            href={withWorkspace("/ide", activeWorkspaceId)}
            prefetch={false}
            variant="secondary"
            className="w-full justify-start"
            onClick={() => setQuickCreateOpen(false)}
          >
            💡 Tangkap ide
          </Button>
          <Button
            href={withWorkspace("/pustaka", activeWorkspaceId)}
            prefetch={false}
            variant="secondary"
            className="w-full justify-start"
            onClick={() => setQuickCreateOpen(false)}
          >
            🖼️ Unggah aset
          </Button>
          <Button
            href={withWorkspace("/pengaturan/organisasi", activeWorkspaceId)}
            prefetch={false}
            variant="secondary"
            className="w-full justify-start"
            onClick={() => setQuickCreateOpen(false)}
          >
            🏢 Buat organisasi / workspace
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
