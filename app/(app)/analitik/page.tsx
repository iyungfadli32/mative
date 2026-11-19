import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import {
  ANALYTICS_TABLES_UNAVAILABLE_ID,
  ANALYTICS_VIEWER_CLIENT_DENIED_ID,
} from "@/features/analytics/constants";
import { parseAnalyticsParams } from "@/features/analytics/params";
import { getDashboardSummary } from "@/features/analytics/queries";
import { AnalyticsDashboard } from "@/features/analytics/components/AnalyticsDashboard";

/**
 * Dashboard analytics — app/(app)/analitik/page.tsx (P7-05).
 * Rentang default 30 hari terakhir (terlihat di form). Tanpa periode
 * pembanding (tidak ada jendela pembanding yang dijamin).
 * viewer_client ditolak tegas (v2 §8) — RLS juga menutup datanya.
 */
export default async function AnalitikPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Analitik"
      description="Performa konten dari record nyata dan impor manual/CSV berlabel — tanpa koneksi platform otomatis (adapter DISABLED)."
    >
      {(ctx) => (
        <AnalitikContent
          workspaceId={ctx.workspace.workspaceId}
          timezone={ctx.workspace.timezone}
          role={ctx.role as WorkspaceRole}
          searchParams={sp}
        />
      )}
    </PlanningShell>
  );
}

async function AnalitikContent({
  workspaceId,
  timezone,
  role,
  searchParams,
}: {
  workspaceId: string;
  timezone: string;
  role: WorkspaceRole;
  searchParams: Record<string, string | string[] | undefined>;
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
  const { from, to } = parseAnalyticsParams(searchParams, timezone);
  const res = await getDashboardSummary(supabase, workspaceId, { from, to });
  if (!res.ok) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
      >
        ⚠️ {ANALYTICS_TABLES_UNAVAILABLE_ID}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <form method="get" action="/analitik" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="workspace" value={workspaceId} />
        <div className="flex flex-col gap-1">
          <label htmlFor="an-from" className="text-sm font-medium">
            Dari
          </label>
          <input
            id="an-from"
            type="date"
            name="from"
            defaultValue={from}
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="an-to" className="text-sm font-medium">
            Sampai
          </label>
          <input
            id="an-to"
            type="date"
            name="to"
            defaultValue={to}
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          className="h-10 rounded-[10px] bg-[var(--mt-teal-700)] px-4 text-sm font-medium text-white"
        >
          Terapkan periode
        </button>
      </form>
      <AnalyticsDashboard
        summary={res.data}
        workspaceId={workspaceId}
        canImport={can(role, "import_analytics")}
      />
    </div>
  );
}
