"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmAssetVersionUploadAction,
  prepareAssetVersionUploadAction,
  restoreAssetVersionAction,
} from "../actions";
import type { AssetVersion } from "../types";

// Perbaikan (c) T-3: riwayat versi aset -- daftar versi + pulihkan + unggah
// versi baru. Pulihan dicatat RPC sebagai versi BARU (append-only), jadi
// riwayat tidak pernah kehilangan versi lama.
export function AssetVersionHistory({
  workspaceId,
  assetId,
  currentObjectKey,
  versions,
  canManage,
}: {
  workspaceId: string;
  assetId: string;
  currentObjectKey: string;
  versions: AssetVersion[];
  canManage: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [restoreState, restoreAction, restorePending] = useActionState(
    restoreAssetVersionAction,
    { ok: false, message: "" },
  );

  async function handleNewVersion(file: File | undefined) {
    if (!file || pending) return;
    setPending(true);
    setMessage("Menyiapkan unggah versi baru...");
    const prepared = await prepareAssetVersionUploadAction({
      assetId,
      workspaceId,
      fileName: file.name,
      byteSize: file.size,
      mimeType: file.type,
    });
    if (!prepared.ok || !prepared.signedUrl) {
      setMessage(prepared.message);
      setPending(false);
      return;
    }
    setMessage("Mengunggah file...");
    let putResponse: Response;
    try {
      putResponse = await fetch(prepared.signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
    } catch {
      setMessage("Gagal mengunggah file ke penyimpanan. Periksa koneksi lalu coba lagi.");
      setPending(false);
      return;
    }
    if (!putResponse.ok) {
      setMessage("Gagal mengunggah file ke penyimpanan. Coba lagi.");
      setPending(false);
      return;
    }
    setMessage("Mengonfirmasi versi baru...");
    const confirmed = await confirmAssetVersionUploadAction({
      assetId,
      workspaceId,
      versionNumber: prepared.versionNumber,
      fileName: file.name,
    });
    if (!confirmed.ok) {
      setMessage(confirmed.message);
      setPending(false);
      return;
    }
    setMessage("");
    setPending(false);
    router.refresh();
  }

  return (
    <div className="mt-3 border-t border-zinc-200 pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-xs font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900"
      >
        {open ? "Sembunyikan riwayat versi" : "Riwayat versi (" + String(versions.length) + ")"}
      </button>
      {open ? (
        <ol className="mt-2 space-y-2">
          {versions.map((version) => {
            const isCurrent = version.storage_object_key === currentObjectKey;
            const fileName = version.storage_object_key.split("/").pop() ?? version.storage_object_key;
            return (
              <li key={version.id} className="flex items-center justify-between gap-2 text-xs">
                <span>
                  <strong>v{version.version_number}</strong> - {fileName} -{" "}
                  {new Date(version.created_at).toLocaleDateString("id-ID", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {isCurrent ? " (saat ini)" : ""}
                </span>
                {canManage && !isCurrent ? (
                  <form action={restoreAction}>
                    <input type="hidden" name="assetId" value={assetId} />
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="versionId" value={version.id} />
                    <button
                      type="submit"
                      disabled={restorePending}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                    >
                      Pulihkan
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {restoreState.message ? (
        <p className="mt-2 text-xs text-zinc-700">{restoreState.message}</p>
      ) : null}
      {canManage ? (
        <div className="mt-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*,.pdf"
            className="hidden"
            onChange={(event) => {
              void handleNewVersion(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            {pending ? "Mengunggah versi baru..." : "Unggah versi baru"}
          </button>
          {message ? <p className="mt-1 text-xs text-zinc-700">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
