"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { getFocusableElements, trapTabKey, type FocusableElement } from "./focusTrap";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

/**
 * Dialog — aksesibel: role="dialog", aria-modal, Escape menutup,
 * fokus awal ke tombol tutup. Dipakai untuk konfirmasi + form pendek.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Fokus awal ke tombol tutup; saat ditutup, fokus kembali ke pemicu (H-1).
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl bg-[var(--mt-surface)] p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (panelRef.current) {
            trapTabKey(
              event,
              getFocusableElements(panelRef.current),
              document.activeElement as unknown as FocusableElement | null,
            );
          }
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--mt-text)]">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{description}</p>
            ) : null}
          </div>
          <Button
            ref={closeRef}
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Tutup dialog"
          >
            ✕
          </Button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * Popover — panel kecil yang dibuka/tutup lewat tombol pemicu.
 * Dipakai untuk menu profil / filter ringkas. Menutup dengan Escape.
 */
export function Popover({
  open,
  onClose,
  label,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="menu"
      aria-label={label}
      className={cn(
        "absolute right-0 z-40 mt-2 w-64 rounded-xl border border-[var(--mt-border)]",
        "bg-[var(--mt-surface)] p-2 shadow-lg",
        className,
      )}
    >
      {children}
    </div>
  );
}
