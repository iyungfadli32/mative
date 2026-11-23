/**
 * Form buat job publishing — features/publishing/components/CreateJobForm.tsx (P6-04).
 * Aturan: form TIDAK PERNAH disembunyikan berdasarkan hasil aksinya sendiri
 * (pelajaran e2e Phase 3/4/5) — pesan tampil di bawah form yang tetap mounted.
 * Jadwal diketik sebagai wall-clock di zona placement; konversi ke UTC
 * dilakukan server action (bukan di browser, bukan zona server).
 */
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createPublishingJobAction } from "../actions";
import type { PreflightResult } from "../types";
import { PreflightChecklist } from "./PreflightChecklist";

function ResultMessage({ state }: { state: { ok: boolean; message: string } }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className="text-sm">
      {state.message}
    </p>
  );
}

export function CreateJobForm({
  workspaceId,
  placementId,
  placementTimezone,
  defaultScheduledAt,
  preflight,
}: {
  workspaceId: string;
  placementId: string;
  placementTimezone: string;
  /** Wall-clock "YYYY-MM-DDTHH:mm" di zona placement (dari placement.scheduled_at). */
  defaultScheduledAt: string;
  preflight: PreflightResult | null;
}) {
  const [state, formAction, pending] = useActionState(createPublishingJobAction, {
    ok: false,
    message: "",
  });
  const blocked = preflight !== null && !preflight.ok;
  return (
    <div className="flex flex-col gap-4">
      <PreflightChecklist preflight={preflight} />
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="placementId" value={placementId} />
        <Input
          id="pub-scheduled-at"
          type="datetime-local"
          name="scheduledAt"
          label={`Jadwal terbit (zona ${placementTimezone})`}
          hint={`Kosongkan bila ingin terbit segera (status Ready). Waktu yang diketik dibaca sebagai waktu di zona ${placementTimezone}, lalu disimpan sebagai UTC.`}
          defaultValue={defaultScheduledAt}
        />
        <Input
          id="pub-timezone"
          type="text"
          name="timezone"
          label="Zona waktu"
          hint="Zona waktu mengikuti placement (ASUMSI-6.6). Ubah hanya bila jadwal ini memakai zona lain — harus nama zona IANA yang valid, misalnya Asia/Jakarta."
          defaultValue={placementTimezone}
        />
        <Button type="submit" disabled={pending || blocked}>
          {pending ? "Membuat job…" : "Buat job publikasi"}
        </Button>
        {blocked ? (
          <p className="text-sm text-[var(--mt-text-muted)]">
            Perbaiki dulu pemeriksaan yang memblokir di atas sebelum membuat job.
          {preflight?.code === "DUPLICATE_JOB" ? (
            <>
              {" "}
              Sudah ada job aktif untuk placement ini di jadwal yang sama. Lihat{" "}
              <Link href="/publishing">antrean publishing</Link> untuk membatalkan atau
              menjadwalkan ulang job tersebut; job yang sudah gagal tidak menghalangi
              pembuatan job baru.
            </>
          ) : null}
          </p>
        ) : null}
        <ResultMessage state={state} />
      </form>
      <p className="text-xs text-[var(--mt-text-muted)]">
        Di Phase 6 tidak ada penerbitan otomatis ke platform. Job yang jatuh tempo diserahkan ke
        aksi manual: Anda terbitkan sendiri di platform, lalu konfirmasi di sini dengan URL dan
        waktu terbit.
      </p>
    </div>
  );
}
