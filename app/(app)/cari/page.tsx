import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PlanningShell } from "@/features/planning/components/PlanningShell";
import { EmptyState } from "@/components/ui/States";
import { searchPlanning, type SearchHit } from "@/features/planning/queries";
import { PLANNING_TABLES_UNAVAILABLE_ID } from "@/features/planning/context";

/**
 * Pencarian global (P2-13). Ter-scope tenant: semua sumber dibatasi
 * workspace aktif. Filter tercermin di URL (?q=...&workspace=...).
 */
export default async function CariPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  const q = typeof sp.q === "string" ? sp.q : "";
  return (
    <PlanningShell
      requestedWorkspaceId={workspaceParam}
      title="Pencarian"
      description="Cari konten, campaign, ide, dan brand di dalam workspace ini saja — tanpa kebocoran lintas-tenant."
    >
      {(ctx) => <CariContent workspaceId={ctx.workspace.workspaceId} q={q} />}
    </PlanningShell>
  );
}

const KIND_LABEL: Record<SearchHit["kind"], { label: string; icon: string }> = {
  content: { label: "Konten", icon: "📝" },
  campaign: { label: "Campaign", icon: "🎯" },
  idea: { label: "Ide", icon: "💡" },
  brand: { label: "Brand", icon: "🏷️" },
};

async function CariContent({ workspaceId, q }: { workspaceId: string; q: string }) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return <p className="text-sm">Supabase belum dikonfigurasi.</p>;
  const result = q ? await searchPlanning(supabase, workspaceId, q) : null;
  return (
    <div className="flex flex-col gap-4">
      <form
        method="get"
        action="/cari"
        role="search"
        aria-label="Pencarian global"
        className="flex flex-wrap gap-2"
      >
        <input type="hidden" name="workspace" value={workspaceId} />
        <label className="sr-only" htmlFor="global-q">
          Kata kunci pencarian
        </label>
        <input
          id="global-q"
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Cari konten, campaign, ide, brand…"
          className="h-11 min-w-64 flex-1 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm"
        />
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center rounded-[10px] bg-[var(--mt-teal-700)] px-4 text-sm font-medium text-white"
        >
          Cari
        </button>
      </form>

      {result?.unavailable ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          ⚠️ {PLANNING_TABLES_UNAVAILABLE_ID}
        </div>
      ) : null}
      {!q ? (
        <EmptyState
          title="Mulai mencari"
          description="Ketik kata kunci di atas. Hasil hanya dari workspace ini — konteks workspace dipertahankan di setiap tautan hasil."
          icon="🔍"
        />
      ) : result && result.data.length === 0 ? (
        <EmptyState
          title={`Tidak ada hasil untuk “${q}”`}
          description="Coba kata kunci lain, atau periksa ejaan. Hasil hanya mencakup konten, campaign, ide, dan brand di workspace ini."
          icon="🔍"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(result?.data ?? []).map((hit) => (
            <li
              key={`${hit.kind}-${hit.id}`}
              className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
            >
              <Link href={hit.href} className="font-medium text-[var(--mt-teal-700)] underline">
                {KIND_LABEL[hit.kind].icon} {hit.title}
              </Link>
              <p className="mt-1 text-sm text-[var(--mt-text-muted)]">{hit.detail}</p>
            </li>
          ))}
        </ul>
      )}
      {result && result.data.length > 0 ? (
        <p className="text-sm text-[var(--mt-text-muted)]">
          {result.data.length} hasil untuk “{q}” di workspace ini.
        </p>
      ) : null}
    </div>
  );
}
