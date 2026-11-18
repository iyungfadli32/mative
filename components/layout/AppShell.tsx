"use client";

import { useState, type ReactNode } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Topbar } from "@/components/layout/Topbar";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import Link from "next/link";

/**
 * AppShell — Dok 02 §2 / Dok 03 §8.
 * Desktop: sidebar 248px (collapse 76px) + topbar.
 * Tablet: sidebar collapsible (md ke atas; di bawah md disembunyikan → bottom nav).
 * Mobile: topbar ringkas + bottom nav (Home/Calendar/Create/Approval/More).
 */
export function AppShell({
  children,
  workspaceName,
  userEmail,
  onSignOut,
}: {
  children: ReactNode;
  workspaceName: string;
  userEmail: string | null;
  onSignOut: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--mt-canvas)]">
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        workspaceName={workspaceName}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar workspaceName={workspaceName} userEmail={userEmail} onSignOut={onSignOut} />
        <main className="flex-1 overflow-y-auto px-4 pb-24 pt-4 md:px-6 md:pb-8 md:pt-6">
          {children}
        </main>
      </div>
      <MobileBottomNav onQuickCreate={() => setQuickCreateOpen(true)} />
      <Dialog
        open={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        title="Buat cepat"
        description="Hanya aksi yang tersedia di fase ini yang bisa dipakai."
      >
        <div className="flex flex-col gap-2">
          <Link href="/pengaturan/organisasi" onClick={() => setQuickCreateOpen(false)}>
            <Button variant="secondary" className="w-full justify-start">
              🏢 Buat organisasi / workspace
            </Button>
          </Link>
          <Button variant="secondary" className="w-full justify-start" disabled>
            📝 Buat konten — belum tersedia di fase ini
          </Button>
          <Button variant="secondary" className="w-full justify-start" disabled>
            💡 Tangkap ide — belum tersedia di fase ini
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
