import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/Badges";
import { listBrands } from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { canManageBrandsChannels } from "@/features/planning/transitions";
import type { WorkspaceRole } from "@/lib/permissions";
import { BrandForm } from "./BrandForm";

/** Merek — CRUD brand per workspace (P2-04). */
export default async function MerekPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Merek"
      description="Brand per workspace: nama, slug unik per workspace, deskripsi, dan status. Brand tidak bisa dipindah antar workspace."
    >
      {(ctx) => (
        <MerekContent workspaceId={ctx.workspace.workspaceId} role={ctx.role as WorkspaceRole} />
      )}
    </PlanningShell>
  );
}

async function MerekContent({ workspaceId, role }: { workspaceId: string; role: WorkspaceRole }) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const brands = await listBrands(supabase, workspaceId);
  const canManage = canManageBrandsChannels(role);
  return (
    <div className="flex flex-col gap-6">
      {brands.unavailable ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          ⚠️ {PLANNING_TABLES_UNAVAILABLE_ID}
        </div>
      ) : null}
      {brands.error && !brands.unavailable ? (
        <p role="alert" className="text-sm text-[var(--mt-rose-500)]">
          Gagal memuat brand: {brands.error}
        </p>
      ) : null}

      {canManage ? (
        <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Buat brand baru</h2>
          <div className="mt-3 max-w-xl">
            <BrandForm workspaceId={workspaceId} />
          </div>
        </section>
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Peran Anda hanya bisa melihat brand — pembuatan butuh owner/admin/manager.
        </p>
      )}

      <section>
        <h2 className="font-semibold">Daftar brand ({brands.data.length})</h2>
        {brands.data.length === 0 && !brands.unavailable ? (
          <div className="mt-3">
            <EmptyState
              title="Belum ada brand"
              description="Buat brand pertama untuk workspace ini — brand dipakai di channel, pilar, campaign, dan konten."
              icon="🏷️"
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {brands.data.map((b) => (
              <li
                key={b.id}
                className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{b.name}</span>
                  <code className="text-xs text-[var(--mt-text-muted)]">{b.slug}</code>
                  <StatusBadge
                    label={
                      b.status === "active"
                        ? "● Aktif"
                        : b.status === "inactive"
                          ? "○ Nonaktif"
                          : "🗄️ Diarsipkan"
                    }
                    tone={b.status === "active" ? "success" : "neutral"}
                  />
                  <span className="text-xs text-[var(--mt-text-muted)]">
                    Logo: {b.logo_asset_id ? "ada" : "belum ada (aset hadir di Phase 3)"}
                  </span>
                </div>
                {b.description ? (
                  <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{b.description}</p>
                ) : null}
                {canManage ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-[var(--mt-teal-700)]">
                      Ubah brand
                    </summary>
                    <div className="mt-3 max-w-xl">
                      <BrandForm workspaceId={workspaceId} initial={b} />
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
