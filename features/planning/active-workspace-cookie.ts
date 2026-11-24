// Nama cookie workspace aktif - dipakai bersama features/tenancy/actions.ts
// (diset saat workspace dibuat) dan features/planning/context.ts
// (dipakai sebagai fallback bila tidak ada `?workspace=`).
// Disimpan di modul ini (bukan di actions.ts) karena file "use server"
// hanya boleh mengekspor fungsi async (server action); mengekspor const
// dari sana membuat bundler menolak seluruh modul itu.
export const ACTIVE_WORKSPACE_COOKIE = "mative-workspace-id";
