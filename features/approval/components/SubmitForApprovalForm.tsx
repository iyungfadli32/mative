"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { submitForApprovalAction } from "@/features/approval/actions";

/**
 * Form submit konten untuk review internal (P4-04).
 * Mengajukan versi TERBARU konten (bukan versi lama).
 *
 * ATURAN POLA (pelajaran e2e Phase 3): form ini SENGAJA tetap dirender
 * setelah submit berhasil — pesannya hidup di useActionState. Halaman
 * boleh menampilkan status request aktif di samping form, tapi jangan
 * meng-unmount form ini berdasarkan hasil aksinya sendiri.
 */
export function SubmitForApprovalForm({
  workspaceId,
  contentItemId,
  contentVersionId,
  versionNumber,
}: {
  workspaceId: string;
  contentItemId: string;
  contentVersionId: string;
  versionNumber: number;
}) {
  const [state, formAction, pending] = useActionState(submitForApprovalAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="contentItemId" value={contentItemId} />
      <input type="hidden" name="contentVersionId" value={contentVersionId} />
      <Button type="submit" size="sm" loading={pending}>
        Ajukan v{versionNumber} untuk approval
      </Button>
      {state.message ? (
        <span role={state.ok ? "status" : "alert"} className="text-xs">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
