"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { convertIdeaAction } from "@/features/planning/actions";
import type { Brand } from "@/features/planning/types";

/**
 * Tombol konversi ide → konten (P2-08, diperbaiki 0012) dengan pesan hasil.
 * Brand WAJIB dipilih di form ini: content_items.brand_id NOT NULL (0007,
 * Dok 05 §3, ERD §5) — ide tanpa brand tidak bisa dikonversi sebelum brand
 * dipilih. Bila ide sudah punya brand, brand itu terpilih awal (boleh
 * diganti); bila belum, pengguna wajib memilih satu.
 *
 * PERBAIKAN 2026-11-19 (e2e Phase 3): komponen ini SENGAJA tetap dirender
 * setelah ide dikonversi (bukan di-unmount oleh halaman) — pesannya hidup
 * di useActionState, dan unmount akan menghapus pesan sukses sebelum sempat
 * dibaca. Dulu halaman hanya merender tombol ini bila ide masih bisa
 * dikonversi, sehingga begitu aksi sukses + revalidasi berjalan, tombol
 * (dan pesannya) lenyap diganti tautan — pesan "Ide dikonversi menjadi
 * konten baru (v1)." tidak pernah terlihat. Sekarang: bila sudah
 * dikonversi, tombol menampilkan pesan sukses / tautan hasil, bukan form.
 */
export function ConvertIdeaButton({
  ideaId,
  workspaceId,
  brands,
  ideaBrandId,
  convertedContentItemId,
}: {
  ideaId: string;
  workspaceId: string;
  brands: Brand[];
  ideaBrandId: string | null;
  convertedContentItemId: string | null;
}) {
  const [state, formAction, pending] = useActionState(convertIdeaAction, {
    ok: false,
    message: "",
  });
  const converted = convertedContentItemId !== null;
  return (
    <span className="inline-flex flex-col gap-1">
      {!converted && !state.ok ? (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="ideaId" value={ideaId} />
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <label className="flex flex-col gap-1 text-sm font-medium">
            Brand (wajib untuk konversi)
            <select
              name="brandId"
              defaultValue={ideaBrandId ?? ""}
              required
              className="h-9 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
            >
              <option value="">— Pilih brand —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" loading={pending}>
            Konversi menjadi konten
          </Button>
        </form>
      ) : null}
      {state.message ? (
        <span role={state.ok ? "status" : "alert"} className="text-xs">
          {state.message}
          {state.ok && state.contentItemId ? (
            <>
              {" "}
              <a href={`/konten/${state.contentItemId}`} className="font-medium underline">
                Lihat konten →
              </a>
            </>
          ) : null}
        </span>
      ) : converted ? (
        <a
          href={`/konten/${convertedContentItemId}`}
          className="text-sm font-medium text-[var(--mt-teal-700)] underline"
        >
          Lihat konten hasil konversi →
        </a>
      ) : null}
    </span>
  );
}
