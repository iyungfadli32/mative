import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { listBrands, listChannels } from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { canManageBrandsChannels } from "@/features/planning/transitions";
import type { WorkspaceRole } from "@/lib/permissions";
import { PLATFORM_LABELS } from "@/features/planning/constants";
import { ChannelForm } from "./ChannelForm";

/** Channel — registry metadata SAJA (P2-05). Tanpa OAuth/token/klaim terhubung. */
export default async function ChannelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Channel"
      description="Registry channel media sosial — metadata saja (platform, nama akun, handle). Belum ada koneksi OAuth; semua channel tampil sebagai “belum terhubung”."
    >
      {(ctx) => (
        <ChannelContent workspaceId={ctx.workspace.workspaceId} role={ctx.role as WorkspaceRole} />
      )}
    </PlanningShell>
  );
}

async function ChannelContent({ workspaceId, role }: { workspaceId: string; role: WorkspaceRole }) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const brands = await listBrands(supabase, workspaceId);
  const channels = await listChannels(
    supabase,
    brands.data.map((b) => b.id),
  );
  const canManage = canManageBrandsChannels(role);
  return (
    <div className="flex flex-col gap-6">
      {brands.unavailable || channels.unavailable ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          ⚠️ {PLANNING_TABLES_UNAVAILABLE_ID}
        </div>
      ) : null}
      {brands.data.length === 0 && !brands.unavailable ? (
        <EmptyState
          title="Belum ada brand"
          description="Channel terikat ke brand — buat brand dulu di halaman Merek."
          icon="🏷️"
        />
      ) : null}

      {brands.data.map((brand) => {
        const brandChannels = channels.data.filter((c) => c.brand_id === brand.id);
        return (
          <section
            key={brand.id}
            className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
          >
            <h2 className="font-semibold">
              {brand.name} — {brandChannels.length} channel
            </h2>
            {brandChannels.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
                Belum ada channel untuk brand ini.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {brandChannels.map((c) => (
                  <li key={c.id} className="rounded-xl border border-[var(--mt-border)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ChannelIcon platform={c.platform} />
                      <span className="font-medium">
                        {PLATFORM_LABELS[c.platform as keyof typeof PLATFORM_LABELS] ?? c.platform}
                      </span>
                      {c.account_name ? <span>{c.account_name}</span> : null}
                      {c.handle ? (
                        <span className="text-[var(--mt-text-muted)]">{c.handle}</span>
                      ) : null}
                      <span className="rounded-full bg-[var(--mt-canvas)] px-2.5 py-1 text-xs font-medium text-[var(--mt-text-muted)]">
                        ⚠️ Belum terhubung
                        {c.connection_status === "manual" ? " (manual)" : ""}
                      </span>
                      <span className="text-xs text-[var(--mt-text-muted)]">
                        Zona: {c.timezone} · Kemampuan: belum diperiksa
                      </span>
                    </div>
                    {canManage ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm font-medium text-[var(--mt-teal-700)]">
                          Ubah channel
                        </summary>
                        <div className="mt-3 max-w-xl">
                          <ChannelForm
                            workspaceId={workspaceId}
                            brandId={brand.id}
                            brandName={brand.name}
                            initial={c}
                          />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canManage ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-[var(--mt-teal-700)]">
                  ＋ Tambah channel untuk {brand.name}
                </summary>
                <div className="mt-3 max-w-xl">
                  <ChannelForm
                    workspaceId={workspaceId}
                    brandId={brand.id}
                    brandName={brand.name}
                  />
                </div>
              </details>
            ) : null}
          </section>
        );
      })}
      {!canManage ? (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Peran Anda hanya bisa melihat channel — penambahan butuh owner/admin/manager.
        </p>
      ) : null}
    </div>
  );
}
