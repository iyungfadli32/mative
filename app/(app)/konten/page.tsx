import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { FilterBar } from "@/features/planning/components/FilterBar";
import { EmptyState } from "@/components/ui/States";
import { ProductionStatusBadge, PriorityBadge } from "@/components/ui/Badges";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { Button } from "@/components/ui/Button";
import {
  listAudiences,
  listBrands,
  listCampaigns,
  listChannels,
  listContentItems,
  listPillars,
} from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { carrySearchParams, parsePlanningFilters } from "@/features/planning/search";
import { canCreateEditContent } from "@/features/planning/transitions";
import { PRODUCTION_STATUS_LABELS, PLATFORM_LABELS } from "@/features/planning/constants";
import type { WorkspaceRole } from "@/lib/permissions";
import { formatInTimezone } from "@/lib/time";

/** Konten — daftar content item kanonis + filter URL (P2-09/P2-13). */
export default async function KontenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Konten"
      description="Content item kanonis — satu sumber kebenaran untuk kalender dan board. Setiap pembuatan otomatis membuat versi v1; edit field kunci membuat versi baru."
    >
      {(ctx) => (
        <KontenContent
          workspaceId={ctx.workspace.workspaceId}
          role={ctx.role as WorkspaceRole}
          sp={sp}
        />
      )}
    </PlanningShell>
  );
}

async function KontenContent({
  workspaceId,
  role,
  sp,
}: {
  workspaceId: string;
  role: WorkspaceRole;
  sp: Record<string, string | string[] | undefined>;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") params.set(k, v);
  }
  const filters = parsePlanningFilters(params, workspaceId);
  const [brands, campaigns, pillars, audiences, items] = await Promise.all([
    listBrands(supabase, workspaceId),
    listCampaigns(supabase, workspaceId),
    listPillars(supabase, workspaceId),
    listAudiences(supabase, workspaceId),
    listContentItems(supabase, filters),
  ]);
  const channels = await listChannels(
    supabase,
    brands.data.map((b) => b.id),
  );
  const unavailable = brands.unavailable || campaigns.unavailable || items.unavailable;
  const canCreate = canCreateEditContent(role);
  return (
    <div className="flex flex-col gap-4">
      {unavailable ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          ⚠️ {PLANNING_TABLES_UNAVAILABLE_ID}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canCreate ? (
          <Link href={`/konten/baru?workspace=${workspaceId}`}>
            <Button>＋ Buat konten</Button>
          </Link>
        ) : (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Peran Anda tidak boleh membuat konten.
          </p>
        )}
      </div>
      <FilterBar
        action="/konten"
        workspaceId={workspaceId}
        query={filters.q}
        hidden={carrySearchParams(sp, [
          "q",
          "brandId",
          "productionStatus",
          "campaignId",
          "pillarId",
          "platform",
          "priority",
        ])}
        resetHref={`/konten?workspace=${workspaceId}`}
        fields={[
          {
            name: "brandId",
            label: "Brand",
            value: filters.brandId,
            options: brands.data.map((b) => ({ value: b.id, label: b.name })),
          },
          {
            name: "productionStatus",
            label: "Status produksi",
            value: filters.productionStatus,
            options: Object.entries(PRODUCTION_STATUS_LABELS).map(([v, m]) => ({
              value: v,
              label: m.label,
            })),
          },
          {
            name: "campaignId",
            label: "Campaign",
            value: filters.campaignId,
            options: campaigns.data.map((c) => ({ value: c.id, label: c.name })),
          },
          {
            name: "pillarId",
            label: "Pilar",
            value: filters.pillarId,
            options: pillars.data.map((p) => ({ value: p.id, label: p.name })),
          },
          {
            name: "platform",
            label: "Platform",
            value: filters.platform,
            options: Object.entries(PLATFORM_LABELS).map(([v, l]) => ({ value: v, label: l })),
          },
          {
            name: "priority",
            label: "Prioritas",
            value: filters.priority,
            options: [
              { value: "low", label: "Rendah" },
              { value: "medium", label: "Sedang" },
              { value: "high", label: "Tinggi" },
              { value: "urgent", label: "Mendesak" },
            ],
          },
        ]}
      />
      {items.truncated ? (
        <div
          role="status"
          className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          Menampilkan hingga 200 konten pertama dari {items.total ?? items.data.length} konten di
          workspace ini. Persempit filter atau gunakan pencarian untuk melihat konten lainnya.
        </div>
      ) : null}
      {items.data.length === 0 && !unavailable ? (
        <EmptyState
          title="Belum ada konten"
          description="Buat konten pertama — kalender dan board akan membaca konten yang sama."
          icon="📝"
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.data.map((item) => {
            const channelIds = [
              ...new Set((item.placements ?? []).map((p) => p.social_channel_id)),
            ];
            return (
              <li
                key={item.id}
                className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/konten/${item.id}?workspace=${workspaceId}`}
                    className="font-semibold text-[var(--mt-teal-700)] underline"
                  >
                    {item.title}
                  </Link>
                  <ProductionStatusBadge status={item.production_status} />
                  {item.priority ? (
                    <PriorityBadge
                      priority={item.priority as "low" | "medium" | "high" | "urgent"}
                    />
                  ) : null}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-[var(--mt-text-muted)]">
                  {channelIds.map((cid) => {
                    const ch = channels.data.find((c) => c.id === cid);
                    return ch ? <ChannelIcon key={cid} platform={ch.platform} size="sm" /> : null;
                  })}
                  <span>
                    {item.brand?.name ?? "—"}
                    {item.campaign ? ` · ${item.campaign.name}` : ""}
                    {item.pillar ? ` · ${item.pillar.name}` : ""}
                    {` · ${(item.placements ?? []).length} placement`}
                    {item.due_at
                      ? ` · tenggat ${formatInTimezone(item.due_at, item.timezone)}`
                      : ""}
                  </span>
                </p>
                {item.internal_description ? (
                  <p className="mt-1 line-clamp-2 text-sm text-[var(--mt-text-muted)]">
                    {item.internal_description}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                  Audiens: {audiences.data.find((a) => a.id === item.audience_id)?.name ?? "—"}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
