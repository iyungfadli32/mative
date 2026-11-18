/**
 * Utilitas waktu — lib/time.ts
 * Aturan (Keputusan #13 + Dok 05 §1): semua timestamp DISIMPAN UTC (ISO 8601
 * berakhiran Z), dirender di timezone workspace (default Asia/Jakarta).
 * Jangan pernah menebak zona waktu dari locale browser untuk data tersimpan.
 */

export const DEFAULT_TIMEZONE = "Asia/Jakarta";

/** Format tanggal-waktu UTC -> zona workspace, label Indonesia. */
export function formatInTimezone(
  isoUtc: string,
  timeZone: string = DEFAULT_TIMEZONE,
  locale: string = "id-ID",
): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "tanggal tidak valid";
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Format tanggal saja (untuk kalender/agenda). */
export function formatDateOnly(
  isoUtc: string,
  timeZone: string = DEFAULT_TIMEZONE,
  locale: string = "id-ID",
): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "tanggal tidak valid";
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/** Label zona waktu yang sedang dipakai (ditampilkan di UI bila relevan). */
export function timezoneLabel(timeZone: string = DEFAULT_TIMEZONE): string {
  return timeZone === "Asia/Jakarta" ? "WIB (Asia/Jakarta)" : timeZone;
}

/** Validasi string zona waktu IANA (tanpa melempar). */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("id-ID", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Sekarang dalam UTC ISO — dipakai untuk stempel client-side saja. */
export function nowUtcIso(): string {
  return new Date().toISOString();
}
