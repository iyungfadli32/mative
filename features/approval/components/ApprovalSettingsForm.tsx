"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { updateApprovalSettingsAction } from "@/features/approval/actions";
import { DEFAULT_CRITICAL_FIELDS } from "@/features/approval/constants";

/**
 * Form pengaturan approval workspace (P4-10). Hanya owner/admin/manager
 * (dirender kondisional oleh halaman). Gerbang client_review default MATI;
 * komentar klien default TIDAK BOLEH (Keputusan #12).
 * Form tetap mounted setelah aksi (pelajaran e2e Phase 3).
 */
export function ApprovalSettingsForm({
  workspaceId,
  clientReviewEnabled,
  clientCanComment,
  allowSelfApproval,
  criticalFields,
}: {
  workspaceId: string;
  clientReviewEnabled: boolean;
  clientCanComment: boolean;
  allowSelfApproval: boolean;
  criticalFields: string[];
}) {
  const [state, formAction, pending] = useActionState(updateApprovalSettingsAction, {
    ok: false,
    message: "",
  });
  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <h2 className="font-semibold">Pengaturan approval workspace</h2>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Gerbang client_review
        <span className="text-xs font-normal text-[var(--mt-text-muted)]">
          Klien meninjau SETELAH review internal disetujui. Default: mati.
        </span>
        <select
          name="clientReviewEnabled"
          defaultValue={clientReviewEnabled ? "true" : "false"}
          className="h-9 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="true">Aktif</option>
          <option value="false">Mati</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Komentar klien di portal
        <span className="text-xs font-normal text-[var(--mt-text-muted)]">
          Default: tidak boleh (Keputusan #12).
        </span>
        <select
          name="clientCanComment"
          defaultValue={clientCanComment ? "true" : "false"}
          className="h-9 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="true">Diizinkan</option>
          <option value="false">Tidak diizinkan</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Self-approval (pengaju memutuskan request sendiri)
        <span className="text-xs font-normal text-[var(--mt-text-muted)]">
          Default: mati (pemisahan tugas). Aktifkan hanya untuk workspace satu orang supaya pengaju
          bisa menyetujui request-nya sendiri.
        </span>
        <select
          name="allowSelfApproval"
          defaultValue={allowSelfApproval ? "true" : "false"}
          className="h-9 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="true">Diizinkan</option>
          <option value="false">Tidak diizinkan</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Field kritis (perubahan sesudah approval memicu persetujuan ulang)
        <span className="text-xs font-normal text-[var(--mt-text-muted)]">
          Pisahkan dengan koma. Default: {DEFAULT_CRITICAL_FIELDS.join(", ")}.
        </span>
        <input
          type="text"
          name="criticalFields"
          defaultValue={criticalFields.join(", ")}
          className="h-9 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Simpan pengaturan
        </Button>
        {state.message ? (
          <span role={state.ok ? "status" : "alert"} className="text-xs">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
