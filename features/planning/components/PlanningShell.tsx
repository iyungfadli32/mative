import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/States";
import { getCurrentUser } from "@/lib/supabase/server";
import { signOutAction } from "@/features/identity/auth";
import { envStatus, SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";
import { ROLE_LABELS } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import Link from "next/link";
import { getPlanningContext, type PlanningContext } from "../context";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

/**
 * Shell halaman perencanaan — features/planning/components/PlanningShell.tsx
 * Menyelesaikan konteks (workspace + peran) SEKALI, lalu memanggil
 * children(ctx). Menangani tiga keadaan jujur: belum masuk, belum ada
 * workspace, Supabase belum dikonfigurasi.
 */
export async function PlanningShell({
  requestedWorkspaceId,
  title,
  description,
  children,
}: {
  requestedWorkspaceId?: string;
  title: string;
  description: string;
  children: (ctx: PlanningContext) => ReactNode;
}) {
  const ctx = await getPlanningContext(requestedWorkspaceId);
  const user = await getCurrentUser();
  return (
    <AppShell
      workspaceName={ctx?.workspace.workspaceName ?? "Belum ada workspace"}
      userEmail={user?.email ?? null}
      onSignOut={signOutAction}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--mt-text)] md:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{description}</p>
          {ctx ? (
            <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
              Workspace: <strong>{ctx.workspace.workspaceName}</strong> · Peran Anda:{" "}
              {ROLE_LABELS[ctx.role as WorkspaceRole] ?? ctx.role} · Zona waktu:{" "}
              {ctx.workspace.timezone}
            </p>
          ) : null}
        </div>
        {ctx ? (
          <WorkspaceSwitcher
            workspaces={ctx.workspaces}
            currentWorkspaceId={ctx.workspace.workspaceId}
          />
        ) : null}
      </div>

      {!envStatus.supabaseConfigured && (
        <div
          role="status"
          className="mt-4 rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          ⚠️ {SUPABASE_NOT_CONFIGURED_ID}
        </div>
      )}

      {!user ? (
        <div className="mt-4">
          <EmptyState
            title="Anda belum masuk"
            description="Masuk untuk mengakses perencanaan workspace Anda."
            icon="🔐"
          />
          <p className="mt-2 text-center text-sm">
            <Link href="/masuk" className="font-medium text-[var(--mt-teal-700)] underline">
              Ke halaman masuk →
            </Link>
          </p>
        </div>
      ) : !ctx ? (
        <div className="mt-4">
          <EmptyState
            title="Belum ada workspace"
            description="Buat organisasi + workspace dulu sebelum merencanakan konten."
            icon="🏢"
          />
          <p className="mt-2 text-center text-sm">
            <Link
              href="/pengaturan/organisasi"
              className="font-medium text-[var(--mt-teal-700)] underline"
            >
              Buat organisasi + workspace →
            </Link>
          </p>
        </div>
      ) : (
        <div className="mt-6">{children(ctx)}</div>
      )}
    </AppShell>
  );
}
