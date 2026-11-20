"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ChannelIcon } from "@/components/ui/ChannelIcon";
import { PriorityBadge } from "@/components/ui/Badges";
import { transitionContentAction, type PlanningActionResult } from "../actions";
import type { ProductionStatus } from "../constants";
import { PRODUCTION_STATUS_LABELS } from "../constants";
import {
  isValidProductionTransition,
  productionTransitionRequiresReason,
  validProductionTargets,
} from "../transitions";
import { formatInTimezone } from "@/lib/time";

export type BoardCard = {
  contentItemId: string;
  title: string;
  brandName: string;
  platforms: string[];
  formats: string[];
  ownerId: string;
  dueAt: string | null;
  timezone: string;
  priority: string | null;
  productionStatus: ProductionStatus;
};

/** Kolom kanban: 8 tahap utama + Arsip + Terkendala (3 exception digabung). */
export const BOARD_COLUMNS: Array<{
  id: string;
  label: string;
  statuses: ProductionStatus[];
}> = [
  { id: "idea", label: "Ide", statuses: ["idea"] },
  { id: "brief", label: "Brief", statuses: ["brief"] },
  { id: "scripting", label: "Scripting", statuses: ["scripting"] },
  { id: "ready_for_production", label: "Siap Produksi", statuses: ["ready_for_production"] },
  { id: "in_production", label: "Dalam Produksi", statuses: ["in_production"] },
  { id: "editing", label: "Editing", statuses: ["editing"] },
  { id: "internal_review", label: "Review Internal", statuses: ["internal_review"] },
  { id: "approved", label: "Disetujui", statuses: ["approved"] },
  { id: "blocked", label: "Terkendala", statuses: ["changes_requested", "blocked", "cancelled"] },
  { id: "archived", label: "Diarsipkan", statuses: ["archived"] },
];

/**
 * Board Kanban (P2-12). Membaca record kanonis yang sama dengan kalender.
 * Drag/drop HTML5 native (ADR-0008 §1) + pemilih "Pindah" per kartu sebagai
 * alternatif yang bisa disentuh/keyboard. Validasi transisi + izin di
 * domain service (RPC 0008), bukan di UI. WIP limit: tanpa batas (P2-A6).
 */
