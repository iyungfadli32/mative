"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createChannelAction, updateChannelAction } from "@/features/planning/actions";
import type { SocialChannel } from "@/features/planning/types";
import { PLATFORM_LABELS } from "@/features/planning/constants";

/**
 * Form buat/edit channel registry (P2-05) — METADATA SAJA.
 * connection_status hanya not_connected/manual. TIDAK ADA OAuth/token.
 */
export function ChannelForm({
  workspaceId,
  brandId,
  brandName,
  initial,
}: {
  workspaceId: string;
  brandId: string;
  brandName: string;
  initial?: SocialChannel | null;
}) {
  const action = initial ? updateChannelAction : createChannelAction;
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
  });
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="brandId" value={brandId} />
      {initial ? <input type="hidden" name="channelId" value={initial.id} /> : null}
      <p className="text-sm text-[var(--mt-text-muted)]">Brand: {brandName}</p>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Platform
        <select
          name="platform"
          defaultValue={initial?.platform ?? "instagram"}
          disabled={Boolean(initial)}
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          {Object.entries(PLATFORM_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <Input
        id={`channel-account-${initial?.id ?? "new"}-${brandId}`}
        name="accountName"
        label="Nama akun"
        defaultValue={initial?.account_name ?? ""}
      />
      <Input
        id={`channel-handle-${initial?.id ?? "new"}-${brandId}`}
        name="handle"
        label="Handle (mis. @originsense.lab)"
        defaultValue={initial?.handle ?? ""}
      />
      <Input
        id={`channel-provider-${initial?.id ?? "new"}-${brandId}`}
        name="providerAccountId"
        label="ID akun provider (opsional — bukan token)"
        defaultValue={initial?.provider_account_id ?? ""}
      />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Status koneksi
        <select
          name="connectionStatus"
          defaultValue={initial?.connection_status ?? "not_connected"}
          className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
        >
          <option value="not_connected">Belum terhubung</option>
          <option value="manual">Manual (posting manual)</option>
        </select>
        <span className="text-[13px] font-normal text-[var(--mt-text-muted)]">
          Fase ini hanya mencatat metadata. Tidak ada OAuth, token, atau klaim “terhubung”.
        </span>
      </label>
      <Input
        id={`channel-tz-${initial?.id ?? "new"}-${brandId}`}
        name="timezone"
        label="Zona waktu channel (IANA)"
        defaultValue={initial?.timezone ?? "Asia/Jakarta"}
        required
      />
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        {initial ? "Simpan perubahan" : "Tambah channel"}
      </Button>
    </form>
  );
}
