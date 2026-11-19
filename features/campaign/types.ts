/**
 * Tipe domain Campaign & Visual Planning — features/campaign/types.ts (P5-03).
 * Campaign dasar sendiri tinggal di features/planning/types.ts (P2-07);
 * di sini hanya yang ditambahkan Phase 5.
 */
import type { Campaign } from "@/features/planning/types";
import type { CampaignTargetMetrics } from "@/lib/validation/schemas";

export type { Campaign, CampaignTargetMetrics };

export type CampaignProgress = {
  total: number;
  ready: number;
  inProduction: number;
  waitingApproval: number;
  notStarted: number;
  exception: number;
  archived: number;
  readyPercent: number;
};

export type CampaignDeliverablePlacement = {
  id: string;
  social_channel_id: string;
  channel_platform: string | null;
  channel_account: string | null;
  platform_format: string | null;
  scheduled_at: string | null;
  distribution_status: string;
};

export type CampaignDeliverable = {
  id: string;
  title: string;
  brand_id: string;
  brand_name: string | null;
  production_status: string;
  owner_user_id: string;
  due_at: string | null;
  placements: CampaignDeliverablePlacement[];
};

export type VisualOrderRow = {
  id: string;
  placement_id: string;
  position: number;
};

export type PlannerPlacement = {
  id: string;
  content_item_id: string;
  content_title: string;
  content_status: string;
  brand_id: string;
  social_channel_id: string;
  channel_platform: string | null;
  channel_account: string | null;
  platform_format: string | null;
  scheduled_at: string | null;
  distribution_status: string;
  /** Posisi visual (null = belum masuk urutan). */
  position: number | null;
};

export type CampaignTemplate = {
  id: string;
  workspace_id: string;
  name: string;
  source_campaign_id: string | null;
  objective: string | null;
  audience_id: string | null;
  target_metrics: CampaignTargetMetrics;
  created_by: string | null;
  created_at: string;
  brand_ids: string[];
};

export type ContentTemplate = {
  id: string;
  workspace_id: string;
  name: string;
  source_content_item_id: string | null;
  title: string;
  brand_id: string;
  brand_name: string | null;
  pillar_id: string | null;
  script: string | null;
  caption: string | null;
  created_by: string | null;
  created_at: string;
  placement_channels: Array<{ channel_id: string; format: string | null }>;
};

export type CsvImportReport = {
  total: number;
  imported: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
  linkedDeliverables: number;
  skippedDeliverables: Array<{ row: number; title: string; reason: string }>;
};
