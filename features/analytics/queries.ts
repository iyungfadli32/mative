/**
 * Query Analytics Foundation — features/analytics/queries.ts (P7-03).
 * Pola publishing/queries.ts: `runQuery` menggulung kegagalan ke
 * `unavailable` (Phase 9: tampilkan galat query, bukan daftar kosong).
 * BUKAN `null`. RLS adalah penegak baca (member + brand scope +
 * viewer_client TIDAK melihat) — query di sini tidak pernah mem-bypass
 * RLS (tidak ada service-role client).
 *
 * Agregasi dashboard memakai latest-wins (metrics.ts) — impor ulang
 * slice yang sama menimpa nilai lama; baris snapshot lama tetap
 * tersimpan tapi tidak ikut total.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ANALYTICS_TABLES_UNAVAILABLE_ID } from "./constants";
import {
  aggregateLatestWins,
  analyticsDataStatus,
  computeEngagementRate,
  computePublishingAdherence,
  isPeriodFullyContained,
} from "./metrics";
import type {
  AnalyticsSnapshot,
  CampaignMetric,
  ContentMetric,
  ContentPerformanceRow,
  DashboardSummary,
  IntegrationEvent,
  MetricDefinition,
} from "./types";

export { ANALYTICS_TABLES_UNAVAILABLE_ID };

export type QueryOutcome<T> = { ok: true; data: T } | { ok: false; unavailable: true };

function wrap<T>(fn: () => Promise<T>): Promise<QueryOutcome<T>> {
  return fn()
    .then((data) => ({ ok: true as const, data }))
    .catch(() => ({ ok: false as const, unavailable: true as const }));
}

const SNAPSHOT_COLUMNS =
  // Kolom WAJIB sama dengan migrasi 0021: analytics_snapshots punya
  // `source` (bukan `source_type`) dan TIDAK punya updated_by/updated_at
  // (PostgREST 400 bila salah — e2e Phase 7 Run 1: A7.1/A7.3 gagal).
  "id, workspace_id, brand_id, source, period_start, period_end, retrieved_at, raw_payload_reference, created_by, created_at";

const CONTENT_METRIC_COLUMNS =
  "id, snapshot_id, workspace_id, brand_id, subject_type, subject_id, metric_key, value, unit, period_start, period_end, source_notes, created_at";

const CAMPAIGN_METRIC_COLUMNS =
  // Kolom WAJIB sama dengan migrasi 0021: campaign_metrics punya
  // `snapshot_id` (bukan `source_snapshot_id`) dan TIDAK punya updated_at
  // (PostgREST 400 bila salah — e2e Phase 7 Run 1: A7.3 gagal).
  "id, workspace_id, campaign_id, brand_id, metric_key, value, unit, aggregation_rule, period_start, period_end, snapshot_id, created_at";

const DEFINITION_COLUMNS =
  "id, workspace_id, source_platform, metric_key, label, unit, formula, notes, compatibility_group, is_derived, created_at";

/** Katalog 14 definisi metrik (global, sumber manual) — urutan kunci. */
export async function listMetricDefinitions(
  supabase: SupabaseClient,
): Promise<QueryOutcome<MetricDefinition[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("metric_definitions")
      .select(DEFINITION_COLUMNS)
      .is("workspace_id", null)
      .order("metric_key", { ascending: true });
    if (error) throw error;
    return (data ?? []) as MetricDefinition[];
  });
}

