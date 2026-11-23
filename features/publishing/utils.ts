/**
 * Utilitas murni Publishing Foundation — features/publishing/utils.ts (P6-03).
 * Semua fungsi di sini PURE (tanpa I/O) dan diuji Vitest (tests/publishing.test.ts).
 * Aturan waktu (Keputusan #13 + ADR-0012 §8): semua timestamp DISIMPAN UTC;
 * konversi wall-clock ↔ UTC memakai zona placement secara EKSPLISIT lewat
 * Intl — TIDAK PERNAH memakai zona server (server berjalan di UTC, jadi
 * `new Date("2026-11-20T15:30")` akan salah 7 jam untuk pengguna WIB).
 */
import {
  PLATFORM_OFFICIAL_URLS,
  PUBLISHING_BACKOFF_MINUTES,
  PUBLISHING_MAX_ATTEMPTS,
  PUBLISHING_STATUS_LABELS,
} from "./constants";
import type { PublishingJobStatus } from "./constants";
import { isValidTimezone } from "@/lib/time";

/** Offset (ms) zona IANA pada satu instan — inti konversi zona eksplisit. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Intl dapat mengembalikan hour "24" untuk tengah malam — normalisasi.
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - date.getTime();
}

/**
 * Wall-clock "YYYY-MM-DDTHH:mm" (sebagaimana diketik pengguna di zona
 * `timeZone`) → ISO UTC. Null bila format salah / zona tidak valid.
 * Dua iterasi offset supaya benar di sekitar transisi DST.
 */
export function zonedWallClockToUtcIso(wallClock: string, timeZone: string): string | null {
  if (!isValidTimezone(timeZone)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wallClock.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59)
    return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  // Tebakan pertama bisa jatuh di sisi DST yang salah — hitung ulang sekali.
  let utc = guess - tzOffsetMs(new Date(guess), timeZone);
  utc = guess - tzOffsetMs(new Date(utc), timeZone);
  const out = new Date(utc);
  if (Number.isNaN(out.getTime())) return null;
  return out.toISOString();
}

