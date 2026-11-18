import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { FilterBar } from "@/features/planning/components/FilterBar";
import { CalendarClient, type CalendarTile } from "@/features/planning/components/CalendarClient";
import { EmptyState } from "@/components/ui/States";
import {
  listBrands,
  listCampaigns,
  listChannels,
  listContentItems,
  listPillars,
  listWorkspaceMembers,
} from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { parsePlanningFilters } from "@/features/planning/search";
import { canSchedule } from "@/features/planning/transitions";
import { dateKeyInTimezone } from "@/features/planning/calendar";
import {
  DISTRIBUTION_STATUS_LABELS,
  PLATFORM_FORMAT_LABELS,
  PLATFORM_LABELS,
  PRODUCTION_STATUS_LABELS,
} from "@/features/planning/constants";
import type { WorkspaceRole } from "@/lib/permissions";

/**
 * Kalender Month + Agenda (P2-11). Membaca record kanonis yang sama dengan
 * board. Week/Day/List ditunda (ADR-0008 §1) — hanya Month + Agenda.
 */
export default async function KalenderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Kalender"
      description="Placement terjadwal per bulan (Month) atau daftar harian (Agenda), plus backlog yang belum terjadwal. Seret kartu antar tanggal untuk menjadwalkan ulang."
    >
      {(ctx) => (
        <KalenderContent
          workspaceId={ctx.workspace.workspaceId}
          timezone={ctx.workspace.timezone}
          role={ctx.role as WorkspaceRole}
          sp={sp}
        />
      )}
    </PlanningShell>
  );
}

async function KalenderContent({
  workspaceId,
  timezone,
  role,
  sp,
}: {
  workspaceId: string;
  timezone: string;
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
  const view = params.get("view") === "agenda" ? "agenda" : "month";
  const [brands, campaigns, pillars, members, items] = await Promise.all([
    listBrands(supabase, workspaceId),
    listCampaigns(supabase, workspaceId),
    listPillars(supabase, workspaceId),
    listWorkspaceMembers(supabase, workspaceId),
    listContentItems(supabase, filters),
  ]);
  const channels = await listChannels(
    supabase,
    brands.data.map((b) => b.id),
  );
  const unavailable = brands.unavailable || items.unavailable;

  // Batasi tile ke bulan yang ditampilkan (berdasarkan timezone workspace).
  const monthStart = `${filters.month}-01`;
  const [y, m] = filters.month.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const monthEnd = `${nextMonth}-01`;
  const tiles: CalendarTile[] = [];
  const backlog: CalendarTile[] = [];
  for (const item of items.data) {
    for (const p of item.placements ?? []) {
      const ch = channels.data.find((c) => c.id === p.social_channel_id);
      const tile: CalendarTile = {
        placementId: p.id,
        contentItemId: item.id,
        title: item.title,
        brandName: item.brand?.name ?? "—",
        format: p.platform_format,
        platform: ch?.platform ?? "other",
        accountName: ch?.account_name ?? null,
        scheduledAt: p.scheduled_at,
        timezone: p.timezone,
        productionStatus: item.production_status,
        distributionStatus: p.distribution_status,
      };
      if (!p.scheduled_at) {
        backlog.push(tile);
        continue;
      }
      const key = dateKeyInTimezone(p.scheduled_at, timezone);
      if (key >= monthStart && key < monthEnd) tiles.push(tile);
    }
  }

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
      <FilterBar
        action="/kalender"
        workspaceId={workspaceId}
        hidden={{ month: filters.month, view }}
        fields={[
          {
            name: "brandId",
            label: "Brand",
            value: filters.brandId,
            options: brands.data.map((b) => ({ value: b.id, label: b.name })),
          },
          {
            name: "channelId",
            label: "Channel",
            value: filters.channelId,
            options: channels.data.map((c) => ({
              value: c.id,
              label: `${PLATFORM_LABELS[c.platform as keyof typeof PLATFORM_LABELS] ?? c.platform}${c.account_name ? ` — ${c.account_name}` : ""}`,
            })),
          },
          {
            name: "platform",
            label: "Platform",
            value: filters.platform,
            options: Object.entries(PLATFORM_LABELS).map(([v, l]) => ({ value: v, label: l })),
          },
          {
            name: "format",
            label: "Format",
            value: filters.format,
            options: Object.entries(PLATFORM_FORMAT_LABELS).map(([v, l]) => ({
              value: v,
              label: l,
            })),
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
            name: "distributionStatus",
            label: "Status distribusi",
            value: filters.distributionStatus,
            options: Object.entries(DISTRIBUTION_STATUS_LABELS).map(([v, m]) => ({
              value: v,
              label: m.label,
            })),
          },
          {
            name: "pillarId",
            label: "Pilar",
            value: filters.pillarId,
            options: pillars.data.map((p) => ({ value: p.id, label: p.name })),
          },
          {
            name: "campaignId",
            label: "Campaign",
            value: filters.campaignId,
            options: campaigns.data.map((c) => ({ value: c.id, label: c.name })),
          },
          {
            name: "ownerId",
            label: "Pemilik konten",
            value: filters.ownerId,
            options: members.map((mb) => ({ value: mb.userId, label: mb.displayName })),
          },
        ]}
        resetHref={`/kalender?workspace=${workspaceId}&month=${filters.month}&view=${view}`}
      />
      {items.data.length === 0 && !unavailable ? (
        <EmptyState
          title="Belum ada konten terjadwal"
          description="Buat konten dan tambahkan placement dengan jadwal — kalender akan menampilkan placement yang sama dengan yang ada di board."
          icon="📅"
        />
      ) : (
        <CalendarClient
          month={filters.month}
          timezone={timezone}
          workspaceId={workspaceId}
          tiles={tiles}
          backlog={backlog}
          canSchedule={canSchedule(role)}
          view={view}
        />
      )}
    </div>
  );
}
