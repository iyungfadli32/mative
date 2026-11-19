import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { listBriefTemplates } from "@/features/production/queries";
import {
  deleteBriefTemplateAction,
  ensureDefaultBriefTemplate,
  setDefaultBriefTemplateAction,
} from "@/features/production/actions";
import { TemplateForm } from "@/features/production/components/TemplateForm";
import type { WorkspaceRole } from "@/lib/permissions";

/**
 * Template Brief (P3-05): daftar template per workspace, buat/ubah/hapus,
 * dan atur default. Template default dibuat otomatis (lazy) bila belum ada.
 * Template default tidak bisa dihapus — ganti default dulu.
 */
export default async function TemplateBriefPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Template Brief"
      description="Template field brief per workspace. Satu template default dipakai editor brief bila konten belum memilih template."
    >
      {(ctx) => (
        <TemplateBriefContent
          workspaceId={ctx.workspace.workspaceId}
          role={ctx.role as WorkspaceRole}
        />
      )}
    </PlanningShell>
  );
}

async function TemplateBriefContent({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: WorkspaceRole;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const canManage = ["owner", "admin", "manager", "strategist"].includes(role);
  const canDelete = ["owner", "admin", "manager"].includes(role);
  const templates = await listBriefTemplates(supabase, workspaceId);
  if (!templates.unavailable && !templates.data.some((t) => t.is_default) && canManage) {
    // Lazy: buat template default standar bila belum ada (idempotent).
    await ensureDefaultBriefTemplate(workspaceId);
  }
  const refreshed = templates.data.some((t) => t.is_default)
    ? templates
    : await listBriefTemplates(supabase, workspaceId);
  return (
    <div className="flex flex-col gap-6">
      {refreshed.unavailable ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          ⚠️ {PLANNING_TABLES_UNAVAILABLE_ID}
        </div>
      ) : null}

      {canManage ? (
        <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Buat template baru</h2>
          <div className="mt-3 max-w-2xl">
            <TemplateForm workspaceId={workspaceId} initial={null} />
          </div>
        </section>
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Peran Anda tidak boleh mengelola template brief.
        </p>
      )}

      <section>
        <h2 className="font-semibold">Template ({refreshed.data.length})</h2>
        {refreshed.data.length === 0 && !refreshed.unavailable ? (
          <div className="mt-3">
            <EmptyState
              title="Belum ada template"
              description="Template default standar dibuat otomatis saat halaman ini dibuka oleh owner/admin/manager/strategist."
              icon="📝"
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {refreshed.data.map((template) => (
              <li
                key={template.id}
                className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{template.name}</span>
                  {template.is_default ? (
                    <span className="rounded-full bg-[var(--mt-teal-700)] px-2 py-0.5 text-[11px] font-semibold text-white">
                      Default
                    </span>
                  ) : null}
                  <span className="text-xs text-[var(--mt-text-muted)]">
                    {template.schema_json.fields.length} field:{" "}
                    {template.schema_json.fields.map((f) => f.label).join(", ")}
                  </span>
                </div>
                {canManage ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!template.is_default ? (
                      <form action={setDefaultBriefTemplateAction}>
                        <input type="hidden" name="workspaceId" value={workspaceId} />
                        <input type="hidden" name="templateId" value={template.id} />
                        <Button type="submit" size="sm" variant="secondary">
                          Jadikan default
                        </Button>
                      </form>
                    ) : null}
                    {canDelete && !template.is_default ? (
                      <form action={deleteBriefTemplateAction}>
                        <input type="hidden" name="workspaceId" value={workspaceId} />
                        <input type="hidden" name="templateId" value={template.id} />
                        <Button type="submit" size="sm" variant="ghost">
                          Hapus template
                        </Button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
                {canManage ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-[var(--mt-teal-700)]">
                      Ubah template
                    </summary>
                    <div className="mt-3 max-w-2xl">
                      <TemplateForm workspaceId={workspaceId} initial={template} />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
