import { getCurrentUser, getSupabaseServerClient } from "@/lib/supabase/server";
import { listMyWorkspaces } from "@/features/tenancy/actions";
import { signOutAction } from "@/features/identity/auth";
import { AppShell } from "@/components/layout/AppShell";
import { KPIStatCard } from "@/components/ui/KPIStatCard";
import { EmptyState } from "@/components/ui/States";
import { EMPTY_KPIS } from "@/features/dashboard/kpis";
import { getDashboardKpis } from "@/features/planning/queries";
import { formatDateOnly, timezoneLabel } from "@/lib/time";
import { envStatus, SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Dashboard / Command Center shell — P1-13 (Dok 02 §3).
 * KPI dari record nyata SAJA; Phase 2: dihitung dari content_items +
 * placements nyata (0 + empty state bila belum ada data).
 * Panel tugas/antrean persetujuan/milestone campaign: empty state dengan aksi berikutnya.
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  const workspaces = await listMyWorkspaces();
  const workspaceName = workspaces[0]?.workspace.name ?? "Belum ada workspace";
  let kpis = EMPTY_KPIS;
  const supabase = await getSupabaseServerClient();
  if (supabase && workspaces[0]) {
    kpis = await getDashboardKpis(supabase, workspaces[0].workspace.id);
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
        <div className="flex gap-2">
          <Link href="/konten/baru">
            <Button variant="secondary">＋ Buat konten</Button>
          </Link>
          <Link href="/kalender">
            <Button variant="secondary">📅 Kalender</Button>
          </Link>
          <Link href="/pengaturan/organisasi">
            <Button variant="secondary">＋ Buat workspace</Button>
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
            <EmptyState
              title="Belum ada yang menunggu persetujuan"
              description="Approval Center hadir di Phase 4. Setelah ada content yang diajukan, antreannya tampil di sini."
              icon="✔️"
            />
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
