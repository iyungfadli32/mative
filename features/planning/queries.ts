/**
 * Query baca Planning Core — features/planning/queries.ts
 * Semua query lewat Supabase client sesi (RLS menegakkan tenant + role).
 * Bila tabel belum ada (0007 belum diterapkan), kembalikan
 * { unavailable: true } — halaman menampilkan pesan jujur, BUKAN crash.
 * TIDAK ADA query yang menulis; TIDAK ADA service-role di sini.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningFilters } from "./search";
import { applyContentFilters, matchesContentSearch } from "./search";
import type {
  Audience,
  Brand,
  Campaign,
  ContentItemWithRelations,
  ContentPlacement,
  ContentStatusEvent,
  ContentVersion,
  Idea,
  ContentPillar,
  QueryResult,
  SocialChannel,
  Tag,
} from "./types";
import { buildKpis } from "@/features/dashboard/kpis";
import type { DashboardKpis } from "@/features/dashboard/kpis";

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /Could not find the table|does not exist|relation .* does not exist/i.test(error.message ?? "")
  );
}

async function runQuery<T>(
  query: PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>,
  empty: T,
): Promise<QueryResult<T>> {
  try {
    const { data, error } = await query;
    if (error) {
      return {
        data: empty,
        error: "Query gagal.",
        unavailable: isMissingTable(error),
      };
    }
    return { data: data ?? empty, error: null, unavailable: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Query gagal.";
    return {
      data: empty,
      error: message,
      unavailable: /does not exist|Could not find/i.test(message),
    };
  }
}

export async function listBrands(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryResult<Brand[]>> {
  return runQuery<Brand[]>(
    supabase
      .from("brands")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true }),
    [],
  );
}

export async function listChannels(
  supabase: SupabaseClient,
  brandIds: string[],
): Promise<QueryResult<SocialChannel[]>> {
  if (brandIds.length === 0) return { data: [], error: null, unavailable: false };
  return runQuery<SocialChannel[]>(
    supabase
      .from("social_channels")
      .select("*")
      .in("brand_id", brandIds)
      .order("platform", { ascending: true }),
    [],
  );
}

export async function listPillars(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryResult<ContentPillar[]>> {
  return runQuery<ContentPillar[]>(
    supabase
      .from("content_pillars")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true }),
    [],
  );
}

export async function listAudiences(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryResult<Audience[]>> {
  return runQuery<Audience[]>(
    supabase
      .from("audiences")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true }),
    [],
  );
}

export async function listCampaigns(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryResult<Campaign[]>> {
  return runQuery<Campaign[]>(
    supabase
      .from("campaigns")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    [],
  );
}

export async function listCampaignBrands(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<QueryResult<Array<{ campaign_id: string; brand_id: string }>>> {
  return runQuery(
    supabase.from("campaign_brands").select("campaign_id, brand_id").eq("campaign_id", campaignId),
    [],
  );
}

export async function listIdeas(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryResult<Idea[]>> {
  return runQuery<Idea[]>(
    supabase
      .from("ideas")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    [],
  );
}

const CONTENT_SELECT =
  "*, brand:brands(id, name), campaign:campaigns(id, name), pillar:content_pillars(id, name), placements:content_placements(*, channel:social_channels(id, platform, account_name))";

export async function listContentItems(
  supabase: SupabaseClient,
  filters: PlanningFilters,
): Promise<QueryResult<ContentItemWithRelations[]>> {
  // Batch 4 (T-5): total baris workspace (di luar filter memori) agar halaman
  // bisa memperingatkan bila pengambilan 200 baris terpotong; (T-6) abaikan
  // konten yang sudah di-soft-delete.
  let total = 0;
  try {
    const { count } = await supabase
      .from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", filters.workspaceId)
      .is("deleted_at", null)
      .is("deleted_at", null);
    total = count ?? 0;
  } catch {
    total = 0;
  }
  const result = await runQuery<ContentItemWithRelations[]>(
    supabase
      .from("content_items")
      .select(CONTENT_SELECT)
      .eq("workspace_id", filters.workspaceId)
      .order("created_at", { ascending: false })
      .limit(200),
    [],
  );
  const truncated = result.data.length >= 200 && total > result.data.length;
  if (result.error || result.data.length === 0) return { ...result, total, truncated: false };
  const channelPlatforms: Record<string, string> = {};
  for (const item of result.data) {
    for (const p of item.placements ?? []) {
      if (p.channel) channelPlatforms[p.social_channel_id] = p.channel.platform;
    }
  }
  const filtered = applyContentFilters(
    result.data.map((item) => ({
      ...item,
      placements: (item.placements ?? []).map((p) => ({
        social_channel_id: p.social_channel_id,
        platform_format: p.platform_format,
        distribution_status: p.distribution_status,
      })),
      channelPlatforms,
    })),
    filters,
  ).map((item) => result.data.find((r) => r.id === item.id) as ContentItemWithRelations);
  const searched = filters.q
    ? filtered.filter((item) => matchesContentSearch(item, filters.q))
    : filtered;
  return { data: searched, error: null, unavailable: false, total, truncated };
}

export async function getContentItemDetail(
  supabase: SupabaseClient,
  contentItemId: string,
): Promise<{
  item: QueryResult<ContentItemWithRelations | null>;
  versions: QueryResult<ContentVersion[]>;
  events: QueryResult<ContentStatusEvent[]>;
  tags: QueryResult<Tag[]>;
}> {
  const item = await runQuery<ContentItemWithRelations | null>(
    supabase
      .from("content_items")
      .select(CONTENT_SELECT)
      .eq("id", contentItemId)
      .is("deleted_at", null)
      .single(),
    null,
  );
  const versions = await runQuery<ContentVersion[]>(
    supabase
      .from("content_versions")
      .select("*")
      .eq("content_item_id", contentItemId)
      .order("version_number", { ascending: false }),
    [],
  );
  const events = await runQuery<ContentStatusEvent[]>(
    supabase
      .from("content_status_events")
      .select("*")
      .eq("content_item_id", contentItemId)
      .order("occurred_at", { ascending: false })
      .limit(100),
    [],
  );
  const tags = await runQuery<Tag[]>(
    supabase
      .from("content_tags")
      .select("tag:tags(*)")
      .eq("content_item_id", contentItemId)
      .then((res) => ({
        data: ((res.data ?? []) as unknown as Array<{ tag: Tag }>)
          .map((row) => row.tag)
          .filter(Boolean),
        error: res.error,
      })),
    [],
  );
  return { item, versions, events, tags };
}

export async function listPlacementsForCalendar(
  supabase: SupabaseClient,
  filters: PlanningFilters,
): Promise<QueryResult<ContentPlacement[]>> {
  // Kalender membaca record kanonis yang sama (content_items + placements) —
  // TIDAK ADA tabel kalender terpisah (R2-01).
  const items = await listContentItems(supabase, filters);
  if (items.error) return { data: [], error: items.error, unavailable: items.unavailable };
  const placements = items.data.flatMap((item) => item.placements ?? []);
  return { data: placements, error: null, unavailable: false };
}

export type SearchHit = {
  kind: "content" | "campaign" | "idea" | "brand";
  id: string;
  title: string;
  detail: string;
  href: string;
};

/** Pencarian global ter-scope tenant (P2-13): 4 sumber, semua dibatasi workspace. */
export async function searchPlanning(
  supabase: SupabaseClient,
  workspaceId: string,
  query: string,
): Promise<QueryResult<SearchHit[]>> {
  const q = query.trim();
  if (!q) return { data: [], error: null, unavailable: false };
  const pattern = `%${q.replace(/[%_]/g, "")}%`;
  const hits: SearchHit[] = [];
  const [contents, campaigns, ideas, brands] = await Promise.all([
    runQuery<Array<{ id: string; title: string; production_status: string }>>(
      supabase
        .from("content_items")
        .select("id, title, production_status")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .ilike("title", pattern)
        .limit(10),
      [],
    ),
    runQuery<Array<{ id: string; name: string; status: string }>>(
      supabase
        .from("campaigns")
        .select("id, name, status")
        .eq("workspace_id", workspaceId)
        .ilike("name", pattern)
        .limit(10),
      [],
    ),
    runQuery<Array<{ id: string; title: string; status: string | null }>>(
      supabase
        .from("ideas")
        .select("id, title, status")
        .eq("workspace_id", workspaceId)
        .ilike("title", pattern)
        .limit(10),
      [],
    ),
    runQuery<Array<{ id: string; name: string; status: string }>>(
      supabase
        .from("brands")
        .select("id, name, status")
        .eq("workspace_id", workspaceId)
        .ilike("name", pattern)
        .limit(10),
      [],
    ),
  ]);
  if (contents.unavailable || campaigns.unavailable || ideas.unavailable || brands.unavailable) {
    return { data: [], error: null, unavailable: true };
  }
  for (const c of contents.data)
    hits.push({
      kind: "content",
      id: c.id,
      title: c.title,
      detail: `Konten · ${c.production_status}`,
      href: `/konten/${c.id}?workspace=${workspaceId}`,
    });
  for (const c of campaigns.data)
    hits.push({
      kind: "campaign",
      id: c.id,
      title: c.name,
      detail: `Campaign · ${c.status}`,
      href: `/kampanye?workspace=${workspaceId}`,
    });
  for (const i of ideas.data)
    hits.push({
      kind: "idea",
      id: i.id,
      title: i.title,
      detail: `Ide · ${i.status ?? "-"}`,
      href: `/ide?workspace=${workspaceId}`,
    });
  for (const b of brands.data)
    hits.push({
      kind: "brand",
      id: b.id,
      title: b.name,
      detail: `Brand · ${b.status}`,
      href: `/merek?workspace=${workspaceId}`,
    });
  return { data: hits, error: null, unavailable: false };
}

