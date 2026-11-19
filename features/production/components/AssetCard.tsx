"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { deleteAssetAction, detachAssetAction, type ProductionActionResult } from "../actions";
import { ASSET_USAGE_ROLE_LABELS } from "../constants";
import type { Asset, ContentAsset } from "../types";
import { formatInTimezone } from "@/lib/time";

/** Kartu aset di pustaka (P3-07): pratinjau lewat signed URL, metadata, hapus. */
export function AssetCard({
  asset,
  signedUrl,
  uploaderName,
  canDelete,
  workspaceId,
}: {
  asset: Asset;
  signedUrl: string | null;
  uploaderName: string | null;
  canDelete: boolean;
  workspaceId: string;
}) {
  const [state, formAction, pending] = useActionState(deleteAssetAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  const isImage = asset.mime_type.startsWith("image/");
  const sizeKb = Math.max(1, Math.round(asset.byte_size / 1024));
  return (
    <li className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
      {isImage && signedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={signedUrl}
          alt={asset.original_filename}
          className="h-40 w-full rounded-xl object-cover"
        />
      ) : signedUrl ? (
        <a
          href={signedUrl}
          target="_blank"
          rel="noreferrer"
          className="block rounded-xl border border-[var(--mt-border)] p-4 text-center text-sm font-medium text-[var(--mt-teal-700)]"
        >
          Buka file ({asset.mime_type})
        </a>
      ) : (
        <p className="rounded-xl border border-[var(--mt-border)] p-4 text-center text-sm text-[var(--mt-text-muted)]">
          Pratinjau tidak tersedia (tautan kedaluwarsa atau file gagal diunggah).
        </p>
      )}
      <p className="mt-2 font-medium">{asset.original_filename}</p>
      <p className="text-xs text-[var(--mt-text-muted)]">
        {asset.mime_type} · {sizeKb} KB
        {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
        {asset.processing_status !== "ready" ? ` · Status: ${asset.processing_status}` : ""}
      </p>
      <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
        Diunggah {uploaderName ?? "—"} · {formatInTimezone(asset.created_at)}
      </p>
      {asset.rights_notes ? (
        <p className="mt-1 text-xs text-[var(--mt-text-muted)]">Hak pakai: {asset.rights_notes}</p>
      ) : null}
      {canDelete ? (
        <form action={formAction} className="mt-3">
          <input type="hidden" name="assetId" value={asset.id} />
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <Button type="submit" size="sm" variant="ghost" loading={pending}>
            Hapus aset
          </Button>
        </form>
      ) : null}
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="mt-2 text-sm">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}

/** Satu lampiran aset di tab Media editor (P3-08). */
export function ContentAssetRow({
  link,
  signedUrl,
  canEdit,
  workspaceId,
}: {
  link: ContentAsset;
  signedUrl: string | null;
  canEdit: boolean;
  workspaceId: string;
}) {
  const asset = link.asset;
  if (!asset) return null;
  const isImage = asset.mime_type.startsWith("image/");
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--mt-border)] p-3">
      {isImage && signedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={signedUrl}
          alt={asset.original_filename}
          className="h-16 w-16 rounded-lg object-cover"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{asset.original_filename}</p>
        <p className="text-xs text-[var(--mt-text-muted)]">
          Peran: {ASSET_USAGE_ROLE_LABELS[link.usage_role]} · {asset.mime_type} ·{" "}
          {Math.max(1, Math.round(asset.byte_size / 1024))} KB
        </p>
      </div>
      {signedUrl && !isImage ? (
        <a
          href={signedUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-[var(--mt-teal-700)] underline"
        >
          Buka
        </a>
      ) : null}
      {canEdit ? <DetachAssetButton contentAssetId={link.id} workspaceId={workspaceId} /> : null}
    </li>
  );
}

/** Tombol lepas lampiran (P3-08): melepas lampiran TIDAK menghapus file aset. */
export function DetachAssetButton({
  contentAssetId,
  workspaceId,
}: {
  contentAssetId: string;
  workspaceId: string;
}) {
  const [state, formAction, pending] = useActionState(detachAssetAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  return (
    <span className="inline-flex flex-col gap-1">
      <form action={formAction}>
        <input type="hidden" name="contentAssetId" value={contentAssetId} />
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <Button type="submit" size="sm" variant="ghost" loading={pending}>
          Lepas lampiran
        </Button>
      </form>
      {state.message ? (
        <span role={state.ok ? "status" : "alert"} className="text-xs">
          {state.message}
        </span>
      ) : null}
    </span>
  );
}
