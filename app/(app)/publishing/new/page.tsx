import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { runPreflight } from "@/features/publishing/queries";
import { CreateJobForm } from "@/features/publishing/components/CreateJobForm";
import { utcIsoToZonedWallClock } from "@/features/publishing/utils";

/**
 * Buat job publikasi dari placement — app/(app)/publishing/new/page.tsx (P6-05).
 * Dibuka dari placement di halaman konten (?placementId=…).
 * Preflight dijalankan di server saat halaman dimuat; checklist tampil
 * sebelum form, dan tombol buat job di-disable bila ada blokir.
 */
export default async function NewPublishingJobPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  const placementId = typeof sp.placementId === "string" ? sp.placementId : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Buat job publikasi"
      description="Jadwalkan placement untuk diterbitkan manual di platform."
    >
      {(ctx) => (
        <NewJobContent
          placementId={placementId}
          workspaceId={ctx.workspace.workspaceId}
          role={ctx.role as WorkspaceRole}
        />
      )}
    </PlanningShell>
  );
}

type PlacementRow = {
  id: string;
  timezone: string;
  scheduled_at: string | null;
  platform_format: string | null;
  content_items: { id: string; title: string | null; workspace_id: string } | null;
  social_channels: { platform: string | null; account_name: string | null } | null;
};

async function NewJobContent({
  placementId,
  workspaceId,
  role,
}: {
  placementId: string | undefined;
  workspaceId: string;
  role: WorkspaceRole;
}) {
  if (!placementId) {
    return (
      <p className="text-sm">
        placementId wajib diisi — buka halaman ini dari tautan &quot;Jadwalkan publikasi&quot; di
        placement halaman konten.
      </p>
    );
  }
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  if (!can(role, "schedule_publish")) {
    return <p className="text-sm">Peran Anda tidak boleh membuat job publikasi.</p>;
  }
  const { data, error } = await supabase
    .from("content_placements")
    .select(
      "id, timezone, scheduled_at, platform_format, content_items!inner(id, title, workspace_id), social_channels(platform, account_name)",
    )
    .eq("id", placementId)
    .single();
  if (error || !data) {
    return <p className="text-sm">Placement tidak ditemukan.</p>;
  }
  const placement = data as unknown as PlacementRow;
  if (!placement.content_items || placement.content_items.workspace_id !== workspaceId) {
    notFound();
  }
  const pre = await runPreflight(supabase, placementId, null, placement.timezone);
  const preflight = pre.ok ? pre.data : null;
  const defaultWall = utcIsoToZonedWallClock(placement.scheduled_at, placement.timezone);
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-[var(--mt-text-muted)]">
        Konten: {placement.content_items.title ?? "—"} · Channel:{" "}
        {placement.social_channels?.platform ?? "—"}
        {placement.social_channels?.account_name
          ? ` (${placement.social_channels.account_name})`
          : ""}{" "}
        · Format: {placement.platform_format ?? "—"}
      </p>
      <CreateJobForm
        workspaceId={workspaceId}
        placementId={placementId}
        placementTimezone={placement.timezone}
        defaultScheduledAt={defaultWall}
        preflight={preflight}
      />
      <p className="text-sm">
        <Link
          href={`/publishing?workspace=${workspaceId}`}
          className="underline underline-offset-2"
        >
          Kembali ke antrean publishing
        </Link>
      </p>
    </div>
  );
}
