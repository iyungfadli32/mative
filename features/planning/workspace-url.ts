import { useSyncExternalStore } from "react";

/**
 * Menambahkan ?workspace=<id> ke tautan internal perencanaan (Batch 4, T-1).
 * Tanpa workspace aktif, tautan dibiarkan apa adanya; getPlanningContext tetap
 * jatuh ke workspace pertama (perilaku lama) dan memberi peringatan bila
 * workspace yang diminta bukan milik pengguna.
 */
export function withWorkspace(href: string, workspaceId: string | null | undefined): string {
  if (!workspaceId) return href;
  if (href.startsWith("http") || href.startsWith("#")) return href;
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  if (!params.has("workspace")) params.set("workspace", workspaceId);
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

/**
 * Workspace aktif dari URL saat ini (?workspace=). Dipakai komponen klien
 * (AppShell) sebagai cadangan bila prop workspaceId tidak diteruskan halaman.
 * Dibaca lewat useSyncExternalStore agar tidak ada ketidaksesuaian hidrasi
 * (server: null) dan tanpa setState di dalam effect.
 */
function subscribeWorkspaceChange(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function getWorkspaceFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("workspace");
}

function getServerWorkspace(): string | null {
  return null;
}

export function useActiveWorkspaceId(): string | null {
  return useSyncExternalStore(subscribeWorkspaceChange, getWorkspaceFromUrl, getServerWorkspace);
}
