import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import {
  ANALYTICS_TABLES_UNAVAILABLE_ID,
  ANALYTICS_VIEWER_CLIENT_DENIED_ID,
} from "@/features/analytics/constants";
import { parseAnalyticsParams } from "@/features/analytics/params";
import {
  getContentPerformance,
  getDashboardSummary,
  getPublishingVolume,
  listBrandsForWorkspace,
  listCampaignMetrics,
  listCampaignNames,
  listSnapshots,
} from "@/features/analytics/queries";
import { AnalyticsReports } from "@/features/analytics/components/AnalyticsReports";

/**
 * 5 laporan analytics — app/(app)/analitik/laporan/page.tsx (P7-05).
 * Ekspor CSV dulu (tanpa PDF). Filter brand opsional (?brand=<uuid>).
 */
export default async function LaporanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Laporan Analitik"
      description="Lima laporan awal dari data impor berlabel — tiap laporan menampilkan sumbernya."
    >
      {(ctx) => (
        <LaporanContent
          workspaceId={ctx.workspace.workspaceId}
          timezone={ctx.workspace.timezone}
          role={ctx.role as WorkspaceRole}
          searchParams={sp}
        />
      )}
    </PlanningShell>
  );
}

async function LaporanContent({
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
  const { from, to, brandId } = parseAnalyticsParams(searchParams, timezone);
  const range = { from, to, brandId };
  const [summaryRes, campaignRes, contentRes, snapshotsRes, volumeRes, brandsRes, namesRes] =
    await Promise.all([
      getDashboardSummary(supabase, workspaceId, range),
      listCampaignMetrics(supabase, workspaceId, { from, to }),
      getContentPerformance(supabase, workspaceId, range),
      listSnapshots(supabase, workspaceId, range),
      getPublishingVolume(supabase, workspaceId, { from, to }),
      listBrandsForWorkspace(supabase, workspaceId),
      listCampaignNames(supabase, workspaceId),
    ]);
  if (
    !summaryRes.ok ||
    !campaignRes.ok ||
    !contentRes.ok ||
    !snapshotsRes.ok ||
    !volumeRes.ok ||
    !brandsRes.ok ||
    !namesRes.ok
  ) {
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
      <form method="get" action="/analitik/laporan" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="workspace" value={workspaceId} />
        <div className="flex flex-col gap-1">
          <label htmlFor="lap-from" className="text-sm font-medium">
            Dari
          </label>
          <input
            id="lap-from"
            type="date"
            name="from"
            defaultValue={from}
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lap-to" className="text-sm font-medium">
            Sampai
          </label>
          <input
            id="lap-to"
            type="date"
            name="to"
            defaultValue={to}
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lap-brand" className="text-sm font-medium">
            Brand
          </label>
          <select
            id="lap-brand"
            name="brand"
            defaultValue={brandId ?? ""}
            className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm"
          >
            <option value="">Semua brand</option>
            {brandsRes.data.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-10 rounded-[10px] bg-[var(--mt-teal-700)] px-4 text-sm font-medium text-white"
        >
          Terapkan filter
        </button>
      </form>
      <AnalyticsReports
        workspaceId={workspaceId}
        from={from}
        to={to}
        brandId={brandId}
        summary={summaryRes.data}
        campaignMetrics={campaignRes.data}
        campaignNames={namesRes.data}
        contentRows={contentRes.data}
        snapshots={snapshotsRes.data}
        publishingVolume={volumeRes.data}
      />
    </div>
  );
}
