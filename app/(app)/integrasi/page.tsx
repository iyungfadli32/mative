import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { ANALYTICS_VIEWER_CLIENT_DENIED_ID } from "@/features/analytics/constants";
import { listIntegrationEvents } from "@/features/analytics/queries";
import { listChannelsWithCapabilities } from "@/features/integrations/queries";
import { INTEGRATIONS_TABLES_UNAVAILABLE_ID } from "@/features/integrations/constants";
import { IntegrationsList } from "@/features/integrations/components/IntegrationsList";

/**
 * Integrasi — app/(app)/integrasi/page.tsx (P7-05).
 * SEMUA platform DISABLED (ASUMSI-7B/7F): halaman ini menampilkan
 * blocker + capability registry, BUKAN tombol hubungkan.
 */
export default async function IntegrasiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Integrasi"
      description="Capability registry: platform apa yang terhubung, apa yang manual, dan apa yang dinonaktifkan — beserta alasannya."
    >
      {(ctx) => (
        <IntegrasiContent
          workspaceId={ctx.workspace.workspaceId}
          role={ctx.role as WorkspaceRole}
        />
      )}
    </PlanningShell>
  );
}

async function IntegrasiContent({
  workspaceId,
  role,
}: {
  workspaceId: string;
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
  const [channelsRes, eventsRes] = await Promise.all([
    listChannelsWithCapabilities(supabase, workspaceId),
    listIntegrationEvents(supabase, workspaceId),
  ]);
  if (!channelsRes.ok || !eventsRes.ok) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
      >
        ⚠️ {INTEGRATIONS_TABLES_UNAVAILABLE_ID}
      </div>
    );
  }
  return <IntegrationsList channels={channelsRes.data} events={eventsRes.data} />;
}
