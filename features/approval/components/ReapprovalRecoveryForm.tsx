"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { transitionContentAction } from "@/features/planning/actions";

/**
 * Tombol pemulihan reapproval (Batch 5 F-02): konten approved yang berubah sesudah
 * disetujui (request berstatus reapproval_required) dipindahkan ke Editing supaya
 * bisa diperbaiki lalu diajukan ulang. Transisi ini legal hanya bila ada request
 * reapproval_required - ditegakkan RPC transition_content_item_status.
 */
export function ReapprovalRecoveryForm({
  contentItemId,
  workspaceId,
}: {
  contentItemId: string;
  workspaceId: string;
}) {
  const [state, formAction, pending] = useActionState(transitionContentAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="contentItemId" value={contentItemId} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="toStatus" value="editing" />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Pindahkan ke Editing
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
