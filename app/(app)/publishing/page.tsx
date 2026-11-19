import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { listPublishingJobs } from "@/features/publishing/queries";
import { PublishingQueue } from "@/features/publishing/components/PublishingQueue";
import { PUBLISHING_TABLES_UNAVAILABLE_ID } from "@/features/publishing/constants";

/**
 * Antrean publishing — app/(app)/publishing/page.tsx (P6-05).
 * Worker lokal (P6-06): job jatuh tempo diproses saat halaman dimuat
 * (idempotent; hanya yang berhak schedule_publish yang memicu pemrosesan).
 * Reminder MVP = seksi "Perlu perhatian" di PublishingQueue (tampilan
 * terhitung, bukan record yang dikirim).
 */
export default async function PublishingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Publishing"
      description="Antrean publikasi — jadwalkan secara lokal, terbitkan manual di platform, lalu konfirmasi di sini dengan URL dan waktu terbit. Tidak ada penerbitan otomatis di Phase 6."
    >
      {(ctx) => (
        <PublishingContent
          workspaceId={ctx.workspace.workspaceId}
          role={ctx.role as WorkspaceRole}
        />
      )}
    </PlanningShell>
  );
}

async function PublishingContent({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: WorkspaceRole;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const canManage = can(role, "schedule_publish");
  if (canManage) {
    // Proses job jatuh tempo (worker lokal). Hasil sengaja diabaikan: daftar
    // di bawah adalah sumber kebenaran; galat (mis. tabel 0020 belum ada)
    // ditangani oleh listPublishingJobs di bawah.
    await supabase.rpc("process_publishing_jobs", {
      p_workspace_id: workspaceId,
      p_job_id: null,
    });
  }
  const res = await listPublishingJobs(supabase, workspaceId);
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
  return <PublishingQueue workspaceId={workspaceId} jobs={res.data} canManage={canManage} />;
}
