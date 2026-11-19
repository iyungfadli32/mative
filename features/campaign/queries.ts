/**
 * Query Campaign & Visual Planning — features/campaign/queries.ts (P5-03).
 * Pola approval/queries.ts: `runQuery` di sini menggulung kegagalan ke
 * `unavailable` (Phase 9: tampilkan galat query, bukan daftar kosong).
 * BUKAN `null`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTargetMetricsLenient } from "@/lib/validation/schemas";
import type { Campaign } from "@/features/planning/types";
import type {
  CampaignDeliverable,
  CampaignTemplate,
  ContentTemplate,
  PlannerPlacement,
  VisualOrderRow,
} from "./types";

export type QueryOutcome<T> = { ok: true; data: T } | { ok: false; unavailable: true };

function wrap<T>(fn: () => Promise<T>): Promise<QueryOutcome<T>> {
  return fn()
    .then((data) => ({ ok: true as const, data }))
    .catch(() => ({ ok: false as const, unavailable: true as const }));
}

export async function getCampaign(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<QueryOutcome<Campaign | null>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("campaigns")
      .select(
        "id, workspace_id, name, objective, audience_id, start_at, end_at, status, owner_user_id, target_metrics, created_at, updated_at",
      )
      .eq("id", campaignId)
      .single();
    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }
    return data as Campaign;
  });
}

export async function listCampaignBrands(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<QueryOutcome<Array<{ id: string; name: string }>>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("campaign_brands")
      .select("brands(id, name)")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: (row.brands as unknown as { id: string; name: string }).id,
      name: (row.brands as unknown as { id: string; name: string }).name,
    }));
  });
}

export async function listCampaignDeliverables(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<QueryOutcome<CampaignDeliverable[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("content_items")
      .select(
        "id, title, brand_id, production_status, owner_user_id, due_at, brands(name), content_placements(id, social_channel_id, platform_format, scheduled_at, distribution_status, social_channels(platform, account_name))",
      )
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((item) => {
      const raw = item as unknown as {
        id: string;
        title: string;
        brand_id: string;
        production_status: string;
        owner_user_id: string;
        due_at: string | null;
        brands: { name: string } | null;
        content_placements: Array<{
          id: string;
          social_channel_id: string;
          platform_format: string | null;
          scheduled_at: string | null;
          distribution_status: string;
          social_channels: { platform: string; account_name: string } | null;
        }>;
      };
      return {
        id: raw.id,
        title: raw.title,
        brand_id: raw.brand_id,
        brand_name: raw.brands?.name ?? null,
        production_status: raw.production_status,
        owner_user_id: raw.owner_user_id,
        due_at: raw.due_at,
        placements: (raw.content_placements ?? []).map((p) => ({
          id: p.id,
          social_channel_id: p.social_channel_id,
          channel_platform: p.social_channels?.platform ?? null,
          channel_account: p.social_channels?.account_name ?? null,
          platform_format: p.platform_format,
          scheduled_at: p.scheduled_at,
          distribution_status: p.distribution_status,
        })),
      };
    });
  });
}

export async function listVisualOrder(
  supabase: SupabaseClient,
  workspaceId: string,
  brandId: string,
  channelId: string,
): Promise<QueryOutcome<VisualOrderRow[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("visual_orders")
      .select("id, placement_id, position")
      .eq("workspace_id", workspaceId)
      .eq("brand_id", brandId)
      .eq("social_channel_id", channelId)
      .order("position", { ascending: true });
    if (error) throw error;
    return (data ?? []) as VisualOrderRow[];
  });
}

/**
 * Placement untuk visual planner: semua placement aktif di (brand, channel)
 * + posisinya bila sudah masuk urutan. scheduled_at DITAMPILKAN tapi TIDAK
 * PERNAH diubah planner (R5.1 — pemisahan visual vs jadwal).
 */
