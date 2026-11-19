import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { listCampaigns, listContentItems, listWorkspaceMembers } from "@/features/planning/queries";
import { EMPTY_FILTERS } from "@/features/planning/search";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { listMyNotifications, listMyTasks, listTasks } from "@/features/production/queries";
import { TaskForm } from "@/features/production/components/TaskForm";
import { TaskStatusForm } from "@/features/production/components/TaskStatusForm";
import { TaskChecklist } from "@/features/production/components/TaskChecklist";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/features/production/constants";
import { markNotificationReadAction } from "@/features/production/actions";
import { NOTIFICATION_TYPE_LABELS } from "@/features/production/constants";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { formatInTimezone } from "@/lib/time";

/**
 * Task Center (P3-06): tab Tugas Saya / Semua Task, buat task + checklist,
 * pindah status mengikuti mesin ADR-0009 §2, notifikasi saya.
 */
export default async function TugasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  const tab = sp.tab === "team" ? "team" : "my";
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Tugas Saya"
      description="Task Center: tugas yang ditugaskan ke Anda, semua task tim, dan notifikasi."
    >
      {(ctx) => (
        <TugasContent
          workspaceId={ctx.workspace.workspaceId}
          role={ctx.role as WorkspaceRole}
          userId={ctx.userId}
          tab={tab}
        />
      )}
    </PlanningShell>
  );
}

async function TugasContent({
  workspaceId,
  role,
  userId,
  tab,
}: {
  workspaceId: string;
  role: WorkspaceRole;
  userId: string;
  tab: "my" | "team";
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const canManage = can(role, "manage_tasks");
  const [mine, team, notifications, contents, campaigns] = await Promise.all([
    listMyTasks(supabase, workspaceId, userId),
    listTasks(supabase, workspaceId),
    listMyNotifications(supabase, userId),
    listContentItems(supabase, { ...EMPTY_FILTERS, workspaceId }),
    listCampaigns(supabase, workspaceId),
  ]);
  const unavailable = mine.unavailable || team.unavailable;
  const members = await listWorkspaceMembers(supabase, workspaceId);
  const shown = tab === "my" ? mine.data : team.data;
  const unread = notifications.data.filter((n) => !n.read_at);
  const parents = [
    ...contents.data.map((c) => ({ id: c.id, title: c.title, kind: "content_item" as const })),
    ...campaigns.data.map((c) => ({ id: c.id, title: c.name, kind: "campaign" as const })),
  ];
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

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Daftar task">
        <Link
          href={`/tugas?workspace=${workspaceId}`}
          role="tab"
          aria-selected={tab === "my"}
          className={`rounded-full px-4 py-2 text-sm font-medium ${tab === "my" ? "bg-[var(--mt-teal-700)] text-white" : "border border-[var(--mt-border)]"}`}
        >
          Tugas Saya ({mine.data.length})
        </Link>
        <Link
          href={`/tugas?workspace=${workspaceId}&tab=team`}
          role="tab"
          aria-selected={tab === "team"}
          className={`rounded-full px-4 py-2 text-sm font-medium ${tab === "team" ? "bg-[var(--mt-teal-700)] text-white" : "border border-[var(--mt-border)]"}`}
        >
          Semua Task ({team.data.length})
        </Link>
      </div>

      {canManage ? (
        <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Buat task baru</h2>
          <div className="mt-3 max-w-2xl">
            <TaskForm
              workspaceId={workspaceId}
              parents={parents}
              members={members}
              canAssignAnyone={!["strategist", "creator", "editor", "approver"].includes(role)}
              selfUserId={userId}
            />
          </div>
        </section>
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Peran Anda hanya bisa melihat task (tidak boleh membuat task).
        </p>
      )}

      <section>
        <h2 className="font-semibold">
          {tab === "my" ? "Tugas Saya" : "Semua Task"} ({shown.length})
        </h2>
        {shown.length === 0 && !unavailable ? (
          <div className="mt-3">
            <EmptyState
              title={tab === "my" ? "Tidak ada task untuk Anda" : "Belum ada task"}
              description="Task dibuat dari konten atau campaign, lalu ditugaskan ke anggota tim."
              icon="✅"
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {shown.map((task) => {
              const checklist = task.checklist ?? [];
              const doneCount = checklist.filter((c) => c.is_done).length;
              const canEditTask =
                canManage &&
                (["owner", "admin", "manager"].includes(role) || task.assignee_user_id === userId);
              return (
                <li
                  key={task.id}
                  className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{task.title}</span>
                    <StatusBadge
                      label={`${TASK_STATUS_LABELS[task.status].icon} ${TASK_STATUS_LABELS[task.status].label}`}
                      tone={
                        task.status === "done"
                          ? "success"
                          : task.status === "blocked"
                            ? "danger"
                            : "neutral"
                      }
                    />
                    <StatusBadge
                      label={`${TASK_PRIORITY_LABELS[task.priority].icon} ${TASK_PRIORITY_LABELS[task.priority].label}`}
                      tone={task.priority === "urgent" ? "danger" : "neutral"}
                    />
                    <span className="text-xs text-[var(--mt-text-muted)]">
                      {task.parent_type === "content_item" ? "Konten: " : "Campaign: "}
                      {task.parentTitle ?? "—"}
                      {task.parent_type === "content_item" && task.parent_id ? (
                        <>
                          {" · "}
                          <Link href={`/konten/${task.parent_id}`} className="underline">
                            Buka konten
                          </Link>
                        </>
                      ) : null}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
                    Ditugaskan ke: {task.assigneeName ?? "belum ditugaskan"}
                    {task.due_at ? ` · Tenggat: ${formatInTimezone(task.due_at)}` : ""}
                    {task.estimate_minutes ? ` · Estimasi: ${task.estimate_minutes} mnt` : ""}
                    {` · Checklist: ${doneCount}/${checklist.length}`}
                  </p>
                  {task.description ? <p className="mt-1 text-sm">{task.description}</p> : null}
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    {canEditTask ? (
                      <div>
                        <h3 className="text-sm font-semibold">Pindah status</h3>
                        <div className="mt-2">
                          <TaskStatusForm
                            taskId={task.id}
                            workspaceId={workspaceId}
                            fromStatus={task.status}
                          />
                        </div>
                      </div>
                    ) : null}
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-[var(--mt-teal-700)]">
                        Checklist ({doneCount}/{checklist.length})
                      </summary>
                      <div className="mt-2">
                        <TaskChecklist
                          taskId={task.id}
                          workspaceId={workspaceId}
                          items={checklist}
                          canEdit={canEditTask}
                        />
                      </div>
                    </details>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Notifikasi saya ({unread.length} belum dibaca)</h2>
        {notifications.data.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--mt-text-muted)]">Belum ada notifikasi.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {notifications.data.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--mt-border)] p-3 text-sm"
              >
                <span className="font-medium">{n.title}</span>
                <span className="text-[var(--mt-text-muted)]">
                  {NOTIFICATION_TYPE_LABELS[n.type]} · {formatInTimezone(n.created_at)}
                </span>
                {n.body ? <span className="text-[var(--mt-text-muted)]">{n.body}</span> : null}
                {!n.read_at ? (
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="notificationId" value={n.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      Tandai dibaca
                    </Button>
                  </form>
                ) : (
                  <span className="text-xs text-[var(--mt-text-muted)]">Sudah dibaca</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
