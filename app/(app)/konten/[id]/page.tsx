import Link from "next/link";
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
  listWorkspaceMembers,
} from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { canEditSpecificContent } from "@/features/planning/transitions";
import {
  DISTRIBUTION_STATUS_LABELS,
  PLATFORM_FORMAT_LABELS,
  PLATFORM_LABELS,
} from "@/features/planning/constants";
import {
  getDefaultBriefTemplate,
  getAssetSignedUrl,
  listAssets,
  listComments,
  listContentAssets,
  listTasks,
} from "@/features/production/queries";
import { ensureDefaultBriefTemplate } from "@/features/production/actions";
import { BriefEditor } from "@/features/production/components/BriefEditor";
import { ScriptEditor } from "@/features/production/components/ScriptEditor";
import { VersionCompare } from "@/features/production/components/VersionCompare";
import { CommentThread } from "@/features/production/components/CommentThread";
import { ApprovalTab } from "@/features/approval/components/ApprovalTab";
import { TaskForm } from "@/features/production/components/TaskForm";
import { TaskStatusForm } from "@/features/production/components/TaskStatusForm";
import { TaskChecklist } from "@/features/production/components/TaskChecklist";
import { AttachAssetForm } from "@/features/production/components/AttachAssetForm";
import { ContentAssetRow } from "@/features/production/components/AssetCard";
import { EDITOR_TABS, EDITOR_TAB_LABELS, type EditorTab } from "@/features/production/constants";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/features/production/constants";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import type { BriefSnapshot } from "@/lib/validation/schemas";
import { formatInTimezone } from "@/lib/time";

