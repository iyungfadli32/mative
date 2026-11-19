/**
 * Panel review klien di portal (P4-14, Keputusan #12).
 * Server component: menampilkan status client review konten yang dibagikan
 * + komentar klien yang sudah ada + form komentar (HANYA bila workspace
 * mengizinkan eksplisit; default TIDAK BOLEH).
 * Komentar klien TIDAK PERNAH menjadi keputusan approval.
 */
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { APPROVAL_STATUS_LABELS } from "@/features/approval/constants";
import { isClientCommentAllowed, listContentApprovalRequests } from "@/features/approval/queries";
import { ClientCommentForm } from "./ClientCommentForm";

export async function ClientReviewPanel({
  shareId,
  resourceType,
  resourceId,
  workspaceId,
}: {
  shareId: string;
  resourceType: string;
  resourceId: string;
  workspaceId: string;
}) {
  const supabase = await getSupabaseServerClient();
  if (!supabase || resourceType !== "content_item") return null;
  const [requestsRes, canComment, commentsRes] = await Promise.all([
    listContentApprovalRequests(supabase, resourceId),
    isClientCommentAllowed(supabase, workspaceId),
    supabase
      .from("comments")
      .select("id, body, author_user_id, created_at")
      .eq("target_type", "content_item")
      .eq("target_id", resourceId)
      .order("created_at", { ascending: true }),
  ]);
  if (requestsRes.unavailable) return null;
  const clientRequest = requestsRes.data.find((r) => r.request_type === "client");
  const comments = (commentsRes.data ?? []) as {
    id: string;
    body: string;
    author_user_id: string;
    created_at: string;
  }[];
  return (
    <div className="mt-5 rounded-2xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-4">
      <h2 className="font-semibold">Review klien</h2>
      {clientRequest ? (
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
          Status client review konten ini: {APPROVAL_STATUS_LABELS[clientRequest.status]}.
        </p>
      ) : (
        <p className="mt-1 text-sm text-[var(--mt-text-muted)]">
          Konten ini belum diajukan untuk client review.
        </p>
      )}
      {comments.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl bg-[var(--mt-canvas)] p-3 text-sm">
              <p>{c.body}</p>
              <p className="mt-1 text-xs text-[var(--mt-text-muted)]">
                {new Date(c.created_at).toLocaleString("id-ID")}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-[var(--mt-text-muted)]">Belum ada komentar.</p>
      )}
      {canComment ? (
        <ClientCommentForm shareId={shareId} />
      ) : (
        <p className="mt-3 text-sm text-[var(--mt-text-muted)]">
          Komentar klien tidak diizinkan untuk workspace ini (default Keputusan #12). Bila tim
          mengizinkan, form komentar akan muncul di sini.
        </p>
      )}
    </div>
  );
}
