"use client";

import { useActionState, useState } from "react";
import { createOrganizationAction, createWorkspaceAction } from "@/features/tenancy/actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { envStatus, SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";

export default function OrganisasiPage({
  organizations,
}: {
  organizations: Array<{ id: string; name: string; slug: string }>;
}) {
  const [orgState, orgAction, orgPending] = useActionState(createOrganizationAction, {
    ok: false,
    message: "",
  });
  const [wsState, wsAction, wsPending] = useActionState(createWorkspaceAction, {
    ok: false,
    message: "",
  });
  const [selectedOrg, setSelectedOrg] = useState(organizations[0]?.id ?? "");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-5">
        <h2 className="text-lg font-semibold">Buat organisasi</h2>
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
          Organisasi adalah akun pelanggan/agensi. Satu organisasi bisa punya banyak workspace.
        </p>
        {!envStatus.supabaseConfigured && (
          <p
            role="status"
            className="mt-3 rounded-xl border border-[var(--mt-amber-500)] p-3 text-sm"
          >
            ⚠️ {SUPABASE_NOT_CONFIGURED_ID}
          </p>
        )}
        <form action={orgAction} className="mt-4 flex flex-col gap-4">
          <Input id="org-name" name="name" label="Nama organisasi" required />
          <Input
            id="org-slug"
            name="slug"
            label="Slug (huruf kecil, angka, tanda hubung)"
            hint="Dipakai di URL dan harus unik."
            required
          />
          {orgState.message ? (
            <p
              role={orgState.ok ? "status" : "alert"}
              className="text-sm text-[var(--mt-teal-700)]"
            >
              {orgState.message}
            </p>
          ) : null}
          <Button type="submit" loading={orgPending} disabled={!envStatus.supabaseConfigured}>
            Buat organisasi
          </Button>
        </form>
        <h3 className="mt-6 font-semibold">Organisasi Anda</h3>
        {organizations.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">Belum ada organisasi.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {organizations.map((o) => (
              <li key={o.id}>
                <span className="font-medium">{o.name}</span>{" "}
                <span className="text-[var(--mt-text-muted)]">({o.slug})</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-5">
        <h2 className="text-lg font-semibold">Buat workspace</h2>
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
          Workspace adalah batas kerja tim. Timezone default: Asia/Jakarta (bisa diubah per
          workspace).
        </p>
        <form action={wsAction} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ws-org" className="text-sm font-medium">
              Organisasi
            </label>
            <select
              id="ws-org"
              name="organizationId"
              // Bila state masih kosong (mis. organisasi baru dibuat dan
              // daftar diperbarui lewat revalidatePath), pakai organisasi
              // pertama supaya organizationId tidak terkirim kosong
              // (organizationId wajib UUID — lihat workspaceSchema).
              value={selectedOrg || organizations[0]?.id || ""}
              onChange={(e) => setSelectedOrg(e.target.value)}
              className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm"
              required
            >
              {organizations.length === 0 ? (
                <option value="">Buat organisasi dulu</option>
              ) : (
                organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <Input id="ws-name" name="name" label="Nama workspace" required />
          <Input id="ws-slug" name="slug" label="Slug" required />
          <Input
            id="ws-timezone"
            name="timezone"
            label="Timezone (IANA)"
            defaultValue="Asia/Jakarta"
            required
          />
          <input type="hidden" name="defaultLocale" value="id" />
          {wsState.message ? (
            <p role={wsState.ok ? "status" : "alert"} className="text-sm text-[var(--mt-teal-700)]">
              {wsState.message}
            </p>
          ) : null}
          <Button
            type="submit"
            loading={wsPending}
            disabled={!envStatus.supabaseConfigured || organizations.length === 0}
          >
            Buat workspace
          </Button>
        </form>
      </section>
    </div>
  );
}
