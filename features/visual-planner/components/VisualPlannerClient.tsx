/**
 * Visual Planner (klien) — features/visual-planner/components/VisualPlannerClient.tsx (P5-05).
 * Modul lepas (Keputusan #4): urutan visual disimpan terpisah dari
 * scheduled_at; planner TIDAK PERNAH mengubah jadwal. Drag & drop
 * (dnd-kit) untuk urutan + tombol naik/turun/lepas/tambah sebagai
 * alternatif sentuh/keyboard. Perubahan disimpan eksplisit lewat tombol
 * "Simpan urutan" (RPC set_visual_order).
 */
"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PlannerPlacement } from "@/features/campaign/types";
import { VISUAL_PREVIEW_APPROXIMATE_LABEL_ID } from "@/features/campaign/constants";
import { setVisualOrderAction } from "../actions";

function formatDate(value: string | null): string {
  if (!value) return "Belum dijadwalkan";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function SortableRow({
  item,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  item: PlannerPlacement;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-3 rounded-lg border p-3 ${isDragging ? "border-blue-400 bg-blue-50 shadow" : "border-slate-200 bg-white"}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="mt-1 shrink-0 cursor-grab rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 active:cursor-grabbing"
        aria-label={`Seret ${item.content_title} untuk mengubah urutan`}
        title="Seret untuk mengubah urutan"
      >
        ⠿
      </button>
      <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.content_title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">
          {item.channel_platform ?? "Channel"} · {item.platform_format ?? "format tidak diatur"} ·{" "}
          {formatDate(item.scheduled_at)}
        </span>
        <span className="mt-0.5 block text-xs text-slate-500">
          Status konten: {item.content_status} · Distribusi: {item.distribution_status}
        </span>
      </span>
      <span className="flex shrink-0 flex-col gap-1">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40"
        >
          ↑ Naik
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === total - 1}
          className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40"
        >
          ↓ Turun
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded border border-slate-200 px-2 py-1 text-xs text-red-700"
        >
          Lepas
        </button>
      </span>
    </li>
  );
}

export default function VisualPlannerClient({
  workspaceId,
  brandId,
  channelId,
  channelLabel,
  brandName,
  items,
}: {
  workspaceId: string;
  brandId: string;
  channelId: string;
  channelLabel: string;
  brandName: string;
  items: PlannerPlacement[];
}) {
  const initialOrdered = useMemo(
    () =>
      items
        .filter((i) => i.position !== null)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((i) => i.id),
    [items],
  );
  const itemsKey = useMemo(
    () => items.map((i) => `${i.id}:${i.position ?? ""}`).join("|"),
    [items],
  );
  const [orderedIds, setOrderedIds] = useState<string[]>(initialOrdered);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Sinkron ulang bila data server berubah (sesudah simpan + revalidasi):
  // pola "adjust state during render" (bukan setState di effect).
  const [prevItemsKey, setPrevItemsKey] = useState(itemsKey);
  if (prevItemsKey !== itemsKey) {
    setPrevItemsKey(itemsKey);
    setOrderedIds(initialOrdered);
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const orderedItems = useMemo(
    () =>
      orderedIds
        .map((id) => items.find((i) => i.id === id))
        .filter((i): i is PlannerPlacement => Boolean(i)),
    [orderedIds, items],
  );
  const unorderedItems = useMemo(
    () => items.filter((i) => !orderedIds.includes(i.id)),
    [orderedIds, items],
  );
  const dirty = useMemo(
    () => orderedIds.join("|") !== initialOrdered.join("|"),
    [orderedIds, initialOrdered],
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrderedIds((ids) => {
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return ids;
      return arrayMove(ids, oldIndex, newIndex);
    });
  }

  function move(index: number, delta: -1 | 1) {
    setOrderedIds((ids) => {
      const next = [...ids];
      const target = index + delta;
      if (target < 0 || target >= next.length) return ids;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function save() {
    const formData = new FormData();
    formData.set("workspaceId", workspaceId);
    formData.set("brandId", brandId);
    formData.set("channelId", channelId);
    for (const id of orderedIds) formData.append("placementIds", id);
    setMessage(null);
    startTransition(async () => {
      const result = await setVisualOrderAction(formData);
      setMessage(result.message);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {VISUAL_PREVIEW_APPROXIMATE_LABEL_ID} Urutan di bawah ini hanya mengatur
        tampilan feed — jadwal tayang (scheduled_at) tiap placement TIDAK berubah.
      </div>

      <section aria-label="Urutan feed">
        <h2 className="text-base font-semibold">
          Urutan feed — {channelLabel} · {brandName}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Seret kartu (atau pakai tombol Naik/Turun) untuk mengubah urutan, lalu tekan
          &ldquo;Simpan urutan&rdquo;. Placement yang belum masuk urutan ada di bawah.
        </p>
        {orderedItems.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-slate-500">
            Belum ada placement dalam urutan. Tambahkan dari daftar di bawah.
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
              <ol className="mt-3 space-y-2">
                {orderedItems.map((item, index) => (
                  <SortableRow
                    key={item.id}
                    item={item}
                    index={index}
                    total={orderedItems.length}
                    onMoveUp={() => move(index, -1)}
                    onMoveDown={() => move(index, 1)}
                    onRemove={() =>
                      setOrderedIds((ids) => ids.filter((id) => id !== item.id))
                    }
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={isPending || !dirty}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {isPending ? "Menyimpan…" : "Simpan urutan"}
          </button>
          {dirty ? (
            <span className="text-sm text-amber-700">Ada perubahan yang belum disimpan.</span>
          ) : (
            <span className="text-sm text-slate-500">Urutan tersimpan.</span>
          )}
          {message ? (
            <span className="text-sm text-slate-700" role="status">
              {message}
            </span>
          ) : null}
        </div>
      </section>

      <section aria-label="Placement belum masuk urutan">
        <h2 className="text-base font-semibold">Belum masuk urutan ({unorderedItems.length})</h2>
        {unorderedItems.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Semua placement di channel ini sudah masuk urutan.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {unorderedItems.map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.content_title}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {item.platform_format ?? "format tidak diatur"} · {formatDate(item.scheduled_at)}
                    {" · "}Status konten: {item.content_status}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setOrderedIds((ids) => [...ids, item.id])}
                  className="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs"
                >
                  + Tambah ke urutan
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
