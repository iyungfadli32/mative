import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { ContentForm } from "@/features/planning/components/ContentForm";
import { createContentAction } from "@/features/planning/actions";
import { listAudiences, listBrands, listCampaigns, listPillars } from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { canCreateEditContent } from "@/features/planning/transitions";
import type { WorkspaceRole } from "@/lib/permissions";

/** Buat konten baru (P2-09) — otomatis membuat versi v1 lewat RPC 0008. */
export default async function KontenBaruPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  const tanggal = typeof sp.tanggal === "string" ? sp.tanggal : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Buat konten"
      description="Konten baru dimulai di stage Ide dengan versi v1. Placement ditambahkan setelah konten dibuat, dari halaman detail."
    >
      {(ctx) => (
        <KontenBaruContent
          workspaceId={ctx.workspace.workspaceId}
          timezone={ctx.workspace.timezone}
          role={ctx.role as WorkspaceRole}
          tanggal={tanggal}
        />
      )}
    </PlanningShell>
  );
}

async function KontenBaruContent({
  workspaceId,
  timezone,
  role,
  tanggal,
}: {
  workspaceId: string;
  timezone: string;
  role: WorkspaceRole;
  tanggal?: string;
}) {
  if (!canCreateEditContent(role)) {
    return (
      <p className="text-sm text-[var(--mt-text-muted)]">Peran Anda tidak boleh membuat konten.</p>
    );
  }
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const [brands, campaigns, pillars, audiences] = await Promise.all([
    listBrands(supabase, workspaceId),
    listCampaigns(supabase, workspaceId),
    listPillars(supabase, workspaceId),
    listAudiences(supabase, workspaceId),
  ]);
  if (brands.unavailable || campaigns.unavailable || pillars.unavailable || audiences.unavailable) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
      >
        ⚠️ {PLANNING_TABLES_UNAVAILABLE_ID}
      </div>
    );
  }
  if (brands.data.length === 0) {
    return (
      <p className="text-sm">
        Buat brand dulu di halaman Merek — konten harus terikat ke satu brand.
      </p>
    );
  }
  return (
    <div className="max-w-2xl rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
      <ContentForm
        workspaceId={workspaceId}
        timezone={timezone}
        brands={brands.data}
        campaigns={campaigns.data}
        pillars={pillars.data}
        audiences={audiences.data}
        initial={null}
        prefillDueAt={tanggal}
        action={createContentAction}
        submitLabel="Buat konten (v1)"
      />
    </div>
  );
}
