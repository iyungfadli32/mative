"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmAssetUploadAction,
  prepareAssetRetryUploadAction,
} from "../actions";

// Perbaikan (c) T-1: tombol Unggah ulang untuk baris aset yang failed.
// Memakai ulang baris DB yang sama (prepare retry + PUT + confirm).
export function AssetRetryButton({
  assetId,
  workspaceId,
}: {
  assetId: string;
  workspaceId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function handleFile(file: File | undefined) {
    if (!file || pending) return;
    setPending(true);
    setMessage("Menyiapkan unggah ulang...");
    const prepared = await prepareAssetRetryUploadAction({
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
    setMessage("Mengonfirmasi unggahan...");
    const confirmed = await confirmAssetUploadAction({ assetId, workspaceId });
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
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*,.pdf"
        className="hidden"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-amber-600 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
      >
        {pending ? "Mengunggah ulang..." : "Unggah ulang"}
      </button>
      {message ? <p className="mt-1 text-xs text-amber-700">{message}</p> : null}
    </div>
  );
}
