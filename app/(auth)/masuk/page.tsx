"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction } from "@/features/identity/auth";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { envStatus, SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";

export default function MasukPage() {
  const [state, formAction, pending] = useActionState(signInAction, {
    ok: false,
    message: "",
  });
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="text-sm text-[var(--mt-teal-700)] underline">
        ← Beranda MaTive
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Masuk ke MaTive</h1>
      <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
        Belum punya akun?{" "}
        <Link href="/daftar" className="font-medium text-[var(--mt-teal-700)] underline">
          Daftar dulu
        </Link>
      </p>
      {!envStatus.supabaseConfigured && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-3 text-sm"
        >
          ⚠️ {SUPABASE_NOT_CONFIGURED_ID}
        </p>
      )}
      <form action={formAction} className="mt-6 flex flex-col gap-4">
        <Input id="email" name="email" type="email" label="Email" autoComplete="email" required />
        <Input
          id="password"
          name="password"
          type="password"
          label="Kata sandi"
          autoComplete="current-password"
          required
        />
        {state.message ? (
          <p role="alert" className="text-sm text-[var(--mt-rose-500)]">
            {state.message}
          </p>
        ) : null}
        <Button type="submit" loading={pending} disabled={!envStatus.supabaseConfigured}>
          Masuk
        </Button>
      </form>
      <p className="mt-4 text-xs text-[var(--mt-text-muted)]">
        Masuk memakai Supabase Auth (default aman provider, tanpa MFA wajib di MVP — P1-A4).
      </p>
    </main>
  );
}
