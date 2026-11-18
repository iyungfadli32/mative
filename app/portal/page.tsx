import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { listMyPortalShares } from "@/features/portal/actions";
import { EmptyState } from "@/components/ui/States";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/Badges";
import { formatInTimezone } from "@/lib/time";
import { envStatus, SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";

/**
 * Portal Klien — P1-16 (Keputusan #12).
 * Login portal memakai auth yang sama; role viewer_client.
 * Daftar HANYA resource yang dibagikan eksplisit ke pengguna ini
 * (ditegakkan RLS di `resource_shares` + server action).
 * Detail konten penuh (isi content item) hadir di Phase 2, saat tabel
 * content_items ada — di fase ini detail menampilkan metadata share.
 */
export default async function PortalPage() {
  const user = await getCurrentUser();
  const shares = await listMyPortalShares();
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-[var(--mt-teal-700)]">
        Portal Klien MaTive
      </p>
      <h1 className="mt-2 text-3xl font-bold">Konten yang dibagikan ke Anda</h1>
      <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
        Anda hanya bisa melihat resource yang secara eksplisit dibagikan ke Anda. Resource lain
        tidak tampil dan tidak bisa diakses — bahkan bila Anda menebak alamatnya. Komentar klien
        default tidak diizinkan (Keputusan #12).
      </p>
      {!envStatus.supabaseConfigured && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-3 text-sm"
        >
          ⚠️ {SUPABASE_NOT_CONFIGURED_ID}
        </p>
      )}
      {!user ? (
        <div className="mt-6">
          <EmptyState
            title="Masuk untuk melihat portal"
            description="Portal klien memakai akun yang sama dengan MaTive. Masuk dengan akun klien Anda."
            icon="🔐"
          />
          <p className="mt-3 text-center text-sm">
            <Link href="/masuk" className="font-medium text-[var(--mt-teal-700)] underline">
              Ke halaman masuk →
            </Link>
          </p>
        </div>
      ) : shares.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Belum ada konten yang dibagikan"
            description="Tim akan membagikan konten ke Anda bila sudah ada yang siap ditinjau. Bila Anda merasa seharusnya ada konten di sini, hubungi tim."
            icon="📭"
          />
        </div>
      ) : (
        <div className="mt-6">
          <DataTable
            caption="Daftar resource yang dibagikan ke Anda"
            rows={shares.map((s) => ({ ...s, id: s.id }))}
            columns={[
              {
                key: "type",
                header: "Jenis",
                render: (r) => (
                  <StatusBadge
                    label={r.resource_type === "content_item" ? "Konten" : "Campaign"}
                    tone="info"
                    icon="📄"
                  />
                ),
              },
              {
                key: "id",
                header: "ID resource",
                render: (r) => <code className="break-all text-xs">{r.resource_id}</code>,
              },
              {
                key: "shared",
                header: "Dibagikan pada",
                render: (r) => formatInTimezone(r.created_at),
              },
              {
                key: "detail",
                header: "Detail",
                render: (r) => (
                  <Link
                    href={`/portal/${r.id}`}
                    className="font-medium text-[var(--mt-teal-700)] underline"
                  >
                    Lihat detail →
                  </Link>
                ),
              },
            ]}
          />
        </div>
      )}
    </main>
  );
}
