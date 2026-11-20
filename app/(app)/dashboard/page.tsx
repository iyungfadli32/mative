import { getCurrentUser, getSupabaseServerClient } from "@/lib/supabase/server";
import { listMyWorkspaces } from "@/features/tenancy/actions";
import { signOutAction } from "@/features/identity/auth";
import { AppShell } from "@/components/layout/AppShell";
import { KPIStatCard } from "@/components/ui/KPIStatCard";
import { EmptyState } from "@/components/ui/States";
import { EMPTY_KPIS } from "@/features/dashboard/kpis";
import { getDashboardKpis } from "@/features/planning/queries";
import { approvalMemberNames, listPendingApprovalRequests } from "@/features/approval/queries";
import { DashboardAnalyticsSummary } from "@/features/analytics/components/DashboardAnalyticsSummary";
import { can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { formatAge, formatDateOnly, timezoneLabel } from "@/lib/time";
import { envStatus, SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Dashboard / Command Center shell — P1-13 (Dok 02 §3).
 * KPI dari record nyata SAJA; Phase 2: dihitung dari content_items +
 * placements nyata (0 + empty state bila belum ada data).
 * Panel tugas/antrean persetujuan/milestone campaign: empty state dengan aksi berikutnya.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  const workspaces = await listMyWorkspaces();
  const sp = await searchParams;
  const workspaceParam = typeof sp.workspace === "string" ? sp.workspace : undefined;
  // Workspace aktif mengikuti ?workspace= bila pemanggil memang member di
  // sana (pola getPlanningContext); bila tidak, workspace pertama.
  // Sebelum perbaikan ini (Phase 9) dashboard selalu memakai workspaces[0]
  // sehingga KPI + nama workspace salah sesudah pindah workspace.
  const active =
    (workspaceParam ? workspaces.find((w) => w.workspace.id === workspaceParam) : undefined) ??
    workspaces[0];
  const workspaceName = active?.workspace.name ?? "Belum ada workspace";
  let kpis = EMPTY_KPIS;
  const supabase = await getSupabaseServerClient();
  if (supabase && active) {
    kpis = await getDashboardKpis(supabase, active.workspace.id);
  }

  // Antrean persetujuan (Phase 9): request in_review NYATA untuk workspace
  // aktif — bukan lagi EmptyState hardcode. Sebelum perbaikan ini panel ini
  // selalu menampilkan "Belum ada yang menunggu persetujuan" walau ada
  // request in_review. Judul + pemohon + umur request + tautan ke
  // /persetujuan; empty state hanya bila benar-benar tidak ada.
  type PendingRow = { title: string; submittedBy: string; age: string };
  let pendingApprovals: PendingRow[] = [];
  if (supabase && active) {
    const pendingRes = await listPendingApprovalRequests(supabase, active.workspace.id);
    const requests = pendingRes.error || pendingRes.unavailable ? [] : pendingRes.data;
    if (requests.length > 0) {
      const itemIds = [...new Set(requests.map((r) => r.target_id))];
      const [{ data: items }, names] = await Promise.all([
        supabase
          .from("content_items")
          .select("id, title")
          .in("id", itemIds.length > 0 ? itemIds : ["00000000-0000-0000-0000-000000000000"]),
        approvalMemberNames(supabase, active.workspace.id),
      ]);
      const titleById = new Map(
        ((items ?? []) as { id: string; title: string }[]).map((i) => [i.id, i.title]),
      );
      pendingApprovals = requests.map((r) => ({
        title: titleById.get(r.target_id) ?? r.target_id,
        submittedBy: names.get(r.submitted_by) ?? r.submitted_by,
        age: formatAge(r.submitted_at),
      }));
    }
  }

  return (
    <AppShell
      workspaceName={workspaceName}
      userEmail={user?.email ?? null}
      onSignOut={signOutAction}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--mt-text)] md:text-3xl">Command Center</h1>
          <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
            {formatDateOnly(new Date().toISOString())} · {timezoneLabel()} ·{" "}
            {user
              ? `Halo, ${user.email}`
              : "Anda belum masuk — masuk untuk melihat workspace Anda."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspaces.length === 0 ? (
            <>
              <Link href="/pengaturan/organisasi">
                <Button>＋ Buat organisasi &amp; workspace</Button>
              </Link>
              <Link href="/konten/baru">
                <Button variant="secondary">＋ Buat konten</Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/konten/baru">
                <Button variant="secondary">＋ Buat konten</Button>
              </Link>
              <Link href="/pengaturan/organisasi">
                <Button variant="secondary">＋ Buat workspace</Button>
              </Link>
            </>
          )}
          <Link href="/kalender">
            <Button variant="secondary">📅 Kalender</Button>
          </Link>
          <Link href="/pengaturan/anggota">
            <Button variant="secondary">Undang anggota</Button>
          </Link>
        </div>
      </div>

      {!envStatus.supabaseConfigured && (
        <div
          role="status"
          className="mt-4 rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          ⚠️ {SUPABASE_NOT_CONFIGURED_ID} Data di halaman ini adalah shell kosong, bukan data nyata.
        </div>
      )}

      {!user && (
        <div className="mt-4">
          <EmptyState
            title="Anda belum masuk"
            description="Masuk atau daftar untuk membuat organisasi dan workspace pertama Anda."
            icon="🔐"
          />
          <p className="mt-2 text-center text-sm">
            <Link href="/masuk" className="font-medium text-[var(--mt-teal-700)] underline">
              Ke halaman masuk →
            </Link>
          </p>
        </div>
      )}

      <section aria-label="KPI operasional" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KPIStatCard label="Direncanakan" value={kpis.planned} icon="📝" empty={!kpis.hasData} />
        <KPIStatCard
          label="Dalam produksi"
          value={kpis.inProduction}
          icon="🎬"
          empty={!kpis.hasData}
        />
        <KPIStatCard
          label="Menunggu persetujuan"
          value={kpis.awaitingApproval}
          icon="👀"
          empty={!kpis.hasData}
        />
        <KPIStatCard label="Terjadwal" value={kpis.scheduled} icon="📅" empty={!kpis.hasData} />
        <KPIStatCard label="Terbit" value={kpis.published} icon="✅" empty={!kpis.hasData} />
      </section>

      {user && active && can(active.role as WorkspaceRole, "view_analytics") ? (
        <section className="mt-6" aria-label="Ringkasan analitik">
          <DashboardAnalyticsSummary
            workspaceId={active.workspace.id}
            timezone={active.workspace.timezone}
          />
        </section>
      ) : null}

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Tugas yang jatuh tempo</h2>
          <div className="mt-3">
            <EmptyState
              title="Belum ada tugas"
              description="Task Center hadir di Phase 3. Setelah ada tugas, yang jatuh tempo tampil di sini."
              icon="✅"
            />
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Antrean persetujuan</h2>
          <div className="mt-3">
            {pendingApprovals.length === 0 ? (
              <EmptyState
                title="Belum ada yang menunggu persetujuan"
                description="Konten yang diajukan untuk approval dan masih ditinjau tampil di sini."
                icon="✔️"
              />
            ) : (
              <ul className="space-y-3">
                {pendingApprovals.map((row) => (
                  <li key={`${row.title}-${row.submittedBy}-${row.age}`} className="text-sm">
                    <Link
                      href={`/persetujuan?workspace=${active?.workspace.id}`}
                      className="font-medium text-[var(--mt-teal-700)] underline"
                    >
                      {row.title}
                    </Link>
                    <p className="mt-0.5 text-[13px] text-[var(--mt-text-muted)]">
                      Diajukan oleh {row.submittedBy} · {row.age}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {pendingApprovals.length > 0 ? (
              <p className="mt-3 text-center text-sm">
                <Link
                  href={`/persetujuan?workspace=${active?.workspace.id}`}
                  className="font-medium text-[var(--mt-teal-700)] underline"
                >
                  Lihat semua di Approval Center →
                </Link>
              </p>
            ) : null}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
          <h2 className="font-semibold">Milestone campaign</h2>
          <div className="mt-3">
            <EmptyState
              title="Belum ada campaign"
              description="Campaign dasar hadir di Phase 2. Buat campaign pertama, lalu milestone-nya tampil di sini."
              icon="🎯"
            />
            <p className="mt-2 text-center text-sm">
              <Link href="/kampanye" className="font-medium text-[var(--mt-teal-700)] underline">
                Ke halaman campaign →
              </Link>
            </p>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
        <h2 className="font-semibold">Workspace Anda</h2>
        {workspaces.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
            Belum ada workspace yang bisa Anda akses.{" "}
            <Link
              href="/pengaturan/organisasi"
              className="font-medium text-[var(--mt-teal-700)] underline"
            >
              Buat organisasi + workspace pertama →
            </Link>
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {workspaces.map((w) => (
              <li key={w.workspace.id}>
                <span className="font-medium">{w.workspace.name}</span>{" "}
                <span className="text-[var(--mt-text-muted)]">
                  ({w.workspace.slug} · peran: {w.role} · {w.workspace.timezone})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
