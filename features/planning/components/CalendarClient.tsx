"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { ProductionStatusBadge } from "@/components/ui/Badges";
import { reschedulePlacementAction, type PlanningActionResult } from "../actions";
import {
  buildMonthGrid,
  dateKeyInTimezone,
  monthLabel,
  timeInTimezone,
  wallTimeToUtcIso,
} from "../calendar";
import { timezoneLabel } from "@/lib/time";

export type CalendarTile = {
  placementId: string;
  contentItemId: string;
  title: string;
  brandName: string;
  format: string | null;
  platform: string;
  accountName: string | null;
  scheduledAt: string | null;
  timezone: string;
  productionStatus: string;
  distributionStatus: string;
};

type CollisionState = {
  placementId: string;
  title: string;
  newScheduledAt: string;
  timezone: string;
} | null;

/**
 * Kalender Month + Agenda (P2-11). Satu sumber kanonis (content_items +
 * placements) — TIDAK ADA tabel kalender. Drag/drop HTML5 native
 * (ADR-0008 §1) + alternatif tombol untuk perangkat sentuh/keyboard.
 * Collision: peringatan + pengguna memilih tetap / geser 1 jam / batal.
 */
export function CalendarClient({
  month,
  timezone,
  workspaceId,
  tiles,
  backlog,
  canSchedule,
  view,
}: {
  month: string;
  timezone: string;
  workspaceId: string;
  tiles: CalendarTile[];
  backlog: CalendarTile[];
  canSchedule: boolean;
  view: "month" | "agenda";
}) {
  const [year, monthNum] = month.split("-").map(Number);
  const weeks = buildMonthGrid(year, monthNum);
  const [message, setMessage] = useState("");
  const [collision, setCollision] = useState<CollisionState>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const byDate = new Map<string, CalendarTile[]>();
  for (const t of tiles) {
    if (!t.scheduledAt) continue;
    const key = dateKeyInTimezone(t.scheduledAt, timezone);
    const list = byDate.get(key) ?? [];
    list.push(t);
    byDate.set(key, list);
  }

  const prevMonth = (() => {
    const m = monthNum === 1 ? 12 : monthNum - 1;
    const y = monthNum === 1 ? year - 1 : year;
    return `${y}-${String(m).padStart(2, "0")}`;
  })();
  const nextMonth = (() => {
    const m = monthNum === 12 ? 1 : monthNum + 1;
    const y = monthNum === 12 ? year + 1 : year;
    return `${y}-${String(m).padStart(2, "0")}`;
  })();

  async function doReschedule(
    placementId: string,
    newScheduledAt: string,
    tz: string,
    force: boolean,
    title: string,
  ): Promise<boolean> {
    setPending(true);
    const fd = new FormData();
    fd.set("placementId", placementId);
    fd.set("workspaceId", workspaceId);
    fd.set("scheduledAt", newScheduledAt);
    fd.set("timezone", tz);
    fd.set("force", force ? "true" : "false");
    const result: PlanningActionResult = await reschedulePlacementAction(
      { ok: false, message: "" },
      fd,
    );
    setPending(false);
    if (result.ok) {
      setMessage(`“${title}” dijadwalkan ulang.`);
      setCollision(null);
      return true;
    }
    if (result.collision) {
      setCollision({ placementId, title, newScheduledAt, timezone: tz });
      return false;
    }
    setMessage(result.message);
    return false;
  }

  function handleDrop(dateKey: string, e: React.DragEvent) {
    e.preventDefault();
    const placementId = e.dataTransfer.getData("text/placement-id");
    if (!placementId || !canSchedule) return;
    const tile = tiles.find((t) => t.placementId === placementId);
    if (!tile || !tile.scheduledAt) return;
    const time = timeInTimezone(tile.scheduledAt, tile.timezone);
    const newScheduledAt = wallTimeToUtcIso(dateKey, time, tile.timezone);
    void doReschedule(placementId, newScheduledAt, tile.timezone, false, tile.title);
  }

  function shiftOneHour() {
    if (!collision) return;
    const shifted = new Date(
      new Date(collision.newScheduledAt).getTime() + 60 * 60 * 1000,
    ).toISOString();
    void doReschedule(collision.placementId, shifted, collision.timezone, false, collision.title);
  }

  const agendaDates = [...byDate.keys()].sort();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/kalender?workspace=${workspaceId}&month=${prevMonth}&view=${view}`}
            className="rounded-lg border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm"
            aria-label="Bulan sebelumnya"
          >
            ←
          </Link>
          <h2 className="text-lg font-semibold">{monthLabel(year, monthNum)}</h2>
          <Link
            href={`/kalender?workspace=${workspaceId}&month=${nextMonth}&view=${view}`}
            className="rounded-lg border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm"
            aria-label="Bulan berikutnya"
          >
            →
          </Link>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[var(--mt-text-muted)]">Zona waktu: {timezoneLabel(timezone)}</span>
          <Link
            href={`/kalender?workspace=${workspaceId}&month=${month}&view=month`}
            aria-current={view === "month" ? "page" : undefined}
            className={`rounded-lg px-3 py-2 ${view === "month" ? "bg-[var(--mt-teal-700)] font-medium text-white" : "border border-[var(--mt-border)] bg-[var(--mt-surface)]"}`}
          >
            Bulan
          </Link>
          <Link
            href={`/kalender?workspace=${workspaceId}&month=${month}&view=agenda`}
            aria-current={view === "agenda" ? "page" : undefined}
            className={`rounded-lg px-3 py-2 ${view === "agenda" ? "bg-[var(--mt-teal-700)] font-medium text-white" : "border border-[var(--mt-border)] bg-[var(--mt-surface)]"}`}
          >
            Agenda
          </Link>
        </div>
      </div>

      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      {!canSchedule ? (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Peran Anda hanya bisa melihat kalender — jadwal ulang butuh peran
          owner/admin/manager/strategist.
        </p>
      ) : null}

      {view === "month" ? (
        <div className="overflow-x-auto rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)]">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr>
                {["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"].map((d) => (
                  <th
                    key={d}
                    className="border-b border-[var(--mt-border)] p-2 text-left font-semibold"
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, wi) => (
                <tr key={wi}>
                  {week.map((cell) => {
                    const dayTiles = byDate.get(cell.dateKey) ?? [];
                    return (
                      <td
                        key={cell.dateKey}
                        onDragOver={(e) => {
                          if (canSchedule) e.preventDefault();
                        }}
                        onDrop={(e) => handleDrop(cell.dateKey, e)}
                        className={`min-h-24 align-top border-b border-r border-[var(--mt-border)] p-1.5 last:border-r-0 ${
                          cell.inMonth ? "" : "bg-[var(--mt-canvas)] text-[var(--mt-text-muted)]"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold">{cell.day}</span>
                          {cell.inMonth ? (
                            <Link
                              href={`/konten/baru?workspace=${workspaceId}&tanggal=${cell.dateKey}`}
                              className="text-xs text-[var(--mt-teal-700)] underline"
                              aria-label={`Buat konten tanggal ${cell.dateKey}`}
                              title="Buat konten di tanggal ini"
                            >
                              ＋
                            </Link>
                          ) : null}
                        </div>
                        <ul className="mt-1 flex flex-col gap-1">
                          {dayTiles.map((t) => (
                            <li key={t.placementId}>
                              <div
                                draggable={canSchedule}
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("text/placement-id", t.placementId);
                                  setDraggingId(t.placementId);
                                }}
                                onDragEnd={() => setDraggingId(null)}
                                className={`rounded-lg border border-[var(--mt-border)] bg-[var(--mt-canvas)] p-1.5 ${
                                  draggingId === t.placementId ? "opacity-50" : ""
                                } ${canSchedule ? "cursor-grab" : ""}`}
                              >
                                <Link href={`/konten/${t.contentItemId}`} className="block">
                                  <span className="flex items-center gap-1 text-xs font-medium">
                                    <ChannelIcon platform={t.platform} size="sm" />
                                    <span className="truncate">{t.title}</span>
                                  </span>
                                  <span className="mt-0.5 block text-[11px] text-[var(--mt-text-muted)]">
                                    {t.scheduledAt ? timeInTimezone(t.scheduledAt, timezone) : "—"}{" "}
                                    · {t.brandName}
                                    {t.format ? ` · ${t.format}` : ""}
                                  </span>
                                  <span className="mt-1 block">
                                    <ProductionStatusBadge status={t.productionStatus} />
                                  </span>
                                </Link>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {agendaDates.length === 0 ? (
            <p className="text-sm text-[var(--mt-text-muted)]">
              Belum ada placement terjadwal di bulan ini.
            </p>
          ) : (
            agendaDates.map((dateKey) => (
              <section
                key={dateKey}
                className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
              >
                <h3 className="font-semibold">
                  {dateKey} · {timezoneLabel(timezone)}
                </h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {(byDate.get(dateKey) ?? []).map((t) => (
                    <li
                      key={t.placementId}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--mt-border)] p-3 text-sm"
                    >
                      <ChannelIcon platform={t.platform} />
                      <Link
                        href={`/konten/${t.contentItemId}`}
                        className="font-medium text-[var(--mt-teal-700)] underline"
                      >
                        {t.title}
                      </Link>
                      <span className="text-[var(--mt-text-muted)]">
                        {t.scheduledAt ? timeInTimezone(t.scheduledAt, timezone) : "—"} ·{" "}
                        {t.brandName}
                        {t.format ? ` · ${t.format}` : ""}
                      </span>
                      <ProductionStatusBadge status={t.productionStatus} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}

      <section
        aria-label="Backlog belum terjadwal"
        className="rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4"
      >
        <h2 className="font-semibold">Backlog — belum terjadwal ({backlog.length})</h2>
        {backlog.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--mt-text-muted)]">
            Semua placement sudah punya jadwal, atau belum ada placement.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {backlog.map((t) => (
              <li
                key={t.placementId}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--mt-border)] p-3 text-sm"
              >
                <ChannelIcon platform={t.platform} />
                <Link
                  href={`/konten/${t.contentItemId}`}
                  className="font-medium text-[var(--mt-teal-700)] underline"
                >
                  {t.title}
                </Link>
                <span className="text-[var(--mt-text-muted)]">
                  {t.brandName}
                  {t.format ? ` · ${t.format}` : ""}
                </span>
                <ProductionStatusBadge status={t.productionStatus} />
                {canSchedule ? (
                  <span className="ml-auto flex items-center gap-2">
                    <label className="sr-only" htmlFor={`backlog-date-${t.placementId}`}>
                      Tanggal jadwal
                    </label>
                    <input
                      id={`backlog-date-${t.placementId}`}
                      type="date"
                      defaultValue={month + "-01"}
                      className="h-9 rounded-[10px] border border-[var(--mt-border)] px-2 text-sm"
                    />
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        const input = document.getElementById(
                          `backlog-date-${t.placementId}`,
                        ) as HTMLInputElement | null;
                        const dateKey = input?.value;
                        if (!dateKey) return;
                        const iso = wallTimeToUtcIso(dateKey, "09:00", t.timezone);
                        void doReschedule(t.placementId, iso, t.timezone, false, t.title);
                      }}
                    >
                      Jadwalkan 09:00
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-[var(--mt-text-muted)]">
          Seret kartu antar tanggal untuk menjadwalkan ulang, atau pakai tombol di backlog. Jadwal
          baru memakai jam yang sama di zona waktu placement ({timezoneLabel(timezone)}).
        </p>
      </section>

      <Dialog
        open={collision !== null}
        onClose={() => setCollision(null)}
        title="Jadwal bentrok"
        description="Sudah ada placement lain di channel yang sama pada waktu yang sama persis. Pilih tindakan — tidak ada yang ditimpa diam-diam."
      >
        {collision ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              “{collision.title}” bentrok pada{" "}
              {new Date(collision.newScheduledAt).toLocaleString("id-ID", {
                timeZone: collision.timezone,
              })}
              .
            </p>
            <Button
              disabled={pending}
              onClick={() =>
                void doReschedule(
                  collision.placementId,
                  collision.newScheduledAt,
                  collision.timezone,
                  true,
                  collision.title,
                )
              }
            >
              Tetap jadwalkan di waktu ini
            </Button>
            <Button variant="secondary" disabled={pending} onClick={shiftOneHour}>
              Geser 1 jam lebih lambat
            </Button>
            <Button variant="ghost" onClick={() => setCollision(null)}>
              Batal
            </Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
