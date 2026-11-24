"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction } from "@/features/identity/auth";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { envStatus, SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";

export default function DaftarPage() {
  const [state, formAction, pending] = useActionState(signUpAction, {
    ok: false,
    message: "",
  });
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="text-sm text-[var(--mt-teal-700)] underline">
        ← Beranda MaTive
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Daftar akun MaTive</h1>
      <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
        Sudah punya akun?{" "}
        <Link href="/masuk" className="font-medium text-[var(--mt-teal-700)] underline">
          Masuk
        </Link>
      </p>
      <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
        Tidak menerima email konfirmasi?{" "}
        <Link href="/kirim-ulang" className="font-medium text-[var(--mt-teal-700)] underline">
          Kirim ulang
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
        <Input
          id="displayName"
          name="displayName"
          label="Nama tampilan"
          autoComplete="name"
          required
        />
        <Input id="email" name="email" type="email" label="Email" autoComplete="email" required />
        <Input
          id="password"
          name="password"
          type="password"
          label="Kata sandi (minimal 8 karakter)"
          autoComplete="new-password"
          required
        />
        {state.message ? (
          <p role={state.ok ? "status" : "alert"} className="text-sm text-[var(--mt-teal-700)]">
            {state.message}
          </p>
        ) : null}
        <Button type="submit" loading={pending} disabled={!envStatus.supabaseConfigured}>
          Buat akun
        </Button>
      </form>
    </main>
  );
}
