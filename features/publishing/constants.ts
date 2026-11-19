/**
 * Konstanta domain Publishing Foundation — features/publishing/constants.ts (P6-03).
 * Sumber: ADR-0012 + Dok 05 §3/§4 + Dok 08 §5/§6/§9 + ASUMSI-6.1 s.d. 6.6.
 * Satu tempat konfigurasi untuk angka operasional (ASUMSI-6.3) — bila Tuan
 * menetapkan angka lain, ganti di sini + fungsi SQL publishing_backoff_minutes.
 */
import { DEFAULT_TIMEZONE } from "@/lib/time";

/** 9 label status Dok 08 §6 — dipakai SECARA HARFIAH di semua tampilan. */
export const PUBLISHING_STATUS_LABELS = {
  draft: "Draft",
  ready: "Ready",
  scheduled_locally: "Scheduled locally",
  sending: "Sending",
  uploaded_or_draft_created: "Uploaded / Draft created",
  published: "Published",
  failed: "Failed",
  needs_manual_action: "Needs manual action",
  cancelled: "Cancelled",
} as const;

export type PublishingJobStatus = keyof typeof PUBLISHING_STATUS_LABELS;

export const PUBLISHING_JOB_STATUSES = [
  "ready",
  "scheduled_locally",
  "sending",
  "needs_manual_action",
  "failed",
  "published",
  "cancelled",
] as const;

/** Hasil attempt (riwayat pemrosesan per job). */
export const PUBLISHING_ATTEMPT_RESULTS = [
  "handoff_manual",
  "failed",
  "published",
  "cancelled",
  "recovered_ready",
  "retry_scheduled",
] as const;

export type PublishingAttemptResult = (typeof PUBLISHING_ATTEMPT_RESULTS)[number];

export const PUBLISHING_ATTEMPT_RESULT_LABELS: Record<PublishingAttemptResult, string> = {
  handoff_manual: "Diserahkan ke manual",
  failed: "Gagal",
  published: "Terbit (manual)",
  cancelled: "Dibatalkan",
  recovered_ready: "Pulih — siap lagi",
  retry_scheduled: "Retry dijadwalkan",
};

/** Angka operasional (ASUMSI-6.3, diputuskan ADR-0012 §5). */
export const PUBLISHING_MAX_ATTEMPTS = 3;
export const PUBLISHING_BACKOFF_MINUTES = [1, 5, 15] as const;
export const PUBLISHING_LEASE_MINUTES = 5;
export const PUBLISHING_PROCESS_TIMEOUT_MINUTES = 2;
export const PUBLISHING_PROCESS_BATCH_LIMIT = 20;

/** Kode galat yang dikembalikan RPC 0020 (dipakai UI + API + tes). */
export const PUBLISHING_ERROR_CODES = [
  "UNAUTHENTICATED",
  "UNAVAILABLE",
  "NOT_FOUND",
  "FORBIDDEN",
  "INVALID_STATE_TRANSITION",
  "INVALID_REASON",
  "INVALID_URL",
  "INVALID_PUBLISHED_AT",
  "APPROVAL_REQUIRED",
  "APPROVAL_STALE",
  "ALREADY_PUBLISHED",
  "TIMEZONE_INVALID",
  "SCHEDULE_PAST",
  "DUPLICATE_JOB",
  "PLACEMENT_CHANGED",
  "PREFLIGHT_FAILED",
  "TRANSIENT_ERROR",
  "NO_DUE_JOB",
  "READY",
  "CREATED",
  "CLAIMED",
  "PROCESSED",
  "RETRY_SCHEDULED",
  "CANCELLED",
  "PUBLISHED",
] as const;

/** Hanya galat ini yang boleh di-retry (A6.4 — tanpa blind retry). */
export const PUBLISHING_TRANSIENT_ERROR_CODES = ["TRANSIENT_ERROR"] as const;

/** URL resmi platform untuk tombol "Open platform" (ASUMSI-6.5). */
export const PLATFORM_OFFICIAL_URLS: Record<string, string> = {
  instagram: "https://www.instagram.com",
  tiktok: "https://www.tiktok.com",
  youtube: "https://studio.youtube.com",
  facebook: "https://www.facebook.com",
  linkedin: "https://www.linkedin.com",
  x: "https://x.com",
  threads: "https://www.threads.net",
};

/** Konfirmasi manual — satu-satunya confirmation_source di Phase 6. */
export const PUBLISHING_MANUAL_CONFIRMATION_SOURCE = "manual_user_confirmation" as const;

/** Zona waktu default bila placement tidak punya (tidak pernah terjadi — kolom NOT NULL). */
export const PUBLISHING_DEFAULT_TIMEZONE = DEFAULT_TIMEZONE;

/** Batas jujur: pengingat = tampilan terhitung (job jatuh tempo ≤ 24 jam). */
export const PUBLISHING_REMINDER_WINDOW_HOURS = 24;

/** Pesan bila tabel Phase 6 belum tersedia di database live. */
export const PUBLISHING_TABLES_UNAVAILABLE_ID =
  "Tabel Publishing Foundation (migrasi 0020) belum diterapkan ke database ini — minta koordinator menjalankan docs/phase-6-report.md §8, lalu muat ulang halaman ini.";
