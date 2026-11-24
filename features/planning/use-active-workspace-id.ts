"use client";

import { useSyncExternalStore } from "react";

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
