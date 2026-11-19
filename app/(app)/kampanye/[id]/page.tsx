/**
 * Campaign Workspace — detail campaign (P5-04).
 * M5.1 (campaign bisa dibuat + brand/konten/placement dihubungkan,
 * deliverables tampil) + M5.2 (progres dihitung dari linked content).
 */
import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/Badges";
import {
  listAudiences,
  listBrands,
  listChannels,
  listContentItems,
} from "@/features/planning/queries";
import { EMPTY_FILTERS } from "@/features/planning/search";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { CAMPAIGN_STATUS_LABELS } from "@/features/planning/constants";
import { canManagePillarsCampaigns } from "@/features/planning/transitions";
import { parseTargetMetricsLenient } from "@/lib/validation/schemas";
import type { WorkspaceRole } from "@/lib/permissions";
import { formatInTimezone } from "@/lib/time";
import {
  getCampaign,
  listCampaignBrands,
  listCampaignDeliverables,
} from "@/features/campaign/queries";
import { computeCampaignProgress } from "@/features/campaign/progress";
import { CAMPAIGN_TABLES_UNAVAILABLE_ID } from "@/features/campaign/constants";
import {
  CampaignEditForm,
  CampaignTransitionForm,
  LinkBrandForm,
  LinkContentForm,
  SaveCampaignTemplateForm,
  UnlinkBrandButton,
  UnlinkContentButton,
} from "./CampaignDetailForms";

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Detail Campaign"
      description="Workspace campaign: progres dari linked content, deliverables, brand, status, dan template."
    >
      {(ctx) => (
        <CampaignDetailContent
          workspaceId={ctx.workspace.workspaceId}
          role={ctx.role as WorkspaceRole}
          campaignId={id}
        />
      )}
    </PlanningShell>
  );
}

