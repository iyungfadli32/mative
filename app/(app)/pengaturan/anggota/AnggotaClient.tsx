"use client";

import { useActionState, useState } from "react";
import {
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
} from "@/features/tenancy/actions";
import { setMemberBrandScopeAction } from "@/features/campaign/actions";
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
  /** null = semua brand; array = hanya brand itu ([] = tidak ada brand). */
  brandScope: string[] | null;
};

export type BrandRow = {
  id: string;
  name: string;
};

export type InvitationRow = {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: string;
  expiresAt: string;
};

/** Editor brand scope per anggota (P1-A7) — hanya owner/admin. */
function MemberScopeForm({
  workspaceId,
  member,
  brands,
  canManageScope,
}: {
  workspaceId: string;
  member: MemberRow;
  brands: BrandRow[];
  canManageScope: boolean;
}) {
  const [mode, setMode] = useState<"all" | "custom">(member.brandScope === null ? "all" : "custom");
  const [state, formAction, pending] = useActionState(setMemberBrandScopeAction, {
    ok: false,
    message: "",
  });
  const scopeLabel =
    member.brandScope === null
      ? "Semua brand"
      : member.brandScope.length === 0
        ? "Tidak ada brand"
        : member.brandScope.map((id) => brands.find((b) => b.id === id)?.name ?? id).join(", ");
  if (!canManageScope) return <span className="text-sm">{scopeLabel}</span>;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">{scopeLabel}</summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="memberUserId" value={member.userId} />
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="scopeMode"
            value="all"
            checked={mode === "all"}
            onChange={() => setMode("all")}
          />
          Semua brand
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="scopeMode"
            value="custom"
            checked={mode === "custom"}
            onChange={() => setMode("custom")}
          />
          Hanya brand terpilih
        </label>
        {mode === "custom" ? (
          <div className="ml-6 flex flex-col gap-1">
            {brands.length === 0 ? (
              <span className="text-[var(--mt-text-muted)]">Belum ada brand di workspace ini.</span>
            ) : (
              brands.map((b) => (
                <label key={b.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="brandIds"
                    value={b.id}
                    defaultChecked={member.brandScope?.includes(b.id) ?? false}
                  />
                  {b.name}
                </label>
              ))
            )}
          </div>
        ) : null}
        {state.message ? (
          <p role={state.ok ? "status" : "alert"} className="text-[13px]">
            {state.message}
          </p>
        ) : null}
        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Simpan scope
        </Button>
      </form>
    </details>
  );
}

/** Tombol hapus anggota (Phase 9, Dok 06 §8 butir 5) — hanya owner, dan
 * hanya untuk anggota non-owner yang bukan diri sendiri. Penegakan akhir
 * tetap di server action (removeMemberAction).
 *
 * PERBAIKAN Phase 9 (defect Low): action state TIDAK lagi dipegang form
 * per baris — pesan sukses ("Anggota dihapus — ...") dulu dirender DI DALAM
 * form Hapus pada baris yang dihapus, sehingga ikut ter-unmount saat
 * revalidasi menghapus barisnya dan tidak pernah tampil (cacat UX kelas
 * pelajaran 6). State kini dipegang AnggotaClient (tingkat halaman) dan
 * pesan dirender di atas daftar anggota, di luar baris yang dihapus. */
function RemoveMemberForm({
  workspaceId,
  member,
  canRemove,
  formAction,
  pending,
}: {
  workspaceId: string;
  member: MemberRow;
  canRemove: boolean;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  if (!canRemove) return <span className="text-[var(--mt-text-muted)]">—</span>;
  return (
    <form action={formAction}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="memberId" value={member.id} />
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        Hapus
      </Button>
    </form>
  );
}

export default function AnggotaClient({
  workspaceId,
  workspaceName,
  members,
  invitations,
  brands,
  canInvite,
  canManageScope,
  canRemoveMember,
  currentUserId,
}: {
  workspaceId: string;
  workspaceName: string;
  members: MemberRow[];
  invitations: InvitationRow[];
  brands: BrandRow[];
  canInvite: boolean;
  canManageScope: boolean;
  /** Hanya owner (server action removeMemberAction menegakkan hal yang sama). */
  canRemoveMember: boolean;
  currentUserId: string | null;
}) {
  const [state, formAction, pending] = useActionState(inviteMemberAction, {
    ok: false,
    message: "",
  });
  // S-5: tautan manual hanya disimpan di state lokal - ditampilkan sekali,
  // bisa disalin, dan hilang saat ditutup (tidak dirender permanen).
  const [manualInvite, setManualInvite] = useState<string | null>(null);
  const [prevInviteToken, setPrevInviteToken] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [revokeState, revokeFormAction] = useActionState(revokeInvitationAction, {
    ok: false,
    message: "",
  });
  // Menyelaraskan tautan sekali-pakai dengan token terbaru (pola "adjusting
  // state during render" React): tanpa useEffect, supaya tidak melanggar
  // aturan react-hooks/set-state-in-effect. Berjalan hanya di client
  // sesudah aksi invite selesai; saat SSR inviteToken masih undefined.
  if (state.inviteToken !== prevInviteToken) {
    setPrevInviteToken(state.inviteToken);
    setManualInvite(
      state.inviteToken ? window.location.origin + "/undangan/" + state.inviteToken : null,
    );
    setCopied(false);
  }
  // State hapus anggota dipegang di tingkat halaman (bukan per baris) —
  // lihat komentar RemoveMemberForm: pesan sukses harus bertahan sesudah
  // revalidasi menghapus baris anggota yang dihapus.
  const [removeState, removeFormAction, removePending] = useActionState(removeMemberAction, {
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
            </p>
          ) : null}
        {manualInvite ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
            <p className="font-medium">Tautan undangan - hanya ditampilkan sekali.</p>
            <p className="mt-1">
              Email undangan gagal dikirim atau belum dikonfigurasi. Salin tautan ini
              dan teruskan secara manual; tautan hilang setelah ditutup.
            </p>
            <code className="mt-2 block break-all rounded bg-white px-2 py-1">{manualInvite}</code>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(manualInvite).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  );
                }}
              >
                {copied ? "Disalin" : "Salin tautan"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setManualInvite(null)}>
                Tutup
              </Button>
            </div>
          </div>
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
        {removeState.message ? (
          <p
            role={removeState.ok ? "status" : "alert"}
            className="mt-3 rounded-xl border border-[var(--mt-border)] p-3 text-sm"
          >
            {removeState.message}
          </p>
        ) : null}
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
              {
                key: "scope",
                header: "Brand scope (P1-A7)",
                render: (r) => (
                  <MemberScopeForm
                    workspaceId={workspaceId}
                    member={r}
                    brands={brands}
                    canManageScope={canManageScope}
                  />
                ),
              },
              {
                key: "action",
                header: "Aksi",
                render: (r) => (
                  <RemoveMemberForm
                    workspaceId={workspaceId}
                    member={r}
                    canRemove={canRemoveMember && r.role !== "owner" && r.userId !== currentUserId}
                    formAction={removeFormAction}
                    pending={removePending}
                  />
                ),
              },
            ]}
          />
        </div>
      </section>

      <section>
        {revokeState.message ? (
          <p role={revokeState.ok ? "status" : "alert"} className="text-sm text-[var(--mt-stone-600)]">
            {revokeState.message}
          </p>
        ) : null}
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
                    <form action={revokeFormAction}>
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