/** ISO UTC → wall-clock "YYYY-MM-DDTHH:mm" di zona `timeZone` (untuk prefill input datetime-local). */
export function utcIsoToZonedWallClock(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || !isValidTimezone(timeZone)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/**
 * Kunci idempotency (ASUMSI-6.2) — HARUS sama persis dengan yang dibuat
 * RPC create_publishing_job: `pub:<placement_id>:<scheduled_at UTC detik|immediate>`.
 */
export function buildIdempotencyKey(placementId: string, scheduledAtUtcIso: string | null): string {
  if (!scheduledAtUtcIso) return `pub:${placementId}:immediate`;
  const d = new Date(scheduledAtUtcIso);
  if (Number.isNaN(d.getTime())) return `pub:${placementId}:immediate`;
  return `pub:${placementId}:${d.toISOString().replace(/\.\d{3}Z$/, "Z")}`;
}

/** Backoff retry (ASUMSI-6.3) — cermin fungsi SQL publishing_backoff_minutes. */
export function backoffMinutes(attemptNumber: number): number {
  if (attemptNumber <= 1) return PUBLISHING_BACKOFF_MINUTES[0];
  if (attemptNumber === 2) return PUBLISHING_BACKOFF_MINUTES[1];
  return PUBLISHING_BACKOFF_MINUTES[2];
}

/** URL publikasi manual: http(s), tanpa spasi, maks 2048 karakter (cermin CHECK RPC confirm). */
export function isValidPublishUrl(url: string): boolean {
  const v = url.trim();
  if (v === "" || v.length > 2048 || /\s/.test(v)) return false;
  return /^https?:\/\/[^/]+/.test(v);
}

/** Zona waktu sumber kebenaran (ASUMSI-6.6): placement menang atas item. */
export function resolvePublishingTimezone(
  _itemTimezone: string | null | undefined,
  placementTimezone: string | null | undefined,
): string {
  return placementTimezone && placementTimezone.trim() !== ""
    ? placementTimezone
    : "Asia/Jakarta";
}

/** Label status 9 label Dok 08 §6 — harfiah, tanpa sinonim. */
export function publishingStatusLabel(status: string): string {
  return (PUBLISHING_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

/** URL resmi "Open platform" (ASUMSI-6.5) — null = tombol TIDAK tampil. */
export function openPlatformUrl(platform: string | null | undefined): string | null {
  if (!platform) return null;
  return PLATFORM_OFFICIAL_URLS[platform] ?? null;
}

/** Guard transisi (cermin RPC 0020 — UI hanya cermin, RPC penegak terakhir). */
export function canRetryJob(
  status: PublishingJobStatus,
  lastErrorCode: string | null,
  failedCount: number,
): boolean {
  return (
    status === "failed" &&
    lastErrorCode === "TRANSIENT_ERROR" &&
    failedCount < PUBLISHING_MAX_ATTEMPTS
  );
}

export function canCancelJob(status: PublishingJobStatus, leaseUntil: string | null): boolean {
  if (status === "published" || status === "cancelled") return false;
  if (status === "sending") {
    // Lease aktif = sedang diproses; lease kadaluarsa = boleh batal.
    return leaseUntil === null || new Date(leaseUntil).getTime() <= Date.now();
  }
  return (
    status === "ready" ||
    status === "scheduled_locally" ||
    status === "needs_manual_action" ||
    status === "failed"
  );
}

export function canConfirmJob(status: PublishingJobStatus, leaseUntil: string | null): boolean {
  // (e) T-2(a) — konfirmasi manual diizinkan dari job failed: bila pengguna memang
  // sudah terbit manual, konfirmasi adalah satu-satunya jalan ke Published.
  if (status === "published" || status === "cancelled") return false;
  if (status === "sending") {
    return leaseUntil === null || new Date(leaseUntil).getTime() <= Date.now();
  }
  return (
    status === "ready" ||
    status === "scheduled_locally" ||
    status === "needs_manual_action" ||
    status === "failed"
  );
}

export function canRecheckJob(status: PublishingJobStatus): boolean {
  return (
    status === "ready" ||
    status === "scheduled_locally" ||
    status === "needs_manual_action" ||
    status === "sending"
  );
}

/** Lease masih aktif? (dipakai guard di atas + tampilan antrean). */
export function isLeaseActive(leaseUntil: string | null, nowMs: number = Date.now()): boolean {
  if (!leaseUntil) return false;
  return new Date(leaseUntil).getTime() > nowMs;
}

export function leaseMinutesRemaining(
  leaseUntil: string | null,
  nowMs: number = Date.now(),
): number {
  if (!leaseUntil) return 0;
  return Math.max(0, Math.ceil((new Date(leaseUntil).getTime() - nowMs) / 60000));
}

/** Job sudah jatuh tempo tapi belum diproses (pengingat Queue). */
export function isJobOverdue(
  job: { status: PublishingJobStatus; scheduled_at: string | null },
  nowMs: number = Date.now(),
): boolean {
  if (job.status !== "ready" && job.status !== "scheduled_locally") return false;
  if (!job.scheduled_at) return false;
  return new Date(job.scheduled_at).getTime() <= nowMs;
}

/** Job jatuh tempo dalam `windowHours` ke depan (pengingat Queue). */
export function isJobDueSoon(
  job: { status: PublishingJobStatus; scheduled_at: string | null },
  windowHours: number = 24,
  nowMs: number = Date.now(),
): boolean {
  if (job.status !== "ready" && job.status !== "scheduled_locally") return false;
  if (!job.scheduled_at) return false;
  const t = new Date(job.scheduled_at).getTime();
  return t > nowMs && t <= nowMs + windowHours * 3600 * 1000;
}
