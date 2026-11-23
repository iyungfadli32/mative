"use client";

import Link from "next/link";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type Ref } from "react";
import { cn } from "@/lib/utils";

/**
 * Button — primitif aksesibel (Dok 03 §6).
 * Warna HANYA lewat token CSS var (var(--mt-*)); dilarang hardcode hex.
 * Varian: primary (teal), secondary (putih + border), ghost, danger.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Bila diisi, Button merender next/link dengan gaya yang sama: satu elemen fokus per aksi. */
  href?: string;
  /** Diteruskan ke next/link saat href diisi (mis. prefetch={false} untuk tautan dialog). */
  prefetch?: boolean;
}

export const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--mt-teal-700)] text-white hover:bg-[var(--mt-teal-600)] disabled:bg-[var(--mt-teal-700)]",
  secondary:
    "bg-[var(--mt-surface)] text-[var(--mt-text)] border border-[var(--mt-border)] hover:bg-[var(--mt-canvas)]",
  ghost: "bg-transparent text-[var(--mt-text)] hover:bg-[var(--mt-canvas)]",
  danger: "bg-[var(--mt-rose-700)] text-white hover:opacity-90 disabled:bg-[var(--mt-rose-700)]",
};

export const buttonSizeClasses: Record<ButtonSize, string> = {
  sm: "h-11 px-3 text-[13px]",
  md: "h-11 px-4 text-sm",
  lg: "h-11 px-5 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    disabled,
    className,
    children,
    href,
    prefetch,
    ...rest
  },
  ref,
) {
  const classes = cn(
    "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium",
    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-60",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    buttonVariantClasses[variant],
    buttonSizeClasses[size],
    className,
  );
  const content = (
    <>
      {loading ? <span aria-hidden="true">⏳</span> : null}
      {children}
    </>
  );
  if (href) {
    const { type: _type, ...anchorProps } = rest;
    void _type;
    return (
      <Link
        ref={ref as unknown as Ref<HTMLAnchorElement>}
        href={href}
        prefetch={prefetch}
        aria-disabled={disabled || loading || undefined}
        className={classes}
        {...(anchorProps as unknown as AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...rest}
    >
      {content}
    </button>
  );
});