export function BoardClient({
  workspaceId,
  cards,
  canEdit,
}: {
  workspaceId: string;
  cards: BoardCard[];
  canEdit: boolean;
}) {
  const [message, setMessage] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [exceptionDialog, setExceptionDialog] = useState<{
    contentItemId: string;
    title: string;
    from: ProductionStatus;
  } | null>(null);
  const [exceptionTarget, setExceptionTarget] = useState<ProductionStatus>("blocked");
  const [exceptionReason, setExceptionReason] = useState("");

  async function doTransition(
    contentItemId: string,
    to: ProductionStatus,
    reason: string,
    title: string,
  ): Promise<boolean> {
    setPendingId(contentItemId);
    const fd = new FormData();
    fd.set("contentItemId", contentItemId);
    fd.set("workspaceId", workspaceId);
    fd.set("toStatus", to);
    fd.set("reason", reason);
    const result: PlanningActionResult = await transitionContentAction(
      { ok: false, message: "" },
      fd,
    );
    setPendingId(null);
    if (result.ok) {
      setMessage(`“${title}” pindah ke ${PRODUCTION_STATUS_LABELS[to].label}.`);
      setExceptionDialog(null);
      setExceptionReason("");
      return true;
    }
    setMessage(result.message);
    return false;
  }

  function handleDrop(columnStatuses: ProductionStatus[], e: React.DragEvent) {
    e.preventDefault();
    const contentItemId = e.dataTransfer.getData("text/content-item-id");
    if (!contentItemId || !canEdit) return;
    const card = cards.find((c) => c.contentItemId === contentItemId);
    if (!card) return;
    const target = columnStatuses.find((s) =>
      isValidProductionTransition(card.productionStatus, s),
    );
    if (!target) {
      setMessage(
        `Tidak ada transisi valid dari ${PRODUCTION_STATUS_LABELS[card.productionStatus].label} ke kolom ini.`,
      );
      return;
    }
    if (productionTransitionRequiresReason(card.productionStatus, target)) {
      setExceptionDialog({ contentItemId, title: card.title, from: card.productionStatus });
      setExceptionTarget(target);
      return;
    }
    void doTransition(contentItemId, target, "", card.title);
  }

  return (
    <div className="flex flex-col gap-4">
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      {!canEdit ? (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Peran Anda hanya bisa melihat board — pindah stage butuh peran yang boleh mengedit konten.
        </p>
      ) : null}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {BOARD_COLUMNS.map((col) => {
          const colCards = cards.filter((c) => col.statuses.includes(c.productionStatus));
          return (
            <section
              key={col.id}
              aria-label={`Kolom ${col.label}`}
              onDragOver={(e) => {
                if (canEdit) e.preventDefault();
              }}
              onDrop={(e) => handleDrop(col.statuses, e)}
              className="flex w-72 shrink-0 flex-col gap-2 rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-canvas)] p-3"
            >
              <header className="flex items-baseline justify-between px-1">
                <h2 className="font-semibold">
                  {col.label}{" "}
                  <span className="text-[var(--mt-text-muted)]">({colCards.length})</span>
                </h2>
                <span className="text-xs text-[var(--mt-text-muted)]">WIP: tanpa batas</span>
              </header>
              {colCards.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--mt-border)] bg-[var(--mt-surface)] p-3 text-center text-xs text-[var(--mt-text-muted)]">
                  Belum ada konten di stage ini.
                </p>
              ) : null}
              {colCards.map((card) => {
                const targets = validProductionTargets(card.productionStatus);
                return (
                  <article
                    key={card.contentItemId}
                    draggable={canEdit}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/content-item-id", card.contentItemId);
                      setDraggingId(card.contentItemId);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    className={`rounded-xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-3 ${
                      draggingId === card.contentItemId ? "opacity-50" : ""
                    } ${canEdit ? "cursor-grab" : ""}`}
                  >
                    <Link
                      href={`/konten/${card.contentItemId}?workspace=${workspaceId}`}
                      className="font-medium text-[var(--mt-teal-700)] underline"
                    >
                      {card.title}
                    </Link>
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-[var(--mt-text-muted)]">
                      {card.platforms.map((p) => (
                        <ChannelIcon key={p} platform={p} size="sm" />
                      ))}
                      <span>
                        {card.brandName}
                        {card.formats.length > 0 ? ` · ${card.formats.join(", ")}` : ""}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                      Tenggat:{" "}
                      {card.dueAt
                        ? formatInTimezone(card.dueAt, card.timezone)
                        : "belum ditentukan"}
                    </p>
                    {card.priority ? (
                      <p className="mt-1">
                        <PriorityBadge
                          priority={card.priority as "low" | "medium" | "high" | "urgent"}
                        />
                      </p>
                    ) : null}
                    {canEdit && targets.length > 0 ? (
                      <form
                        className="mt-2 flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const form = e.currentTarget;
                          const select = form.elements.namedItem("toStatus") as HTMLSelectElement;
                          const to = select.value as ProductionStatus;
                          if (!to) return;
                          if (productionTransitionRequiresReason(card.productionStatus, to)) {
                            setExceptionDialog({
                              contentItemId: card.contentItemId,
                              title: card.title,
                              from: card.productionStatus,
                            });
                            setExceptionTarget(to);
                            return;
                          }
                          void doTransition(card.contentItemId, to, "", card.title);
                        }}
                      >
                        <label className="sr-only" htmlFor={`move-${card.contentItemId}`}>
                          Pindah {card.title} ke stage
                        </label>
                        <select
                          id={`move-${card.contentItemId}`}
                          name="toStatus"
                          defaultValue=""
                          className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--mt-border)] bg-[var(--mt-surface)] px-2 text-xs"
                        >
                          <option value="">Pindah ke…</option>
                          {targets.map((t) => (
                            <option key={t} value={t}>
                              {PRODUCTION_STATUS_LABELS[t].label}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" size="sm" disabled={pendingId === card.contentItemId}>
                          Pindah
                        </Button>
                      </form>
                    ) : null}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>

      <Dialog
        open={exceptionDialog !== null}
        onClose={() => setExceptionDialog(null)}
        title="Transisi butuh alasan"
        description="Transisi ini masuk/keluar dari status exception — alasan wajib diisi dan tercatat di riwayat status."
      >
        {exceptionDialog ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              “{exceptionDialog.title}” — dari{" "}
              {PRODUCTION_STATUS_LABELS[exceptionDialog.from].label} ke{" "}
              {PRODUCTION_STATUS_LABELS[exceptionTarget].label}.
            </p>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Alasan (wajib)
              <textarea
                value={exceptionReason}
                onChange={(e) => setExceptionReason(e.target.value)}
                rows={3}
                className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
              />
            </label>
            <Button
              disabled={!exceptionReason.trim()}
              onClick={() =>
                void doTransition(
                  exceptionDialog.contentItemId,
                  exceptionTarget,
                  exceptionReason,
                  exceptionDialog.title,
                )
              }
            >
              Pindah dengan alasan ini
            </Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
