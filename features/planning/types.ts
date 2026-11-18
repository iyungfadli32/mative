/**
 * Tipe baris Planning Core — features/planning/types.ts
 * Cermin kolom migrasi 0007 (Dok 05 §3). JSONB dibaca sebagai record
 * generik; bentuk yang dikenal didokumentasikan di ADR-0007 §5 + ADR-0008.
 */

export type Brand = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_asset_id: string | null;
  status: string;
  brand_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SocialChannel = {
  id: string;
  brand_id: string;
  platform: string;
  account_name: string | null;
  handle: string | null;
  provider_account_id: string | null;
  connection_status: string;
  capability_snapshot: Record<string, unknown>;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type ContentPillar = {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  name: string;
  description: string | null;
  color_token: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Audience = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  attributes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Campaign = {
  id: string;
  workspace_id: string;
  name: string;
  objective: string | null;
  audience_id: string | null;
  start_at: string | null;
  end_at: string | null;
  status: string;
  owner_user_id: string | null;
  target_metrics: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Idea = {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  title: string;
  source_type: string | null;
  notes: string | null;
  tags: string[];
  status: string | null;
  owner_user_id: string | null;
  converted_content_item_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentItem = {
  id: string;
  workspace_id: string;
  brand_id: string;
  campaign_id: string | null;
  pillar_id: string | null;
  title: string;
  internal_description: string | null;
  objective: string | null;
  audience_id: string | null;
  funnel_stage: string | null;
  production_status: string;
  priority: string | null;
  owner_user_id: string;
  due_at: string | null;
  timezone: string;
  origin_idea_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentPlacement = {
  id: string;
  content_item_id: string;
  social_channel_id: string;
  platform_format: string | null;
  platform_caption: string | null;
  platform_hashtags: string[];
  scheduled_at: string | null;
  timezone: string;
  distribution_status: string;
  platform_metadata: Record<string, unknown>;
  /** SELALU null di Phase 2 (CHECK 0007) — belum ada publishing. */
  remote_post_id: string | null;
  /** SELALU null di Phase 2 (CHECK 0007) — belum ada publishing. */
  published_url: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentVersion = {
  id: string;
  content_item_id: string;
  version_number: number;
  brief_snapshot: Record<string, unknown>;
  script: string | null;
  caption: string | null;
  cta: string | null;
  creative_notes: string | null;
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
};

export type PlacementVersion = {
  id: string;
  placement_id: string;
  version_number: number;
  payload_snapshot: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export type ContentStatusEvent = {
  id: string;
  content_item_id: string;
  from_status: string | null;
  to_status: string;
  actor_user_id: string | null;
  reason: string | null;
  occurred_at: string;
  created_at: string;
};

export type Tag = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  color_token: string | null;
  created_at: string;
  updated_at: string;
};

/** Content item + relasi yang dibutuhkan kalender/board/detail (satu query). */
export type ContentItemWithRelations = ContentItem & {
  brand?: { id: string; name: string } | null;
  campaign?: { id: string; name: string } | null;
  pillar?: { id: string; name: string } | null;
  placements: Array<
    ContentPlacement & {
      channel?: { id: string; platform: string; account_name: string | null } | null;
    }
  >;
};

/** Hasil query yang tabelnya mungkin belum ada (0007/0008 belum diterapkan). */
export type QueryResult<T> = {
  data: T;
  /** Pesan error Supabase (null bila sukses). */
  error: string | null;
  /** true bila tabel/fungsi belum ada di database live (migrasi belum diterapkan). */
  unavailable: boolean;
};

/** Peran pemanggil di satu workspace (dibaca dari workspace_members). */
export type WorkspaceMembership = {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  timezone: string;
  role: string;
};
