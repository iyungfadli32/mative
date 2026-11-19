/**
 * Template — app/(app)/template/page.tsx (P5-06).
 * Template dasar (ASUMSI-5.4): campaign + konten, salinan saja.
 * BUKAN /pustaka (itu Pustaka Aset P3-07) dan BUKAN /template-brief.
 */
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { listContentItems } from "@/features/planning/queries";
import { EMPTY_FILTERS } from "@/features/planning/search";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { listCampaignTemplates, listContentTemplates } from "@/features/campaign/queries";
import { CAMPAIGN_TABLES_UNAVAILABLE_ID } from "@/features/campaign/constants";
import {
  CreateCampaignFromTemplateForm,
  CreateContentFromTemplateForm,
  SaveContentAsTemplateForm,
} from "./TemplateForms";

export default async function TemplatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Template"
      description="Template dasar campaign dan konten — salinan yang bisa dipakai ulang. Template campaign juga bisa disimpan dari halaman detail campaign."
    >
      {(ctx) => (
        <TemplateContent workspaceId={ctx.workspace.workspaceId} role={ctx.role as WorkspaceRole} />
      )}
    </PlanningShell>
  );
}

async function TemplateContent({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: WorkspaceRole;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const [campaignTemplates, contentTemplates, contentItems] = await Promise.all([
    listCampaignTemplates(supabase, workspaceId),
    listContentTemplates(supabase, workspaceId),
    listContentItems(supabase, { workspaceId, ...EMPTY_FILTERS }),
  ]);
  const unavailable = !campaignTemplates.ok || !contentTemplates.ok || contentItems.unavailable;
  const canManageCampaigns = can(role, "manage_pillars_campaigns");
  const canCreateContent = can(role, "create_edit_content");
  const contentOptions = (contentItems.data ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    brandName: (item as unknown as { brand?: { name: string } | null }).brand?.name ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      {unavailable ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          ⚠️ {CAMPAIGN_TABLES_UNAVAILABLE_ID} ({PLANNING_TABLES_UNAVAILABLE_ID})
        </div>
      ) : null}

      <section>
        <h2 className="font-semibold">
          Template campaign ({campaignTemplates.ok ? campaignTemplates.data.length : 0})
        </h2>
        {!campaignTemplates.ok || campaignTemplates.data.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="Belum ada template campaign"
              description="Simpan campaign sebagai template dari halaman detail campaign."
              icon="🎯"
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {campaignTemplates.data.map((t) => (
              <li
                key={t.id}
                className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
              >
                <span className="font-semibold">{t.name}</span>
                {t.objective ? (
                  <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{t.objective}</p>
                ) : null}
                <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                  {t.target_metrics.target_deliverables !== undefined
                    ? `Target: ${t.target_metrics.target_deliverables} deliverable`
                    : "Tanpa target"}
                  {t.brand_ids.length > 0 ? ` · ${t.brand_ids.length} brand` : ""}
                </p>
                {canManageCampaigns ? (
                  <div className="mt-2 max-w-xl">
                    <CreateCampaignFromTemplateForm
                      workspaceId={workspaceId}
                      templateId={t.id}
                      templateName={t.name}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-semibold">
          Template konten ({contentTemplates.ok ? contentTemplates.data.length : 0})
        </h2>
        {!contentTemplates.ok || contentTemplates.data.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="Belum ada template konten"
              description="Simpan konten sebagai template lewat form di bawah."
              icon="📝"
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {contentTemplates.data.map((t) => (
              <li
                key={t.id}
                className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
              >
                <span className="font-semibold">{t.name}</span>
                <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
                  Judul: {t.title} · Brand: {t.brand_name ?? "—"} · {t.placement_channels.length}{" "}
                  channel
                </p>
                {canCreateContent ? (
                  <div className="mt-2 max-w-xl">
                    <CreateContentFromTemplateForm
                      workspaceId={workspaceId}
                      templateId={t.id}
                      templateTitle={t.title}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canCreateContent ? (
          <div className="mt-4 rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
            <h3 className="font-semibold">Simpan konten sebagai template</h3>
            <div className="mt-3 max-w-xl">
              <SaveContentAsTemplateForm workspaceId={workspaceId} items={contentOptions} />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
