/**
 * Form aksi job publishing — features/publishing/components/JobActionForms.tsx (P6-04).
 * Aturan: SEMUA form tetap mounted (pelajaran e2e Phase 3/4/5) — bila aksi
 * tidak berlaku untuk status job saat ini, form di-DISABLE dengan alasan,
 * bukan disembunyikan. Pesan hasil tampil di bawah form masing-masing.
 * Konfirmasi manual adalah SATU-SATUNYA jalan ke Published (A6.2).
 */
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  cancelPublishingJobAction,
  confirmPublishingJobAction,
  processPublishingJobsAction,
  recheckPublishingJobAction,
  reschedulePublishingJobAction,
  retryPublishingJobAction,
} from "../actions";
import type { PublishingJob, PublishingJobRow } from "../types";
import {
  canCancelJob,
  canConfirmJob,
  canRecheckJob,
  canRetryJob,
  utcIsoToZonedWallClock,
} from "../utils";

function ResultMessage({ state }: { state: { ok: boolean; message: string } }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className="text-sm">
      {state.message}
    </p>
  );
}

const initial = { ok: false, message: "" };

function useJobForm(action: (prev: typeof initial, fd: FormData) => Promise<typeof initial>) {
  return useActionState(action, initial);
}

/** Konfirmasi manual: URL + waktu terbit nyata → status Published (A6.1). */
export function ConfirmJobForm({ workspaceId, job }: { workspaceId: string; job: PublishingJob }) {
  const [state, formAction, pending] = useJobForm(confirmPublishingJobAction);
  const allowed = canConfirmJob(job.status, job.lease_until);
  const nowWall = utcIsoToZonedWallClock(new Date().toISOString(), job.timezone);
  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-[var(--mt-border)] p-4">
      <h3 className="text-sm font-semibold">Konfirmasi terbit manual</h3>
      <p className="text-sm text-[var(--mt-text-muted)]">
        Isi URL publikasi yang sebenarnya sesudah Anda menerbitkan konten ini di platform.
        Konfirmasi ini satu-satunya jalan ke status Published — tidak ada status Published
        otomatis di Phase 6.
      </p>
      {job.status === "failed" ? (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Job ini sudah gagal. Konfirmasi hanya bila Anda memang sudah menerbitkan konten
          ini secara manual di platform — konfirmasi tetap mencatat bukti terbit dan
          mengubah placement menjadi Published.
        </p>
      ) : null}
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="jobId" value={job.id} />
        <Input
          id="pub-canonical-url"
          type="url"
          name="canonicalUrl"
          label="URL publikasi"
          hint="URL lengkap publikasi yang sebenarnya di platform (http:// atau https://)."
          placeholder="https://www.instagram.com/p/…"
          disabled={!allowed || pending}
          required
        />
        <Input
          id="pub-published-at"
          type="datetime-local"
          name="publishedAt"
          label={`Waktu terbit (zona ${job.timezone})`}
          defaultValue={nowWall}
          disabled={!allowed || pending}
          required
        />
        <Button type="submit" disabled={!allowed || pending}>
          {pending ? "Mengonfirmasi…" : "Konfirmasi sudah terbit"}
        </Button>
        {!allowed ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Job berstatus {job.status} tidak bisa dikonfirmasi.
          </p>
        ) : null}
        <ResultMessage state={state} />
      </form>
    </section>
  );
}

/** Batal eksplisit + alasan wajib (A6.5). */
export function CancelJobForm({ workspaceId, job }: { workspaceId: string; job: PublishingJob }) {
  const [state, formAction, pending] = useJobForm(cancelPublishingJobAction);
  const allowed = canCancelJob(job.status, job.lease_until);
  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-[var(--mt-border)] p-4">
      <h3 className="text-sm font-semibold">Batalkan job</h3>
      <p className="text-sm text-[var(--mt-text-muted)]">
        Pembatalan aman sebelum pengiriman: tidak ada efek ke platform. Job yang dibatalkan
        membebaskan slot jadwalnya sehingga waktu yang sama bisa dijadwalkan ulang.
      </p>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="jobId" value={job.id} />
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Alasan pembatalan (wajib)
          <textarea
            name="reason"
            rows={2}
            maxLength={500}
            disabled={!allowed || pending}
            required
            className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
          />
        </label>
        <Button type="submit" disabled={!allowed || pending}>
          {pending ? "Membatalkan…" : "Batalkan job"}
        </Button>
        {!allowed ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Job berstatus {job.status}
            {job.status === "sending" ? " dan sedang diproses (lease aktif)" : ""} tidak bisa
            dibatalkan.
          </p>
        ) : null}
        <ResultMessage state={state} />
      </form>
    </section>
  );
}

