/**
 * Visual Planner — app/(app)/kampanye/[id]/visual/page.tsx (P5-05).
 * M5.3 (planner tampil + label "approximate" + urutan bisa diubah) +
 * M5.4 (bukti pemisahan: ubah urutan → scheduled_at TIDAK BERUBAH).
 */
import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { listBrands, listChannels } from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import type { WorkspaceRole } from "@/lib/permissions";
import {
  getCampaign,
  listCampaignBrands,
  listPlannerPlacements,
} from "@/features/campaign/queries";
import { CAMPAIGN_TABLES_UNAVAILABLE_ID } from "@/features/campaign/constants";
import VisualPlannerClient from "@/features/visual-planner/components/VisualPlannerClient";

export default async function VisualPlannerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  const brandParam = typeof sp.brand === "string" ? sp.brand : undefined;
  const channelParam = typeof sp.channel === "string" ? sp.channel : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Visual Planner"
      description="Urutan feed per brand + channel — terpisah dari jadwal tayang."
    >
      {(ctx) => (
        <VisualPlannerContent
          workspaceId={ctx.workspace.workspaceId}
          role={ctx.role as WorkspaceRole}
          campaignId={id}
          brandParam={brandParam}
          channelParam={channelParam}
        />
      )}
    </PlanningShell>
  );
}

async function VisualPlannerContent({
  workspaceId,
  campaignId,
  brandParam,
  channelParam,
}: {
  workspaceId: string;
  role: WorkspaceRole;
  campaignId: string;
  brandParam?: string;
  channelParam?: string;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const campaignOutcome = await getCampaign(supabase, campaignId);
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
  const [brands, linkedBrands] = await Promise.all([
    listBrands(supabase, workspaceId),
    listCampaignBrands(supabase, campaign.id),
  ]);
  const linkedBrandIds = linkedBrands.ok ? linkedBrands.data.map((b) => b.id) : [];
  const channelsOutcome = await listChannels(supabase, linkedBrandIds);
  const channels = channelsOutcome.data;
  const unavailable = brands.unavailable || !linkedBrands.ok || channelsOutcome.unavailable;
  const selectedBrandId =
    brandParam && linkedBrandIds.includes(brandParam) ? brandParam : linkedBrandIds[0];
  const channelsForBrand = channels.filter((c) => c.brand_id === selectedBrandId);
  const selectedChannelId =
    channelParam && channelsForBrand.some((c) => c.id === channelParam)
      ? channelParam
      : channelsForBrand[0]?.id;
  const selectedBrand = brands.data.find((b) => b.id === selectedBrandId);
  const selectedChannel = channels.find((c) => c.id === selectedChannelId);
  const placementsOutcome = selectedBrandId && selectedChannelId
    ? await listPlannerPlacements(supabase, workspaceId, selectedBrandId, selectedChannelId)
    : { ok: true as const, data: [] };

  return (
    <div className="flex flex-col gap-6">
      {unavailable || !placementsOutcome.ok ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          ⚠️ {PLANNING_TABLES_UNAVAILABLE_ID}
        </div>
      ) : null}
      <p className="text-sm">
        <Link href={`/kampanye/${campaign.id}`} className="underline">
          ← Kembali ke {campaign.name}
        </Link>
      </p>

      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Pilih brand + channel</h2>
        {linkedBrandIds.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
            Campaign ini belum punya brand — tautkan brand dulu di halaman detail campaign.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {linkedBrandIds.map((brandId) => {
                const brand = brands.data.find((b) => b.id === brandId);
                const firstChannel = channels.find((c) => c.brand_id === brandId);
                return (
                  <Link
                    key={brandId}
                    href={`/kampanye/${campaign.id}/visual?brand=${brandId}${firstChannel ? `&channel=${firstChannel.id}` : ""}`}
                    className={`rounded-full border px-3 py-1 text-sm ${brandId === selectedBrandId ? "border-slate-900 bg-slate-900 text-white" : "border-[var(--mt-border)]"}`}
                  >
                    {brand?.name ?? brandId}
                  </Link>
                );
              })}
            </div>
            {selectedBrandId ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {channelsForBrand.length === 0 ? (
                  <p className="text-sm text-[var(--mt-text-muted)]">
                    Brand ini belum punya channel — buat channel dulu di halaman Channel.
                  </p>
                ) : (
                  channelsForBrand.map((ch) => (
                    <Link
                      key={ch.id}
                      href={`/kampanye/${campaign.id}/visual?brand=${selectedBrandId}&channel=${ch.id}`}
                      className={`rounded-full border px-3 py-1 text-sm ${ch.id === selectedChannelId ? "border-slate-900 bg-slate-900 text-white" : "border-[var(--mt-border)]"}`}
                    >
                      {ch.platform} ({ch.account_name})
                    </Link>
                  ))
                )}
              </div>
            ) : null}
          </>
        )}
      </section>

      {selectedBrand && selectedChannel && placementsOutcome.ok ? (
        <VisualPlannerClient
          workspaceId={workspaceId}
          brandId={selectedBrand.id}
          channelId={selectedChannel.id}
          channelLabel={`${selectedChannel.platform} (${selectedChannel.account_name})`}
          brandName={selectedBrand.name}
          items={placementsOutcome.data}
        />
      ) : selectedBrandId && selectedChannelId ? (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Placement untuk brand + channel ini belum bisa dimuat.
        </p>
      ) : null}
    </div>
  );
}
