/**
 * Detail job publishing — features/publishing/components/JobDetail.tsx (P6-04).
 * Menampilkan: status + jadwal (zona placement), placement & konten, bukti
 * terbit (bila ada), riwayat attempts (audit trail), dan form aksi.
 * Tidak ada status palsu: "Scheduled locally" tidak pernah tampil sebagai
 * "Scheduled (provider)"; "Uploaded / Draft created" tidak pernah tercapai
 * di Phase 6 (tidak ada provider).
 */
import Link from "next/link";
import { formatInTimezone } from "@/lib/time";
import type { PublishingJobRow } from "../types";
import { openPlatformUrl, publishingStatusLabel } from "../utils";
import { PUBLISHING_ATTEMPT_RESULT_LABELS } from "../constants";
import { PublishingStatusBadge } from "./StatusBadge";
import {
  CancelJobForm,
  ConfirmJobForm,
  RecheckJobForm,
  RescheduleJobForm,
  RetryJobForm,
} from "./JobActionForms";

export function JobDetail({
  workspaceId,
  job,
  canManage,
}: {
  workspaceId: string;
  job: PublishingJobRow;
  canManage: boolean;
}) {
  const platformUrl = openPlatformUrl(job.placement?.channel_platform);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">
            {job.placement?.content_title ?? "Konten tanpa judul"}
          </h2>
          <PublishingStatusBadge status={job.status} />
        </div>
        <p className="text-sm text-[var(--mt-text-muted)]">
          Status: {publishingStatusLabel(job.status)} · Zona waktu: {job.timezone} (zona
          placement)
        </p>
        <p className="text-sm">
          Jadwal:{" "}
          {job.scheduled_at
            ? `${formatInTimezone(job.scheduled_at, job.timezone)} (${job.timezone})`
            : "Segera (Ready)"}
        </p>
        <p className="text-sm text-[var(--mt-text-muted)]">
          Placement: {job.placement?.platform_format ?? "—"} · Channel:{" "}
          {job.placement?.channel_platform ?? "—"}
          {job.placement?.channel_account ? ` (${job.placement.channel_account})` : ""} · Konten:{" "}
          {job.placement ? (
            <Link
              href={`/konten/${job.placement.content_item_id}`}
              className="underline underline-offset-2"
            >
              Lihat konten
            </Link>
          ) : (
            "—"
          )}
        </p>
        {platformUrl ? (
          <p className="text-sm">
            <a
              href={platformUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Open platform ({job.placement?.channel_platform})
            </a>
          </p>
        ) : null}
        <p className="text-sm text-[var(--mt-text-muted)]">
          Kunci idempotency: <code>{job.idempotency_key}</code> · Percobaan:{" "}
          {job.attempt_count} · Dibuat {formatInTimezone(job.created_at, job.timezone)}
        </p>
      </section>

      {job.published_post ? (
        <section className="flex flex-col gap-2 rounded-[10px] border border-[var(--mt-border)] p-4">
          <h3 className="text-sm font-semibold">Bukti terbit (konfirmasi manual)</h3>
          <p className="text-sm">
            URL:{" "}
            <a
              href={job.published_post.canonical_url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 break-all"
            >
              {job.published_post.canonical_url}
            </a>
          </p>
          <p className="text-sm text-[var(--mt-text-muted)]">
            Terbit: {formatInTimezone(job.published_post.published_at, job.timezone)} · Sumber:{" "}
            {job.published_post.confirmation_source}
          </p>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Riwayat pemrosesan ({job.attempts.length})</h3>
        {job.attempts.length === 0 ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Belum ada percobaan pemrosesan untuk job ini.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {job.attempts.map((attempt) => (
              <li
                key={attempt.id}
                className="rounded-[10px] border border-[var(--mt-border)] p-3 text-sm"
              >
                <p className="font-medium">
                  #{attempt.attempt_number} —{" "}
                  {PUBLISHING_ATTEMPT_RESULT_LABELS[attempt.result_status] ?? attempt.result_status}
                </p>
                <p className="text-[var(--mt-text-muted)]">
                  Mulai {formatInTimezone(attempt.started_at, job.timezone)}
                  {attempt.completed_at
                    ? ` · Selesai ${formatInTimezone(attempt.completed_at, job.timezone)}`
                    : ""}
                </p>
                {attempt.error_code ? (
                  <p>
                    Galat: {attempt.error_code}
                    {attempt.error_message_safe ? ` — ${attempt.error_message_safe}` : ""}
                  </p>
                ) : null}
                {attempt.provider_response_safe ? (
                  <p className="break-words">Catatan: {attempt.provider_response_safe}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {canManage ? (
        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold">Aksi</h3>
          <ConfirmJobForm workspaceId={workspaceId} job={job} />
          <RecheckJobForm workspaceId={workspaceId} job={job} />
          <RetryJobForm workspaceId={workspaceId} job={job} />
          <RescheduleJobForm workspaceId={workspaceId} job={job} />
          <CancelJobForm workspaceId={workspaceId} job={job} />
        </section>
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Peran Anda tidak boleh mengubah job publikasi (baca-saja).
        </p>
      )}
    </div>
  );
}
