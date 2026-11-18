"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { WorkspaceMembership } from "../types";

/** Pindah workspace sambil mempertahankan filter lain di URL (P2-13). */
export function WorkspaceSwitcher({
  workspaces,
  currentWorkspaceId,
}: {
  workspaces: WorkspaceMembership[];
  currentWorkspaceId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  if (workspaces.length <= 1) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-[var(--mt-text-muted)]">Workspace</span>
      <select
        aria-label="Pindah workspace"
        value={currentWorkspaceId}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("workspace", e.target.value);
          router.push(`?${params.toString()}`);
        }}
        className="h-9 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-2 text-sm"
      >
        {workspaces.map((w) => (
          <option key={w.workspaceId} value={w.workspaceId}>
            {w.workspaceName} ({w.role})
          </option>
        ))}
      </select>
    </label>
  );
}
