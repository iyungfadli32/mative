import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/Badges";
import Link from "next/link";
import {
  listAudiences,
  listBrands,
  listCampaignBrands,
  listCampaigns,
} from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { canManagePillarsCampaigns } from "@/features/planning/transitions";
import { CAMPAIGN_STATUS_LABELS } from "@/features/planning/constants";
import type { WorkspaceRole } from "@/lib/permissions";
import { formatInTimezone } from "@/lib/time";
import { parseTargetMetricsLenient } from "@/lib/validation/schemas";
import { CampaignForm } from "./CampaignForm";
import { CampaignCsvExportButton, CampaignCsvImportForm } from "./CampaignCsvForms";

/** Campaign dasar (P2-07) + tautan campaign_brands. */
export default async function KampanyePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Campaign"
      description="Campaign dasar: nama, tujuan, audiens, periode, status sementara (draf → aktif → selesai → arsip, + dibatalkan), dan brand yang terlibat."
    >
      {(ctx) => (
        <KampanyeContent workspaceId={ctx.workspace.workspaceId} role={ctx.role as WorkspaceRole} />
      )}
    </PlanningShell>
  );
}

async function KampanyeContent({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: WorkspaceRole;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const [brands, audiences, campaigns] = await Promise.all([
    listBrands(supabase, workspaceId),
    listAudiences(supabase, workspaceId),
    listCampaigns(supabase, workspaceId),
  ]);
  const unavailable = brands.unavailable || audiences.unavailable || campaigns.unavailable;
  const canManage = canManagePillarsCampaigns(role);
  // Tautan brand per campaign (dibatasi 10 campaign pertama di halaman ini).
  const links = new Map<string, string[]>();
  for (const c of campaigns.data.slice(0, 10)) {
    const r = await listCampaignBrands(supabase, c.id);
    links.set(
      c.id,
      r.data.map((row) => brands.data.find((b) => b.id === row.brand_id)?.name ?? row.brand_id),
    );
  }
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

      {canManage ? (
        <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Buat campaign baru</h2>
          <div className="mt-3 max-w-xl">
            <CampaignForm
              workspaceId={workspaceId}
              brands={brands.data}
              audiences={audiences.data}
            />
          </div>
        </section>
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Peran Anda hanya bisa melihat campaign — pembuatan butuh owner/admin/manager/strategist.
        </p>
      )}

      {canManage ? (
        <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Impor / Ekspor CSV</h2>
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
            Ekspor menghasilkan file yang bisa diimpor kembali. Impor menolak baris yang tidak
            valid satu per satu — baris lain tetap masuk.
          </p>
          <div className="mt-3 flex max-w-xl flex-col gap-4">
            <CampaignCsvExportButton workspaceId={workspaceId} />
            <CampaignCsvImportForm workspaceId={workspaceId} />
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="font-semibold">Daftar campaign ({campaigns.data.length})</h2>
        {campaigns.data.length === 0 && !unavailable ? (
          <div className="mt-3">
            <EmptyState
              title="Belum ada campaign"
              description="Campaign mengelompokkan konten dalam satu periode dan tujuan."
              icon="🎯"
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {campaigns.data.map((c) => {
              const audienceName = audiences.data.find((a) => a.id === c.audience_id)?.name ?? "—";
              const brandNames = links.get(c.id) ?? [];
              const metrics = parseTargetMetricsLenient(c.target_metrics);
              return (
                <li
                  key={c.id}
                  className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/kampanye/${c.id}`}
                      className="font-semibold text-[var(--mt-teal-700)] underline"
                    >
                      {c.name}
                    </Link>
                    <StatusBadge
                      label={`● ${CAMPAIGN_STATUS_LABELS[c.status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? c.status}`}
                      tone={c.status === "active" ? "success" : "neutral"}
                    />
                  </div>
                  {c.objective ? (
                    <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{c.objective}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                    Audiens: {audienceName} · Brand:{" "}
                    {brandNames.length > 0 ? brandNames.join(", ") : "—"} · Periode:{" "}
                    {c.start_at ? formatInTimezone(c.start_at) : "—"} s.d.{" "}
                    {c.end_at ? formatInTimezone(c.end_at) : "—"}
                  </p>
                  {metrics.target_deliverables !== undefined ||
                  metrics.target_date ||
                  metrics.notes ? (
                    <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                      Target:{" "}
                      {[
                        metrics.target_deliverables !== undefined
                          ? `${metrics.target_deliverables} deliverable`
                          : null,
                        metrics.target_date ? `selesai ${metrics.target_date}` : null,
                        metrics.notes ?? null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
