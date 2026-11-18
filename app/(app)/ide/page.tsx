import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { listBrands, listIdeas } from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";
import { canConvertIdea, canCreateIdeas } from "@/features/planning/transitions";
import { IDEA_SOURCE_TYPE_LABELS, IDEA_STATUS_LABELS } from "@/features/planning/constants";
import type { WorkspaceRole } from "@/lib/permissions";
import { updateIdeaStatusAction } from "@/features/planning/actions";
import { ConvertIdeaButton } from "./ConvertIdeaButton";
import { IdeaForm } from "./IdeaForm";

/**
 * Ide — tangkap minimal (P2-08). Konversi penuh (inbox + brief) adalah
 * Phase 3; di sini konversi hanya membuat content item + menandai converted.
 */
export default async function IdePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Ide"
      description="Tangkap ide dengan cepat. Ide bisa dikonversi menjadi konten (satu transaksi) — ide yang sudah dikonversi tidak bisa dikonversi ulang."
    >
      {(ctx) => (
        <IdeContent workspaceId={ctx.workspace.workspaceId} role={ctx.role as WorkspaceRole} />
      )}
    </PlanningShell>
  );
}

async function IdeContent({ workspaceId, role }: { workspaceId: string; role: WorkspaceRole }) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const [brands, ideas] = await Promise.all([
    listBrands(supabase, workspaceId),
    listIdeas(supabase, workspaceId),
  ]);
  const unavailable = brands.unavailable || ideas.unavailable;
  const canCreate = canCreateIdeas(role);
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

      <section>
        <h2 className="font-semibold">Daftar ide ({ideas.data.length})</h2>
        {ideas.data.length === 0 && !unavailable ? (
          <div className="mt-3">
            <EmptyState
              title="Belum ada ide"
              description="Ide yang ditangkap tampil di sini. Inbox lengkap dengan filter dan brief hadir di Phase 3."
              icon="💡"
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {ideas.data.map((idea) => {
              const convertible = canConvertIdea(idea);
              const brandName = brands.data.find((b) => b.id === idea.brand_id)?.name ?? "—";
              return (
                <li
                  key={idea.id}
                  className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{idea.title}</span>
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
                      {idea.tags.length > 0 ? ` · Tag: ${idea.tags.join(", ")}` : ""}
                    </span>
                  </div>
                  {idea.notes ? (
                    <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{idea.notes}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {convertible && canCreate ? (
                      <ConvertIdeaButton ideaId={idea.id} workspaceId={workspaceId} />
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
