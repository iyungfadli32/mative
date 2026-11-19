/**
 * Daftar integrasi — features/integrations/components/IntegrationsList.tsx (P7-03).
 * SEMUA platform DISABLED (ASUMSI-7B/7F): kartu menampilkan blocker,
 * bukan tombol hubungkan palsu (P1-13 — DILARANG tombol palsu).
 * Channel yang sudah dicatat menampilkan status capability registry-nya.
 */
import type { ChannelCapability } from "@/features/analytics/types";
import {
  INTEGRATION_CONNECTION_STATUS_LABELS,
  INTEGRATION_PLATFORMS,
} from "../constants";

export function IntegrationsList({
  channels,
  events,
}: {
  channels: ChannelCapability[];
  events: Array<{ id: string; event_type: string; detail: Record<string, unknown> | null; created_at: string }>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Status adapter">
        <div
          role="status"
          className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
        >
          <p className="font-semibold">Adapter integrasi: DISABLED</p>
          <p className="mt-1 text-[var(--mt-text-muted)]">
            Platform pertama belum dipilih dan tidak ada akses ke platform apa pun — jadi tidak
            ada koneksi otomatis di Phase 7. Data analytics hanya dari record nyata dan impor
            manual/CSV berlabel. Jangan hubungkan akun apa pun dari halaman ini.
          </p>
        </div>
      </section>

      <section aria-label="Platform">
        <h2 className="text-lg font-semibold">Platform</h2>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {INTEGRATION_PLATFORMS.map((p) => (
            <li
              key={p.platform}
              className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{p.label}</h3>
                <span className="rounded-full bg-[var(--mt-surface-muted)] px-2 py-0.5 text-xs font-medium">
                  DISABLED
                </span>
              </div>
              <p className="mt-2 text-sm text-[var(--mt-text-muted)]">{p.blocker}</p>
              <p className="mt-2 text-sm">
                <a
                  href={p.officialUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[var(--mt-teal-700)] underline"
                >
                  Buka situs resmi {p.label} →
                </a>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Channel tercatat">
        <h2 className="text-lg font-semibold">Channel tercatat di workspace ini</h2>
        {channels.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
            Belum ada channel. Channel dicatat dari halaman Merek/Channel sebagai metadata —
            pencatatan tidak berarti terhubung.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {channels.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {c.account_name ?? "(tanpa nama)"} · {c.platform}
                    {c.brand_name ? ` · Brand ${c.brand_name}` : ""}
                  </p>
                  <span className="rounded-full bg-[var(--mt-surface-muted)] px-2 py-0.5 text-xs font-medium">
                    {INTEGRATION_CONNECTION_STATUS_LABELS[c.connection_status] ??
                      c.connection_status}
                  </span>
                </div>
                {c.capability_snapshot ? (
                  <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
                    Capability:{" "}
                    {typeof c.capability_snapshot === "object" && c.capability_snapshot !== null
                      ? (c.capability_snapshot.blocker as string | undefined) ??
                        (c.capability_snapshot.status as string | undefined) ??
                        JSON.stringify(c.capability_snapshot)
                      : String(c.capability_snapshot)}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
                    Belum ada pemeriksaan capability — status:{" "}
                    {INTEGRATION_CONNECTION_STATUS_LABELS[c.connection_status] ??
                      c.connection_status}
                    .
                  </p>
                )}
                {c.capability_checked_at ? (
                  <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                    Terakhir diperiksa: {new Date(c.capability_checked_at).toLocaleString("id-ID")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Jejak audit integrasi">
        <h2 className="text-lg font-semibold">Jejak audit integrasi</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
            Belum ada event integrasi (impor selesai, pemeriksaan capability, dan sejenisnya
            tercatat di sini).
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {events.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm"
              >
                <span className="font-medium">{e.event_type}</span>{" "}
                <span className="text-[var(--mt-text-muted)]">
                  {new Date(e.created_at).toLocaleString("id-ID")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
