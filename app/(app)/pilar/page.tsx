import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/Badges";
import { listAudiences, listBrands, listPillars } from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { canManagePillarsCampaigns } from "@/features/planning/transitions";
import type { WorkspaceRole } from "@/lib/permissions";
import { AudienceForm, PillarForm } from "./PilarForms";

/** Pilar + Audiens dasar (P2-06). */
export default async function PilarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Pilar & Audiens"
      description="Pilar konten per workspace (boleh terikat satu brand atau berlaku untuk seluruh workspace) dan audiens dasar dengan atribut yang bentuknya didokumentasikan."
    >
      {(ctx) => (
        <PilarContent workspaceId={ctx.workspace.workspaceId} role={ctx.role as WorkspaceRole} />
      )}
    </PlanningShell>
  );
}

async function PilarContent({ workspaceId, role }: { workspaceId: string; role: WorkspaceRole }) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const [brands, pillars, audiences] = await Promise.all([
    listBrands(supabase, workspaceId),
    listPillars(supabase, workspaceId),
    listAudiences(supabase, workspaceId),
  ]);
  const unavailable = brands.unavailable || pillars.unavailable || audiences.unavailable;
  const canManage = canManagePillarsCampaigns(role);
  const brandName = (id: string | null) =>
    brands.data.find((b) => b.id === id)?.name ?? "Seluruh workspace";
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

      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Pilar konten ({pillars.data.length})</h2>
        {pillars.data.length === 0 && !unavailable ? (
          <div className="mt-3">
            <EmptyState
              title="Belum ada pilar"
              description="Pilar mengelompokkan konten berdasarkan tema besar — dipakai sebagai filter di kalender dan board."
              icon="🧱"
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {pillars.data.map((p) => (
              <li key={p.id} className="rounded-xl border border-[var(--mt-border)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-[var(--mt-text-muted)]">
                    {brandName(p.brand_id)} · token warna: {p.color_token ?? "-"}
                  </span>
                  <StatusBadge
                    label={p.active ? "● Aktif" : "○ Nonaktif"}
                    tone={p.active ? "success" : "neutral"}
                  />
                </div>
                {p.description ? (
                  <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{p.description}</p>
                ) : null}
                {canManage ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium text-[var(--mt-teal-700)]">
                      Ubah pilar
                    </summary>
                    <div className="mt-3 max-w-xl">
                      <PillarForm workspaceId={workspaceId} brands={brands.data} initial={p} />
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
              ＋ Buat pilar
            </summary>
            <div className="mt-3 max-w-xl">
              <PillarForm workspaceId={workspaceId} brands={brands.data} />
            </div>
          </details>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Audiens ({audiences.data.length})</h2>
        {audiences.data.length === 0 && !unavailable ? (
          <div className="mt-3">
            <EmptyState
              title="Belum ada audiens"
              description="Audiens mendeskripsikan siapa yang dituju konten — dipakai di campaign dan konten."
              icon="🎯"
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {audiences.data.map((a) => {
              const attrs = a.attributes as Record<string, unknown>;
              return (
                <li key={a.id} className="rounded-xl border border-[var(--mt-border)] p-3">
                  <p className="font-medium">{a.name}</p>
                  {a.description ? (
                    <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{a.description}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                    {typeof attrs.age_range === "string" ? `Usia: ${attrs.age_range} · ` : ""}
                    {typeof attrs.location === "string" ? `Lokasi: ${attrs.location} · ` : ""}
                    {Array.isArray(attrs.interests)
                      ? `Minat: ${attrs.interests.join(", ")} · `
                      : ""}
                    {Array.isArray(attrs.pain_points)
                      ? `Pain point: ${attrs.pain_points.join(", ")}`
                      : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {canManage ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-[var(--mt-teal-700)]">
              ＋ Buat audiens
            </summary>
            <div className="mt-3 max-w-xl">
              <AudienceForm workspaceId={workspaceId} />
            </div>
          </details>
        ) : (
          <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
            Peran Anda hanya bisa melihat pilar/audiens — pembuatan butuh
            owner/admin/manager/strategist.
          </p>
        )}
      </section>
    </div>
  );
}
