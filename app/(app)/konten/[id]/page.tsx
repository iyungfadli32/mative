import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { ContentForm } from "@/features/planning/components/ContentForm";
import { PlacementForm } from "@/features/planning/components/PlacementForm";
import { TransitionForm } from "@/features/planning/components/TransitionForm";
import { DistributionForm } from "@/features/planning/components/DistributionForm";
import { StatusHistory } from "@/features/planning/components/StatusHistory";
import { EmptyState } from "@/components/ui/States";
import { ProductionStatusBadge, StatusBadge } from "@/components/ui/Badges";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { Button } from "@/components/ui/Button";
import {
  createPlacementAction,
  deletePlacementAction,
  transitionContentAction,
  updateContentAction,
  updatePlacementAction,
} from "@/features/planning/actions";
import {
  getContentItemDetail,
  listAudiences,
  listBrands,
  listCampaigns,
  listChannels,
  listPillars,
} from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { canEditSpecificContent } from "@/features/planning/transitions";
import {
  DISTRIBUTION_STATUS_LABELS,
  PLATFORM_FORMAT_LABELS,
  PLATFORM_LABELS,
} from "@/features/planning/constants";
import type { WorkspaceRole } from "@/lib/permissions";
import { formatInTimezone } from "@/lib/time";

/**
 * Detail konten (P2-09 s.d. P2-14): edit → versi baru, placement
 * multi-channel, transisi stage, riwayat status, daftar versi.
 */
export default async function KontenDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Detail konten"
      description="Satu content item: metadata, placement per channel, versi, dan riwayat status."
    >
      {(ctx) => (
        <KontenDetailContent
          contentItemId={id}
          workspaceId={ctx.workspace.workspaceId}
          timezone={ctx.workspace.timezone}
          role={ctx.role as WorkspaceRole}
          userId={ctx.userId}
        />
      )}
    </PlanningShell>
  );
}