/** Anggota workspace + nama tampilan (untuk filter owner/assignee). */
export async function listWorkspaceMembers(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Array<{ userId: string; role: string; displayName: string }>> {
  try {
    const { data, error } = await supabase
      .from("workspace_members")
      .select("user_id, workspace_role")
      .eq("workspace_id", workspaceId)
      .eq("membership_status", "active");
    if (error || !data) return [];
    const ids = (data as Array<{ user_id: string }>).map((r) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", ids);
    const names = new Map(
      ((profiles ?? []) as Array<{ id: string; display_name: string | null }>).map((p) => [
        p.id,
        p.display_name ?? p.id,
      ]),
    );
    return (data as Array<{ user_id: string; workspace_role: string }>).map((r) => ({
      userId: r.user_id,
      role: r.workspace_role,
      displayName: names.get(r.user_id) ?? r.user_id,
    }));
  } catch {
    return [];
  }
}

/** KPI dashboard dari record nyata (Phase 2: content + placement nyata). */
export async function getDashboardKpis(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<DashboardKpis> {
  try {
    const [items, placements] = await Promise.all([
      supabase.from("content_items").select("production_status").eq("workspace_id", workspaceId),
      supabase
        .from("content_placements")
        .select("distribution_status, content_items!inner(workspace_id)")
        .eq("content_items.workspace_id", workspaceId),
    ]);
    if (items.error || placements.error) return buildKpis({});
    const rows = (items.data ?? []) as Array<{ production_status: string }>;
    const prows = (placements.data ?? []) as Array<{ distribution_status: string }>;
    return buildKpis({
      planned: rows.filter((r) => ["idea", "brief", "scripting"].includes(r.production_status))
        .length,
      inProduction: rows.filter((r) =>
        ["ready_for_production", "in_production", "editing", "internal_review"].includes(
          r.production_status,
        ),
      ).length,
      awaitingApproval: rows.filter((r) => r.production_status === "internal_review").length,
      scheduled: prows.filter((r) => r.distribution_status === "scheduled_locally").length,
      published: prows.filter((r) => r.distribution_status === "published").length,
    });
  } catch {
    return buildKpis({});
  }
}
