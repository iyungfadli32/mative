"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { submitClientReviewAction } from "@/features/approval/actions";

/**
 * Form submit konten untuk client review (P4-04, langkah 4.14).
 * Hanya bisa dipakai SETELAH review internal disetujui (ditegakkan RPC)
 * dan bila gerbang client_review aktif di workspace.
 * Form tetap mounted setelah aksi (pelajaran e2e Phase 3).
 */
export function SubmitClientReviewForm({
  workspaceId,
  contentItemId,
  contentVersionId,
}: {
  workspaceId: string;
  contentItemId: string;
  contentVersionId: string;
}) {
  const [state, formAction, pending] = useActionState(submitClientReviewAction, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="contentItemId" value={contentItemId} />
      <input type="hidden" name="contentVersionId" value={contentVersionId} />
      <Button type="submit" size="sm" loading={pending}>
        Ajukan untuk client review
      </Button>
      {state.message ? (
        <span role={state.ok ? "status" : "alert"} className="text-xs">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