async function KontenDetailContent({
  contentItemId,
  workspaceId,
  timezone,
  role,
  userId,
}: {
  contentItemId: string;
  workspaceId: string;
  timezone: string;
  role: WorkspaceRole;
  userId: string;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const detail = await getContentItemDetail(supabase, contentItemId);
  if (detail.item.unavailable) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
      >
        ⚠️ {PLANNING_TABLES_UNAVAILABLE_ID}
      </div>
    );
  }
  if (detail.item.error || !detail.item.data) {
    if (detail.item.error?.includes("0 rows") || detail.item.error?.includes("No rows")) {
      notFound();
    }
    return (
      <p role="alert" className="text-sm text-[var(--mt-rose-500)]">
        Gagal memuat konten: {detail.item.error ?? "tidak ditemukan"}
      </p>
    );
  }
  const item = detail.item.data;
  if (item.workspace_id !== workspaceId) {
    // Deep link hanya resolve untuk pengguna berwenang (P2-13): item milik
    // workspace lain tidak ditampilkan — perlakukan sebagai tidak ditemukan.
    notFound();
  }
  const canEdit = canEditSpecificContent(role, item.owner_user_id === userId);
  const [brands, campaigns, pillars, audiences] = await Promise.all([
    listBrands(supabase, workspaceId),
    listCampaigns(supabase, workspaceId),
    listPillars(supabase, workspaceId),
    listAudiences(supabase, workspaceId),
  ]);
  const channels = await listChannels(
    supabase,
    brands.data.map((b) => b.id),
  );
  const brandChannels = channels.data.filter((c) => c.brand_id === item.brand_id);
  const latestVersion = detail.versions.data[0] ?? null;
  const usedChannelIds = new Set((item.placements ?? []).map((p) => p.social_channel_id));
  const freeChannels = brandChannels.filter((c) => !usedChannelIds.has(c.id));

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold">{item.title}</h2>
          <ProductionStatusBadge status={item.production_status} />
          {item.archived_at ? <StatusBadge label="🗄️ Diarsipkan" tone="neutral" /> : null}
        </div>
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
          Brand: {item.brand?.name ?? "—"} · Campaign: {item.campaign?.name ?? "—"} · Pilar:{" "}
          {item.pillar?.name ?? "—"} · Tenggat:{" "}
          {item.due_at ? formatInTimezone(item.due_at, item.timezone) : "belum ditentukan"} (
          {item.timezone})
        </p>
        {item.internal_description ? (
          <p className="mt-2 text-sm">{item.internal_description}</p>
        ) : null}
        {item.objective ? (
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">Tujuan: {item.objective}</p>
        ) : null}
        {item.origin_idea_id ? (
          <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
            Dibuat dari ide (origin_idea_id tercatat).
          </p>
        ) : null}
      </section>

      {canEdit ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
            <h2 className="font-semibold">Ubah konten (membuat versi baru)</h2>
            <div className="mt-3">
              <ContentForm
                workspaceId={workspaceId}
                timezone={timezone}
                brands={brands.data}
                campaigns={campaigns.data}
                pillars={pillars.data}
                audiences={audiences.data}
                initial={item}
                initialVersion={latestVersion}
                action={updateContentAction}
                submitLabel="Simpan sebagai versi baru"
              />
            </div>
          </section>
          <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
            <h2 className="font-semibold">Pindah production stage</h2>
            <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
              Stage saat ini: {item.production_status}. Setiap perpindahan tercatat di riwayat
              status.
            </p>
            <div className="mt-3">
              <TransitionForm
                contentItemId={item.id}
                workspaceId={workspaceId}
                fromStatus={item.production_status as never}
                action={transitionContentAction}
              />
            </div>
          </section>
        </div>
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Peran Anda tidak boleh mengedit konten ini
          {role === "creator" || role === "editor"
            ? " (hanya konten yang ditugaskan kepada Anda)"
            : ""}
          .
        </p>
      )}

      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">
          Placement ({(item.placements ?? []).length}) — satu konten, banyak channel
        </h2>
        {(item.placements ?? []).length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="Belum ada placement"
              description="Tambahkan placement untuk setiap channel tujuan — format, caption, dan jadwal bisa berbeda per channel."
              icon="📣"
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {(item.placements ?? []).map((p) => {
              const ch = channels.data.find((c) => c.id === p.social_channel_id);
              return (
                <li key={p.id} className="rounded-xl border border-[var(--mt-border)] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ChannelIcon platform={ch?.platform ?? "other"} />
                    <span className="font-medium">
                      {PLATFORM_LABELS[(ch?.platform ?? "other") as keyof typeof PLATFORM_LABELS] ??
                        ch?.platform}
                      {ch?.account_name ? ` — ${ch.account_name}` : ""}
                    </span>
                    <StatusBadge
                      label={`${DISTRIBUTION_STATUS_LABELS[p.distribution_status as keyof typeof DISTRIBUTION_STATUS_LABELS]?.icon ?? ""} ${DISTRIBUTION_STATUS_LABELS[p.distribution_status as keyof typeof DISTRIBUTION_STATUS_LABELS]?.label ?? p.distribution_status}`}
                      tone={p.distribution_status === "published" ? "success" : "neutral"}
                    />
                    <span className="text-xs text-[var(--mt-text-muted)]">
                      Format:{" "}
                      {PLATFORM_FORMAT_LABELS[
                        (p.platform_format ?? "other") as keyof typeof PLATFORM_FORMAT_LABELS
                      ] ??
                        p.platform_format ??
                        "—"}
                      {p.scheduled_at
                        ? ` · Jadwal: ${formatInTimezone(p.scheduled_at, p.timezone)} (${p.timezone})`
                        : " · Belum terjadwal"}
                    </span>
                  </div>
                  {p.platform_caption ? (
                    <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{p.platform_caption}</p>
                  ) : null}
                  {p.platform_hashtags.length > 0 ? (
                    <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                      Hashtag: {p.platform_hashtags.map((h) => `#${h}`).join(" ")}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                    remote_post_id / published_url: belum ada (belum ada publishing di fase ini).
                  </p>
                  {canEdit ? (
                    <div className="mt-3 flex flex-col gap-3">
                      <DistributionForm
                        placementId={p.id}
                        workspaceId={workspaceId}
                        fromStatus={p.distribution_status as never}
                      />
                      <details>
                        <summary className="cursor-pointer text-sm font-medium text-[var(--mt-teal-700)]">
                          Ubah caption / format / hashtag
                        </summary>
                        <div className="mt-3 max-w-xl">
                          <PlacementForm
                            workspaceId={workspaceId}
                            contentItemId={item.id}
                            channels={brandChannels}
                            initial={p}
                            action={updatePlacementAction}
                            submitLabel="Simpan placement"
                          />
                        </div>
                      </details>
                      <form action={deletePlacementAction}>
                        <input type="hidden" name="placementId" value={p.id} />
                        <input type="hidden" name="workspaceId" value={workspaceId} />
                        <Button type="submit" size="sm" variant="ghost">
                          Lepas placement ini
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {canEdit && freeChannels.length > 0 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-[var(--mt-teal-700)]">
              ＋ Tambah placement
            </summary>
            <div className="mt-3 max-w-xl">
              <PlacementForm
                workspaceId={workspaceId}
                contentItemId={item.id}
                channels={freeChannels}
                initial={null}
                action={createPlacementAction}
                submitLabel="Tambah placement"
              />
            </div>
          </details>
        ) : canEdit ? (
          <p className="mt-3 text-sm text-[var(--mt-text-muted)]">
            Semua channel brand ini sudah punya placement untuk konten ini.
          </p>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Versi ({detail.versions.data.length})</h2>
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
            Versi baru dibuat setiap kali field kunci diubah. Bandingkan/restore penuh hadir di
            Phase 3.
          </p>
          {detail.versions.data.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--mt-text-muted)]">Belum ada versi.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {detail.versions.data.map((v) => (
                <li key={v.id} className="rounded-xl border border-[var(--mt-border)] p-3 text-sm">
                  <p className="font-medium">
                    v{v.version_number} · {formatInTimezone(v.created_at)}
                  </p>
                  {v.change_summary ? (
                    <p className="text-[var(--mt-text-muted)]">{v.change_summary}</p>
                  ) : null}
                  {v.caption ? <p className="mt-1 line-clamp-2">Caption: {v.caption}</p> : null}
                  {v.cta ? <p className="mt-1">CTA: {v.cta}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Riwayat status ({detail.events.data.length})</h2>
          <div className="mt-3">
            <StatusHistory events={detail.events.data} />
          </div>
        </section>
      </div>
    </div>
  );
}