/** Tab Content Workspace / Editor (P3-11, P4-04): tab server-rendered (?tab=).
 * Default overview. Approval hadir sebagai tab penuh mulai Phase 4. */
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
  const tabParam = typeof sp.tab === "string" ? sp.tab : "overview";
  const tab: EditorTab = (EDITOR_TABS as readonly string[]).includes(tabParam)
    ? (tabParam as EditorTab)
    : "overview";
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Detail konten"
      description="Content Workspace: ringkasan, brief, script, media, placement, task, komentar, versi, dan approval."
    >
      {(ctx) => (
        <KontenDetailContent
          contentItemId={id}
          workspaceId={ctx.workspace.workspaceId}
          timezone={ctx.workspace.timezone}
          role={ctx.role as WorkspaceRole}
          userId={ctx.userId}
          tab={tab}
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
  tab,
}: {
  contentItemId: string;
  workspaceId: string;
  timezone: string;
  role: WorkspaceRole;
  userId: string;
  tab: EditorTab;
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
  const latestVersion = detail.versions.data[0] ?? null;
  const tabHref = (t: EditorTab) => `/konten/${item.id}?workspace=${workspaceId}&tab=${t}`;

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
        <p className="mt-2 text-xs text-[var(--mt-text-muted)]">
          Approval: lihat tab Approval. Publishing:{" "}
          <Link
            href={`/publishing?workspace=${workspaceId}`}
            className="underline underline-offset-2"
          >
            antrean publishing
          </Link>
          .
        </p>
      </section>

      <nav className="flex flex-wrap gap-2" role="tablist" aria-label="Tab editor konten">
        {EDITOR_TABS.map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            role="tab"
            aria-selected={tab === t}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              tab === t ? "bg-[var(--mt-teal-700)] text-white" : "border border-[var(--mt-border)]"
            }`}
          >
            {EDITOR_TAB_LABELS[t]}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? (
        <OverviewTab
          item={item}
          workspaceId={workspaceId}
          timezone={timezone}
          role={role}
          canEdit={canEdit}
          latestVersion={latestVersion}
          events={detail.events.data}
        />
      ) : null}
      {tab === "brief" ? (
        <BriefTab
          contentItemId={item.id}
          workspaceId={workspaceId}
          role={role}
          canEdit={canEdit}
          latestVersion={latestVersion}
        />
      ) : null}
      {tab === "script" ? (
        <ScriptTab
          contentItemId={item.id}
          workspaceId={workspaceId}
          canEdit={canEdit}
          latestVersion={latestVersion}
        />
      ) : null}
      {tab === "media" ? (
        <MediaTab contentItemId={item.id} workspaceId={workspaceId} canEdit={canEdit} />
      ) : null}
      {tab === "placements" ? (
        <PlacementsTab item={item} workspaceId={workspaceId} canEdit={canEdit} role={role} />
      ) : null}
      {tab === "tasks" ? (
        <TasksTab
          contentItemId={item.id}
          contentTitle={item.title}
          workspaceId={workspaceId}
          role={role}
          userId={userId}
        />
      ) : null}
      {tab === "comments" ? (
        <CommentsTab
          contentItemId={item.id}
          workspaceId={workspaceId}
          role={role}
          userId={userId}
        />
      ) : null}
      {tab === "versions" ? (
        <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Versi ({detail.versions.data.length})</h2>
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
            Bandingkan dua versi per-field; field yang berubah ditandai. Memulihkan versi lama
            membuat versi BARU — riwayat tidak ditimpa.
          </p>
          <div className="mt-3">
            <VersionCompare
              versions={detail.versions.data}
              workspaceId={workspaceId}
              contentItemId={item.id}
              canEdit={canEdit}
            />
          </div>
        </section>
      ) : null}
      {tab === "approval" ? (
        <ApprovalTab
          contentItemId={item.id}
          contentTitle={item.title}
          workspaceId={workspaceId}
          role={role}
          userId={userId}
          canEdit={canEdit}
          latestVersionId={latestVersion?.id ?? ""}
          latestVersionNumber={latestVersion?.version_number ?? 0}
          productionStatus={item.production_status}
        />
      ) : null}
    </div>
  );
}

// ============================================================================
// Tab: overview (P2-09 s.d. P2-14 — dipindah dari halaman detail lama)
// ============================================================================

async function OverviewTab({
  item,
  workspaceId,
  timezone,
  role,
  canEdit,
  latestVersion,
  events,
}: {
  item: NonNullable<Awaited<ReturnType<typeof getContentItemDetail>>["item"]["data"]>;
  workspaceId: string;
  timezone: string;
  role: WorkspaceRole;
  canEdit: boolean;
  latestVersion:
    Awaited<ReturnType<typeof getContentItemDetail>>["versions"]["data"][number] | null;
  events: Awaited<ReturnType<typeof getContentItemDetail>>["events"]["data"];
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const [brands, campaigns, pillars, audiences] = await Promise.all([
    listBrands(supabase, workspaceId),
    listCampaigns(supabase, workspaceId),
    listPillars(supabase, workspaceId),
    listAudiences(supabase, workspaceId),
  ]);
  return (
    <div className="flex flex-col gap-6">
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
        <h2 className="font-semibold">Riwayat status ({events.length})</h2>
        <div className="mt-3">
          <StatusHistory events={events} />
        </div>
      </section>
    </div>
  );
}

// ============================================================================
// Tab: brief (P3-05) + script (P3-11)
// ============================================================================

async function BriefTab({
  contentItemId,
  workspaceId,
  role,
  canEdit,
  latestVersion,
}: {
  contentItemId: string;
  workspaceId: string;
  role: WorkspaceRole;
  canEdit: boolean;
  latestVersion:
    Awaited<ReturnType<typeof getContentItemDetail>>["versions"]["data"][number] | null;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  let template = await getDefaultBriefTemplate(supabase, workspaceId);
  if (template.unavailable) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
      >
        ⚠️ {PLANNING_TABLES_UNAVAILABLE_ID}
      </div>
    );
  }
  if (!template.data && ["owner", "admin", "manager", "strategist"].includes(role)) {
    // Pakai baris yang dikembalikan ensure — baca ulang
    // getDefaultBriefTemplate memakai URL yang sama dengan baca di atas
    // dan di-memoize Next.js dalam satu render (cacat e2e 2026-11-19).
    const ensured = await ensureDefaultBriefTemplate(workspaceId);
    if (ensured.template) {
      template = { data: ensured.template, error: null, unavailable: false };
    } else {
      template = await getDefaultBriefTemplate(supabase, workspaceId);
    }
  }
  if (!template.data) {
    return (
      <p className="text-sm text-[var(--mt-text-muted)]">
        Belum ada template brief default di workspace ini. Minta owner/admin/manager/strategist
        membuka halaman Template Brief dulu.
      </p>
    );
  }
  const snapshot = (latestVersion?.brief_snapshot ?? {}) as Record<string, unknown>;
  const initial: BriefSnapshot = {
    objective: typeof snapshot.objective === "string" ? snapshot.objective : "",
    audience: typeof snapshot.audience === "string" ? snapshot.audience : "",
    angle: typeof snapshot.angle === "string" ? snapshot.angle : "",
    format: typeof snapshot.format === "string" ? snapshot.format : "",
    keyMessages: Array.isArray(snapshot.keyMessages)
      ? (snapshot.keyMessages as string[])
      : Array.isArray(snapshot.key_messages)
        ? (snapshot.key_messages as string[])
        : [],
    cta: typeof snapshot.cta === "string" ? snapshot.cta : "",
    references: Array.isArray(snapshot.references) ? (snapshot.references as string[]) : [],
  };
  return (
    <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
      <h2 className="font-semibold">Brief terstruktur</h2>
      <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
        Brief tersimpan sebagai snapshot JSONB di versi konten — setiap simpan membuat versi baru.
      </p>
      <div className="mt-3 max-w-2xl">
        <BriefEditor
          workspaceId={workspaceId}
          contentItemId={contentItemId}
          templateFields={template.data.schema_json.fields}
          templateName={template.data.name}
          initial={initial}
          canEdit={canEdit}
        />
      </div>
    </section>
  );
}

async function ScriptTab({
  contentItemId,
  workspaceId,
  canEdit,
  latestVersion,
}: {
  contentItemId: string;
  workspaceId: string;
  canEdit: boolean;
  latestVersion:
    Awaited<ReturnType<typeof getContentItemDetail>>["versions"]["data"][number] | null;
}) {
  return (
    <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
      <h2 className="font-semibold">Script &amp; caption</h2>
      <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
        Script, caption, CTA, dan catatan kreatif dari versi terbaru. Menyimpan membuat versi baru.
      </p>
      <div className="mt-3 max-w-2xl">
        <ScriptEditor
          workspaceId={workspaceId}
          contentItemId={contentItemId}
          initial={{
            script: latestVersion?.script ?? null,
            caption: latestVersion?.caption ?? null,
            cta: latestVersion?.cta ?? null,
            creativeNotes: latestVersion?.creative_notes ?? null,
          }}
          canEdit={canEdit}
        />
      </div>
    </section>
  );
}

// ============================================================================
// Tab: media (P3-08)
// ============================================================================

async function MediaTab({
  contentItemId,
  workspaceId,
  canEdit,
}: {
  contentItemId: string;
  workspaceId: string;
  canEdit: boolean;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const [links, assets] = await Promise.all([
    listContentAssets(supabase, contentItemId),
    listAssets(supabase, workspaceId),
  ]);
  const attachedIds = new Set(links.data.map((l) => l.asset_id));
  const freeAssets = assets.data.filter(
    (a) => !attachedIds.has(a.id) && a.processing_status === "ready",
  );
  const signedUrls = new Map<string, string | null>();
  for (const link of links.data) {
    if (link.asset) {
      signedUrls.set(link.id, await getAssetSignedUrl(supabase, link.asset.object_key));
    }
  }
  return (
    <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
      <h2 className="font-semibold">Media ({links.data.length}) — aset yang dilampirkan</h2>
      <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
        Melepas lampiran tidak menghapus file aset. Unggah aset baru lewat{" "}
        <Link href={`/pustaka?workspace=${workspaceId}`} className="underline">
          Pustaka Aset
        </Link>
        .
      </p>
      {links.data.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--mt-text-muted)]">Belum ada aset yang dilampirkan.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {links.data.map((link) => (
            <ContentAssetRow
              key={link.id}
              link={link}
              signedUrl={signedUrls.get(link.id) ?? null}
              canEdit={canEdit}
              workspaceId={workspaceId}
            />
          ))}
        </ul>
      )}
      {canEdit ? (
        <div className="mt-4 max-w-xl">
          <h3 className="text-sm font-semibold">Lampirkan aset dari pustaka</h3>
          <div className="mt-2">
            <AttachAssetForm
              workspaceId={workspaceId}
              contentItemId={contentItemId}
              assets={freeAssets}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ============================================================================
// Tab: placements (P2-10 s.d. P2-14 — dipindah dari halaman detail lama)
// ============================================================================

async function PlacementsTab({
  item,
  workspaceId,
  canEdit,
  role,
}: {
  item: NonNullable<Awaited<ReturnType<typeof getContentItemDetail>>["item"]["data"]>;
  workspaceId: string;
  canEdit: boolean;
  role: WorkspaceRole;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const brands = await listBrands(supabase, workspaceId);
  const channels = await listChannels(
    supabase,
    brands.data.map((b) => b.id),
  );
  const brandChannels = channels.data.filter((c) => c.brand_id === item.brand_id);
  const usedChannelIds = new Set((item.placements ?? []).map((p) => p.social_channel_id));
  const freeChannels = brandChannels.filter((c) => !usedChannelIds.has(c.id));
  const canSchedulePublish = can(role, "schedule_publish");
  return (
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
                {p.published_url ? (
                  <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                    Terbit:{" "}
                    <a
                      href={p.published_url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all underline underline-offset-2"
                    >
                      {p.published_url}
                    </a>
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                    Belum terbit (belum ada URL publikasi).
                  </p>
                )}
                {canSchedulePublish && p.distribution_status !== "published" ? (
                  <p className="mt-2">
                    <Link
                      href={`/publishing/new?workspace=${workspaceId}&placementId=${p.id}`}
                      className="text-sm font-medium text-[var(--mt-teal-700)] underline-offset-2 hover:underline"
                    >
                      Jadwalkan publikasi
                    </Link>
                  </p>
                ) : null}
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
                      <p className="text-sm text-[var(--mt-text-muted)]">
                        Menghapus placement juga menghapus job publishing dan riwayatnya.
                        Placement yang sudah terbit atau masih punya job aktif tidak bisa
                        dilepas — batalkan dulu job-nya.
                      </p>
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
      {/* Form tambah placement SENGAJA tetap dirender walau tidak ada channel
          bebas — bila di-unmount saat placement tercipta (freeChannels jadi
          kosong sesudah revalidasi), pesan sukses "Placement ditambahkan
          (versi v1)." hilang sebelum dibaca (pola Phase 3/4; cacat e2e
          2026-11-19). Saat tidak ada channel bebas form dirender disabled
          dan penjelasannya tampil di bawahnya. */}
      {canEdit ? (
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
              disabled={freeChannels.length === 0}
            />
          </div>
          {freeChannels.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--mt-text-muted)]">
              Semua channel brand ini sudah punya placement untuk konten ini.
            </p>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

// ============================================================================
// Tab: tasks (P3-06) + comments (P3-09)
// ============================================================================

async function TasksTab({
  contentItemId,
  contentTitle,
  workspaceId,
  role,
  userId,
}: {
  contentItemId: string;
  contentTitle: string;
  workspaceId: string;
  role: WorkspaceRole;
  userId: string;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const canManage = can(role, "manage_tasks");
  const [all, members] = await Promise.all([
    listTasks(supabase, workspaceId),
    listWorkspaceMembers(supabase, workspaceId),
  ]);
  const tasks = all.data.filter(
    (t) => t.parent_type === "content_item" && t.parent_id === contentItemId,
  );
  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Buat task untuk konten ini</h2>
          <div className="mt-3 max-w-2xl">
            <TaskForm
              workspaceId={workspaceId}
              parents={[{ id: contentItemId, title: contentTitle, kind: "content_item" }]}
              members={members}
              canAssignAnyone={!["strategist", "creator", "editor", "approver"].includes(role)}
              selfUserId={userId}
              lockedParent={{ type: "content_item", id: contentItemId, title: contentTitle }}
            />
          </div>
        </section>
      ) : null}
      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Task konten ini ({tasks.length})</h2>
        {tasks.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
            Belum ada task untuk konten ini.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {tasks.map((task) => {
              const checklist = task.checklist ?? [];
              const doneCount = checklist.filter((c) => c.is_done).length;
              const canEditTask =
                canManage &&
                (["owner", "admin", "manager"].includes(role) || task.assignee_user_id === userId);
              return (
                <li key={task.id} className="rounded-xl border border-[var(--mt-border)] p-3">
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
                      Ditugaskan ke: {task.assigneeName ?? "belum ditugaskan"}
                      {task.due_at ? ` · Tenggat: ${formatInTimezone(task.due_at)}` : ""}
                      {` · Checklist: ${doneCount}/${checklist.length}`}
                    </span>
                  </div>
                  {task.description ? <p className="mt-1 text-sm">{task.description}</p> : null}
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    {canEditTask ? (
                      <div>
                        <TaskStatusForm
                          taskId={task.id}
                          workspaceId={workspaceId}
                          fromStatus={task.status}
                        />
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
    </div>
  );
}

async function CommentsTab({
  contentItemId,
  workspaceId,
  role,
  userId,
}: {
  contentItemId: string;
  workspaceId: string;
  role: WorkspaceRole;
  userId: string;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const [comments, members] = await Promise.all([
    listComments(supabase, "content_item", contentItemId),
    listWorkspaceMembers(supabase, workspaceId),
  ]);
  // viewer_client tidak masuk halaman ini (editor internal); komentar klien
  // hanya lewat portal. Di sini: member dengan capability comment.
  const canComment = role !== "viewer_client" && can(role, "comment");
  return (
    <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
      <h2 className="font-semibold">Komentar ({comments.data.length})</h2>
      <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
        Thread komentar konten ini. Sebut anggota lewat pemilih — yang disebut mendapat notifikasi.
      </p>
      <div className="mt-3">
        <CommentThread
          workspaceId={workspaceId}
          targetType="content_item"
          targetId={contentItemId}
          comments={comments.data}
          members={members}
          canComment={canComment}
          userId={userId}
        />
      </div>
    </section>
  );
}
