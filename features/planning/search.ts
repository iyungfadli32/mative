/**
 * Pencarian global + filter lewat URL — features/planning/search.ts (P2-13)
 * Aturan: pencarian TER-SCOPE tenant (workspace_id selalu dikirim ke query);
 * filter yang bermakna tercermin di query parameters URL; konteks
 * workspace/brand dipertahankan saat navigasi (param workspace + brand
 * selalu dibawa). Fungsi di sini MURNI agar bisa di-unit-test.
 */

export type PlanningFilters = {
  workspaceId: string;
  /** Kata kunci pencarian bebas (judul/nama). */
  q: string;
  brandId: string;
  channelId: string;
  platform: string;
  format: string;
  productionStatus: string;
  distributionStatus: string;
  pillarId: string;
  campaignId: string;
  ownerId: string;
  priority: string;
  /** Kalender: bulan YYYY-MM. Board: tidak dipakai. */
  month: string;
  /** Hanya yang belum terjadwal (kalender backlog). */
  unscheduledOnly: boolean;
};

export const EMPTY_FILTERS: Omit<PlanningFilters, "workspaceId"> = {
  q: "",
  brandId: "",
  channelId: "",
  platform: "",
  format: "",
  productionStatus: "",
  distributionStatus: "",
  pillarId: "",
  campaignId: "",
  ownerId: "",
  priority: "",
  month: "",
  unscheduledOnly: false,
};

const PARAM_KEYS: Array<keyof Omit<PlanningFilters, "workspaceId" | "unscheduledOnly">> = [
  "q",
  "brandId",
  "channelId",
  "platform",
  "format",
  "productionStatus",
  "distributionStatus",
  "pillarId",
  "campaignId",
  "ownerId",
  "priority",
  "month",
];

/** Baca filter dari URLSearchParams (halaman server meneruskan searchParams). */
export function parsePlanningFilters(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  workspaceId: string,
): PlanningFilters {
  const get = (key: string): string => {
    if (params instanceof URLSearchParams) return params.get(key) ?? "";
    const v = params[key];
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  };
  const filters: PlanningFilters = { workspaceId, ...EMPTY_FILTERS };
  for (const key of PARAM_KEYS) {
    (filters as unknown as Record<string, string>)[key] = get(key).trim();
  }
  filters.unscheduledOnly = get("unscheduledOnly") === "1";
  // Bulan default: bulan berjalan (format YYYY-MM).
  if (!filters.month) {
    const now = new Date();
    filters.month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return filters;
}

/** Tulis filter kembali ke query string (nilai kosong dihilangkan). */
export function buildPlanningQueryString(
  filters: Partial<PlanningFilters> & { workspaceId: string },
): string {
  const params = new URLSearchParams();
  params.set("workspace", filters.workspaceId);
  for (const key of PARAM_KEYS) {
    const v = (filters as unknown as Record<string, string | undefined>)[key];
    if (v) params.set(key, v);
  }
  if (filters.unscheduledOnly) params.set("unscheduledOnly", "1");
  return params.toString();
}
/**
 * Batch 4 (T-8): kembalikan parameter aktif dari `searchParams` yang harus
 * dipertahankan — semua kunci kecuali yang dirender sebagai field terlihat
 * (atau `workspace`, yang sudah dirender FilterBar sebagai hidden input).
 * Dipakai sebagai `hidden` FilterBar dan sebagai parameter yang dibawa
 * tautan navigasi (mis. bulan/tampilan kalender) agar filter tidak hilang.
 */
export function carrySearchParams(
  sp: Record<string, string | string[] | undefined>,
  rendered: string[],
): Record<string, string> {
  const carried: Record<string, string> = {};
  for (const [key, value] of Object.entries(sp)) {
    if (key === "workspace" || rendered.includes(key)) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first) carried[key] = first;
  }
  return carried;
}

/** Apakah satu content item cocok dengan kata kunci (judul/deskripsi/tujuan)? */
export function matchesContentSearch(
  item: { title: string; internal_description: string | null; objective: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack =
    `${item.title} ${item.internal_description ?? ""} ${item.objective ?? ""}`.toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

export type FilterableContent = {
  brand_id: string;
  campaign_id: string | null;
  pillar_id: string | null;
  production_status: string;
  priority: string | null;
  owner_user_id: string;
  placements?: Array<{
    social_channel_id: string;
    platform_format: string | null;
    distribution_status: string;
  }>;
  channelPlatforms?: Record<string, string>;
};

/** Terapkan filter terstruktur ke daftar content (dipakai di server + tes). */
export function applyContentFilters<T extends FilterableContent>(
  items: T[],
  filters: PlanningFilters,
): T[] {
  return items.filter((item) => {
    if (filters.brandId && item.brand_id !== filters.brandId) return false;
    if (filters.campaignId && item.campaign_id !== filters.campaignId) return false;
    if (filters.pillarId && item.pillar_id !== filters.pillarId) return false;
    if (filters.productionStatus && item.production_status !== filters.productionStatus)
      return false;
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.ownerId && item.owner_user_id !== filters.ownerId) return false;
    if (filters.channelId || filters.platform || filters.format || filters.distributionStatus) {
      const placements = item.placements ?? [];
      const ok = placements.some((p) => {
        if (filters.channelId && p.social_channel_id !== filters.channelId) return false;
        if (filters.format && p.platform_format !== filters.format) return false;
        if (filters.distributionStatus && p.distribution_status !== filters.distributionStatus)
          return false;
        if (filters.platform) {
          const platform = item.channelPlatforms?.[p.social_channel_id] ?? "";
          if (platform !== filters.platform) return false;
        }
        return true;
      });
      if (!ok) return false;
    }
    return true;
  });
}
