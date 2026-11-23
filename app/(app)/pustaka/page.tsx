import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { sweepStaleAssetUploadsAction } from "@/features/production/actions";
import { getAssetSignedUrl, listAssetVersionsByAssetIds, listAssets } from "@/features/production/queries";
import { AssetCard } from "@/features/production/components/AssetCard";
import { AssetUploadForm } from "@/features/production/components/AssetUploadForm";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { listWorkspaceMembers } from "@/features/planning/queries";

/**
 * Pustaka Aset (P3-07): aset privat per workspace — unggah, pratinjau
 * lewat signed URL 1 jam, hapus (hanya bila tidak ada lampiran).
 * Tanpa pemindaian virus di MVP.
 */
export default async function PustakaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Pustaka Aset"
      description="Aset privat workspace: gambar, video, dan PDF untuk dipakai di konten."
    >
      {(ctx) => (
        <PustakaContent workspaceId={ctx.workspace.workspaceId} role={ctx.role as WorkspaceRole} />
      )}
    </PlanningShell>
  );
}

async function PustakaContent({ workspaceId, role }: { workspaceId: string; role: WorkspaceRole }) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  // Perbaikan (c) T-1: penyapu berkala -- setiap kali Pustaka dibuka,
  // unggahan uploading yang lebih tua dari 60 menit ditandai gagal dan
  // objek Storage yatimnya ikut dihapus. Gagal menyapu tidak menghalangi
  // halaman (daftar aset tetap ditampilkan apa adanya).
  try {
    await sweepStaleAssetUploadsAction({ workspaceId, olderThanMinutes: 60 });
  } catch {
    // Abaikan: penyapu tidak boleh merusak halaman Pustaka.
  }
  const canUpload = can(role, "upload_assets");
  const canDelete = ["owner", "admin", "manager"].includes(role);
  const assets = await listAssets(supabase, workspaceId);
  const versionsByAsset = await listAssetVersionsByAssetIds(
    supabase,
    assets.data.map((asset) => asset.id),
  );
  const members = await listWorkspaceMembers(supabase, workspaceId);
  const names = new Map(members.map((m) => [m.userId, m.displayName]));
  const signedUrls = new Map<string, string | null>();
  for (const asset of assets.data) {
    if (asset.processing_status === "ready") {
      signedUrls.set(asset.id, await getAssetSignedUrl(supabase, asset.object_key));
    } else {
      signedUrls.set(asset.id, null);
    }
  }
  return (
    <div className="flex flex-col gap-6">
      {assets.unavailable ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          ⚠️ {PLANNING_TABLES_UNAVAILABLE_ID}
        </div>
      ) : null}

      {canUpload ? (
        <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Unggah aset baru</h2>
          <div className="mt-3 max-w-xl">
            <AssetUploadForm workspaceId={workspaceId} />
          </div>
        </section>
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Peran Anda tidak boleh mengunggah aset.
        </p>
      )}

      <section>
        <h2 className="font-semibold">Aset ({assets.data.length})</h2>
        {assets.data.length === 0 && !assets.unavailable ? (
          <div className="mt-3">
            <EmptyState
              title="Belum ada aset"
              description="Unggah gambar, video, atau PDF — aset bisa dilampirkan ke konten dari tab Media di editor konten."
              icon="🖼️"
            />
          </div>
        ) : (
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assets.data.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                signedUrl={signedUrls.get(asset.id) ?? null}
                uploaderName={asset.uploaded_by ? (names.get(asset.uploaded_by) ?? null) : null}
                canDelete={canDelete}
                workspaceId={workspaceId}
                versions={versionsByAsset.get(asset.id) ?? []}
                canUpload={canUpload}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
