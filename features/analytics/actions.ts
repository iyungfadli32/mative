/**
 * Server actions Analytics Foundation — features/analytics/actions.ts (P7-03).
 * Pola publishing/actions.ts: Zod dulu (boundary), lalu sesi + peran dari
 * DB (BUKAN dari body), lalu Supabase client sesi (RLS penegak terakhir).
 * - SEMUA penulisan metrik HANYA lewat RPC 0021 import_analytics_snapshot
 *   — TIDAK ADA penulisan langsung ke tabel analytics dari client.
 * - Satu CSV = satu snapshot = satu periode; validasi format di csv.ts,
 *   resolusi subject (UUID → brand + workspace) di sini, validasi akhir
 *   + atomik di RPC (satu baris buruk = seluruh impor gagal).
 * - TIDAK ADA adapter provider, OAuth, polling, atau penulisan secret.
 */
"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SUPABASE_NOT_CONFIGURED_ID } from "@/lib/env";
import { brandInScope, can } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/permissions";
import { importAnalyticsCsvSchema } from "@/lib/validation/schemas";
import { getCallerBrandScope, getCallerRole } from "@/features/planning/context";
import { parseAnalyticsCsv, validateAnalyticsCsvFile } from "./csv";
import type { ValidatedAnalyticsCsvRow } from "./csv";
import { ANALYTICS_TABLES_UNAVAILABLE_ID } from "./constants";
import type { AnalyticsActionResult, ImportRpcResult } from "./types";

const ok = (message: string, extra?: Partial<AnalyticsActionResult>): AnalyticsActionResult => ({
  ok: true,
  message,
  ...extra,
});
const fail = (message: string, extra?: Partial<AnalyticsActionResult>): AnalyticsActionResult => ({
  ok: false,
  message,
  ...extra,
});

function isMissingTableMessage(message: string): boolean {
  return /Could not find the table|Could not find the function|does not exist|42P01|PGRST205/i.test(
    message,
  );
}

function dbErrorMessage(error: { message?: string } | null, fallback: string): string {
  const message = error?.message ?? fallback;
  if (isMissingTableMessage(message)) return ANALYTICS_TABLES_UNAVAILABLE_ID;
  return message;
}

function asRpcResult(data: unknown): ImportRpcResult | null {
  if (!data || typeof data !== "object") return null;
  return data as ImportRpcResult;
}

async function requireImporter(
  workspaceId: string,
  userId: string,
  brandId: string | null,
): Promise<string | null> {
  const role = (await getCallerRole(workspaceId, userId)) as WorkspaceRole | null;
  if (!role || !can(role, "import_analytics")) {
    return "Peran Anda tidak boleh mengimpor analytics.";
  }
  if (brandId) {
    const scope = await getCallerBrandScope(workspaceId, userId);
    if (!brandInScope(scope, brandId)) {
      return "Brand ini di luar scope Anda.";
    }
  }
  return null;
}

/**
 * Resolusi subject CSV (UUID → brand di workspace ini). Batch per jenis
 * supaya satu impor besar tidak N+1. Mengembalikan peta subjectId →
 * brandId, atau pesan galat pertama (dengan nomor baris file).
 */
