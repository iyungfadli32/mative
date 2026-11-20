"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * MobileBottomNav — Dok 02 §2: Home / Calendar / Create / Approval / More.
 * Semua item aktif sejak Phase 2 (Kalender) dan Phase 4 (Approval).
 * Quick-create membuka bottom sheet (berisi aksi yang tersedia saja).
 */
export function MobileBottomNav({ onQuickCreate }: { onQuickCreate: () => void }) {
  const pathname = usePathname();
  const items = [
    { href: "/dashboard", label: "Home", icon: "🏠", available: true },
    { href: "/kalender", label: "Kalender", icon: "📅", available: true },
    { href: null, label: "Buat", icon: "＋", available: true, action: true },
    { href: "/persetujuan", label: "Approval", icon: "✔️", available: true },
    { href: "/lainnya", label: "Lainnya", icon: "⋯", available: true },
  ];
  return (
    <nav
      aria-label="Navigasi bawah"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--mt-border)] bg-[var(--mt-surface)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = item.href !== null && pathname === item.href;
          const inner = (
            <>
              <span aria-hidden="true" className="text-xl leading-none">
                {item.icon}
              </span>
              <span className="text-[11px]">{item.label}</span>
              {!item.available && <span className="sr-only">(belum tersedia di fase ini)</span>}
            </>
          );
          const cls = cn(
            "mt-touch-target flex flex-col items-center justify-center gap-0.5 py-2",
            active ? "font-semibold text-[var(--mt-teal-700)]" : "text-[var(--mt-text-muted)]",
            !item.available && "opacity-45",
          );
          return (
            <li key={item.label} className="flex justify-center">
              {item.action ? (
                <button
                  type="button"
                  onClick={onQuickCreate}
                  aria-label="Buat cepat"
                  className="mt-touch-target flex flex-col items-center justify-center gap-0.5 py-2 text-[var(--mt-teal-700)]"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--mt-teal-700)] text-xl text-white"
                  >
                    ＋
                  </span>
                  <span className="text-[11px]">Buat</span>
                </button>
              ) : item.available && item.href ? (
                <Link href={item.href} className={cls} aria-current={active ? "page" : undefined}>
                  {inner}
                </Link>
              ) : (
                <span className={cls} aria-disabled="true" title="Belum tersedia di fase ini.">
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
