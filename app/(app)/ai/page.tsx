import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { AI_ACCESS_DENIED_ID, AI_TABLES_UNAVAILABLE_ID } from "@/features/ai/constants";
import { getAiSettings } from "@/features/ai/settings";
import {
  getAiDailyUsage,
  listAiContextCampaigns,
  listAiContextItems,
  listAiGenerations,
} from "@/features/ai/queries";
import { AiSetupState } from "@/features/ai/components/AiSetupState";
import { AiActionForm } from "@/features/ai/components/AiActionForm";
import { getAiAdapter, NULL_PROVIDER_ID } from "@/features/ai/adapter";
import { AiGenerationsLog } from "@/features/ai/components/AiGenerationsLog";
import { AiSettingsForm } from "@/features/ai/components/AiSettingsForm";

/**
 * Asisten AI — app/(app)/ai/page.tsx (P8-02/8.4/8.11).
 * AI NONAKTIF (Keputusan #11): halaman menampilkan setup state yang
 * jujur, BUKAN hasil palsu. Peran tanpa use_ai (approver, viewer_client)
 * ditolak tegas — RLS juga menutup lognya.
 */
export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Asisten AI"
      description="Draft AI terstruktur dengan review manusia — ide, brief, draft, repurpose, checklist, rangkuman feedback, dan rangkuman campaign. Tanpa auto-publish/auto-approve."
    >
      {(ctx) => (
        <AiContent
          workspaceId={ctx.workspace.workspaceId}
          role={ctx.role as WorkspaceRole}
        />
      )}
    </PlanningShell>
  );
}

async function AiContent({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: WorkspaceRole;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  if (!can(role, "use_ai")) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
      >
        ⚠️ {AI_ACCESS_DENIED_ID}
      </div>
    );
  }
  const [usageRes, generationsRes] = await Promise.all([
    getAiDailyUsage(supabase, workspaceId),
    listAiGenerations(supabase, workspaceId),
  ]);
  if (!usageRes.ok || !generationsRes.ok) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
      >
        ⚠️ {AI_TABLES_UNAVAILABLE_ID}
      </div>
    );
  }
  const settings = await getAiSettings(supabase, workspaceId);
  const [itemsRes, campaignsRes] = await Promise.all([
    listAiContextItems(supabase, workspaceId),
    listAiContextCampaigns(supabase, workspaceId),
  ]);
  const canManageSettings = role === "owner" || role === "admin";
  const aiAvailable = getAiAdapter().providerId !== NULL_PROVIDER_ID;
  return (
    <div className="flex flex-col gap-6">
      <AiSetupState
        settings={settings}
        usage={{ used: usageRes.data, limit: settings.dailyLimit }}
      />
      <AiActionForm
        workspaceId={workspaceId}
        items={itemsRes.ok ? itemsRes.data : []}
        campaigns={campaignsRes.ok ? campaignsRes.data : []}
        disabled={!aiAvailable}
      />
      <AiGenerationsLog generations={generationsRes.data} />
      {canManageSettings ? (
        <AiSettingsForm workspaceId={workspaceId} settings={settings} />
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Pengaturan AI hanya bisa diubah owner/admin workspace ini.
        </p>
      )}
    </div>
  );
}