/** Jadwalkan ulang (atomik, satu RPC): jadwal baru diperiksa dulu; bila lolos, job lama dibatalkan + job baru dibuat dalam satu transaksi. */
export function RescheduleJobForm({
  workspaceId,
  job,
}: {
  workspaceId: string;
  job: PublishingJob;
}) {
  const [state, formAction, pending] = useJobForm(reschedulePublishingJobAction);
  const allowed = job.status !== "published" && job.status !== "cancelled";
  const defaultWall = job.scheduled_at
    ? utcIsoToZonedWallClock(job.scheduled_at, job.timezone)
    : "";
  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-[var(--mt-border)] p-4">
      <h3 className="text-sm font-semibold">Jadwalkan ulang</h3>
      <p className="text-sm text-[var(--mt-text-muted)]">
        Penjadwalan ulang bersifat atomik: jadwal baru diperiksa dulu (preflight); bila
        lolos, job lama dibatalkan dan job baru dibuat dalam satu transaksi. Bila jadwal
        baru tidak valid, job lama tetap utuh.
      </p>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="jobId" value={job.id} />
        <input type="hidden" name="timezone" value={job.timezone} />
        <Input
          id="pub-reschedule-at"
          type="datetime-local"
          name="scheduledAt"
          label={`Jadwal baru (zona ${job.timezone})`}
          defaultValue={defaultWall}
          disabled={!allowed || pending}
          required
        />
        <Button type="submit" disabled={!allowed || pending}>
          {pending ? "Menjadwalkan ulang…" : "Jadwalkan ulang"}
        </Button>
        {!allowed ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Job berstatus {job.status} tidak bisa dijadwalkan ulang.
          </p>
        ) : null}
        <ResultMessage state={state} />
      </form>
    </section>
  );
}

/** Retry eksplisit (A6.4): hanya job failed karena TRANSIENT_ERROR, < 3 percobaan. */
export function RetryJobForm({
  workspaceId,
  job,
}: {
  workspaceId: string;
  job: PublishingJobRow;
}) {
  const [state, formAction, pending] = useJobForm(retryPublishingJobAction);
  const lastFailed = job.attempts?.find((a) => a.result_status === "failed") ?? null;
  const allowed = canRetryJob(job.status, lastFailed?.error_code ?? null, job.attempt_count);
  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-[var(--mt-border)] p-4">
      <h3 className="text-sm font-semibold">Retry job</h3>
      <p className="text-sm text-[var(--mt-text-muted)]">
        Retry hanya untuk kegagalan sementara (TRANSIENT_ERROR), maksimal 3 percobaan dengan
        backoff 1 → 5 → 15 menit. Kegagalan preflight tidak bisa di-retry — perbaiki dulu
        penyebabnya, lalu periksa ulang.
      </p>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="jobId" value={job.id} />
        <Button type="submit" disabled={!allowed || pending}>
          {pending ? "Menjadwalkan retry…" : "Retry job"}
        </Button>
        {!allowed ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Job ini tidak bisa di-retry (status {job.status}
            {lastFailed ? `, galat terakhir ${lastFailed.error_code}` : ""}, percobaan{" "}
            {job.attempt_count}/3).
          </p>
        ) : null}
        <ResultMessage state={state} />
      </form>
    </section>
  );
}

/** Periksa-ulang (ASUMSI-6.1): preflight ulang dari needs_manual_action. */
export function RecheckJobForm({ workspaceId, job }: { workspaceId: string; job: PublishingJob }) {
  const [state, formAction, pending] = useJobForm(recheckPublishingJobAction);
  const allowed = canRecheckJob(job.status);
  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-[var(--mt-border)] p-4">
      <h3 className="text-sm font-semibold">Periksa ulang</h3>
      <p className="text-sm text-[var(--mt-text-muted)]">
        Jalankan preflight ulang untuk job ini. Bila lolos, job kembali ke Ready (atau
        Scheduled locally bila jadwalnya masih di masa depan); bila gagal, job tetap menunggu
        aksi manual dengan alasan terbaru.
      </p>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="jobId" value={job.id} />
        <Button type="submit" disabled={!allowed || pending}>
          {pending ? "Memeriksa ulang…" : "Periksa ulang"}
        </Button>
        {!allowed ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Job berstatus {job.status} tidak bisa diperiksa ulang.
          </p>
        ) : null}
        <ResultMessage state={state} />
      </form>
    </section>
  );
}

/** Tombol "Proses antrean" di halaman Queue (worker lokal P6-06). */
export function ProcessQueueForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction, pending] = useJobForm(processPublishingJobsAction);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Memproses…" : "Proses antrean sekarang"}
      </Button>
      <ResultMessage state={state} />
    </form>
  );
}
