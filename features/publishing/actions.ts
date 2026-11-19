/**
 * Server actions Publishing Foundation — features/publishing/actions.ts (P6-03 s.d. P6-08).
 * Pola Phase 2/3/4/5: Zod dulu (boundary), lalu sesi + peran dari DB (BUKAN
 * dari body), lalu Supabase client sesi (RLS penegak terakhir).
 * - SEMUA perubahan status job HANYA lewat RPC 0020 — TIDAK ADA penulisan
 *   status langsung dari client (pola approval 0014).
 * - Jadwal wall-clock → UTC memakai zona placement secara eksplisit
 *   (zonedWallClockToUtcIso) — BUKAN `new Date(v)` (zona server = UTC).
 * - Form yang menampilkan pesan hasil aksi HARUS tetap mounted
 *   (pelajaran e2e Phase 3/4/5: jangan sembunyikan form useActionState
 *   berdasarkan hasil aksinya sendiri).
 * - TIDAK ADA adapter provider, OAuth, polling, atau penulisan secret di sini.
 */
"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";
import { brandInScope, can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import {
  cancelPublishingJobSchema,
  confirmPublishingJobSchema,
  createPublishingJobSchema,
  reschedulePublishingJobSchema,
  retryPublishingJobSchema,
} from "@/lib/validation/schemas";
import {
  getCallerBrandScope,
  getCallerRole,
  PLANNING_TABLES_UNAVAILABLE_ID,
} from "@/features/planning/context";
import { PUBLISHING_TABLES_UNAVAILABLE_ID } from "./constants";
import type { PublishingActionResult } from "./types";
import { resolvePublishingTimezone, zonedWallClockToUtcIso } from "./utils";

const ok = (message: string, extra?: Partial<PublishingActionResult>): PublishingActionResult => ({
  ok: true,
  message,
  ...extra,
});
const fail = (
  message: string,
  extra?: Partial<PublishingActionResult>,
): PublishingActionResult => ({ ok: false, message, ...extra });

function isMissingTableMessage(message: string): boolean {
  return /Could not find the table|does not exist|42P01|PGRST205|Could not find the function/i.test(
    message,
  );
}

function dbErrorMessage(error: { message?: string } | null, fallback: string): string {
  const message = error?.message ?? fallback;
  if (isMissingTableMessage(message)) return PUBLISHING_TABLES_UNAVAILABLE_ID;
  return message;
}

type RpcResult = {
  ok: boolean;
  code?: string;
  message?: string;
  job_id?: string;
  status?: string;
  processed?: number;
};

function asRpcResult(data: unknown): RpcResult | null {
  if (!data || typeof data !== "object") return null;
  return data as RpcResult;
}

/** Konteks placement + brand untuk pengecekan peran/scope di lapis aplikasi. */
async function getPlacementContext(
  supabase: SupabaseClient,
  placementId: string,
): Promise<{ workspaceId: string; brandId: string; contentItemId: string; timezone: string } | null> {
  const { data, error } = await supabase
    .from("content_placements")
    .select("id, timezone, content_items!inner(id, workspace_id, brand_id)")
    .eq("id", placementId)
    .single();
  if (error || !data) return null;
  const item = (data as unknown as { content_items: { id: string; workspace_id: string; brand_id: string } })
    .content_items;
  return {
    workspaceId: item.workspace_id,
    brandId: item.brand_id,
    contentItemId: item.id,
    timezone: (data as unknown as { timezone: string }).timezone,
  };
}

/** Konteks job (workspace + brand) untuk pengecekan peran/scope. */
async function getJobContext(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{
  workspaceId: string;
  brandId: string;
  placementId: string;
  timezone: string;
  status: string;
} | null> {
  const { data, error } = await supabase
    .from("publishing_jobs")
    .select("id, workspace_id, placement_id, timezone, status")
    .eq("id", jobId)
    .single();
  if (error || !data) return null;
  const job = data as {
    workspace_id: string;
    placement_id: string;
    timezone: string;
    status: string;
  };
  const placement = await getPlacementContext(supabase, job.placement_id);
  if (!placement) return null;
  return {
    workspaceId: job.workspace_id,
    brandId: placement.brandId,
    placementId: job.placement_id,
    timezone: job.timezone,
    status: job.status,
  };
}

async function requireScheduler(
  supabase: SupabaseClient,
  workspaceId: string,
  brandId: string,
  userId: string,
): Promise<string | null> {
  const role = (await getCallerRole(workspaceId, userId)) as WorkspaceRole | null;
  if (!role || !can(role, "schedule_publish")) {
    return "Peran Anda tidak boleh mengatur publikasi.";
  }
  const scope = await getCallerBrandScope(workspaceId, userId);
  if (!brandInScope(scope, brandId)) {
    return "Brand ini di luar scope Anda.";
  }
  return null;
}

async function requireUser(): Promise<{
  supabase: SupabaseClient | null;
  user: { id: string } | null;
}> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { supabase: null, user: null };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user: user ? { id: user.id } : null };
}