/** Snapshot workspace yang periodenya bersinggungan dengan [from, to]. */
export async function listSnapshots(
  supabase: SupabaseClient,
  workspaceId: string,
  range: { from: string; to: string; brandId?: string | null },
): Promise<QueryOutcome<AnalyticsSnapshot[]>> {
  return wrap(async () => {
    let q = supabase
      .from("analytics_snapshots")
      .select(SNAPSHOT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .lte("period_start", range.to)
      .gte("period_end", range.from)
      .order("retrieved_at", { ascending: false })
      .limit(100);
    if (range.brandId) q = q.eq("brand_id", range.brandId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as AnalyticsSnapshot[];
  });
}

/** Semua snapshot workspace (untuk status "belum terhubung" + terakhir diperbarui). */
export async function listAllSnapshots(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryOutcome<AnalyticsSnapshot[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("analytics_snapshots")
      .select(SNAPSHOT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("retrieved_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as AnalyticsSnapshot[];
  });
}

/** Metrik konten workspace yang periodenya bersinggungan dengan [from, to]. */
export async function listContentMetrics(
  supabase: SupabaseClient,
  workspaceId: string,
  range: { from: string; to: string; brandId?: string | null },
): Promise<QueryOutcome<ContentMetric[]>> {
  return wrap(async () => {
    let q = supabase
      .from("content_metrics")
      .select(CONTENT_METRIC_COLUMNS)
      .eq("workspace_id", workspaceId)
      .lte("period_start", range.to)
      .gte("period_end", range.from)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (range.brandId) q = q.eq("brand_id", range.brandId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as ContentMetric[];
  });
}

/** Agregat campaign workspace yang periodenya bersinggungan dengan [from, to]. */
export async function listCampaignMetrics(
  supabase: SupabaseClient,
  workspaceId: string,
  range: { from: string; to: string; brandId?: string | null },
): Promise<QueryOutcome<CampaignMetric[]>> {
  return wrap(async () => {
    let q = supabase
      .from("campaign_metrics")
      .select(CAMPAIGN_METRIC_COLUMNS)
      .eq("workspace_id", workspaceId)
      .lte("period_start", range.to)
      .gte("period_end", range.from)
      .order("campaign_id", { ascending: true })
      .order("metric_key", { ascending: true })
      .order("period_start", { ascending: true })
      .limit(1000);
    if (range.brandId) q = q.eq("brand_id", range.brandId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as CampaignMetric[];
  });
}

/** Brand workspace (id + nama) — label laporan. */
export async function listBrandsForWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryOutcome<Array<{ id: string; name: string }>>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("brands")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; name: string }>;
  });
}

/** Event integrasi terbaru (jejak audit impor + capability). */
export async function listIntegrationEvents(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryOutcome<IntegrationEvent[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("integration_events")
      .select("id, workspace_id, event_type, actor_user_id, detail, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as IntegrationEvent[];
  });
}

export type ImportSubjectRef = {
  subjectType: "placement" | "content_item" | "published_post";
  subjectId: string;
  label: string;
  brandId: string;
  brandName: string | null;
};

/**
 * Tabel referensi halaman impor: subject yang bisa diimpor + UUID-nya
 * (subject_ref CSV wajib UUID — tanpa tabel ini pengguna harus menebak
 * ID). Dibatasi 100 per jenis; RLS menyaring sesuai scope pemanggil.
 */
export async function listImportSubjects(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryOutcome<ImportSubjectRef[]>> {
  return wrap(async () => {
    const [placementsRes, itemsRes, postsRes, brandsRes] = await Promise.all([
      supabase
        .from("content_placements")
        .select(
          "id, platform_format, content_items!inner(id, workspace_id, brand_id, title, brands(name))",
        )
        .eq("content_items.workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("content_items")
        .select("id, title, brand_id, brands(name)")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("published_posts")
        .select(
          "id, canonical_url, placement_id, content_placements!inner(content_items!inner(workspace_id, brand_id, title, brands(name)))",
        )
        .eq("content_placements.content_items.workspace_id", workspaceId)
        .order("published_at", { ascending: false })
        .limit(100),
      supabase.from("brands").select("id, name").eq("workspace_id", workspaceId),
    ]);
    if (placementsRes.error) throw placementsRes.error;
    if (itemsRes.error) throw itemsRes.error;
    if (postsRes.error) throw postsRes.error;
    if (brandsRes.error) throw brandsRes.error;
    const brandName = new Map<string, string>(
      ((brandsRes.data ?? []) as Array<{ id: string; name: string }>).map((b) => [b.id, b.name]),
    );
    const out: ImportSubjectRef[] = [];
    for (const p of (placementsRes.data ?? []) as unknown as Array<{
      id: string;
      platform_format: string | null;
      content_items: { brand_id: string; title: string | null; brands: { name: string | null } | null };
    }>) {
      out.push({
        subjectType: "placement",
        subjectId: p.id,
        label: `${p.content_items?.title ?? "(tanpa judul)"} — ${p.platform_format ?? "placement"}`,
        brandId: p.content_items.brand_id,
        brandName: brandName.get(p.content_items.brand_id) ?? null,
      });
    }
    for (const it of (itemsRes.data ?? []) as unknown as Array<{
      id: string;
      title: string | null;
      brand_id: string;
    }>) {
      out.push({
        subjectType: "content_item",
        subjectId: it.id,
        label: it.title ?? "(tanpa judul)",
        brandId: it.brand_id,
        brandName: brandName.get(it.brand_id) ?? null,
      });
    }
    for (const pp of (postsRes.data ?? []) as unknown as Array<{
      id: string;
      canonical_url: string;
      content_placements: { content_items: { brand_id: string; title: string | null } };
    }>) {
      out.push({
        subjectType: "published_post",
        subjectId: pp.id,
        label: `${pp.content_placements?.content_items?.title ?? "(tanpa judul)"} — ${pp.canonical_url}`,
        brandId: pp.content_placements.content_items.brand_id,
        brandName: brandName.get(pp.content_placements.content_items.brand_id) ?? null,
      });
    }
    return out;
  });
}

/** Hari sesudah tanggal YYYY-MM-DD (batas akhir eksklusif rentang). */
function nextDay(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  return new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
}

/** Ringkasan dashboard /analitik untuk satu workspace + periode. */
export async function getDashboardSummary(
  supabase: SupabaseClient,
  workspaceId: string,
  range: { from: string; to: string; brandId?: string | null },
): Promise<QueryOutcome<DashboardSummary>> {
  return wrap(async () => {
    // F-5 (Batch 6): adherence mengikuti filter brand lewat placement brand tersebut.
    const adherencePlacementIds = range.brandId
      ? await listPlacementIdsForBrand(supabase, workspaceId, range.brandId)
      : null;
    let jobsQuery = supabase
      .from("publishing_jobs")
      .select("id, placement_id, scheduled_at, status")
      .eq("workspace_id", workspaceId)
      .gte("scheduled_at", `${range.from}T00:00:00Z`)
      .lt("scheduled_at", `${nextDay(range.to)}T00:00:00Z`)
      .limit(500);
    if (adherencePlacementIds !== null && adherencePlacementIds.length > 0) {
      jobsQuery = jobsQuery.in("placement_id", adherencePlacementIds);
    }
    const [allSnapshotsRes, metricsRes, brandsRes, placementsCountRes, jobsRes] =
      await Promise.all([
        listAllSnapshots(supabase, workspaceId),
        listContentMetrics(supabase, workspaceId, range),
        listBrandsForWorkspace(supabase, workspaceId),
        supabase
          .from("content_placements")
          .select("id, content_items!inner(workspace_id)", { count: "exact", head: true })
          .eq("content_items.workspace_id", workspaceId),
        jobsQuery,
      ]);
    if (!allSnapshotsRes.ok) throw new Error("snapshots unavailable");
    if (!metricsRes.ok) throw new Error("metrics unavailable");
    if (!brandsRes.ok) throw new Error("brands unavailable");
    if (placementsCountRes.error) throw placementsCountRes.error;
    if (jobsRes.error) throw jobsRes.error;

    const allSnapshots = allSnapshotsRes.data;
    const metrics = metricsRes.data;
    // F-1 (Batch 6): KPI hanya menjumlah periode impor yang sepenuhnya berada
    // dalam rentang yang dipilih. Baris latest-wins yang periodenya hanya
    // sebagian masuk rentang tidak dihitung (jumlahnya di partialPeriodRows).
    // retrieved_at tidak ada di content_metrics - latest-wins memakai
    // created_at baris (satu snapshot = satu waktu impor; urutan antar
    // snapshot dipertahankan karena created_at naik seiring impor).
    const latestBySubjectKey = new Map<string, ContentMetric>();
    for (const m of metrics) {
      const k = `${m.subject_type}|${m.subject_id}|${m.metric_key}|${m.period_start}|${m.period_end}`;
      const prev = latestBySubjectKey.get(k);
      if (!prev || m.created_at >= prev.created_at) latestBySubjectKey.set(k, m);
    }
    const latestRows = [...latestBySubjectKey.values()];
    const containedRows = latestRows.filter((m) =>
      isPeriodFullyContained(m.period_start, m.period_end, range.from, range.to),
    );
    const partialPeriodRows = latestRows.length - containedRows.length;
    const totals = aggregateLatestWins(
      containedRows.map((m) => ({
        subject_type: m.subject_type,
        subject_id: m.subject_id,
        metric_key: m.metric_key,
        value: Number(m.value),
        period_start: m.period_start,
        period_end: m.period_end,
        retrieved_at: m.created_at,
      })),
    );
    const reach = totals.find((t) => t.metric_key === "reach")?.value ?? null;
    const engagements = totals.find((t) => t.metric_key === "engagements")?.value ?? null;
    const engagementRate =
      reach != null && engagements != null ? computeEngagementRate(engagements, reach) : null;

    const brandName = new Map<string, string>(brandsRes.data.map((b) => [b.id, b.name]));
    const byBrandMap = new Map<string, { reach: number; engagements: number }>();
    for (const m of containedRows) {
      const cur = byBrandMap.get(m.brand_id) ?? { reach: 0, engagements: 0 };
      if (m.metric_key === "reach") cur.reach += Number(m.value);
      if (m.metric_key === "engagements") cur.engagements += Number(m.value);
      byBrandMap.set(m.brand_id, cur);
    }
    const byBrand = [...byBrandMap.entries()]
      .map(([brandId, v]) => ({
        brandId,
        brandName: brandName.get(brandId) ?? "(brand tidak dikenal)",
        reach: v.reach,
        engagements: v.engagements,
        engagementRate: computeEngagementRate(v.engagements, v.reach),
      }))
      .sort((a, b) => b.reach - a.reach);

    const jobs =
      adherencePlacementIds !== null && adherencePlacementIds.length === 0
        ? []
        : ((jobsRes.data ?? []) as Array<{
            placement_id: string;
            scheduled_at: string | null;
            status: string;
          }>);
    let posts: Array<{ placement_id: string; published_at: string }> = [];
    const placementIds = [...new Set(jobs.map((j) => j.placement_id))];
    if (placementIds.length > 0) {
      const postsRes = await supabase
        .from("published_posts")
        .select("placement_id, published_at")
        .in("placement_id", placementIds);
      if (postsRes.error) throw postsRes.error;
      posts = (postsRes.data ?? []) as Array<{ placement_id: string; published_at: string }>;
    }
    const publishingAdherence = computePublishingAdherence(jobs, posts);

    const placementsWithMetrics = new Set(
      containedRows
        .filter((m) => m.subject_type === "placement")
        .map((m) => m.subject_id),
    ).size;
    const totalPlacements = placementsCountRes.count ?? 0;
    const lastSnapshot = allSnapshots[0] ?? null;

    return {
      status: analyticsDataStatus(allSnapshots.length, placementsWithMetrics, totalPlacements),
      periodStart: range.from,
      periodEnd: range.to,
      snapshotCount: allSnapshots.length,
      lastRetrievedAt: lastSnapshot?.retrieved_at ?? null,
      lastSourceReference: lastSnapshot?.raw_payload_reference ?? null,
      totals,
      engagementRate,
      publishingAdherence,
      byBrand,
      placementCoverage: { withMetrics: placementsWithMetrics, total: totalPlacements },
      partialPeriodRows,
    };
  });
}

/** Nama campaign workspace (id + nama) — label laporan campaign. */
export async function listCampaignNames(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryOutcome<Array<{ id: string; name: string }>>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; name: string }>;
  });
}

