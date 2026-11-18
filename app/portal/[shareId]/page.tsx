import Link from "next/link";
import { notFound } from "next/navigation";
import { getPortalShare } from "@/features/portal/actions";
import { getCurrentUser } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/Badges";
import { formatInTimezone } from "@/lib/time";

/**
 * Detail share portal — P1-16.
 * RLS menolak bila share ini bukan milik pemanggil (getPortalShare → null).
 * Isi konten (judul, caption, aset) dirender penuh di Phase 2, saat tabel
 * content_items + placements ada; di fase ini tampilkan metadata share
 * + status yang jujur — JANGAN menampilkan isi karangan.
 */
export default async function PortalDetailPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <EmptyState
          title="Masuk untuk melihat detail ini"
          description="Detail konten yang dibagikan hanya bisa dilihat setelah masuk dengan akun klien."
          icon="🔐"
        />
        <p className="mt-3 text-center text-sm">
          <Link href="/masuk" className="font-medium text-[var(--mt-teal-700)] underline">
            Ke halaman masuk →
          </Link>
        </p>
      </main>
    );
  }
  const share = await getPortalShare(shareId);
  if (!share) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/portal" className="text-sm text-[var(--mt-teal-700)] underline">
        ← Kembali ke Portal Klien
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Detail konten yang dibagikan</h1>
      <div className="mt-6 rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-5">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--mt-text-muted)]">Jenis resource</dt>
            <dd>
              <StatusBadge
                label={share.resource_type === "content_item" ? "Konten" : "Campaign"}
                tone="info"
                icon="📄"
              />
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--mt-text-muted)]">ID resource</dt>
            <dd className="break-all font-mono text-xs">{share.resource_id}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--mt-text-muted)]">Dibagikan pada</dt>
            <dd>{formatInTimezone(share.created_at)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--mt-text-muted)]">Dibagikan ke</dt>
            <dd>{user.email}</dd>
          </div>
        </dl>
        <p className="mt-5 rounded-xl bg-[var(--mt-canvas)] p-3 text-sm text-[var(--mt-text-muted)]">
          Isi konten (judul, naskah, aset, dan versi) akan tampil di sini mulai Phase 2, setelah
          tabel content tersedia. Di fase ini portal menampilkan metadata share yang sudah
          terverifikasi — tanpa isi karangan.
        </p>
        <p className="mt-3 text-sm text-[var(--mt-text-muted)]">
          Komentar klien tidak diizinkan secara default (Keputusan #12). Bila workspace mengizinkan
          komentar klien di Phase 4, tombol komentar akan muncul di sini.
        </p>
      </div>
    </main>
  );
}
