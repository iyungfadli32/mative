"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { withWorkspace } from "@/features/planning/workspace-url";
import { useActiveWorkspaceId } from "@/features/planning/use-active-workspace-id";

import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Dialog";
import { Dialog } from "@/components/ui/Dialog";
import { envStatus } from "@/lib/env";
import {
  getNotificationBellAction,
  markNotificationReadAction,
} from "@/features/production/actions";
import { NOTIFICATION_TYPE_LABELS } from "@/features/production/constants";
import type { AppNotification } from "@/features/production/types";

/**
 * Topbar — Dok 02 §2: global search shell, quick create, notification center,
 * help, profil. Search di fase ini adalah SHELL (belum ada data content —
 * pencarian global dibangun Phase 2, P2-13).
 */
export function Topbar({
  workspaceName,
  workspaceId,
  userEmail,
  onSignOut,
}: {
  workspaceName: string;
  workspaceId?: string | null;
  userEmail: string | null;
  onSignOut: () => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  // Perbaikan (c) T-4: lonceng notifikasi -- badge belum dibaca + daftar 10
  // terbaru. Dimuat saat Topbar dipasang dan setiap kali lonceng dibuka.
  const [bellOpen, setBellOpen] = useState(false);
  const [bellUnread, setBellUnread] = useState(0);
  const [bellItems, setBellItems] = useState<AppNotification[]>([]);
  const [bellLoaded, setBellLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getNotificationBellAction()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setBellUnread(result.unreadCount);
          setBellItems(result.notifications);
        }
        setBellLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setBellLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Batch 4 (T-1/T-2): workspace aktif dari prop, atau dari ?workspace= URL.
  const urlWorkspaceId = useActiveWorkspaceId();
  const activeWorkspaceId = workspaceId ?? urlWorkspaceId;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[var(--mt-border)] bg-[var(--mt-surface)] px-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--mt-text)] md:hidden">
          {workspaceName}
        </p>
        <form method="get" action="/cari" className="hidden md:block">
          <label htmlFor="global-search" className="sr-only">
            Cari di MaTive
          </label>
          {activeWorkspaceId ? (
            <input type="hidden" name="workspace" value={activeWorkspaceId} />
          ) : null}
          <input
            id="global-search"
            name="q"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari konten, campaign, ide, brand…"
            className="h-10 w-full max-w-md rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-canvas)] px-3 text-sm"
          />
        </form>
      </div>

      {!envStatus.supabaseConfigured && (
        <span className="hidden rounded-full bg-[var(--mt-mint-100)] px-2.5 py-1 text-xs font-medium text-[var(--mt-amber-800)] lg:inline-flex">
          ⚠️ Supabase belum dikonfigurasi
        </span>
      )}

      <Button size="sm" onClick={() => setQuickCreateOpen(true)}>
        ＋ Buat cepat
      </Button>

      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            bellUnread > 0 ? "Notifikasi (" + bellUnread + " belum dibaca)" : "Notifikasi"
          }
          aria-expanded={bellOpen}
          aria-haspopup="menu"
          onClick={() => {
            const next = !bellOpen;
            setBellOpen(next);
            if (next) {
              void getNotificationBellAction()
                .then((result) => {
                  if (result.ok) {
                    setBellUnread(result.unreadCount);
                    setBellItems(result.notifications);
                  }
                })
                .catch(() => undefined);
            }
          }}
        >
          {"\u{1F514}"}
          {bellUnread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
              {bellUnread > 99 ? "99+" : bellUnread}
            </span>
          ) : null}
        </Button>
        <Popover open={bellOpen} onClose={() => setBellOpen(false)} label="Notifikasi">
          <p className="px-3 py-2 text-sm font-semibold">Notifikasi</p>
          {bellItems.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[var(--mt-text-muted)]">
              {bellLoaded ? "Belum ada notifikasi." : "Memuat notifikasi..."}
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {bellItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-2 border-t border-[var(--mt-border)] px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{item.title}</span>{" "}
                    <span className="text-[var(--mt-text-muted)]">
                      {NOTIFICATION_TYPE_LABELS[item.type]} -{" "}
                      {new Date(item.created_at).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    {item.body ? (
                      <span className="block text-[var(--mt-text-muted)]">{item.body}</span>
                    ) : null}
                  </span>
                  {!item.read_at ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notificationId" value={item.id} />
                      <button
                        type="submit"
                        className="shrink-0 text-xs font-medium text-[var(--mt-teal-700)] underline underline-offset-2"
                      >
                        Tandai dibaca
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Link
            href={withWorkspace("/tugas", activeWorkspaceId)}
            onClick={() => setBellOpen(false)}
            className="block px-3 py-2 text-sm font-medium text-[var(--mt-teal-700)] underline underline-offset-2"
          >
            Lihat semua notifikasi
          </Link>
        </Popover>
      </div>

      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setProfileOpen((v) => !v)}
          aria-expanded={profileOpen}
          aria-haspopup="menu"
          aria-label="Menu profil"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--mt-teal-700)] text-sm font-bold text-white"
          >
            {(userEmail ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden max-w-40 truncate text-sm lg:inline">
            {userEmail ?? "Belum masuk"}
          </span>
        </Button>
        <Popover open={profileOpen} onClose={() => setProfileOpen(false)} label="Menu profil">
          <Link
            href={withWorkspace("/profil", activeWorkspaceId)}
            className="block rounded-lg px-3 py-2 text-sm hover:bg-[var(--mt-canvas)]"
            onClick={() => setProfileOpen(false)}
          >
            👤 Profil saya
          </Link>
          <Link
            href={withWorkspace("/pengaturan", activeWorkspaceId)}
            className="block rounded-lg px-3 py-2 text-sm hover:bg-[var(--mt-canvas)]"
            onClick={() => setProfileOpen(false)}
          >
            ⚙️ Pengaturan
          </Link>
          <button
            type="button"
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--mt-rose-700)] hover:bg-[var(--mt-canvas)]"
            onClick={() => {
              setProfileOpen(false);
              onSignOut();
            }}
          >
            Keluar
          </button>
        </Popover>
      </div>

      <Dialog
        open={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        title="Buat cepat"
        description="Aksi yang tersedia saat ini."
      >
        {/* prefetch={false}: tautan dialog diklik segera setelah dialog
            terbuka — prefetch yang masih berjalan membuat router MENUNGGU
            tanpa umpan balik apa pun sampai prefetch selesai (~1 dtk),
            persis keluhan D3. Tanpa prefetch, klik langsung memulai
            navigasi + loading.tsx tampil instan. */}
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
    </header>
  );
}
