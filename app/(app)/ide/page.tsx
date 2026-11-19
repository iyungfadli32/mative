import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { listBrands, listIdeas, listWorkspaceMembers } from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { canConvertIdea, canCreateIdeas } from "@/features/planning/transitions";
import { IDEA_SOURCE_TYPE_LABELS, IDEA_STATUS_LABELS } from "@/features/planning/constants";
import type { WorkspaceRole } from "@/lib/permissions";
import { updateIdeaStatusAction } from "@/features/planning/actions";
import { ConvertIdeaButton } from "./ConvertIdeaButton";
import { IdeaForm } from "./IdeaForm";

/**
 * Ide — inbox (P3-04): filter status/brand/owner + detail ide + konversi
 * ke konten (satu transaksi RPC 0008). Ide yang sudah dikonversi tidak
 * bisa dikonversi ulang.
 */
export default async function IdePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  const statusFilter = typeof sp.status === "string" ? sp.status : "";
  const brandFilter = typeof sp.brand === "string" ? sp.brand : "";
  const ownerFilter = typeof sp.owner === "string" ? sp.owner : "";
  const ideaDetailId = typeof sp.idea === "string" ? sp.idea : "";
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Ide"
      description="Inbox ide: saring berdasarkan status, brand, atau pemilik, lalu konversi menjadi konten (satu transaksi) — ide yang sudah dikonversi tidak bisa dikonversi ulang."
    >
      {(ctx) => (
        <IdeContent
          workspaceId={ctx.workspace.workspaceId}
          role={ctx.role as WorkspaceRole}
          statusFilter={statusFilter}
          brandFilter={brandFilter}
          ownerFilter={ownerFilter}
          ideaDetailId={ideaDetailId}
        />
      )}
    </PlanningShell>
  );
}

