"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { attachAssetAction, type ProductionActionResult } from "../actions";
import { ASSET_USAGE_ROLE_LABELS } from "../constants";
import type { Asset, AssetUsageRole } from "../types";

/** Form lampirkan aset dari pustaka ke konten (P3-08).
 *
 * PERBAIKAN 2026-11-19 (e2e Phase 3): komponen ini SENGAJA tetap dirender
 * meski tidak ada lagi aset bebas — pesannya hidup di useActionState, dan
 * unmount akan menghapus pesan sukses sebelum sempat dibaca. Dulu MediaTab
 * hanya merender form ini bila freeAssets.length > 0, sehingga begitu
 * lampiran terakhir berhasil + revalidasi berjalan, form (dan pesannya)
 * lenyap diganti teks "Semua aset siap..." — pesan "Aset dilampirkan ke
 * konten." tidak pernah terlihat, padahal lampiran berhasil. Sekarang:
 * bila tidak ada aset bebas, form menampilkan pesan sukses / teks
 * "Semua aset siap..." — bukan menghilang.
 */
export function AttachAssetForm({
  workspaceId,
  contentItemId,
  assets,
}: {
  workspaceId: string;
  contentItemId: string;
  assets: Asset[];
}) {
  const [state, formAction, pending] = useActionState(attachAssetAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  return (
    <>
      {assets.length > 0 ? (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="contentItemId" value={contentItemId} />
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Aset
              <select
                name="assetId"
                required
                className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
              >
                <option value="">— Pilih aset —</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.original_filename} ({a.mime_type})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Peran
              <select
                name="usageRole"
                defaultValue="attachment"
                className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
              >
                {(Object.keys(ASSET_USAGE_ROLE_LABELS) as AssetUsageRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ASSET_USAGE_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <Button type="submit" size="sm" loading={pending}>
              Lampirkan aset
            </Button>
          </div>
        </form>
      ) : state.message ? null : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Semua aset siap di pustaka sudah dilampirkan ke konten ini.
        </p>
      )}
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
    </>
  );
}
