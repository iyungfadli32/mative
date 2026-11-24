"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updatePasswordAction } from "@/features/identity/auth";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { envStatus, SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(
    updatePasswordAction,
    { ok: false, message: "" },
  );
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Link href="/masuk" className="text-sm text-[var(--mt-teal-700)] underline">
        ← Kembali masuk
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Atur kata sandi baru</h1>
      <p className="mt-2 text-sm text-[var(--mt-stone-600)]">
        Halaman ini dibuka dari tautan reset yang dikirim ke email Anda, atau
        dari profil untuk mengganti kata sandi. Kata sandi minimal 8 karakter.
      </p>
      {envStatus.supabaseConfigured ? null : (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Supabase belum dikonfigurasi: {SUPABASE_NOT_CONFIGURED_ID}
        </p>
      )}
      <form action={formAction} className="mt-8 space-y-4">
        <div>
          <Input id="password" name="password" type="password" label="Kata sandi baru" required autoComplete="new-password" />
        </div>
        <div>
          <Input id="confirmPassword" name="confirmPassword" type="password" label="Ulangi kata sandi baru" required autoComplete="new-password" />
        </div>
        <Button type="submit" loading={pending} disabled={!envStatus.supabaseConfigured}>
          Ubah kata sandi
        </Button>
        {state.message ? (
          <p role={state.ok ? "status" : "alert"} className="text-sm text-[var(--mt-stone-600)]">
            {state.message}{" "}
            {state.ok ? (
              <Link href="/masuk" className="text-[var(--mt-teal-700)] underline">
                Masuk sekarang
              </Link>
            ) : (
              <Link href="/lupa-password" className="text-[var(--mt-teal-700)] underline">
                Minta tautan baru
              </Link>
            )}
          </p>
        ) : null}
      </form>
    </main>
  );
}
