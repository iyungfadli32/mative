/**
 * Query Publishing Foundation — features/publishing/queries.ts (P6-03).
 * Pola campaign/queries.ts: `runQuery` menggulung kegagalan ke `unavailable`
 * (Phase 9: tampilkan galat query, bukan daftar kosong). BUKAN `null`.
 * RLS adalah penegak baca (member / shared) — query di sini tidak pernah
 * mem-bypass RLS (tidak ada service-role client).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PreflightResult,
  PublishedPost,
  PublishingAttempt,
  PublishingJob,
  PublishingJobRow,
} from "./types";

export type QueryOutcome<T> = { ok: true; data: T } | { ok: false; unavailable: true };

function wrap<T>(fn: () => Promise<T>): Promise<QueryOutcome<T>> {
  return fn()
    .then((data) => ({ ok: true as const, data }))
    .catch(() => ({ ok: false as const, unavailable: true as const }));
}

const JOB_COLUMNS =
  "id, workspace_id, placement_id, placement_version_id, scheduled_at, timezone, status, idempotency_key, provider_job_id, next_attempt_at, attempt_count, lease_owner, lease_until, created_by, created_at, updated_at";

const ATTEMPT_COLUMNS =
  "id, publishing_job_id, attempt_number, result_status, provider_response_safe, error_code, error_message_safe, started_at, completed_at, created_at";

const POST_COLUMNS =
  "id, workspace_id, placement_id, provider_post_id, canonical_url, published_at, confirmation_source, raw_metadata_reference, created_by, created_at";

type PlacementContextRow = {
  id: string;
  platform_format: string | null;
  platform_caption: string | null;
  scheduled_at: string | null;
  timezone: string;
  distribution_status: string;
  content_item_id: string;
  content_items: { title: string | null } | null;
  social_channels: { platform: string | null; account_name: string | null } | null;
};

async function getPlacementContexts(
  supabase: SupabaseClient,
  placementIds: string[],
): Promise<Map<string, PlacementContextRow>> {
  const map = new Map<string, PlacementContextRow>();
  if (placementIds.length === 0) return map;
  const { data, error } = await supabase
    .from("content_placements")
    .select(
      "id, platform_format, platform_caption, scheduled_at, timezone, distribution_status, content_item_id, content_items(title), social_channels(platform, account_name)",
    )
    .in("id", placementIds);
  if (error) throw error;
  for (const row of (data ?? []) as unknown as PlacementContextRow[]) map.set(row.id, row);
  return map;
}

async function attachContexts(
  supabase: SupabaseClient,
  jobs: PublishingJob[],
): Promise<PublishingJobRow[]> {
  const jobIds = jobs.map((j) => j.id);
  const placementIds = [...new Set(jobs.map((j) => j.placement_id))];
  const [placements, attemptsRes, postsRes] = await Promise.all([
    getPlacementContexts(supabase, placementIds),
    jobIds.length === 0
      ? Promise.resolve({ data: [] as PublishingAttempt[], error: null })
      : supabase
          .from("publishing_attempts")
          .select(ATTEMPT_COLUMNS)
          .in("publishing_job_id", jobIds)
          .order("attempt_number", { ascending: false }),
    placementIds.length === 0
      ? Promise.resolve({ data: [] as PublishedPost[], error: null })
      : supabase.from("published_posts").select(POST_COLUMNS).in("placement_id", placementIds),
  ]);
  if (attemptsRes.error) throw attemptsRes.error;
  if (postsRes.error) throw postsRes.error;
  const attemptsByJob = new Map<string, PublishingAttempt[]>();
  for (const a of (attemptsRes.data ?? []) as PublishingAttempt[]) {
    const list = attemptsByJob.get(a.publishing_job_id) ?? [];
    list.push(a);
    attemptsByJob.set(a.publishing_job_id, list);
  }
  const postByPlacement = new Map<string, PublishedPost>();
  for (const p of (postsRes.data ?? []) as PublishedPost[]) postByPlacement.set(p.placement_id, p);
  return jobs.map((job) => {
    const pl = placements.get(job.placement_id) ?? null;
    return {
      ...job,
      placement: pl
        ? {
            id: pl.id,
            platform_format: pl.platform_format,
            platform_caption: pl.platform_caption,
            scheduled_at: pl.scheduled_at,
            timezone: pl.timezone,
            distribution_status: pl.distribution_status,
            content_title: pl.content_items?.title ?? null,
            content_item_id: pl.content_item_id,
            channel_platform: pl.social_channels?.platform ?? null,
            channel_account: pl.social_channels?.account_name ?? null,
          }
        : null,
      attempts: attemptsByJob.get(job.id) ?? [],
      published_post: postByPlacement.get(job.placement_id) ?? null,
    };
  });
}

/** Semua job satu workspace (terbaru dulu). Filter status dilakukan di pemanggil. */
export async function listPublishingJobs(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<QueryOutcome<PublishingJobRow[]>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("publishing_jobs")
      .select(JOB_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return attachContexts(supabase, (data ?? []) as PublishingJob[]);
  });
}

/** Satu job + attempts + bukti terbit (null bila tidak ada / tidak terlihat). */
export async function getPublishingJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<QueryOutcome<PublishingJobRow | null>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("publishing_jobs")
      .select(JOB_COLUMNS)
      .eq("id", jobId)
      .single();
    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }
    const rows = await attachContexts(supabase, [data as PublishingJob]);
    return rows[0] ?? null;
  });
}

/** Job aktif (belum terminal) untuk satu placement — terbaru dulu. */
export async function getActivePublishingJobForPlacement(
  supabase: SupabaseClient,
  placementId: string,
): Promise<QueryOutcome<PublishingJob | null>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("publishing_jobs")
      .select(JOB_COLUMNS)
      .eq("placement_id", placementId)
      .not("status", "in", '("published","cancelled")')
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }
    return data as PublishingJob;
  });
}

/** Bukti terbit untuk satu placement (null bila belum terbit). */
export async function getPublishedPostForPlacement(
  supabase: SupabaseClient,
  placementId: string,
): Promise<QueryOutcome<PublishedPost | null>> {
  return wrap(async () => {
    const { data, error } = await supabase
      .from("published_posts")
      .select(POST_COLUMNS)
      .eq("placement_id", placementId)
      .single();
    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }
    return data as PublishedPost;
  });
}

/** Preflight placement (RPC 0020) — dipakai checklist + validasi sebelum buat job. */
export async function runPreflight(
  supabase: SupabaseClient,
  placementId: string,
  scheduledAtUtcIso: string | null,
  timezone: string | null,
  excludeJobId?: string | null,
): Promise<QueryOutcome<PreflightResult | null>> {
  return wrap(async () => {
    const { data, error } = await supabase.rpc("publishing_preflight", {
      p_placement_id: placementId,
      p_scheduled_at: scheduledAtUtcIso,
      p_timezone: timezone,
      p_exclude_job_id: excludeJobId ?? null,
    });
    if (error) throw error;
    return data as PreflightResult | null;
  });
}