/** Volume publishing: jumlah job per status dalam periode (laporan 5). */
/**
 * Placement milik sebuah brand (placement -> content_item -> brand).
 * Dipakai filter brand untuk volume publishing dan adherence (F-5, Batch 6):
 * publishing_jobs hanya menyimpan placement_id.
 */
async function listPlacementIdsForBrand(
  supabase: SupabaseClient,
  workspaceId: string,
  brandId: string,
): Promise<string[]> {
  const itemsRes = await supabase
    .from("content_items")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("brand_id", brandId)
    .limit(1000);
  if (itemsRes.error) throw itemsRes.error;
  const itemIds = (itemsRes.data ?? []).map((row) => row.id);
  if (itemIds.length === 0) return [];
  const placementsRes = await supabase
    .from("content_placements")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("content_item_id", itemIds)
    .limit(1000);
  if (placementsRes.error) throw placementsRes.error;
  return (placementsRes.data ?? []).map((row) => row.id);
}

export async function getPublishingVolume(
  supabase: SupabaseClient,
  workspaceId: string,
  range: { from: string; to: string; brandId?: string | null },
): Promise<QueryOutcome<{ total: number; byStatus: Record<string, number> }>> {
  return wrap(async () => {
    // F-5 (Batch 6): volume mengikuti filter brand lewat placement brand tersebut.
    const placementIds = range.brandId
      ? await listPlacementIdsForBrand(supabase, workspaceId, range.brandId)
      : null;
    if (placementIds !== null && placementIds.length === 0) {
      return { total: 0, byStatus: {} };
    }
    let q = supabase
      .from("publishing_jobs")
      .select("status")
      .eq("workspace_id", workspaceId)
      .gte("scheduled_at", `${range.from}T00:00:00Z`)
      .lt("scheduled_at", `${nextDay(range.to)}T00:00:00Z`)
      .limit(1000);
    if (placementIds !== null) {
      q = q.in("placement_id", placementIds);
    }
    const { data, error } = await q;
    if (error) throw error;
    const byStatus: Record<string, number> = {};
    for (const j of (data ?? []) as Array<{ status: string }>) {
      byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
    }
    return { total: (data ?? []).length, byStatus };
  });
}

