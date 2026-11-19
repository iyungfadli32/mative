/**
 * Tipe domain Publishing Foundation — features/publishing/types.ts (P6-03).
 * Kolom mengikuti migrasi 0020 (Dok 05 §3 + ADR-0012).
 */
import type { PublishingAttemptResult, PublishingJobStatus } from "./constants";

export type { PublishingAttemptResult, PublishingJobStatus };

export type PublishingJob = {
  id: string;
  workspace_id: string;
  placement_id: string;
  placement_version_id: string | null;
  scheduled_at: string | null;
  timezone: string;
  status: PublishingJobStatus;
  idempotency_key: string;
  provider_job_id: string | null;
  next_attempt_at: string | null;
  attempt_count: number;
  lease_owner: string | null;
  lease_until: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PublishingAttempt = {
  id: string;
  publishing_job_id: string;
  attempt_number: number;
  result_status: PublishingAttemptResult;
  provider_response_safe: string | null;
  error_code: string | null;
  error_message_safe: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

export type PublishedPost = {
  id: string;
  workspace_id: string;
  placement_id: string;
  provider_post_id: string | null;
  canonical_url: string;
  published_at: string;
  confirmation_source: string;
  raw_metadata_reference: string | null;
  created_by: string | null;
  created_at: string;
};

/** Satu baris checklist preflight (dari RPC publishing_preflight). */
export type PreflightCheck = {
  key: string;
  severity: "block" | "warn";
  passed: boolean;
  message: string;
};

export type PreflightResult = {
  ok: boolean;
  code: string;
  message: string;
  checks: PreflightCheck[];
};

/** Job + konteks tampilannya (placement, konten, channel). */
export type PublishingJobRow = PublishingJob & {
  placement: {
    id: string;
    platform_format: string | null;
    platform_caption: string | null;
    scheduled_at: string | null;
    timezone: string;
    distribution_status: string;
    content_title: string | null;
    content_item_id: string;
    channel_platform: string | null;
    channel_account: string | null;
  } | null;
  attempts: PublishingAttempt[];
  published_post: PublishedPost | null;
};

export type PublishingActionResult = {
  ok: boolean;
  message: string;
  jobId?: string;
  status?: string;
  processed?: number;
  /** Kode RPC 0020 (FORBIDDEN, DUPLICATE_JOB, …) — dipakai pemetaan status HTTP API. */
  code?: string;
};
