/**
 * Status setup AI — features/ai/components/AiSetupState.tsx (P8-02/8.7).
 * Jujur: AI NONAKTIF (tidak ada provider) — tampilkan setup state,
 * BUKAN hasil palsu. Menampilkan status aktif/nonaktif workspace,
 * provider, dan pemakaian hari ini vs batas.
 */
import { AI_DEFAULT_DAILY_LIMIT, AI_RETENTION_DAYS } from "../constants";
import type { AiSettings } from "../types";

export function AiSetupState({
  settings,
  usage,
}: {
  settings: AiSettings;
  usage: { used: number; limit: number } | null;
}) {
  const limit = usage?.limit ?? settings.dailyLimit ?? AI_DEFAULT_DAILY_LIMIT;
  const used = usage?.used ?? 0;
  return (
    <div
      role="status"
      className="rounded-2xl border border-[var(--mt-amber-500)] bg-[var(--mt-surface)] p-4 text-sm"
    >
      <p className="font-medium">🤖 AI belum dikonfigurasi — pilih provider dulu.</p>
      <p className="mt-1 text-[var(--mt-text-muted)]">
        Asisten AI di workspace ini memakai adapter netral tanpa provider. Semua aksi akan
        berakhir dengan pesan &ldquo;AI belum dikonfigurasi&rdquo; dan tercatat di log — tidak ada
        hasil palsu, tidak ada pemanggilan model, tidak ada biaya.
      </p>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-[var(--mt-text-muted)]">Status workspace</dt>
          <dd className="font-medium">{settings.enabled ? "Aktif (opt-in)" : "Nonaktif (default)"}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--mt-text-muted)]">Provider</dt>
          <dd className="font-medium">Tidak ada (none)</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--mt-text-muted)]">Pemakaian hari ini</dt>
          <dd className="font-medium">
            {used} / {limit} generasi
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-[var(--mt-text-muted)]">
        Retensi log {AI_RETENTION_DAYS} hari. Input mentah tidak disimpan — log hanya menyimpan
        referensi, status, dan kategori galat.
      </p>
    </div>
  );
}
