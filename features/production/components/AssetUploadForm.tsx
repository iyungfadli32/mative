"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { uploadAssetAction, type ProductionActionResult } from "../actions";
import { MAX_ASSET_BYTES } from "../constants";

/**
 * Form unggah aset (P3-07). Jenis file dicek dari ISI file di server
 * (magic bytes) — ekstensi nama file tidak dipercaya. Maks 10 MB.
 * Tanpa pemindaian virus di MVP — jangan klaim file aman dari malware.
 */
export function AssetUploadForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction, pending] = useActionState(uploadAssetAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Pilih file (PNG, JPEG, WebP, MP4, WebM, PDF — maks 10 MB)
        <input
          type="file"
          name="file"
          required
          accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,application/pdf"
          className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm"
        />
      </label>
      <p className="text-xs text-[var(--mt-text-muted)]">
        File disimpan privat di bucket mative-assets; hanya bisa dibuka lewat tautan bertanda tangan
        1 jam. Batas {Math.round(MAX_ASSET_BYTES / 1024 / 1024)} MB per file.
      </p>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" loading={pending}>
        Unggah aset
      </Button>
    </form>
  );
}