/** Buat job publishing (P6-03): jadwal + zona placement → RPC create. */
export async function createPublishingJobAction(
  _prev: PublishingActionResult,
  formData: FormData,
): Promise<PublishingActionResult> {
  const parsed = createPublishingJobSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    placementId: formData.get("placementId"),
    scheduledAt: formData.get("scheduledAt") ?? "",
    timezone: formData.get("timezone") ?? "",
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  }
  const placement = await getPlacementContext(supabase, parsed.data.placementId);
  if (!placement) return fail(PLANNING_TABLES_UNAVAILABLE_ID);
  if (placement.workspaceId !== parsed.data.workspaceId) {
    return fail("Placement tidak ditemukan di workspace ini.");
  }
  const denied = await requireScheduler(supabase, parsed.data.workspaceId, placement.brandId, user.id);
  if (denied) return fail(denied);

  // Zona efektif (ASUMSI-6.6: placement menang) + konversi wall-clock → UTC.
  const timezone = resolvePublishingTimezone(null, parsed.data.timezone || placement.timezone);
  let scheduledAtUtc: string | null = null;
  if (parsed.data.scheduledAt) {
    scheduledAtUtc = zonedWallClockToUtcIso(parsed.data.scheduledAt, timezone);
    if (!scheduledAtUtc) return fail("Jadwal atau zona waktu tidak valid.");
  }

  const { data, error } = await supabase.rpc("create_publishing_job", {
    p_placement_id: parsed.data.placementId,
    p_scheduled_at: scheduledAtUtc,
    p_timezone: timezone,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal membuat job publikasi."));
  const result = asRpcResult(data);
  if (!result?.ok) return fail(result?.message ?? "Gagal membuat job publikasi.");
  revalidatePath("/publishing");
  revalidatePath(`/konten/${placement.contentItemId}`);
  return ok(result.message ?? "Job publikasi dibuat.", {
    jobId: result.job_id,
    status: result.status,
  });
}

/** Retry eksplisit job failed (P6-03): hanya transient, < 3 percobaan (RPC). */
export async function retryPublishingJobAction(
  _prev: PublishingActionResult,
  formData: FormData,
): Promise<PublishingActionResult> {
  const parsed = retryPublishingJobSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    jobId: formData.get("jobId"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  }
  const job = await getJobContext(supabase, parsed.data.jobId);
  if (!job) return fail("Job tidak ditemukan.");
  if (job.workspaceId !== parsed.data.workspaceId) {
    return fail("Job tidak ditemukan di workspace ini.");
  }
  const denied = await requireScheduler(supabase, parsed.data.workspaceId, job.brandId, user.id);
  if (denied) return fail(denied);
  const { data, error } = await supabase.rpc("retry_publishing_job", {
    p_job_id: parsed.data.jobId,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal me-retry job."));
  const result = asRpcResult(data);
  if (!result?.ok) return fail(result?.message ?? "Gagal me-retry job.");
  revalidatePath("/publishing");
  return ok(result.message ?? "Retry dijadwalkan.", { jobId: parsed.data.jobId });
}

/** Batal eksplisit + alasan wajib (P6-03). */
export async function cancelPublishingJobAction(
  _prev: PublishingActionResult,
  formData: FormData,
): Promise<PublishingActionResult> {
  const parsed = cancelPublishingJobSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    jobId: formData.get("jobId"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  }
  const job = await getJobContext(supabase, parsed.data.jobId);
  if (!job) return fail("Job tidak ditemukan.");
  if (job.workspaceId !== parsed.data.workspaceId) {
    return fail("Job tidak ditemukan di workspace ini.");
  }
  const denied = await requireScheduler(supabase, parsed.data.workspaceId, job.brandId, user.id);
  if (denied) return fail(denied);
  const { data, error } = await supabase.rpc("cancel_publishing_job", {
    p_job_id: parsed.data.jobId,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal membatalkan job."));
  const result = asRpcResult(data);
  if (!result?.ok) return fail(result?.message ?? "Gagal membatalkan job.");
  revalidatePath("/publishing");
  return ok(result.message ?? "Job dibatalkan.", { jobId: parsed.data.jobId });
}

/** Konfirmasi manual — satu-satunya jalan ke Published (P6-03). */
export async function confirmPublishingJobAction(
  _prev: PublishingActionResult,
  formData: FormData,
): Promise<PublishingActionResult> {
  const parsed = confirmPublishingJobSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    jobId: formData.get("jobId"),
    canonicalUrl: formData.get("canonicalUrl") ?? "",
    publishedAt: formData.get("publishedAt") ?? "",
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  }
  const job = await getJobContext(supabase, parsed.data.jobId);
  if (!job) return fail("Job tidak ditemukan.");
  if (job.workspaceId !== parsed.data.workspaceId) {
    return fail("Job tidak ditemukan di workspace ini.");
  }
  const denied = await requireScheduler(supabase, parsed.data.workspaceId, job.brandId, user.id);
  if (denied) return fail(denied);
  // Waktu publikasi diketik di zona job (zona placement) → UTC.
  const publishedAtUtc = zonedWallClockToUtcIso(parsed.data.publishedAt, job.timezone);
  if (!publishedAtUtc) return fail("Waktu publikasi atau zona waktu tidak valid.");
  const { data, error } = await supabase.rpc("confirm_publishing_job", {
    p_job_id: parsed.data.jobId,
    p_canonical_url: parsed.data.canonicalUrl,
    p_published_at: publishedAtUtc,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal mengonfirmasi publikasi."));
  const result = asRpcResult(data);
  if (!result?.ok) return fail(result?.message ?? "Gagal mengonfirmasi publikasi.");
  revalidatePath("/publishing");
  return ok(result.message ?? "Publikasi dikonfirmasi manual.", {
    jobId: parsed.data.jobId,
    status: "published",
  });
}

/** Jadwalkan ulang: batalkan job lama (alasan "dijadwalkan ulang") + buat job baru. */
export async function reschedulePublishingJobAction(
  _prev: PublishingActionResult,
  formData: FormData,
): Promise<PublishingActionResult> {
  const parsed = reschedulePublishingJobSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    jobId: formData.get("jobId"),
    scheduledAt: formData.get("scheduledAt") ?? "",
    timezone: formData.get("timezone") ?? "",
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  }
  const job = await getJobContext(supabase, parsed.data.jobId);
  if (!job) return fail("Job tidak ditemukan.");
  if (job.workspaceId !== parsed.data.workspaceId) {
    return fail("Job tidak ditemukan di workspace ini.");
  }
  const denied = await requireScheduler(supabase, parsed.data.workspaceId, job.brandId, user.id);
  if (denied) return fail(denied);
  if (job.status === "published" || job.status === "cancelled") {
    return fail(`Job ${job.status} tidak bisa dijadwalkan ulang.`);
  }
  const timezone = resolvePublishingTimezone(null, parsed.data.timezone || job.timezone);
  const scheduledAtUtc = zonedWallClockToUtcIso(parsed.data.scheduledAt, timezone);
  if (!scheduledAtUtc) return fail("Jadwal atau zona waktu tidak valid.");

  const { data: cancelData, error: cancelError } = await supabase.rpc("cancel_publishing_job", {
    p_job_id: parsed.data.jobId,
    p_reason: "Dijadwalkan ulang.",
  });
  if (cancelError) return fail(dbErrorMessage(cancelError, "Gagal membatalkan job lama."));
  const cancelResult = asRpcResult(cancelData);
  if (!cancelResult?.ok) return fail(cancelResult?.message ?? "Gagal membatalkan job lama.");
  const { data, error } = await supabase.rpc("create_publishing_job", {
    p_placement_id: job.placementId,
    p_scheduled_at: scheduledAtUtc,
    p_timezone: timezone,
  });
  if (error) {
    return fail(
      `Job lama dibatalkan, tetapi buat job baru gagal: ${dbErrorMessage(error, "Gagal membuat job baru.")} Buat job baru dari placement.`,
    );
  }
  const result = asRpcResult(data);
  if (!result?.ok) {
    return fail(
      `Job lama dibatalkan, tetapi buat job baru gagal: ${result?.message ?? "Gagal membuat job baru."} Buat job baru dari placement.`,
    );
  }
  revalidatePath("/publishing");
  return ok("Job dijadwalkan ulang — job lama dibatalkan, job baru dibuat.", {
    jobId: result.job_id,
    status: result.status,
  });
}

/**
 * Proses antrean (worker lokal, P6-06): klaim job jatuh tempo → preflight
 * ulang → handoff manual. Dipakai halaman Queue (server component) + tombol
 * "Proses antrean" + API proses. Idempotent — hanya job jatuh tempo yang
 * disentuh; lease mencegah pemrosesan ganda.
 */
export async function processPublishingJobs(
  workspaceId: string,
  jobId?: string | null,
): Promise<PublishingActionResult> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return fail(SUPABASE_NOT_CONFIGURED_ID);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Anda harus masuk dulu.");
  const role = (await getCallerRole(workspaceId, user.id)) as WorkspaceRole | null;
  if (!role || !can(role, "schedule_publish")) {
    return fail("Peran Anda tidak boleh memproses antrean publishing.");
  }
  const { data, error } = await supabase.rpc("process_publishing_jobs", {
    p_workspace_id: workspaceId,
    p_job_id: jobId ?? null,
  });
  if (error) return fail(dbErrorMessage(error, "Gagal memproses antrean."));
  const result = asRpcResult(data);
  if (!result?.ok) return fail(result?.message ?? "Gagal memproses antrean.");
  revalidatePath("/publishing");
  return ok(result.message ?? "Antrean diproses.", { processed: result.processed ?? 0 });
}

/** Periksa-ulang satu job (ASUMSI-6.1): preflight ulang dari needs_manual_action. */
export async function recheckPublishingJobAction(
  _prev: PublishingActionResult,
  formData: FormData,
): Promise<PublishingActionResult> {
  const parsed = retryPublishingJobSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    jobId: formData.get("jobId"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return fail(supabase ? "Anda harus masuk dulu." : SUPABASE_NOT_CONFIGURED_ID);
  }
  const job = await getJobContext(supabase, parsed.data.jobId);
  if (!job) return fail("Job tidak ditemukan.");
  if (job.workspaceId !== parsed.data.workspaceId) {
    return fail("Job tidak ditemukan di workspace ini.");
  }
  const denied = await requireScheduler(supabase, parsed.data.workspaceId, job.brandId, user.id);
  if (denied) return fail(denied);
  const result = await processPublishingJobs(parsed.data.workspaceId, parsed.data.jobId);
  return result;
}

/** Aksi form untuk tombol "Proses antrean" (tanpa job tertentu). */
export async function processPublishingJobsAction(
  _prev: PublishingActionResult,
  formData: FormData,
): Promise<PublishingActionResult> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!workspaceId) return fail("workspace_id tidak valid.");
  return processPublishingJobs(workspaceId);
}
