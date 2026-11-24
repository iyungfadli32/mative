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
