/**
 * Konstanta Campaign & Visual Planning — features/campaign/constants.ts (P5-03).
 * Label status campaign dipakai ulang dari planning/constants.ts (P2-07).
 */
export { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABELS } from "@/features/planning/constants";
export type { CampaignStatus } from "@/features/planning/constants";

/** Label "approximate" yang SELALU terlihat di preview visual (R5.3). */
export const VISUAL_PREVIEW_APPROXIMATE_LABEL_ID =
  "Preview ini perkiraan tampilan feed — bukan tampilan persis platform.";

/** Kolom CSV campaign — tetap (ASUMSI-5.6). Urutan TIDAK BOLEH berubah. */
export const CAMPAIGN_CSV_COLUMNS = [
  "name",
  "objective",
  "audience_name",
  "start_at",
  "end_at",
  "status",
  "owner_email",
  "target_deliverables",
  "target_date",
  "notes",
  "brands",
  "deliverables",
] as const;

export const CAMPAIGN_CSV_FILENAME = "campaigns.csv";

/** Pesan jujur bila tabel Phase 5 belum tersedia di database live. */
export const CAMPAIGN_TABLES_UNAVAILABLE_ID =
  "Tabel Phase 5 (migrasi 0017) belum diterapkan ke database ini — minta koordinator menjalankan docs/phase-5-report.md §8, lalu muat ulang halaman ini.";

export const BRAND_SCOPE_TABLES_UNAVAILABLE_ID =
  "Penegakan brand scope (migrasi 0016) belum diterapkan ke database ini — minta koordinator menjalankan docs/phase-5-report.md §8, lalu muat ulang halaman ini.";
