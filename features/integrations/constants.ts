/**
 * Konstanta Integrasi — features/integrations/constants.ts (P7-03).
 * Sumber: ADR-0013 + ASUMSI-7B/7F.
 *
 * ATURAN KERAS: SEMUA platform DISABLED di Phase 7 — platform pertama
 * BELUM dipilih (langkah 7.1 tidak terpenuhi) dan TIDAK ADA akses ke
 * platform apa pun (langkah 7.3 tidak terpenuhi). Daftar di bawah ini
 * BUKAN klaim dukungan: tiap platform menampilkan blocker yang
 * didokumentasikan, dan capability registry mencatat status 'disabled'
 * per channel. Jangan tambahkan platform ke daftar "didukung" sampai
 * uji akun test lolos (ASUMSI-7F).
 */
export type IntegrationPlatformEntry = {
  platform: string;
  label: string;
  officialUrl: string;
  /** Alasan adapter DISABLED (ditampilkan di UI + disimpan di capability_snapshot). */
  blocker: string;
};

export const INTEGRATION_DISABLED_BLOCKER =
  "Platform belum dipilih (langkah 7.1) + akses belum tersedia (langkah 7.3) — adapter DISABLED. Data analytics hanya dari impor manual/CSV berlabel.";

export const INTEGRATION_PLATFORMS: readonly IntegrationPlatformEntry[] = [
  {
    platform: "instagram",
    label: "Instagram",
    officialUrl: "https://www.instagram.com",
    blocker: INTEGRATION_DISABLED_BLOCKER,
  },
  {
    platform: "tiktok",
    label: "TikTok",
    officialUrl: "https://www.tiktok.com",
    blocker: INTEGRATION_DISABLED_BLOCKER,
  },
  {
    platform: "youtube",
    label: "YouTube",
    officialUrl: "https://studio.youtube.com",
    blocker: INTEGRATION_DISABLED_BLOCKER,
  },
  {
    platform: "facebook",
    label: "Facebook",
    officialUrl: "https://www.facebook.com",
    blocker: INTEGRATION_DISABLED_BLOCKER,
  },
  {
    platform: "linkedin",
    label: "LinkedIn",
    officialUrl: "https://www.linkedin.com",
    blocker: INTEGRATION_DISABLED_BLOCKER,
  },
  {
    platform: "x",
    label: "X",
    officialUrl: "https://x.com",
    blocker: INTEGRATION_DISABLED_BLOCKER,
  },
  {
    platform: "threads",
    label: "Threads",
    officialUrl: "https://www.threads.net",
    blocker: INTEGRATION_DISABLED_BLOCKER,
  },
];

export const INTEGRATION_CONNECTION_STATUS_LABELS: Record<string, string> = {
  not_connected: "Belum terhubung",
  manual: "Manual",
  disabled: "Dinonaktifkan",
};

/** Pesan bila tabel Phase 7 belum tersedia di database live. */
export const INTEGRATIONS_TABLES_UNAVAILABLE_ID =
  "Tabel Analytics Foundation (migrasi 0021) belum diterapkan ke database ini — minta koordinator menjalankan docs/phase-7-report.md §8, lalu muat ulang halaman ini.";
