"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  createCommentAction,
  deleteCommentAction,
  updateCommentAction,
  type ProductionActionResult,
} from "../actions";
import type { Comment, CommentTargetType } from "../types";
import { formatInTimezone } from "@/lib/time";

/**
 * Thread komentar + mention (P3-09). Mention dipilih eksplisit dari
 * anggota workspace (bukan parsing teks @nama). Balasan menargetkan
 * komentar induk. Edit mengisi edited_at; hapus = soft-delete.
 */
export function CommentThread({
  workspaceId,
  targetType,
  targetId,
  comments,
  members,
  canComment,
  userId,
}: {
  workspaceId: string;
  targetType: CommentTargetType;
  targetId: string;
  comments: Comment[];
  members: Array<{ userId: string; displayName: string }>;
  canComment: boolean;
  userId: string;
}) {
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, editAction, editPending] = useActionState(updateCommentAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteCommentAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);

  const roots = comments.filter((c) => !c.parent_comment_id);
  const replies = (parentId: string) => comments.filter((c) => c.parent_comment_id === parentId);

  const commentCard = (comment: Comment, depth: number) => {
    const isDeleted = Boolean(comment.deleted_at);
    const isAuthor = comment.author_user_id === userId;
    return (
      <li
        key={comment.id}
        className={`rounded-xl border border-[var(--mt-border)] p-3 ${depth > 0 ? "ml-6" : ""}`}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mt-text-muted)]">
          <span className="font-medium text-[var(--mt-text)]">
            {comment.authorName ?? "Anggota"}
          </span>
          <span>{formatInTimezone(comment.created_at)}</span>
          {comment.edited_at ? <span>· diubah</span> : null}
        </div>
        {isDeleted ? (
          <p className="mt-1 text-sm italic text-[var(--mt-text-muted)]">Komentar ini dihapus.</p>
        ) : editingId === comment.id ? (
          <form action={editAction} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="commentId" value={comment.id} />
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <textarea
              name="body"
              rows={3}
              defaultValue={comment.body}
              required
              maxLength={5000}
              className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={editPending}>
                Simpan
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setEditingId(null)}
              >
                Batal
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
            {(comment.mentions ?? []).length > 0 ? (
              <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                Menyebut:{" "}
                {(comment.mentions ?? []).map((m) => `@${m.mentionedName ?? "anggota"}`).join(", ")}
              </p>
            ) : null}
          </>
        )}
        {!isDeleted && canComment ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setReplyTo(comment.id)}>
              Balas
            </Button>
            {isAuthor ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingId(comment.id)}
                >
                  Ubah
                </Button>
                <form action={deleteAction}>
                  <input type="hidden" name="commentId" value={comment.id} />
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <Button type="submit" size="sm" variant="ghost" loading={deletePending}>
                    Hapus
                  </Button>
                </form>
              </>
            ) : null}
          </div>
        ) : null}
        {replyTo === comment.id && canComment ? (
          <div className="mt-3">
            <CommentComposer
              workspaceId={workspaceId}
              targetType={targetType}
              targetId={targetId}
              parentCommentId={comment.id}
              members={members}
              onDone={() => setReplyTo(null)}
            />
          </div>
        ) : null}
        {replies(comment.id).map((r) => commentCard(r, depth + 1))}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {comments.length === 0 ? (
        <p className="text-sm text-[var(--mt-text-muted)]">Belum ada komentar.</p>
      ) : (
        <ul className="flex flex-col gap-3">{roots.map((c) => commentCard(c, 0))}</ul>
      )}
      {editState.message ? (
        <p role={editState.ok ? "status" : "alert"} className="text-sm">
          {editState.message}
        </p>
      ) : null}
      {deleteState.message ? (
        <p role={deleteState.ok ? "status" : "alert"} className="text-sm">
          {deleteState.message}
        </p>
      ) : null}
      {canComment ? (
        <div className="rounded-2xl border border-[var(--mt-border)] p-3">
          <h3 className="text-sm font-semibold">Tulis komentar</h3>
          <div className="mt-2">
            <CommentComposer
              workspaceId={workspaceId}
              targetType={targetType}
              targetId={targetId}
              parentCommentId={null}
              members={members}
            />
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--mt-text-muted)]">
          Peran Anda tidak boleh berkomentar di sini.
        </p>
      )}
    </div>
  );
}

function MentionPicker({
  members,
  selected,
  onChange,
}: {
  members: Array<{ userId: string; displayName: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <label className="mt-2 flex flex-col gap-1.5 text-sm font-medium">
      Sebut anggota (opsional)
      <select
        multiple
        value={selected}
        onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
        className="min-h-10 rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm font-normal"
      >
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.displayName}
          </option>
        ))}
      </select>
      <span className="text-xs font-normal text-[var(--mt-text-muted)]">
        Tahan Ctrl/Cmd untuk memilih lebih dari satu. Yang disebut mendapat notifikasi.
      </span>
    </label>
  );
}

function CommentComposer({
  workspaceId,
  targetType,
  targetId,
  parentCommentId,
  members,
  onDone,
}: {
  workspaceId: string;
  targetType: CommentTargetType;
  targetId: string;
  parentCommentId: string | null;
  members: Array<{ userId: string; displayName: string }>;
  onDone?: () => void;
}) {
  const [mentioned, setMentioned] = useState<string[]>([]);
  const [state, formAction, pending] = useActionState(createCommentAction, {
    ok: false,
    message: "",
  } satisfies ProductionActionResult);
  return (
    <form
      action={async (fd) => {
        await formAction(fd);
        onDone?.();
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="targetType" value={targetType} />
      <input type="hidden" name="targetId" value={targetId} />
      {parentCommentId ? (
        <input type="hidden" name="parentCommentId" value={parentCommentId} />
      ) : null}
      {mentioned.map((id) => (
        <input key={id} type="hidden" name="mentionedUserIds" value={id} />
      ))}
      <textarea
        name="body"
        rows={3}
        required
        maxLength={5000}
        placeholder={parentCommentId ? "Tulis balasan…" : "Tulis komentar…"}
        className="rounded-[10px] border border-[var(--mt-border)] bg-[var(--mt-surface)] px-3 py-2 text-sm"
      />
      <MentionPicker members={members} selected={mentioned} onChange={setMentioned} />
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className="text-sm">
          {state.message}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" loading={pending}>
          {parentCommentId ? "Kirim balasan" : "Kirim komentar"}
        </Button>
      </div>
    </form>
  );
}
