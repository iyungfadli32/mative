/**
 * Daftar antrean publishing — features/publishing/components/PublishingQueue.tsx (P6-04).
 * Seksi "Perlu perhatian" (reminder MVP, P6-07): job needs_manual_action +
 * job jatuh tempo + job jatuh tempo ≤ 24 jam — tampilan terhitung, BUKAN
 * record yang "dikirim" (tidak ada kanal email/push di Phase 6).
 * Semua waktu tampil di zona job (zona placement).
 */
import Link from "next/link";
import { formatInTimezone } from "@/lib/time";
import type { PublishingJobRow } from "../types";
import { isJobDueSoon, isJobOverdue, openPlatformUrl } from "../utils";
import { PUBLISHING_REMINDER_WINDOW_HOURS } from "../constants";
import { PublishingStatusBadge } from "./StatusBadge";
import { ProcessQueueForm } from "./JobActionForms";

function JobCard({ job }: { job: PublishingJobRow }) {
  const platformUrl = openPlatformUrl(job.placement?.channel_platform);
  return (
    <article className="flex flex-col gap-2 rounded-[10px] border border-[var(--mt-border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/publishing/${job.id}`}
          className="text-sm font-semibold text-[var(--mt-text)] underline-offset-2 hover:underline"
        >
          {job.placement?.content_title ?? "Konten tanpa judul"}
        </Link>
        <PublishingStatusBadge status={job.status} />
      </div>
      <p className="text-sm text-[var(--mt-text-muted)]">
        {job.placement?.channel_platform ?? "—"}
        {job.placement?.channel_account ? ` · ${job.placement.channel_account}` : ""}
        {job.placement?.platform_format ? ` · ${job.placement.platform_format}` : ""}
      </p>
      <p className="text-sm">
        Jadwal:{" "}
        {job.scheduled_at
          ? `${formatInTimezone(job.scheduled_at, job.timezone)} (${job.timezone})`
          : "Segera (Ready)"}
      </p>
      {job.next_attempt_at ? (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Percobaan berikutnya: {formatInTimezone(job.next_attempt_at, job.timezone)}
        </p>
      ) : null}
      <p className="text-sm text-[var(--mt-text-muted)]">
        Percobaan: {job.attempt_count} · Dibuat{" "}
        {formatInTimezone(job.created_at, job.timezone)}
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href={`/publishing/${job.id}`}
          className="text-sm font-medium text-[var(--mt-text)] underline-offset-2 hover:underline"
        >
          Lihat detail & riwayat
        </Link>
        {platformUrl ? (
          <a
            href={platformUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-[var(--mt-text)] underline-offset-2 hover:underline"
          >
            Open platform
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function PublishingQueue({
  workspaceId,
  jobs,
  canManage,
}: {
  workspaceId: string;
  jobs: PublishingJobRow[];
  canManage: boolean;
}) {
  const attention = jobs.filter(
    (job) =>
      job.status === "needs_manual_action" ||
      job.status === "failed" ||
      isJobOverdue(job) ||
      isJobDueSoon(job, PUBLISHING_REMINDER_WINDOW_HOURS),
  );
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Perlu perhatian</h2>
        {attention.length === 0 ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Tidak ada job yang butuh aksi manual atau jatuh tempo dalam{" "}
            {PUBLISHING_REMINDER_WINDOW_HOURS} jam ke depan.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {attention.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Semua job ({jobs.length})</h2>
          {canManage ? <ProcessQueueForm workspaceId={workspaceId} /> : null}
        </div>
        {canManage ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Antrean juga diproses otomatis saat halaman ini dimuat (worker lokal Phase 6 — job
            jatuh tempo diserahkan ke aksi manual). Tombol di atas menjalankan pemrosesan ulang
            tanpa memuat ulang halaman.
          </p>
        ) : null}
        {jobs.length === 0 ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Belum ada job publikasi di workspace ini. Buat job dari placement yang sudah
            disetujui di halaman konten.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
