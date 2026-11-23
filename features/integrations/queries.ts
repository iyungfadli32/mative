/**
 * Query Integrasi — features/integrations/queries.ts (P7-03).
 * Capability registry = social_channels (0007) + kolom 0021
 * (connection_status diperluas 'disabled', capability_snapshot,
 * capability_checked_at). RLS penegak baca — tidak ada service-role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelCapability } from "@/features/analytics/types";
import { INTEGRATIONS_TABLES_UNAVAILABLE_ID } from "./constants";

export { INTEGRATIONS_TABLES_UNAVAILABLE_ID };

import { wrapQueryOutcome as wrap, type QueryOutcome } from "@/lib/query";

/** Channel workspace + capability snapshot-nya (RLS menyaring scope). */
export async function listChannelsWithCapabilities(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryOutcome<ChannelCapability[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("social_channels")
      .select(
        "id, brand_id, platform, account_name, connection_status, capability_snapshot, capability_checked_at, brands!inner(workspace_id, name)",
      )
      .eq("brands.workspace_id", workspaceId)
      .order("platform", { ascending: true })
      .order("account_name", { ascending: true });
    if (error) throw error;
    return (
      (data ?? []) as unknown as Array<{
        id: string;
        brand_id: string;
        platform: string;
        account_name: string | null;
        connection_status: string;
        capability_snapshot: Record<string, unknown> | null;
        capability_checked_at: string | null;
        brands: { name: string | null };
      }>
    ).map((c) => ({
      id: c.id,
      brand_id: c.brand_id,
      brand_name: c.brands?.name ?? null,
      platform: c.platform,
      account_name: c.account_name,
      connection_status: c.connection_status as ChannelCapability["connection_status"],
      capability_snapshot: c.capability_snapshot,
      capability_checked_at: c.capability_checked_at,
    }));
  });
}
