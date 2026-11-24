"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resendConfirmationAction } from "@/features/identity/auth";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { envStatus, SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";

export default function KirimUlangPage() {
  const [state, formAction, pending] = useActionState(
    resendConfirmationAction,
    { ok: false, message: "" },
  );
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Link href="/masuk" className="text-sm text-[var(--mt-teal-700)] underline">
        ← Kembali masuk
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Kirim ulang konfirmasi email</h1>
      <p className="mt-2 text-sm text-[var(--mt-stone-600)]">
        Belum menerima email konfirmasi setelah mendaftar? Masukkan email
        Anda; bila akun belum terkonfirmasi, tautan baru dikirim.
      </p>
      {envStatus.supabaseConfigured ? null : (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Supabase belum dikonfigurasi: {SUPABASE_NOT_CONFIGURED_ID}
        </p>
      )}
      <form action={formAction} className="mt-8 space-y-4">
        <div>
          <Input id="email" name="email" type="email" label="Email" required autoComplete="email" />
        </div>
        <Button type="submit" loading={pending} disabled={!envStatus.supabaseConfigured}>
          Kirim ulang tautan konfirmasi
        </Button>
        {state.message ? (
          <p role={state.ok ? "status" : "alert"} className="text-sm text-[var(--mt-stone-600)]">
            {state.message}
          </p>
        ) : null}
      </form>
    </main>
  );
}
