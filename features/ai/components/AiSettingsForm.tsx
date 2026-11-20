/**
 * Form pengaturan AI — features/ai/components/AiSettingsForm.tsx (P8-07).
 * Owner/admin saja (halaman menutup form untuk peran lain; RLS 0003
 * menegakkan tulis). Form TIDAK PERNAH disembunyikan berdasarkan hasil
 * aksinya sendiri — pesan tampil di bawah form yang tetap mounted.
 */
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { saveAiSettingsAction } from "../actions";
import type { AiActionResult, AiSettings } from "../types";

function ResultMessage({ state }: { state: AiActionResult }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className="text-sm">
      {state.message}
    </p>
  );
}

export function AiSettingsForm({
  workspaceId,
  settings,
}: {
  workspaceId: string;
  settings: AiSettings;
}) {
  const [state, formAction, pending] = useActionState(saveAiSettingsAction, {
    ok: false,
    message: "",
  } satisfies AiActionResult);
  return (
    <section aria-label="Pengaturan AI" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Pengaturan AI</h2>
      <p className="text-sm text-[var(--mt-text-muted)]">
        AI default nonaktif per workspace (opt-in eksplisit). Tanpa batas yang disepakati, AI tidak
        diaktifkan untuk workspace ini. Batas harian dihitung dari generasi yang selesai saja.
      </p>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ai-set-enabled" className="text-sm font-medium text-[var(--mt-text)]">
              Aktifkan AI untuk workspace ini
            </label>
            <select
              id="ai-set-enabled"
              name="enabled"
              defaultValue={settings.enabled ? "true" : "false"}
              className="h-10 w-full rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 text-sm text-[var(--mt-text)]"
            >
              <option value="false">Nonaktif (default)</option>
              <option value="true">Aktif</option>
            </select>
            <p className="text-xs text-[var(--mt-text-muted)]">
              Aktif pun tetap butuh provider — tanpa provider, aksi berakhir &ldquo;belum
              dikonfigurasi&rdquo;.
            </p>
          </div>
          <Input
            id="ai-set-daily-limit"
            type="number"
            name="dailyLimit"
            label="Batas harian (generasi selesai)"
            defaultValue={String(settings.dailyLimit)}
            hint="Default 10. Bila tercapai, aksi AI ditolak dengan pesan yang jelas."
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Menyimpan…" : "Simpan pengaturan AI"}
          </Button>
        </div>
        <ResultMessage state={state} />
      </form>
    </section>
  );
}
