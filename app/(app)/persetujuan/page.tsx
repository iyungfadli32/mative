import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import type { WorkspaceRole } from "@/lib/permissions";
import {
  approvalMemberNames,
  getCriticalFields,
  isClientCommentAllowed,
  isClientReviewEnabled,
  listApprovalQueue,
} from "@/features/approval/queries";
import { APPROVAL_QUEUE_TABS } from "@/features/approval/constants";
import type { ApprovalQueueTab } from "@/features/approval/types";
import {
  ApprovalCenterClient,
  type ApprovalCenterRow,
} from "@/features/approval/components/ApprovalCenterClient";
import { ApprovalSettingsForm } from "@/features/approval/components/ApprovalSettingsForm";

/**
 * Approval Center (P4-08/P4-09, M4.1): antrean Menunggu saya / Semua
 * tertunda / Disetujui / Minta revisi / Ditolak + kartu request +
 * keputusan inline + pengaturan workspace (owner/admin/manager).
 */
export default async function PersetujuanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  const tabParam = typeof sp.tab === "string" ? sp.tab : "menunggu_saya";
  const tab: ApprovalQueueTab = (APPROVAL_QUEUE_TABS as readonly string[]).includes(tabParam)
    ? (tabParam as ApprovalQueueTab)
    : "menunggu_saya";
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Approval Center"
      description="Antrean review & approval: siapa menunggu Anda, apa yang tertunda, dan apa yang sudah diputuskan."
    >
      {(ctx) => (
        <PersetujuanContent
          workspaceId={ctx.workspace.workspaceId}
          role={ctx.role as WorkspaceRole}
          userId={ctx.userId}
          tab={tab}
        />
      )}
    </PlanningShell>
  );
}

async function PersetujuanContent({
  workspaceId,
  role,
  userId,
  tab,
}: {
  workspaceId: string;
  role: WorkspaceRole;
  userId: string;
  tab: ApprovalQueueTab;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const queueRes = await listApprovalQueue(supabase, workspaceId, userId, role, tab);
  if (queueRes.unavailable) {
    return (
      <p className="text-sm">
        {PLANNING_TABLES_UNAVAILABLE_ID} — terapkan migrasi 0013 dan 0014 dulu.
      </p>
    );
  }
  if (queueRes.error) return <p className="text-sm">Gagal memuat antrean: {queueRes.error}</p>;
  const requests = queueRes.data;

  // Perkaya kartu: judul + status produksi konten, nomor versi, nama submitter.
  const itemIds = [...new Set(requests.map((r) => r.target_id))];
  const versionIds = [...new Set(requests.map((r) => r.content_version_id))];
  const [{ data: items }, { data: versions }, names] = await Promise.all([
    supabase
      .from("content_items")
      .select("id, title, production_status")
      .in("id", itemIds.length > 0 ? itemIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase
      .from("content_versions")
      .select("id, content_item_id, version_number")
      .in("id", versionIds.length > 0 ? versionIds : ["00000000-0000-0000-0000-000000000000"]),
    approvalMemberNames(supabase, workspaceId),
  ]);
  const itemById = new Map(
    ((items ?? []) as { id: string; title: string; production_status: string }[]).map((i) => [
      i.id,
      i,
    ]),
  );
  const versionById = new Map(
    ((versions ?? []) as { id: string; content_item_id: string; version_number: number }[]).map(
      (v) => [v.id, v],
    ),
  );
  const latestVersionByItem = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: latest } = await supabase
      .from("content_versions")
      .select("id, content_item_id, version_number")
      .in("content_item_id", itemIds)
      .order("version_number", { ascending: false });
    for (const v of (latest ?? []) as { id: string; content_item_id: string }[]) {
      if (!latestVersionByItem.has(v.content_item_id))
        latestVersionByItem.set(v.content_item_id, v.id);
    }
  }
  // Penugasan step saat ini (untuk form keputusan inline).
  const workflowIds = [...new Set(requests.map((r) => r.workflow_id))];
  const { data: steps } = await supabase
    .from("approval_steps")
    .select(
      "id, workflow_id, step_order, step_type, assignee_role, assignee_user_id, required_count",
    )
    .in(
      "workflow_id",
      workflowIds.length > 0 ? workflowIds : ["00000000-0000-0000-0000-000000000000"],
    );
  const stepsByWorkflow = new Map<
    string,
    { step_order: number; assignee_role: string | null; assignee_user_id: string | null }[]
  >();
  for (const s of (steps ?? []) as {
    workflow_id: string;
    step_order: number;
    assignee_role: string | null;
    assignee_user_id: string | null;
  }[]) {
    const list = stepsByWorkflow.get(s.workflow_id) ?? [];
    list.push(s);
    stepsByWorkflow.set(s.workflow_id, list);
  }
  const rows: ApprovalCenterRow[] = requests.map((request) => {
    const item = itemById.get(request.target_id);
    const version = versionById.get(request.content_version_id);
    const atOrder = (stepsByWorkflow.get(request.workflow_id) ?? []).filter(
      (s) => s.step_order === request.current_step_order,
    );
    return {
      request,
      contentTitle: item?.title ?? request.target_id,
      contentProductionStatus: item?.production_status ?? "-",
      versionNumber: version?.version_number ?? null,
      submittedByName: names.get(request.submitted_by) ?? request.submitted_by,
      canDecide:
        request.status === "in_review" &&
        atOrder.some(
          (s) =>
            s.assignee_user_id === userId || (s.assignee_role !== null && s.assignee_role === role),
        ),
      isStale:
        latestVersionByItem.has(request.target_id) &&
        latestVersionByItem.get(request.target_id) !== request.content_version_id,
    };
  });

  const canManage = ["owner", "admin", "manager"].includes(role);
  const [clientReviewEnabled, clientCanComment, criticalFields] = canManage
    ? await Promise.all([
        isClientReviewEnabled(supabase, workspaceId),
        isClientCommentAllowed(supabase, workspaceId),
        getCriticalFields(supabase, workspaceId),
      ])
    : [false, false, [] as string[]];

  return (
    <div className="flex flex-col gap-4">
      <ApprovalCenterClient rows={rows} tab={tab} workspaceId={workspaceId} />
      {canManage ? (
        <ApprovalSettingsForm
          workspaceId={workspaceId}
          clientReviewEnabled={clientReviewEnabled}
          clientCanComment={clientCanComment}
          criticalFields={criticalFields}
        />
      ) : null}
      <p className="text-xs text-[var(--mt-text-muted)]">
        Keputusan approval tercatat permanen dan tidak bisa diubah. Komentar klien di portal tidak
        pernah menjadi keputusan approval.
      </p>
    </div>
  );
}