async function IdeContent({
  workspaceId,
  role,
  statusFilter,
  brandFilter,
  ownerFilter,
  ideaDetailId,
}: {
  workspaceId: string;
  role: WorkspaceRole;
  statusFilter: string;
  brandFilter: string;
  ownerFilter: string;
  ideaDetailId: string;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const [brands, ideas, members] = await Promise.all([
    listBrands(supabase, workspaceId),
    listIdeas(supabase, workspaceId),
    listWorkspaceMembers(supabase, workspaceId),
  ]);
  const unavailable = brands.unavailable || ideas.unavailable;
  const canCreate = canCreateIdeas(role);
  const memberNames = new Map(members.map((m) => [m.userId, m.displayName]));
  const filtered = ideas.data.filter((idea) => {
    if (statusFilter && (idea.status ?? "new") !== statusFilter) return false;
    if (brandFilter && idea.brand_id !== brandFilter) return false;
    if (ownerFilter && idea.owner_user_id !== ownerFilter) return false;
    return true;
  });
  const detailIdea = ideaDetailId ? (ideas.data.find((i) => i.id === ideaDetailId) ?? null) : null;
  return (
    <div className="flex flex-col gap-6">
      {unavailable ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          ⚠️ {PLANNING_TABLES_UNAVAILABLE_ID}
        </div>
      ) : null}

      {canCreate ? (
        <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Tangkap ide baru</h2>
          <div className="mt-3 max-w-xl">
            <IdeaForm workspaceId={workspaceId} brands={brands.data} />
          </div>
        </section>
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">Peran Anda tidak boleh menangkap ide.</p>
      )}

      <section className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Saring inbox</h2>
        <form method="get" className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="workspace" value={workspaceId} />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Status
            <select
              name="status"
              defaultValue={statusFilter}
              className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
            >
              <option value="">Semua status</option>
              <option value="new">Baru</option>
              <option value="considering">Dipertimbangkan</option>
              <option value="converted">Dikonversi</option>
              <option value="dropped">Dibatalkan</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Brand
            <select
              name="brand"
              defaultValue={brandFilter}
              className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
            >
              <option value="">Semua brand</option>
              {brands.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Pemilik
            <select
              name="owner"
              defaultValue={ownerFilter}
              className="h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm font-normal"
            >
              <option value="">Semua pemilik</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm">
            Terapkan filter
          </Button>
          {(statusFilter || brandFilter || ownerFilter) && (
            <Link
              href={`/ide?workspace=${workspaceId}`}
              className="text-sm font-medium text-[var(--mt-teal-700)] underline"
            >
              Hapus filter
            </Link>
          )}
        </form>
      </section>

      {detailIdea ? (
        <section className="rounded-2xl border border-[var(--mt-teal-700)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Detail ide: {detailIdea.title}</h2>
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
            Status:{" "}
            {IDEA_STATUS_LABELS[(detailIdea.status ?? "new") as keyof typeof IDEA_STATUS_LABELS] ??
              detailIdea.status}
            {" · "}Sumber:{" "}
            {IDEA_SOURCE_TYPE_LABELS[
              (detailIdea.source_type ?? "other") as keyof typeof IDEA_SOURCE_TYPE_LABELS
            ] ?? detailIdea.source_type}
            {" · "}Brand: {brands.data.find((b) => b.id === detailIdea.brand_id)?.name ?? "—"}
            {" · "}Pemilik:{" "}
            {detailIdea.owner_user_id ? (memberNames.get(detailIdea.owner_user_id) ?? "—") : "—"}
            {detailIdea.tags.length > 0 ? ` · Tag: ${detailIdea.tags.join(", ")}` : ""}
          </p>
          {detailIdea.notes ? (
            <p className="mt-2 whitespace-pre-wrap text-sm">{detailIdea.notes}</p>
          ) : (
            <p className="mt-2 text-sm text-[var(--mt-text-muted)]">Tidak ada catatan.</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canConvertIdea(detailIdea) && canCreate ? (
              <ConvertIdeaButton
                ideaId={detailIdea.id}
                workspaceId={workspaceId}
                brands={brands.data}
                ideaBrandId={detailIdea.brand_id}
              />
            ) : detailIdea.converted_content_item_id ? (
              <Link
                href={`/konten/${detailIdea.converted_content_item_id}`}
                className="text-sm font-medium text-[var(--mt-teal-700)] underline"
              >
                Lihat konten hasil konversi →
              </Link>
            ) : (
              <span className="text-sm text-[var(--mt-text-muted)]">
                Sudah dikonversi / tidak bisa dikonversi ulang.
              </span>
            )}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="font-semibold">
          Daftar ide ({filtered.length}
          {filtered.length !== ideas.data.length ? ` dari ${ideas.data.length}` : ""})
        </h2>
        {filtered.length === 0 && !unavailable ? (
          <div className="mt-3">
            <EmptyState
              title="Belum ada ide yang cocok"
              description="Ubah filter atau tangkap ide baru di atas."
              icon="💡"
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {filtered.map((idea) => {
              const convertible = canConvertIdea(idea);
              const brandName = brands.data.find((b) => b.id === idea.brand_id)?.name ?? "—";
              return (
                <li
                  key={idea.id}
                  className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/ide?workspace=${workspaceId}${statusFilter ? `&status=${statusFilter}` : ""}${brandFilter ? `&brand=${brandFilter}` : ""}${ownerFilter ? `&owner=${ownerFilter}` : ""}&idea=${idea.id}`}
                      className="font-semibold underline"
                    >
                      {idea.title}
                    </Link>
                    <StatusBadge
                      label={`● ${IDEA_STATUS_LABELS[(idea.status ?? "new") as keyof typeof IDEA_STATUS_LABELS] ?? idea.status ?? "Baru"}`}
                      tone={idea.status === "converted" ? "success" : "neutral"}
                    />
                    <span className="text-xs text-[var(--mt-text-muted)]">
                      Sumber:{" "}
                      {IDEA_SOURCE_TYPE_LABELS[
                        (idea.source_type ?? "other") as keyof typeof IDEA_SOURCE_TYPE_LABELS
                      ] ?? idea.source_type}{" "}
                      · Brand: {brandName}
                      {idea.owner_user_id
                        ? ` · Pemilik: ${memberNames.get(idea.owner_user_id) ?? "—"}`
                        : ""}
                      {idea.tags.length > 0 ? ` · Tag: ${idea.tags.join(", ")}` : ""}
                    </span>
                  </div>
                  {idea.notes ? (
                    <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{idea.notes}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {convertible && canCreate ? (
                      <ConvertIdeaButton
                        ideaId={idea.id}
                        workspaceId={workspaceId}
                        brands={brands.data}
                        ideaBrandId={idea.brand_id}
                      />
                    ) : idea.converted_content_item_id ? (
                      <Link
                        href={`/konten/${idea.converted_content_item_id}`}
                        className="text-sm font-medium text-[var(--mt-teal-700)] underline"
                      >
                        Lihat konten hasil konversi →
                      </Link>
                    ) : (
                      <span className="text-sm text-[var(--mt-text-muted)]">
                        Sudah dikonversi / tidak bisa dikonversi ulang.
                      </span>
                    )}
                    {idea.status !== "converted" && canCreate ? (
                      <form action={updateIdeaStatusAction}>
                        <input type="hidden" name="ideaId" value={idea.id} />
                        <input type="hidden" name="workspaceId" value={workspaceId} />
                        <input
                          type="hidden"
                          name="status"
                          value={idea.status === "considering" ? "new" : "considering"}
                        />
                        <Button type="submit" size="sm" variant="secondary">
                          {idea.status === "considering"
                            ? "Tandai belum dipertimbangkan"
                            : "Tandai dipertimbangkan"}
                        </Button>
                      </form>
                    ) : null}
                    {idea.status !== "converted" && idea.status !== "dropped" && canCreate ? (
                      <form action={updateIdeaStatusAction}>
                        <input type="hidden" name="ideaId" value={idea.id} />
                        <input type="hidden" name="workspaceId" value={workspaceId} />
                        <input type="hidden" name="status" value="dropped" />
                        <Button type="submit" size="sm" variant="ghost">
                          Batalkan ide
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
