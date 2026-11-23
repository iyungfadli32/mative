import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  id: string;
}

/**
 * Input — selalu berlabel (aksesibilitas: label terikat id).
 * Pesan error memakai teks (bukan warna saja).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id, className, ...rest },
  ref,
) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-[var(--mt-text)]">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        className={cn(
          "h-10 w-full rounded-[10px] border bg-[var(--mt-surface)] px-3 text-sm",
          "text-[var(--mt-text)] placeholder:text-[var(--mt-text-muted)]",
          error
            ? "border-[var(--mt-rose-500)]"
            : "border-[var(--mt-border)] focus:border-[var(--mt-teal-700)]",
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] text-[var(--mt-rose-700)]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-[var(--mt-text-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
