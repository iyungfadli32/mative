"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Dialog";
import { Dialog } from "@/components/ui/Dialog";
import { envStatus } from "@/lib/env";

/**
 * Topbar — Dok 02 §2: global search shell, quick create, notification center,
 * help, profil. Search di fase ini adalah SHELL (belum ada data content —
 * pencarian global dibangun Phase 2, P2-13).
 */
export function Topbar({
  workspaceName,
  userEmail,
  onSignOut,
}: {
  workspaceName: string;
  userEmail: string | null;
  onSignOut: () => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [search, setSearch] = useState("");

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
        <span className="hidden rounded-full bg-[var(--mt-mint-100)] px-2.5 py-1 text-xs font-medium text-[var(--mt-amber-500)] lg:inline-flex">
          ⚠️ Supabase belum dikonfigurasi
        </span>
      )}

      <Button size="sm" onClick={() => setQuickCreateOpen(true)}>
        ＋ Buat cepat
      </Button>

      <Button
        variant="ghost"
        size="sm"
        aria-label="Notifikasi (belum ada notifikasi di fase ini)"
        title="Notifikasi dasar hadir di Phase 3–4"
      >
        🔔
      </Button>

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
            href="/profil"
            className="block rounded-lg px-3 py-2 text-sm hover:bg-[var(--mt-canvas)]"
            onClick={() => setProfileOpen(false)}
          >
            👤 Profil saya
          </Link>
          <Link
            href="/pengaturan"
            className="block rounded-lg px-3 py-2 text-sm hover:bg-[var(--mt-canvas)]"
            onClick={() => setProfileOpen(false)}
          >
            ⚙️ Pengaturan
          </Link>
          <button
            type="button"
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--mt-rose-500)] hover:bg-[var(--mt-canvas)]"
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
          <Link href="/konten/baru" prefetch={false} onClick={() => setQuickCreateOpen(false)}>
            <Button variant="secondary" className="w-full justify-start">
              📝 Buat konten
            </Button>
          </Link>
          <Link href="/ide" prefetch={false} onClick={() => setQuickCreateOpen(false)}>
            <Button variant="secondary" className="w-full justify-start">
              💡 Tangkap ide
            </Button>
          </Link>
          <Link href="/pustaka" prefetch={false} onClick={() => setQuickCreateOpen(false)}>
            <Button variant="secondary" className="w-full justify-start">
              🖼️ Unggah aset
            </Button>
          </Link>
          <Link
            href="/pengaturan/organisasi"
            prefetch={false}
            onClick={() => setQuickCreateOpen(false)}
          >
            <Button variant="secondary" className="w-full justify-start">
              🏢 Buat organisasi / workspace
            </Button>
          </Link>
        </div>
      </Dialog>
    </header>
  );
}
