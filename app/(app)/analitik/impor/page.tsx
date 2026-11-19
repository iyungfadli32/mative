import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import {
  ANALYTICS_TABLES_UNAVAILABLE_ID,
  ANALYTICS_VIEWER_CLIENT_DENIED_ID,
} from "@/features/analytics/constants";
import { defaultDateRange } from "@/features/analytics/metrics";
import { listBrandsForWorkspace, listImportSubjects } from "@/features/analytics/queries";
import { ImportAnalyticsForm } from "@/features/analytics/components/ImportAnalyticsForm";

/**
 * Impor analytics CSV — app/(app)/analitik/impor/page.tsx (P7-05).
 * Satu CSV = satu snapshot = satu periode. Hanya peran import_analytics
 * yang melihat form (yang lain mendapat penolakan tegas).
 */
export default async function ImporPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Impor Data Analytics"
      description="Impor metrik dari laporan platform (CSV) — satu file menjadi satu snapshot untuk satu periode. Impor ulang slice yang sama menimpa nilai lama."
    >
      {(ctx) => (
        <ImporContent
          workspaceId={ctx.workspace.workspaceId}
          timezone={ctx.workspace.timezone}
          role={ctx.role as WorkspaceRole}
        />
      )}
    </PlanningShell>
  );
}

async function ImporContent({
  workspaceId,
  timezone,
  role,
}: {
  workspaceId: string;
  timezone: string;
  role: WorkspaceRole;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  if (!can(role, "view_analytics")) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
      >
        ⚠️ {ANALYTICS_VIEWER_CLIENT_DENIED_ID}
      </div>
    );
  }
  if (!can(role, "import_analytics")) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
      >
        ⚠️ Peran Anda tidak boleh mengimpor analytics. Minta owner/admin/manager/strategist
        atau analis workspace ini yang mengimpor.
      </div>
    );
  }
  const [brandsRes, subjectsRes] = await Promise.all([
    listBrandsForWorkspace(supabase, workspaceId),
    listImportSubjects(supabase, workspaceId),
  ]);
  if (!brandsRes.ok || !subjectsRes.ok) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
      >
        ⚠️ {ANALYTICS_TABLES_UNAVAILABLE_ID}
      </div>
    );
  }
  const range = defaultDateRange(timezone);
  return (
    <ImportAnalyticsForm
      workspaceId={workspaceId}
      brands={brandsRes.data}
      subjects={subjectsRes.data}
      defaultPeriodStart={range.start}
      defaultPeriodEnd={range.end}
    />
  );
}
