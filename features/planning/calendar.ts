/**
 * Utilitas kalender + timezone — features/planning/calendar.ts
 * Aturan (Keputusan #13 + P2-A9): semua waktu DISIMPAN UTC, dirender di
 * timezone workspace. Penjadwalan placement memakai timezone placement;
 * due date produksi memakai timezone content item.
 * Semua fungsi di sini MURNI (tanpa I/O) agar bisa di-unit-test.
 */
import { DEFAULT_TIMEZONE } from "@/lib/time";

/** Offset zona waktu (menit) untuk satu momen, lewat Intl. */
export function timezoneOffsetMinutes(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // "24" jam di format en-US berarti tengah malam — normalisasi ke 0.
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Kunci tanggal YYYY-MM-DD dari ISO UTC di timezone tertentu. */
export function dateKeyInTimezone(isoUtc: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Jam:menit (HH:mm) dari ISO UTC di timezone tertentu. */
export function timeInTimezone(isoUtc: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Konversi tanggal + jam dinding (YYYY-MM-DD + HH:mm) di satu timezone
 * menjadi ISO UTC. Dipakai saat pengguna mengisi jadwal di kalender.
 */
export function wallTimeToUtcIso(dateKey: string, time: string, timeZone: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  // Tebak UTC, lalu koreksi dengan offset aktual di momen itu (2 iterasi cukup).
  let guess = Date.UTC(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0);
  for (let i = 0; i < 2; i++) {
    const offset = timezoneOffsetMinutes(timeZone, new Date(guess));
    guess = Date.UTC(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0) - offset * 60000;
  }
  return new Date(guess).toISOString();
}

/** Geser kunci tanggal sejumlah hari (aritmetika tanggal kalender, bukan 24 jam). */
export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Jumlah hari dalam satu bulan. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Hari dalam minggu (0 = Minggu) untuk tanggal 1 di bulan itu. */
export function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

export type CalendarCell = {
  dateKey: string;
  /** Tanggal milik bulan yang sedang ditampilkan (false = selingan bulan lain). */
  inMonth: boolean;
  day: number;
};

/** Grid kalender bulanan: minggu × 7 sel, dimulai hari Minggu (pola Dok 02 §4). */
export function buildMonthGrid(year: number, month: number): CalendarCell[][] {
  const total = daysInMonth(year, month);
  const firstWeekday = firstWeekdayOfMonth(year, month);
  const prevMonthDays = daysInMonth(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    const day = prevMonthDays - firstWeekday + 1 + i;
    const pm = month === 1 ? 12 : month - 1;
    const py = month === 1 ? year - 1 : year;
    cells.push({
      dateKey: `${py}-${String(pm).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      inMonth: false,
      day,
    });
  }
  for (let day = 1; day <= total; day++) {
    cells.push({
      dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      inMonth: true,
      day,
    });
  }
  while (cells.length % 7 !== 0) {
    const next = cells.length - firstWeekday - total + 1;
    const nm = month === 12 ? 1 : month + 1;
    const ny = month === 12 ? year + 1 : year;
    cells.push({
      dateKey: `${ny}-${String(nm).padStart(2, "0")}-${String(next).padStart(2, "0")}`,
      inMonth: false,
      day: next,
    });
  }
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export type Placeable = {
  id: string;
  social_channel_id: string;
  scheduled_at: string | null;
  content_item_id: string;
};

/** Collision (P2-A5): placement lain di channel yang sama pada waktu yang sama persis. */
export function findCollision(
  placements: Placeable[],
  channelId: string,
  scheduledAt: string,
  excludePlacementId?: string,
): Placeable | null {
  return (
    placements.find(
      (p) =>
        p.id !== excludePlacementId &&
        p.social_channel_id === channelId &&
        p.scheduled_at === scheduledAt,
    ) ?? null
  );
}

/** Kelompokkan placement terjadwal per kunci tanggal (di timezone workspace). */
export function groupPlacementsByDate(
  placements: Placeable[],
  timeZone: string = DEFAULT_TIMEZONE,
): Map<string, Placeable[]> {
  const map = new Map<string, Placeable[]>();
  for (const p of placements) {
    if (!p.scheduled_at) continue;
    const key = dateKeyInTimezone(p.scheduled_at, timeZone);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return map;
}

/** Placement tanpa jadwal (backlog unscheduled). */
export function unscheduledPlacements(placements: Placeable[]): Placeable[] {
  return placements.filter((p) => !p.scheduled_at);
}

/** Label bulan Bahasa Indonesia (untuk header kalender). */
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}
