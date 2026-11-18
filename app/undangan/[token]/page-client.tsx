"use client";

import { useActionState } from "react";
import Link from "next/link";
import { acceptInvitationAction } from "@/features/tenancy/actions";
import { Button } from "@/components/ui/Button";

/** Halaman terima undangan — /undangan/<token>. Token TIDAK PERNAH dicatat di log. */
export default function TerimaUndanganPage({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction.bind(null, token), {
    ok: false,
    message: "",
  });
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-bold">Terima undangan workspace</h1>
      <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
        Undangan berlaku 7 hari dan satu kali pakai. Pastikan Anda masuk dengan email yang sama
        dengan alamat undangan.
      </p>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="mt-4 text-sm text-[var(--mt-teal-700)]">
          {state.message}
        </p>
      ) : null}
      {state.ok ? (
        <Link href="/dashboard" className="mt-4">
          <Button>Ke Command Center →</Button>
        </Link>
      ) : (
        <form action={formAction} className="mt-6">
          <Button type="submit" loading={pending}>
            Terima undangan
          </Button>
        </form>
      )}
      <p className="mt-4 text-sm">
        <Link href="/masuk" className="text-[var(--mt-teal-700)] underline">
          Masuk dulu bila belum masuk →
        </Link>
      </p>
    </main>
  );
}
