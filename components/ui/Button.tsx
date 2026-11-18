"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Button — primitif aksesibel (Dok 03 §6).
 * Warna HANYA lewat token CSS var (var(--mt-*)); dilarang hardcode hex.
 * Varian: primary (teal), secondary (putih + border), ghost, danger.
 */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--mt-teal-700)] text-white hover:bg-[var(--mt-teal-600)] disabled:bg-[var(--mt-teal-700)]",
  secondary:
    "bg-[var(--mt-surface)] text-[var(--mt-text)] border border-[var(--mt-border)] hover:bg-[var(--mt-canvas)]",
  ghost: "bg-transparent text-[var(--mt-text)] hover:bg-[var(--mt-canvas)]",
  danger: "bg-[var(--mt-rose-500)] text-white hover:opacity-90 disabled:bg-[var(--mt-rose-500)]",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium",
        "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-60",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {loading ? <span aria-hidden="true">⏳</span> : null}
      {children}
    </button>
  );
});