async function resolveSubjectBrands(
  supabase: SupabaseClient,
  workspaceId: string,
  rows: ValidatedAnalyticsCsvRow[],
): Promise<{ ok: true; brands: Map<string, string> } | { ok: false; message: string }> {
  const brands = new Map<string, string>();
  const byType = new Map<string, ValidatedAnalyticsCsvRow[]>();
  for (const row of rows) {
    const list = byType.get(row.subjectType) ?? [];
    list.push(row);
    byType.set(row.subjectType, list);
  }
  const placements = byType.get("placement") ?? [];
  if (placements.length > 0) {
    const ids = [...new Set(placements.map((r) => r.subjectRef))];
    const { data, error } = await supabase
      .from("content_placements")
      .select("id, content_items!inner(workspace_id, brand_id)")
      .in("id", ids);
    if (error) return { ok: false, message: dbErrorMessage(error, "Gagal memeriksa placement.") };
    for (const p of (data ?? []) as unknown as Array<{
      id: string;
      content_items: { workspace_id: string; brand_id: string };
    }>) {
      if (p.content_items.workspace_id === workspaceId) {
        brands.set(p.id, p.content_items.brand_id);
      }
    }
    for (const row of placements) {
      if (!brands.has(row.subjectRef)) {
        return {
          ok: false,
          message: `Baris ${row.rowNumber}: placement ${row.subjectRef} tidak ditemukan di workspace ini.`,
        };
      }
    }
  }
  const items = byType.get("content_item") ?? [];
  if (items.length > 0) {
    const ids = [...new Set(items.map((r) => r.subjectRef))];
    const { data, error } = await supabase
      .from("content_items")
      .select("id, workspace_id, brand_id")
      .in("id", ids);
    if (error) return { ok: false, message: dbErrorMessage(error, "Gagal memeriksa konten.") };
    for (const it of (data ?? []) as Array<{
      id: string;
      workspace_id: string;
      brand_id: string;
    }>) {
      if (it.workspace_id === workspaceId) brands.set(it.id, it.brand_id);
    }
    for (const row of items) {
      if (!brands.has(row.subjectRef)) {
        return {
          ok: false,
          message: `Baris ${row.rowNumber}: konten ${row.subjectRef} tidak ditemukan di workspace ini.`,
        };
      }
    }
  }
  const posts = byType.get("published_post") ?? [];
  if (posts.length > 0) {
    const ids = [...new Set(posts.map((r) => r.subjectRef))];
    const { data, error } = await supabase
      .from("published_posts")
      .select("id, workspace_id, content_placements!inner(content_items!inner(brand_id))")
      .in("id", ids);
    if (error) {
      return { ok: false, message: dbErrorMessage(error, "Gagal memeriksa postingan terbit.") };
    }
    for (const pp of (data ?? []) as unknown as Array<{
      id: string;
      workspace_id: string;
      content_placements: { content_items: { brand_id: string } };
    }>) {
      if (pp.workspace_id === workspaceId) {
        brands.set(pp.id, pp.content_placements.content_items.brand_id);
      }
    }
    for (const row of posts) {
      if (!brands.has(row.subjectRef)) {
        return {
          ok: false,
          message: `Baris ${row.rowNumber}: postingan terbit ${row.subjectRef} tidak ditemukan di workspace ini.`,
        };
      }
    }
  }
  return { ok: true, brands };
}

