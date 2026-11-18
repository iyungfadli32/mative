"use client";

import { useActionState } from "react";
import { inviteMemberAction, revokeInvitationAction } from "@/features/tenancy/actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/Badges";
import { ROLE_LABELS, WORKSPACE_ROLES, type WorkspaceRole } from "@/lib/permissions";
import { envStatus, SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";

export type MemberRow = {
  id: string;
  userId: string;
  email: string;
  role: WorkspaceRole;
  status: string;
};

export type InvitationRow = {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: string;
  expiresAt: string;
};

export default function AnggotaClient({
  workspaceId,
  workspaceName,
  members,
  invitations,
  canInvite,
}: {
  workspaceId: string;
  workspaceName: string;
  members: MemberRow[];
  invitations: InvitationRow[];
  canInvite: boolean;
}) {
  const [state, formAction, pending] = useActionState(inviteMemberAction, {
    ok: false,
    message: "",
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-5">
        <h2 className="text-lg font-semibold">Undang anggota — {workspaceName}</h2>
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
          Undangan berlaku 7 hari, satu kali pakai, dan bisa dicabut (P1-A5). Hanya owner/admin yang
          boleh mengundang. Role yang diundang harus salah satu dari 9 role baseline.
        </p>
        {!envStatus.supabaseConfigured && (
          <p
            role="status"
            className="mt-3 rounded-xl border border-[var(--mt-amber-500)] p-3 text-sm"
          >
            ⚠️ {SUPABASE_NOT_CONFIGURED_ID}
          </p>
        )}
        {!canInvite && (
          <p role="status" className="mt-3 rounded-xl border border-[var(--mt-border)] p-3 text-sm">
            Peran Anda di workspace ini tidak boleh mengundang anggota.
          </p>
        )}
        <form action={formAction} className="mt-4 flex flex-col gap-4">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <Input id="invite-email" name="email" type="email" label="Email yang diundang" required />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-role" className="text-sm font-medium">
              Role
            </label>
            <select
              id="invite-role"
              name="role"
              className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm"
              required
              defaultValue="creator"
            >
              {WORKSPACE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]} ({r})
                </option>
              ))}
            </select>
          </div>
          {state.message ? (
            <p role={state.ok ? "status" : "alert"} className="text-sm text-[var(--mt-teal-700)]">
              {state.message}
              {state.inviteToken ? (
                <>
                  <br />
                  Tautan undangan (tampilkan sekali saja):{" "}
                  <code className="break-all">/undangan/{state.inviteToken}</code>
                </>
              ) : null}
            </p>
          ) : null}
          <Button
            type="submit"
            loading={pending}
            disabled={!envStatus.supabaseConfigured || !canInvite}
          >
            Kirim undangan
          </Button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Anggota workspace</h2>
        <div className="mt-3">
          <DataTable<MemberRow>
            caption="Daftar anggota workspace"
            rows={members}
            emptyTitle="Belum ada anggota"
            emptyDescription="Anggota tampil di sini setelah undangan diterima."
            columns={[
              { key: "email", header: "Email", render: (r) => r.email },
              { key: "role", header: "Role", render: (r) => ROLE_LABELS[r.role] ?? r.role },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <StatusBadge
                    label={r.status}
                    tone={r.status === "active" ? "success" : "neutral"}
                    icon={r.status === "active" ? "✔️" : "•"}
                  />
                ),
              },
            ]}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Undangan</h2>
        <div className="mt-3">
          <DataTable<InvitationRow>
            caption="Daftar undangan workspace"
            rows={invitations}
            emptyTitle="Belum ada undangan"
            emptyDescription="Undangan yang dibuat tampil di sini sampai diterima, kedaluwarsa, atau dicabut."
            columns={[
              { key: "email", header: "Email", render: (r) => r.email },
              { key: "role", header: "Role", render: (r) => ROLE_LABELS[r.role] ?? r.role },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <StatusBadge
                    label={r.status}
                    tone={
                      r.status === "pending"
                        ? "warning"
                        : r.status === "accepted"
                          ? "success"
                          : "neutral"
                    }
                    icon={r.status === "pending" ? "⏳" : r.status === "accepted" ? "✔️" : "✕"}
                  />
                ),
              },
              { key: "expires", header: "Berlaku sampai", render: (r) => r.expiresAt },
              {
                key: "action",
                header: "Aksi",
                render: (r) =>
                  r.status === "pending" ? (
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="invitationId" value={r.id} />
                      <Button type="submit" variant="secondary" size="sm">
                        Cabut
                      </Button>
                    </form>
                  ) : (
                    <span className="text-[var(--mt-text-muted)]">—</span>
                  ),
              },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