/** Performa konten: per subject (latest-wins), urutan reach tertinggi, maks 50. */
export async function getContentPerformance(
  supabase: SupabaseClient,
  workspaceId: string,
  range: { from: string; to: string; brandId?: string | null },
): Promise<QueryOutcome<ContentPerformanceRow[]>> {
  return wrap(async () => {
    const [metricsRes, brandsRes] = await Promise.all([
      listContentMetrics(supabase, workspaceId, range),
      listBrandsForWorkspace(supabase, workspaceId),
    ]);
    if (!metricsRes.ok) throw new Error("metrics unavailable");
    if (!brandsRes.ok) throw new Error("brands unavailable");
    const metrics = metricsRes.data;
    const brandName = new Map<string, string>(brandsRes.data.map((b) => [b.id, b.name]));

    const latest = new Map<string, ContentMetric>();
    for (const m of metrics) {
      const k = `${m.subject_type}|${m.subject_id}|${m.metric_key}|${m.period_start}|${m.period_end}`;
      const prev = latest.get(k);
      if (!prev || m.created_at >= prev.created_at) latest.set(k, m);
    }
    const bySubject = new Map<
      string,
      {
        subjectType: ContentPerformanceRow["subjectType"];
        subjectId: string;
        brandId: string;
        reach: number;
        impressions: number;
        engagements: number;
        sourceReference: string | null;
      }
    >();
    for (const m of latest.values()) {
      const k = `${m.subject_type}|${m.subject_id}`;
      const cur = bySubject.get(k) ?? {
        subjectType: m.subject_type,
        subjectId: m.subject_id,
        brandId: m.brand_id,
        reach: 0,
        impressions: 0,
        engagements: 0,
        sourceReference: null,
      };
      if (m.metric_key === "reach") cur.reach += Number(m.value);
      if (m.metric_key === "impressions") cur.impressions += Number(m.value);
      if (m.metric_key === "engagements") cur.engagements += Number(m.value);
      bySubject.set(k, cur);
    }
    const subjects = [...bySubject.values()].sort((a, b) => b.reach - a.reach).slice(0, 50);
    const placementIds = subjects.filter((s) => s.subjectType === "placement").map((s) => s.subjectId);
    const itemIds = subjects.filter((s) => s.subjectType === "content_item").map((s) => s.subjectId);
    const postIds = subjects.filter((s) => s.subjectType === "published_post").map((s) => s.subjectId);
    const labels = new Map<string, { label: string; channelPlatform: string | null; channelAccount: string | null }>();
    if (placementIds.length > 0) {
      const { data, error } = await supabase
        .from("content_placements")
        .select("id, platform_format, content_items(title), social_channels(platform, account_name)")
        .in("id", placementIds);
      if (error) throw error;
      for (const p of (data ?? []) as unknown as Array<{
        id: string;
        platform_format: string | null;
        content_items: { title: string | null } | null;
        social_channels: { platform: string | null; account_name: string | null } | null;
      }>) {
        labels.set(p.id, {
          label: `${p.content_items?.title ?? "(tanpa judul)"} — ${p.platform_format ?? "placement"}`,
          channelPlatform: p.social_channels?.platform ?? null,
          channelAccount: p.social_channels?.account_name ?? null,
        });
      }
    }
    if (itemIds.length > 0) {
      const { data, error } = await supabase
        .from("content_items")
        .select("id, title")
        .in("id", itemIds);
      if (error) throw error;
      for (const it of (data ?? []) as Array<{ id: string; title: string | null }>) {
        labels.set(it.id, { label: it.title ?? "(tanpa judul)", channelPlatform: null, channelAccount: null });
      }
    }
    if (postIds.length > 0) {
      const { data, error } = await supabase
        .from("published_posts")
        .select("id, canonical_url, content_placements(content_items(title), social_channels(platform, account_name))")
        .in("id", postIds);
      if (error) throw error;
      for (const pp of (data ?? []) as unknown as Array<{
        id: string;
        canonical_url: string;
        content_placements: {
          content_items: { title: string | null } | null;
          social_channels: { platform: string | null; account_name: string | null } | null;
        } | null;
      }>) {
        labels.set(pp.id, {
          label: `${pp.content_placements?.content_items?.title ?? "(tanpa judul)"} — ${pp.canonical_url}`,
          channelPlatform: pp.content_placements?.social_channels?.platform ?? null,
          channelAccount: pp.content_placements?.social_channels?.account_name ?? null,
        });
      }
    }
    return subjects.map((s) => {
      const lab = labels.get(s.subjectId);
      return {
        subjectType: s.subjectType,
        subjectId: s.subjectId,
        subjectLabel: lab?.label ?? s.subjectId,
        brandName: brandName.get(s.brandId) ?? null,
        channelPlatform: lab?.channelPlatform ?? null,
        channelAccount: lab?.channelAccount ?? null,
        reach: s.reach,
        impressions: s.impressions,
        engagements: s.engagements,
        engagementRate: computeEngagementRate(s.engagements, s.reach),
        sourceReference: s.sourceReference,
      };
    });
  });
}
