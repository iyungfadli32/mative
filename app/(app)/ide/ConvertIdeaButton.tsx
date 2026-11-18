"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { convertIdeaAction } from "@/features/planning/actions";

/** Tombol konversi ide → konten (P2-08) dengan pesan hasil. */
export function ConvertIdeaButton({
  ideaId,
  workspaceId,
}: {
  ideaId: string;
  workspaceId: string;
}) {
  const [state, formAction, pending] = useActionState(convertIdeaAction, {
    ok: false,
    message: "",
  });
  return (
    <span className="inline-flex flex-col gap-1">
      <form action={formAction}>
        <input type="hidden" name="ideaId" value={ideaId} />
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <Button type="submit" size="sm" loading={pending}>
          Konversi menjadi konten
        </Button>
      </form>
      {state.message ? (
        <span role={state.ok ? "status" : "alert"} className="text-xs">
          {state.message}
          {state.ok && state.contentItemId ? (
            <>
              {" "}
              <a href={`/konten/${state.contentItemId}`} className="font-medium underline">
                Lihat konten →
              </a>
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
