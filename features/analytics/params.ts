/**
 * Parameter periode + brand dari query string — features/analytics/params.ts (P7-03).
 * Murni (tanpa DB): tanggal tidak valid atau terbalik → rentang default
 * 30 hari terakhir di zona workspace. brandId bukan UUID → null.
 */
import { defaultDateRange } from "./metrics";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function param(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return typeof v === "string" ? v : undefined;
}

export function parseAnalyticsParams(
  sp: Record<string, string | string[] | undefined>,
  timezone: string,
): { from: string; to: string; brandId: string | null } {
  const fromRaw = param(sp, "from");
  const toRaw = param(sp, "to");
  const brandRaw = param(sp, "brand");
  let range = defaultDateRange(timezone);
  if (fromRaw && toRaw && DATE_RE.test(fromRaw) && DATE_RE.test(toRaw) && fromRaw <= toRaw) {
    range = { start: fromRaw, end: toRaw };
  }
  return {
    from: range.start,
    to: range.end,
    brandId: brandRaw && UUID_RE.test(brandRaw) ? brandRaw : null,
  };
}