async function CampaignDetailContent({
  workspaceId,
  role,
  campaignId,
}: {
  workspaceId: string;
  role: WorkspaceRole;
  campaignId: string;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const [campaignOutcome, brands, audiences, deliverablesOutcome, contentItems] =
    await Promise.all([
      getCampaign(supabase, campaignId),
      listBrands(supabase, workspaceId),
      listAudiences(supabase, workspaceId),
      listCampaignDeliverables(supabase, campaignId),
      listContentItems(supabase, { workspaceId, ...EMPTY_FILTERS }),
    ]);
  const unavailable =
    !campaignOutcome.ok ||
    brands.unavailable ||
    audiences.unavailable ||
    !deliverablesOutcome.ok ||
    contentItems.unavailable;
  if (!campaignOutcome.ok) {
    return (
      <div role="alert" className="rounded-2xl border border-[var(--mt-amber-500)] p-4 text-sm">
        ⚠️ {CAMPAIGN_TABLES_UNAVAILABLE_ID}
      </div>
    );
  }
  if (!campaignOutcome.data) {
    return (
      <EmptyState
        title="Campaign tidak ditemukan"
        description="Campaign ini tidak ada di workspace ini, atau di luar scope Anda."
        icon="🎯"
      />
    );
  }
  const campaign = campaignOutcome.data;
  const linkedBrandsOutcome = await listCampaignBrands(supabase, campaign.id);
  const linkedBrandIds = linkedBrandsOutcome.ok ? linkedBrandsOutcome.data.map((b) => b.id) : [];
  const linkedBrandNames = linkedBrandsOutcome.ok ? linkedBrandsOutcome.data : [];
  const channelsOutcome = await listChannels(supabase, linkedBrandIds);
  const deliverables = deliverablesOutcome.ok ? deliverablesOutcome.data : [];
  const progress = computeCampaignProgress(deliverables);
  const metrics = parseTargetMetricsLenient(campaign.target_metrics);
  const audienceName =
    audiences.data.find((a) => a.id === campaign.audience_id)?.name ?? "—";
  const unlinkedItems = (contentItems.data ?? [])
    .filter((item) => {
      const c = (item as unknown as { campaign?: { id: string } | null }).campaign;
      return !c;
    })
    .map((item) => ({
      id: item.id,
      title: item.title,
      brandName: (item as unknown as { brand?: { name: string } | null }).brand?.name ?? null,
    }));
  const unlinkedBrands = brands.data.filter((b) => !linkedBrandIds.includes(b.id));
  const canManage = canManagePillarsCampaigns(role);

  return (
    <div className="flex flex-col gap-6">
      {unavailable ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          ⚠️ {PLANNING_TABLES_UNAVAILABLE_ID}
        </div>
      ) : null}

      <p className="text-sm">
        <Link href="/kampanye" className="underline">
          ← Kembali ke daftar campaign
        </Link>
      </p>

      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{campaign.name}</h2>
          <StatusBadge
            label={`● ${CAMPAIGN_STATUS_LABELS[campaign.status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? campaign.status}`}
            tone={campaign.status === "active" ? "success" : "neutral"}
          />
        </div>
        {campaign.objective ? (
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{campaign.objective}</p>
        ) : null}
        <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
          Audiens: {audienceName} · Periode:{" "}
          {campaign.start_at ? formatInTimezone(campaign.start_at) : "—"} s.d.{" "}
          {campaign.end_at ? formatInTimezone(campaign.end_at) : "—"}
        </p>
        <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
          Target:{" "}
          {metrics.target_deliverables !== undefined
            ? `${metrics.target_deliverables} deliverable`
            : "—"}
          {metrics.target_date ? ` · selesai ${metrics.target_date}` : ""}
          {metrics.notes ? ` · ${metrics.notes}` : ""}
        </p>
      </section>

      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Progres — dihitung dari linked content (bukan ketikan manual)</h2>
        <p className="mt-1 text-sm">
          Siap tayang (approved): {progress.ready} dari {progress.total} deliverable —{" "}
          {progress.readyPercent}%
        </p>
        <div
          className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuenow={progress.readyPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progres campaign"
        >
          <div className="h-full bg-teal-600" style={{ width: `${progress.readyPercent}%` }} />
        </div>
        <p className="mt-2 text-xs text-[var(--mt-text-muted)]">
          Dalam produksi: {progress.inProduction} · Menunggu approval: {progress.waitingApproval} ·{" "}
          Belum mulai: {progress.notStarted} · Pengecualian: {progress.exception} · Diarsipkan:{" "}
          {progress.archived}
        </p>
      </section>

      {canManage ? (
        <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Ubah status</h2>
          <div className="mt-3 max-w-xl">
            <CampaignTransitionForm workspaceId={workspaceId} campaign={campaign} />
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Deliverables ({deliverables.length})</h2>
        {deliverables.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
            Belum ada konten yang ditautkan ke campaign ini.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {deliverables.map((d) => (
              <li
                key={d.id}
                className="rounded-xl border border-[var(--mt-border)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/konten/${d.id}`} className="font-medium underline">
                    {d.title}
                  </Link>
                  <StatusBadge label={d.production_status} tone={d.production_status === "approved" ? "success" : "neutral"} />
                  <span className="text-xs text-[var(--mt-text-muted)]">
                    {d.brand_name ?? "tanpa brand"}
                    {d.production_status === "approved" ? " · Siap tayang" : ""}
                  </span>
                  {canManage ? (
                    <UnlinkContentButton
                      workspaceId={workspaceId}
                      campaignId={campaign.id}
                      contentItemId={d.id}
                      title={d.title}
                    />
                  ) : null}
                </div>
                {d.placements.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1 text-xs text-[var(--mt-text-muted)]">
                    {d.placements.map((p) => (
                      <li key={p.id}>
                        {p.channel_platform ?? "Channel"} {p.channel_account ? `(${p.channel_account})` : ""} ·{" "}
                        {p.platform_format ?? "format tidak diatur"} ·{" "}
                        {p.scheduled_at ? formatInTimezone(p.scheduled_at) : "belum dijadwalkan"} ·{" "}
                        {p.distribution_status}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-[var(--mt-text-muted)]">Belum ada placement.</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <div className="mt-4 max-w-xl">
            <h3 className="text-sm font-semibold">Tautkan konten</h3>
            <div className="mt-2">
              <LinkContentForm
                workspaceId={workspaceId}
                campaignId={campaign.id}
                items={unlinkedItems}
              />
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Brand ({linkedBrandNames.length})</h2>
        {linkedBrandNames.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
            Belum ada brand yang terhubung.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {linkedBrandNames.map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-2 rounded-full border border-[var(--mt-border)] px-3 py-1 text-sm"
              >
                {b.name}
                {canManage ? (
                  <UnlinkBrandButton
                    workspaceId={workspaceId}
                    campaignId={campaign.id}
                    brandId={b.id}
                    brandName={b.name}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <div className="mt-4 max-w-xl">
            <LinkBrandForm
              workspaceId={workspaceId}
              campaignId={campaign.id}
              brands={unlinkedBrands}
            />
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Visual Planner</h2>
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
          Atur urutan feed per brand + channel. Urutan visual TIDAK mengubah jadwal tayang.
        </p>
        {channelsOutcome.data.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
            Belum ada channel pada brand campaign ini — buat channel dulu di halaman Channel.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {channelsOutcome.data.map((ch) => {
              const brandName =
                brands.data.find((b) => b.id === ch.brand_id)?.name ?? ch.brand_id;
              return (
                <li key={ch.id}>
                  <Link
                    href={`/kampanye/${campaign.id}/visual?brand=${ch.brand_id}&channel=${ch.id}`}
                    className="text-sm font-medium text-[var(--mt-teal-700)] underline"
                  >
                    {brandName} — {ch.platform} ({ch.account_name})
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canManage ? (
        <>
          <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
            <h2 className="font-semibold">Ubah campaign</h2>
            <div className="mt-3 max-w-xl">
              <CampaignEditForm
                workspaceId={workspaceId}
                campaign={campaign}
                brands={brands.data}
                audiences={audiences.data}
                linkedBrandIds={linkedBrandIds}
                targetMetrics={metrics}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
            <h2 className="font-semibold">Simpan sebagai template</h2>
            <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
              Template adalah salinan — campaign ini tidak berubah.
            </p>
            <div className="mt-3 max-w-xl">
              <SaveCampaignTemplateForm
                workspaceId={workspaceId}
                campaign={campaign}
                linkedBrandIds={linkedBrandIds}
                targetMetrics={metrics}
              />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
