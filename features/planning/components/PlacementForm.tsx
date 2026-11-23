"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { PlanningActionResult } from "../actions";
import type { ContentPlacement, SocialChannel } from "../types";
import { PLATFORM_FORMAT_LABELS, PLATFORM_LABELS } from "../constants";

/**
 * Form tambah/edit placement (P2-10). Jadwal + status distribusi TIDAK
 * diubah di sini — jadwal lewat reschedule (kalender), status distribusi
 * lewat TransitionForm. remote_post_id/published_url tidak pernah diisi.
 */
export function PlacementForm({
  workspaceId,
  contentItemId,
  channels,
  initial,
  action,
  submitLabel,
  // Form SENGAJA tetap dirender walau disabled — bila di-unmount tepat
  // saat aksinya berhasil, pesan sukses useActionState hilang sebelum
  // dibaca (pola Phase 3/4; cacat e2e 2026-11-19: pesan "Placement
  // ditambahkan (versi v1)." lenyap karena form tambah di-unmount saat
  // freeChannels jadi kosong sesudah revalidasi). Saat disabled, tombol
  // kirim + select channel nonaktif; penjelasannya dirender pemanggil.
  disabled = false,
}: {
  workspaceId: string;
  contentItemId: string;
  channels: SocialChannel[];
  initial: ContentPlacement | null;
  action: (prev: PlanningActionResult, formData: FormData) => Promise<PlanningActionResult>;
  submitLabel: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="contentItemId" value={contentItemId} />
      {initial ? <input type="hidden" name="placementId" value={initial.id} /> : null}
      {/* Select channel di-disable saat edit (channel tak bisa diubah),
          tapi kontrol disabled TIDAK ikut terkirim — tanpa input
          tersembunyi ini socialChannelId null dan validasi update selalu
          gagal ("Data tidak valid.", defect Langkah 0 Phase 3: edit
          placement tak pernah bisa menyimpan). */}
      {initial ? (
        <input type="hidden" name="socialChannelId" value={initial.social_channel_id} />
      ) : null}
      {/* Edit tidak mengubah jadwal/distribusi — kirim nilai lama apa adanya. */}
      {initial ? (
        <>
          <input type="hidden" name="scheduledAt" value={initial.scheduled_at ?? ""} />
          <input type="hidden" name="distributionStatus" value={initial.distribution_status} />
        </>
      ) : null}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Channel <span className="text-[var(--mt-rose-700)]">*</span>
        <select
          name="socialChannelId"
          defaultValue={initial?.social_channel_id ?? ""}
          required
          disabled={disabled || Boolean(initial)}
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="">— Pilih channel —</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {PLATFORM_LABELS[c.platform as keyof typeof PLATFORM_LABELS] ?? c.platform}
              {c.account_name ? ` — ${c.account_name}` : ""}
              {c.handle ? ` (${c.handle})` : ""} · belum terhubung
            </option>
          ))}
        </select>
        <span className="text-[13px] font-normal text-[var(--mt-text-muted)]">
          Channel di fase ini hanya metadata — statusnya “belum terhubung”. Belum ada publish.
        </span>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Format platform
        <select
          name="platformFormat"
          defaultValue={initial?.platform_format ?? ""}
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="">— Tanpa format —</option>
          {Object.entries(PLATFORM_FORMAT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Caption per channel
        <textarea
          name="platformCaption"
          defaultValue={initial?.platform_caption ?? ""}
          rows={3}
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
        />
      </label>
      <Input
        id="placement-hashtags"
        name="platformHashtags"
        label="Hashtag (pisahkan dengan koma, tanpa #)"
        defaultValue={(initial?.platform_hashtags ?? []).join(", ")}
        hint="Contoh: mative, konten, perencanaan"
      />
      {!initial ? (
        <Input
          id="placement-scheduledAt"
          name="scheduledAt"
          type="datetime-local"
          label="Jadwal tayang (opsional — kosong = backlog)"
          defaultValue=""
        />
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Jadwal saat ini: {initial.scheduled_at ?? "belum terjadwal"} — ubah lewat kalender.
        </p>
      )}
      <input type="hidden" name="timezone" value={initial?.timezone ?? "Asia/Jakarta"} />
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending} disabled={disabled}>
        {submitLabel}
      </Button>
    </form>
  );
}