/** Impor CSV tervalidasi (P7-03): peran + scope + resolusi subject, lalu RPC 0021. */
export async function importAnalyticsCsvCore(
  supabase: SupabaseClient,
  userId: string,
  input: {
    workspaceId: string;
    brandId: string | null;
    periodStart: string;
    periodEnd: string;
    rawReference: string;
    rows: ValidatedAnalyticsCsvRow[];
  },
): Promise<AnalyticsActionResult> {
  const denied = await requireImporter(input.workspaceId, userId, input.brandId);
  if (denied) return fail(denied, { code: "FORBIDDEN" });
  const resolved = await resolveSubjectBrands(supabase, input.workspaceId, input.rows);
  if (!resolved.ok) return fail(resolved.message, { code: "INVALID_SUBJECT" });
  // Scope per subject (cermin RPC): brand yang dipilih harus cocok semua
  // subject; tanpa brand, tiap subject harus dalam scope pemanggil.
  const scope = await getCallerBrandScope(input.workspaceId, userId);
  for (const row of input.rows) {
    const brandId = resolved.brands.get(row.subjectRef);
    if (!brandId)
      return fail(`Baris ${row.rowNumber}: subject tidak ditemukan.`, { code: "INVALID_SUBJECT" });
    if (input.brandId && brandId !== input.brandId) {
      return fail(`Baris ${row.rowNumber}: subject milik brand lain (bukan brand yang dipilih).`, {
        code: "FORBIDDEN",
      });
    }
    if (!input.brandId && !brandInScope(scope, brandId)) {
      return fail(`Baris ${row.rowNumber}: subject di luar scope brand Anda.`, {
        code: "FORBIDDEN",
      });
    }
  }
  const { data, error } = await supabase.rpc("import_analytics_snapshot", {
    p_workspace_id: input.workspaceId,
    p_brand_id: input.brandId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_raw_reference: input.rawReference,
    p_metrics: input.rows.map((r) => ({
      subject_type: r.subjectType,
      subject_id: r.subjectRef,
      metric_key: r.metricKey,
      value: r.value,
      unit: r.unit,
      source_notes: r.sourceNotes,
    })),
  });
  if (error) return fail(dbErrorMessage(error, "Gagal mengimpor analytics."));
  const result = asRpcResult(data);
  if (!result?.ok) {
    return fail(result?.message ?? "Gagal mengimpor analytics.", { code: result?.code });
  }
  return ok(
    `Impor berhasil: ${result.inserted ?? input.rows.length} baris metrik dari ${input.rawReference} (${input.periodStart} s.d. ${input.periodEnd}).`,
    {
      snapshotId: result.snapshot_id ?? undefined,
      inserted: result.inserted,
      campaigns: result.campaigns,
      code: result.code,
    },
  );
}

/** Aksi form impor CSV (textarea tempel ATAU file unggah). */
export async function importAnalyticsCsvAction(
  _prev: AnalyticsActionResult,
  formData: FormData,
): Promise<AnalyticsActionResult> {
  const file = formData.get("csvFile");
  let csvText = String(formData.get("csvText") ?? "");
  if (file instanceof File && file.size > 0) {
    csvText = await file.text();
  }
  const brandRaw = String(formData.get("brandId") ?? "");
  const parsed = importAnalyticsCsvSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    brandId: brandRaw === "" ? null : brandRaw,
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    rawReference: formData.get("rawReference"),
    csvText,
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Data tidak valid.");
  }
  const parsedCsv = parseAnalyticsCsv(csvText);
  const validated = validateAnalyticsCsvFile(
    parsedCsv,
    parsed.data.periodStart,
    parsed.data.periodEnd,
  );
  if (!validated.ok) return fail(validated.error);
  // Referensi kosong → otomatis csv:impor.csv:<jumlah baris> (RPC menolak
  // referensi kosong dengan INVALID_REFERENCE).
  const rawReference =
    parsed.data.rawReference === ""
      ? `csv:impor.csv:${validated.data.length}`
      : parsed.data.rawReference;
  const supabase = await getSupabaseServerClient();
  if (!supabase) return fail(SUPABASE_NOT_CONFIGURED_ID);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Anda harus masuk dulu.");
  const result = await importAnalyticsCsvCore(supabase, user.id, {
    workspaceId: parsed.data.workspaceId,
    brandId: parsed.data.brandId ?? null,
    periodStart: parsed.data.periodStart,
    periodEnd: parsed.data.periodEnd,
    rawReference,
    rows: validated.data,
  });
  if (result.ok) {
    // Hanya /analitik/impor yang direvalidasi — halaman yang sedang dilihat
    // user. /analitik + /analitik/laporan memuat ulang datanya sendiri saat
    // dikunjungi (semua fetch server memakai cache: "no-store"), jadi tidak
    // perlu direvalidasi di sini. Alasan: revalidasi 3 path sekaligus
    // memaksa router me-refetch 3 halaman saat action selesai; bila salah
    // satu refetch lambat, `useActionState` pending tertahan dan tombol
    // impor tampak menggantung walau data sudah tersimpan (flake hang UI
    // Phase 7, 4× dalam 5 run — penyebab pasti belum terbukti, mitigasi ini
    // mempersempit permukaan refetch ke 1 path).
    revalidatePath("/analitik/impor");
  }
  return result;
}
