/**
 * Konstanta domain AI Assistant — features/ai/constants.ts (P8-02).
 * Sumber: ADR-0014 + ASUMSI-8A s.d. 8F + Rencana Detail §8.1–8.9.
 *
 * ATURAN KERAS: 7 id fitur + label di sini HARUS sama persis dengan
 * CHECK `ai_generations_feature_check` di migrasi 0022 (diuji paritas
 * di tests/ai.test.ts). Bila Tuan menetapkan fitur baru, ubah migrasi
 * (baru) DAN katalog ini bersamaan.
 *
 * AI NONAKTIF (Keputusan #11): TIDAK ADA provider yang dipilih — adapter
 * netral mengembalikan state "not configured" yang jujur; halaman AI
 * menampilkan setup state, BUKAN hasil palsu.
 */

/** Batas pemakaian default (ASUMSI-8E): 10 generasi completed/hari/workspace. */
export const AI_DEFAULT_DAILY_LIMIT = 10;

/** Retensi log ai_generations (ASUMSI-8D): 90 hari — sama dengan ai_retention_days() 0022. */
export const AI_RETENTION_DAYS = 90;

/** Timeout aksi AI (ASUMSI-8F): 30 detik. */
export const AI_ACTION_TIMEOUT_MS = 30000;

export const AI_FEATURES = [
  "content_ideas",
  "brief",
  "content_draft",
  "repurpose",
  "checklist",
  "feedback_summary",
  "campaign_summary",
] as const;

export type AiFeature = (typeof AI_FEATURES)[number];

export type AiFeatureEntry = {
  id: AiFeature;
  label: string;
  description: string;
  /** Sumber data yang BOLEH dipakai aksi ini (R8.9). */
  allowedSources: string;
  /** Ke mana output dimasukkan (8.4). */
  insertTarget: string;
  /** Apakah output bisa dimasukkan sebagai versi konten baru (RPC 0022)? */
  canInsertAsVersion: boolean;
};

export const AI_FEATURE_CATALOG: AiFeatureEntry[] = [
  {
    id: "content_ideas",
    label: "Ide Konten",
    description:
      "Ide konten dari brand, audiens, tujuan, pilar, campaign, dan channel workspace ini — dikelompokkan dan dicek duplikasinya.",
    allowedSources: "brand, audiens, tujuan, pilar, campaign, dan channel dari workspace ini",
    insertTarget: "Salin ke form buat ide (prefill, submit normal)",
    canInsertAsVersion: false,
  },
  {
    id: "brief",
    label: "Brief Terstruktur",
    description:
      "Brief terstruktur dari ide + angle/format yang dipilih — tujuan, audiens, poin kunci, hook, dan CTA.",
    allowedSources: "ide yang dipilih + brand/campaign terkait",
    insertTarget: "Insert sebagai versi baru konten (RPC insert_ai_draft_version)",
    canInsertAsVersion: true,
  },
  {
    id: "content_draft",
    label: "Draft Konten",
    description: "Hook, outline, script, caption, CTA, dan hashtag dari konten + brief snapshot-nya.",
    allowedSources: "content item yang dipilih + brief snapshot-nya",
    insertTarget: "Insert sebagai versi baru konten (RPC insert_ai_draft_version)",
    canInsertAsVersion: true,
  },
  {
    id: "repurpose",
    label: "Repurpose",
    description:
      "Ubah konten ke channel/format lain dengan batas platform TERVERIFIKASI dari capability registry Phase 7. Batas yang belum terverifikasi ditandai belum diketahui — tidak dikarang.",
    allowedSources: "content item yang dipilih + capability registry Phase 7 (batas platform terverifikasi)",
    insertTarget: "Salin ke form buat konten (prefill channel/format target) atau insert sebagai versi baru item target",
    canInsertAsVersion: true,
  },
  {
    id: "checklist",
    label: "Checklist Produksi",
    description:
      "Checklist creative production + rangkuman sumber/referensi yang diberikan user. Hanya sumber yang diberikan di input aksi ini.",
    allowedSources: "hanya sumber/referensi yang diberikan user di input aksi ini",
    insertTarget: "Tampil + salin teks (tidak ada insert versi)",
    canInsertAsVersion: false,
  },
  {
    id: "feedback_summary",
    label: "Rangkuman Feedback",
    description:
      "Rangkum thread komentar + kelompokkan feedback revisi menjadi action items + catatan handoff.",
    allowedSources: "thread komentar target di workspace ini",
    insertTarget: "Action items ditampilkan; user membuat tugas manual (tidak auto-create)",
    canInsertAsVersion: false,
  },
  {
    id: "campaign_summary",
    label: "Rangkuman Campaign",
    description:
      "Rangkum performa campaign dari metrik NYATA + sarankan eksperimen dengan menyebut metrik + periode sumber + tandai konten yang perlu dievaluasi. Tanpa klaim sebab-akibat tanpa bukti.",
    allowedSources: "metrik campaign nyata dari database (grounding analytics 8.5)",
    insertTarget: "Tampil saja (insight bukan konten)",
    canInsertAsVersion: false,
  },
];

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  content_ideas: "Ide Konten",
  brief: "Brief Terstruktur",
  content_draft: "Draft Konten",
  repurpose: "Repurpose",
  checklist: "Checklist Produksi",
  feedback_summary: "Rangkuman Feedback",
  campaign_summary: "Rangkuman Campaign",
};

export type AiGenerationStatus = "completed" | "failed" | "blocked" | "not_configured";

export type AiErrorCategory =
  | "none"
  | "provider_not_configured"
  | "provider_error"
  | "rate_limited"
  | "invalid_output"
  | "prompt_injection"
  | "usage_limit"
  | "validation";

/** Pesan jujur (ID) — dipakai adapter, action, dan halaman. */
export const AI_NOT_CONFIGURED_ID =
  "AI belum dikonfigurasi untuk workspace ini — pilih provider dulu.";
export const AI_DISABLED_ID =
  "AI belum diaktifkan untuk workspace ini — aktifkan dulu di pengaturan AI.";
export const AI_USAGE_LIMIT_ID =
  "Batas pemakaian AI hari ini sudah tercapai — coba lagi besok atau minta owner/admin menaikkan batasnya.";
export const AI_ACCESS_DENIED_ID = "Peran Anda tidak boleh memakai Asisten AI.";
export const AI_TABLES_UNAVAILABLE_ID =
  "Tabel AI (migrasi 0022) belum diterapkan ke database ini — minta koordinator menjalankan docs/phase-8-report.md §8, lalu muat ulang halaman ini.";
export const AI_INJECTION_BLOCKED_ID =
  "Input terdeteksi mengandung upaya override instruksi — aksi diblokir dan dicatat.";
