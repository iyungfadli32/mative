/**
 * Tab Approval di Content Editor (P4-04 s.d. P4-11).
 * Server component: menampilkan status approval konten, request aktif +
 * riwayat keputusan, form submit, form keputusan (bila pemanggil ditugaskan
 * di step saat ini), gerbang client review, dan penugasan workflow default.
 * TIDAK ADA perubahan status approval langsung — semua lewat RPC 0014.
 */
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listWorkspaceMembers } from "@/features/planning/queries";
import { APPROVAL_STATUS_LABELS } from "@/features/approval/constants";
import {
  approvalMemberNames,
  getDefaultWorkflow,
  isClientReviewEnabled,
  listApprovalDecisions,
  listContentApprovalRequests,
  listWorkflowSteps,
} from "@/features/approval/queries";
import { isActiveRequestStatus } from "@/features/approval/transitions";
import { DecisionForm } from "./DecisionForm";
import { StepAssignmentForm } from "./StepAssignmentForm";
import { SubmitClientReviewForm } from "./SubmitClientReviewForm";
import { SubmitForApprovalForm } from "./SubmitForApprovalForm";

export async function ApprovalTab({
  contentItemId,
  contentTitle,
  workspaceId,
  role,
  userId,
  canEdit,
  latestVersionId,
  latestVersionNumber,
  productionStatus,
}: {
  contentItemId: string;
  contentTitle: string;
  workspaceId: string;
  role: string;
  userId: string;
  canEdit: boolean;
  latestVersionId: string;
  latestVersionNumber: number;
  productionStatus: string;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return (
      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Approval</h2>
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
          Supabase belum dikonfigurasi — approval tidak bisa dimuat.
        </p>
      </section>
    );
  }
  const [requestsRes, workflowRes, clientReviewEnabled, names] = await Promise.all([
    listContentApprovalRequests(supabase, contentItemId),
    getDefaultWorkflow(supabase, workspaceId),
    isClientReviewEnabled(supabase, workspaceId),
    approvalMemberNames(supabase, workspaceId),
  ]);
  if (requestsRes.unavailable) {
    return (
      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Approval</h2>
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
          Tabel approval belum tersedia — terapkan migrasi 0013 dan 0014 dulu.
        </p>
      </section>
    );
  }
  const requests = requestsRes.data;
  const activeRequest = requests.find((r) => isActiveRequestStatus(r.status));
  const internalApproved = requests.some(
    (r) => r.request_type === "internal" && r.status === "approved",
  );
  const clientRequest = requests.find((r) => r.request_type === "client");
  const latestApprovedRequest = requests.find(
    (r) => r.request_type === "internal" && r.status === "approved",
  );

  // Keputusan + penugasan untuk request aktif.
  let decisions: Awaited<ReturnType<typeof listApprovalDecisions>>["data"] = [];
  let canDecide = false;
  if (activeRequest) {
    const [decRes, stepsRes] = await Promise.all([
      listApprovalDecisions(supabase, activeRequest.id),
      listWorkflowSteps(supabase, activeRequest.workflow_id),
    ]);
    decisions = decRes.data;
    const atOrder = stepsRes.data.filter((s) => s.step_order === activeRequest.current_step_order);
    canDecide =
      activeRequest.status === "in_review" &&
      atOrder.some(
        (s) =>
          s.assignee_user_id === userId || (s.assignee_role !== null && s.assignee_role === role),
      );
  }
  const isStale =
    activeRequest !== undefined && activeRequest.content_version_id !== latestVersionId;

  // Penugasan workflow default (owner/admin/manager saja).
  const workflow = workflowRes.data;
  let workflowSteps: Awaited<ReturnType<typeof listWorkflowSteps>>["data"] = [];
  let members: Awaited<ReturnType<typeof listWorkspaceMembers>> = [];
  const canManage = ["owner", "admin", "manager"].includes(role);
  if (workflow && canManage) {
    const [stepsRes, memRes] = await Promise.all([
      listWorkflowSteps(supabase, workflow.id),
      listWorkspaceMembers(supabase, workspaceId),
    ]);
    workflowSteps = stepsRes.data;
    members = memRes;
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
      <div>
        <h2 className="font-semibold">Approval — {contentTitle}</h2>
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
          Status produksi: {productionStatus}. Versi terbaru: v{latestVersionNumber}. Keputusan
          tercatat permanen dan tidak bisa diubah (append-only).
        </p>
      </div>

      {isStale ? (
        <p
          role="alert"
          className="rounded-xl border border-[var(--mt-amber-500)] bg-[var(--mt-canvas)] p-3 text-sm"
        >
          ⚠️ Request aktif ini menunjuk versi lama (bukan v{latestVersionNumber}). Keputusan atas
          versi basi akan ditolak server — ajukan ulang versi terbaru bila perlu.
        </p>
      ) : null}

      {activeRequest ? (
        <div className="rounded-xl border border-[var(--mt-border)] bg-[var(--mt-canvas)] p-3">
          <p className="text-sm font-medium">
            Request aktif: {APPROVAL_STATUS_LABELS[activeRequest.status]} (
            {activeRequest.request_type === "client" ? "client review" : "review internal"})
          </p>
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
            Diajukan oleh {names.get(activeRequest.submitted_by) ?? activeRequest.submitted_by} •{" "}
            {new Date(activeRequest.submitted_at).toLocaleString("id-ID")}
          </p>
          {decisions.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {decisions.map((d) => (
                <li key={d.id}>
                  {names.get(d.approver_user_id) ?? d.approver_user_id} — {d.decision}
                  {d.comment ? ` — “${d.comment}”` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {canDecide ? (
            <DecisionForm requestId={activeRequest.id} workspaceId={workspaceId} />
          ) : activeRequest.status === "in_review" ? (
            <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
              Anda tidak ditugaskan di step saat ini, jadi tidak bisa memutuskan request ini.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Belum ada request approval aktif untuk konten ini.
        </p>
      )}

      {canEdit && !activeRequest ? (
        <div>
          <SubmitForApprovalForm
            workspaceId={workspaceId}
            contentItemId={contentItemId}
            contentVersionId={latestVersionId}
            versionNumber={latestVersionNumber}
          />
        </div>
      ) : null}

      {internalApproved && clientReviewEnabled && !clientRequest ? (
        <div className="rounded-xl border border-[var(--mt-border)] bg-[var(--mt-canvas)] p-3">
          <p className="text-sm font-medium">Client review</p>
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
            Review internal sudah disetujui dan gerbang client_review aktif di workspace ini. Klien
            akan melihat konten ini di portal; keputusan tetap dibuat approver internal.
          </p>
          <div className="mt-2">
            <SubmitClientReviewForm
              workspaceId={workspaceId}
              contentItemId={contentItemId}
              contentVersionId={latestApprovedRequest?.content_version_id ?? latestVersionId}
            />
          </div>
        </div>
      ) : null}
      {clientRequest ? (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Client review: {APPROVAL_STATUS_LABELS[clientRequest.status]}.
        </p>
      ) : null}
      {internalApproved && !clientReviewEnabled ? (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Gerbang client_review mati di workspace ini (default) — konten tidak diajukan ke klien.
        </p>
      ) : null}

      {requests.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Riwayat request</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {requests.map((r) => (
              <li key={r.id}>
                {APPROVAL_STATUS_LABELS[r.status]} •{" "}
                {r.request_type === "client" ? "client review" : "review internal"} • diajukan{" "}
                {new Date(r.submitted_at).toLocaleDateString("id-ID")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {workflow && canManage ? (
        <div>
          <h3 className="text-sm font-semibold">Penugasan workflow default ({workflow.name})</h3>
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
            Step default menugaskan role “approver”. Bila workspace belum punya member approver,
            tugaskan step ke role lain atau pengguna eksplisit di sini — tanpa penugasan, request
            tidak pernah bisa diputuskan.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {workflowSteps.map((s) => (
              <StepAssignmentForm
                key={s.id}
                workspaceId={workspaceId}
                stepId={s.id}
                stepOrder={s.step_order}
                stepType={s.step_type}
                assigneeRole={s.assignee_role}
                assigneeUserId={s.assignee_user_id}
                members={members.map((m) => ({
                  userId: m.userId,
                  displayName: m.displayName,
                  role: m.role,
                }))}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
