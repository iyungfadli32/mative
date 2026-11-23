import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { FilterBar } from "@/features/planning/components/FilterBar";
import { BoardClient, type BoardCard } from "@/features/planning/components/BoardClient";
import { EmptyState } from "@/components/ui/States";
import {
  listBrands,
  listChannels,
  listContentItems,
  listWorkspaceMembers,
} from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { carrySearchParams, parsePlanningFilters } from "@/features/planning/search";
import { canCreateEditContent } from "@/features/planning/transitions";
import { dateKeyInTimezone } from "@/features/planning/calendar";
import type { WorkspaceRole } from "@/lib/permissions";

/**
 * Board Kanban (P2-12). Stage mengikuti production_status; WIP tanpa batas.
 * Membaca record kanonis yang sama dengan kalender (R2-01).
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Board Produksi"
      description="Kanban produksi: seret kartu antar stage, atau pakai pemilih “Pindah” di tiap kartu. Setiap perpindahan tercatat di riwayat status."
    >
      {(ctx) => (
        <BoardContent
          workspaceId={ctx.workspace.workspaceId}
          timezone={ctx.workspace.timezone}
          role={ctx.role as WorkspaceRole}
          sp={sp}
        />
      )}
    </PlanningShell>
  );
}

async function BoardContent({
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
  const dueDate = params.get("dueDate") ?? "";
  const [brands, members, items] = await Promise.all([
    listBrands(supabase, workspaceId),
    listWorkspaceMembers(supabase, workspaceId),
    listContentItems(supabase, filters),
  ]);
  const channels = await listChannels(
    supabase,
    brands.data.map((b) => b.id),
  );
  const unavailable = brands.unavailable || items.unavailable;
  const platformByChannel = new Map(channels.data.map((c) => [c.id, c.platform]));
  let cards: BoardCard[] = items.data.map((item) => {
    const placements = item.placements ?? [];
    return {
      contentItemId: item.id,
      title: item.title,
      brandName: item.brand?.name ?? "—",
      platforms: [
        ...new Set(placements.map((p) => platformByChannel.get(p.social_channel_id) ?? "other")),
      ],
      formats: [
        ...new Set(placements.map((p) => p.platform_format).filter((f): f is string => Boolean(f))),
      ],
      ownerId: item.owner_user_id,
      dueAt: item.due_at,
      timezone: item.timezone,
      priority: item.priority,
      productionStatus: item.production_status as BoardCard["productionStatus"],
    };
  });
  if (dueDate) {
    cards = cards.filter((c) => c.dueAt && dateKeyInTimezone(c.dueAt, timezone) === dueDate);
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
        action="/board"
        workspaceId={workspaceId}
        query={filters.q}
        hidden={carrySearchParams(sp, ["q", "brandId", "ownerId", "priority", "dueDate"])}
        dateFilter={{ name: "dueDate", label: "Tenggat (tanggal)", value: dueDate }}
        fields={[
          {
            name: "brandId",
            label: "Brand",
            value: filters.brandId,
            options: brands.data.map((b) => ({ value: b.id, label: b.name })),
          },
          {
            name: "ownerId",
            label: "Pemilik konten",
            value: filters.ownerId,
            options: members.map((mb) => ({ value: mb.userId, label: mb.displayName })),
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
        resetHref={`/board?workspace=${workspaceId}`}
      />
      {items.data.length === 0 && !unavailable ? (
        <EmptyState
          title="Belum ada konten"
          description="Buat konten pertama — board akan menampilkan kartu yang sama dengan yang ada di kalender."
          icon="🗂️"
        />
      ) : (
        <BoardClient workspaceId={workspaceId} cards={cards} canEdit={canCreateEditContent(role)} />
      )}
    </div>
  );
}
