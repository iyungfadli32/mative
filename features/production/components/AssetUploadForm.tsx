"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  confirmAssetUploadAction,
  prepareAssetUploadAction,
} from "../actions";
import { ALLOWED_ASSET_MIME_TYPES, MAX_ASSET_BYTES } from "../constants";

/**
 * Form unggah aset (P3-07, jalur signed URL — perbaikan (c) K-1).
 * File TIDAK PERNAH lewat Server Action (batas body Next.js 1 MB):
 *   1. prepare → server membuat baris aset 'uploading' + signed upload URL
 *   2. browser PUT file langsung ke Storage (Supabase) lewat URL itu
 *   3. confirm → server mengunduh objek, validasi ulang isi file
 *      (magic bytes + ukuran), lalu tandai 'ready' + versi v1.
 * Jenis file dicek dari ISI file di server — ekstensi nama file tidak
 * dipercaya. Maks 10 MB (janji ini sekarang benar-benar berlaku).
 * Tanpa pemindaian virus di MVP — jangan klaim file aman dari malware.
 */
export function AssetUploadForm({ workspaceId }: { workspaceId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState("");
  const [state, setState] = useState<{ ok: boolean; message: string }>({
    ok: false,
    message: "",
  });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setState({ ok: false, message: "Pilih file dulu." });
      return;
    }
    // Saringan awal di client (pengalaman pengguna saja — server tetap
    // memvalidasi ulang: prepare memeriksa deklarasi, confirm memeriksa isi).
    if (file.size > MAX_ASSET_BYTES) {
      setState({ ok: false, message: "File melebihi batas 10 MB." });
      return;
    }
    if (!(ALLOWED_ASSET_MIME_TYPES as readonly string[]).includes(file.type)) {
      setState({
        ok: false,
        message:
          "Jenis file tidak diizinkan. Yang diterima: PNG, JPEG, WebP, MP4, WebM, PDF (dicek dari isi file).",
      });
      return;
    }
    setPending(true);
    setState({ ok: false, message: "" });

    setPhase("Menyiapkan unggahan…");
    const prepared = await prepareAssetUploadAction({
      workspaceId,
      fileName: file.name,
      byteSize: file.size,
      mimeType: file.type,
    });
    if (!prepared.ok || !prepared.signedUrl || !prepared.assetId) {
      setState({ ok: false, message: prepared.message });
      setPending(false);
      setPhase("");
      return;
    }

    setPhase("Mengunggah file…");
    let putResponse: Response;
    try {
      putResponse = await fetch(prepared.signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
    } catch {
      setState({
        ok: false,
        message: "Gagal mengunggah file ke penyimpanan. Periksa koneksi lalu coba lagi.",
      });
      setPending(false);
      setPhase("");
      return;
    }
    if (!putResponse.ok) {
      setState({
        ok: false,
        message: "Gagal mengunggah file ke penyimpanan. Coba lagi.",
      });
      setPending(false);
      setPhase("");
      return;
    }

    setPhase("Mengonfirmasi unggahan…");
    const confirmed = await confirmAssetUploadAction({
      assetId: prepared.assetId,
      workspaceId,
    });
    setState({ ok: confirmed.ok, message: confirmed.message });
    if (confirmed.ok) formRef.current?.reset();
    setPending(false);
    setPhase("");
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Pilih file (PNG, JPEG, WebP, MP4, WebM, PDF — maks 10 MB)
        <input
          ref={fileRef}
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
      {pending && phase ? <p className="text-sm">{phase}</p> : null}
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