export async function listPlannerPlacements(
  supabase: SupabaseClient,
  workspaceId: string,
  brandId: string,
  channelId: string,
): Promise<QueryOutcome<PlannerPlacement[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("content_placements")
      .select(
        "id, content_item_id, social_channel_id, platform_format, scheduled_at, distribution_status, social_channels(platform, account_name), content_items!inner(title, production_status, brand_id, workspace_id)",
      )
      .eq("social_channel_id", channelId)
      .eq("content_items.brand_id", brandId)
      .eq("content_items.workspace_id", workspaceId)
      .order("scheduled_at", { ascending: true, nullsFirst: false });
    if (error) throw error;
    const orders = await listVisualOrder(supabase, workspaceId, brandId, channelId);
    const positionByPlacement = new Map<string, number>();
    if (orders.ok) {
      for (const o of orders.data) positionByPlacement.set(o.placement_id, o.position);
    }
    return (data ?? []).map((row) => {
      const raw = row as unknown as {
        id: string;
        content_item_id: string;
        social_channel_id: string;
        platform_format: string | null;
        scheduled_at: string | null;
        distribution_status: string;
        social_channels: { platform: string; account_name: string } | null;
        content_items: { title: string; production_status: string; brand_id: string };
      };
      return {
        id: raw.id,
        content_item_id: raw.content_item_id,
        content_title: raw.content_items.title,
        content_status: raw.content_items.production_status,
        brand_id: raw.content_items.brand_id,
        social_channel_id: raw.social_channel_id,
        channel_platform: raw.social_channels?.platform ?? null,
        channel_account: raw.social_channels?.account_name ?? null,
        platform_format: raw.platform_format,
        scheduled_at: raw.scheduled_at,
        distribution_status: raw.distribution_status,
        position: positionByPlacement.get(raw.id) ?? null,
      };
    });
  });
}

export async function listCampaignTemplates(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryOutcome<CampaignTemplate[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("campaign_templates")
      .select("id, workspace_id, name, source_campaign_id, objective, audience_id, target_metrics, created_by, created_at, campaign_template_brands(brand_id)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => {
      const raw = row as unknown as {
        id: string;
        workspace_id: string;
        name: string;
        source_campaign_id: string | null;
        objective: string | null;
        audience_id: string | null;
        target_metrics: unknown;
        created_by: string | null;
        created_at: string;
        campaign_template_brands: Array<{ brand_id: string }>;
      };
      return {
        id: raw.id,
        workspace_id: raw.workspace_id,
        name: raw.name,
        source_campaign_id: raw.source_campaign_id,
        objective: raw.objective,
        audience_id: raw.audience_id,
        target_metrics: parseTargetMetricsLenient(raw.target_metrics),
        created_by: raw.created_by,
        created_at: raw.created_at,
        brand_ids: raw.campaign_template_brands.map((b) => b.brand_id),
      };
    });
  });
}

export async function listContentTemplates(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryOutcome<ContentTemplate[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("content_templates")
      .select(
        "id, workspace_id, name, source_content_item_id, title, brand_id, pillar_id, script, caption, created_by, created_at, brands(name), content_template_placements(social_channel_id, format)",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => {
      const raw = row as unknown as {
        id: string;
        workspace_id: string;
        name: string;
        source_content_item_id: string | null;
        title: string;
        brand_id: string;
        pillar_id: string | null;
        script: string | null;
        caption: string | null;
        created_by: string | null;
        created_at: string;
        brands: { name: string } | null;
        content_template_placements: Array<{ social_channel_id: string; format: string | null }>;
      };
      return {
        id: raw.id,
        workspace_id: raw.workspace_id,
        name: raw.name,
        source_content_item_id: raw.source_content_item_id,
        title: raw.title,
        brand_id: raw.brand_id,
        brand_name: raw.brands?.name ?? null,
        pillar_id: raw.pillar_id,
        script: raw.script,
        caption: raw.caption,
        created_by: raw.created_by,
        created_at: raw.created_at,
        placement_channels: raw.content_template_placements.map((p) => ({
          channel_id: p.social_channel_id,
          format: p.format,
        })),
      };
    });
  });
}
