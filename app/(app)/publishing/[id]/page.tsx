import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { getPublishingJob } from "@/features/publishing/queries";
import { JobDetail } from "@/features/publishing/components/JobDetail";
import { PUBLISHING_TABLES_UNAVAILABLE_ID } from "@/features/publishing/constants";

/** Detail job publishing — app/(app)/publishing/[id]/page.tsx (P6-05). */
export default async function PublishingDetailPage({
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
      title="Detail job publikasi"
      description="Status, jadwal, bukti terbit, dan riwayat pemrosesan job."
    >
      {(ctx) => (
        <PublishingDetailContent
          jobId={id}
          workspaceId={ctx.workspace.workspaceId}
          role={ctx.role as WorkspaceRole}
        />
      )}
    </PlanningShell>
  );
}

async function PublishingDetailContent({
  jobId,
  workspaceId,
  role,
}: {
  jobId: string;
  workspaceId: string;
  role: WorkspaceRole;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const res = await getPublishingJob(supabase, jobId);
  if (!res.ok) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
      >
        ⚠️ {PUBLISHING_TABLES_UNAVAILABLE_ID}
      </div>
    );
  }
  if (!res.data || res.data.workspace_id !== workspaceId) {
    // Deep link hanya resolve untuk pengguna berwenang: job milik workspace
    // lain tidak ditampilkan — perlakukan sebagai tidak ditemukan.
    notFound();
  }
  const canManage = can(role, "schedule_publish");
  return <JobDetail workspaceId={workspaceId} job={res.data} canManage={canManage} />;
}
