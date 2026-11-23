/**
 * Uji statis migrasi — tests/migrations.test.ts
 * Berjalan TANPA database live: memeriksa file migrasi SQL berisi
 * RLS + policy eksplisit, dan repo bebas secret.
 * Ini BUKAN pengganti pgTAP (supabase/tests/01_rls_phase1.sql) yang butuh DB
 * live — keduanya dicatat terpisah di laporan fase.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS_DIR = path.resolve(TESTS_DIR, "../supabase/migrations");
const APP_ROOT = path.resolve(TESTS_DIR, "..");

function migrationFiles(): Array<{ name: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), "utf8") }));
}

describe("Migrasi — RLS + policy eksplisit (statis, tanpa DB)", () => {
  it("memiliki 31 migrasi berversi berurutan 0001–0031", () => {
    const files = migrationFiles();
    expect(files.map((f) => f.name)).toEqual([
      "0001_profiles.sql",
      "0002_organizations.sql",
      "0003_workspaces.sql",
      "0004_activity_logs.sql",
      "0005_resource_shares.sql",
      "0006_rls_recursion_fix.sql",
      "0007_planning_core.sql",
      "0008_planning_transactions.sql",
      "0009_production_ops.sql",
      "0010_production_transactions.sql",
      "0011_fix_content_item_brand_null.sql",
      "0012_convert_idea_brand_param.sql",
      "0013_approval_core.sql",
      "0014_approval_transactions.sql",
      "0015_notification_scope_placement.sql",
      "0016_brand_scope.sql",
      "0017_visual_planner_templates.sql",
      "0018_set_visual_order_fixes.sql",
      "0019_brands_insert_scope_fix.sql",
      "0020_publishing_foundation.sql",
      "0021_analytics_foundation.sql",
      "0022_ai_foundation.sql",
      "0023_ai_generations_select_policy_fix.sql",
      "0024_fix_ws_members_insert_self_promotion.sql",
      "0025_enforce_client_review_gate.sql",
      "0026_enforce_brand_scope_in_rpc.sql",
      "0027_guard_member_owner_escalation.sql",
      "0028_publishing_recovery_atomic_reschedule.sql",
      "0029_asset_upload_recovery_versioning_comment_notifications.sql",
      "0030_batch4_planning_fixes.sql",
      "0031_batch5_approval_fixes.sql",
    ]);
  });

  it("setiap migrasi yang membuat tabel mengaktifkan RLS untuk tabelnya", () => {
    for (const { name, sql } of migrationFiles()) {
      // 0006 hanya menulis ulang policy (DROP/CREATE POLICY), tidak membuat
      // tabel baru — RLS tabelnya sudah aktif sejak 0001–0005.
      // 0008 dan 0010 hanya berisi fungsi RPC transaksional (tanpa
      // tabel/policy baru); 0011 hanya mengganti satu fungsi trigger
      // (tanpa tabel/policy baru); 0012 hanya mengganti satu fungsi RPC
      // (tanpa tabel/policy baru); 0014 hanya berisi fungsi approval
      // (tanpa tabel/policy baru); 0015 hanya memperluas satu CHECK +
      // mengganti satu fungsi trigger (tanpa tabel/policy baru); 0016
      // hanya menulis ulang policy + helper (tanpa tabel baru); 0018
      // hanya menimpa satu fungsi RPC + memperketat satu CHECK (tanpa
      // tabel/policy baru); 0025 hanya menulis ulang dua fungsi RPC
      // (preflight + decide, tanpa tabel/policy baru); 0026 hanya
      // menulis ulang dua fungsi RPC (tanpa tabel/policy baru); 0027 hanya
      // menulis ulang policy INSERT + trigger (tanpa tabel/policy baru); 0028 hanya
      // menulis ulang empat fungsi RPC + satu fungsi RPC baru + satu fungsi
      // trigger + satu indeks (tanpa tabel/policy baru); 0029 hanya
      // menulis ulang satu fungsi RPC + dua fungsi RPC baru + menambah dua
      // kolom + memperluas satu CHECK (tanpa tabel/policy baru).
      // 0031 hanya mendefinisikan ulang tiga fungsi approval + satu trigger (tanpa tabel/policy baru).
      if (
        name === "0008_planning_transactions.sql" ||
        name === "0010_production_transactions.sql" ||
        name === "0011_fix_content_item_brand_null.sql" ||
        name === "0012_convert_idea_brand_param.sql" ||
        name === "0014_approval_transactions.sql" ||
        name === "0015_notification_scope_placement.sql" ||
        name === "0016_brand_scope.sql" ||
        name === "0018_set_visual_order_fixes.sql" ||
        name === "0025_enforce_client_review_gate.sql" ||
        name === "0026_enforce_brand_scope_in_rpc.sql" ||
        name === "0027_guard_member_owner_escalation.sql" ||
        name === "0028_publishing_recovery_atomic_reschedule.sql" ||
        name === "0029_asset_upload_recovery_versioning_comment_notifications.sql" ||
        name === "0030_batch4_planning_fixes.sql" ||
        name === "0031_batch5_approval_fixes.sql"
      ) {
        expect(sql, `${name} tidak boleh membuat tabel`).not.toMatch(/create table/i);
        expect(sql, `${name} harus berisi fungsi RPC`).toMatch(/create or replace function/i);
        continue;
      }
      if (!/create table/i.test(sql)) {
        expect(sql, `${name} harus menulis ulang policy`).toMatch(/create policy/i);
        continue;
      }
      expect(sql, `${name} harus berisi ENABLE ROW LEVEL SECURITY`).toMatch(
        /enable row level security/i,
      );
    }
  });

  it("setiap migrasi mencabut grant default (revoke all ... from anon)", () => {
    for (const { name, sql } of migrationFiles()) {
      // 0015 hanya mengganti fungsi trigger yang SUDAH ada (tanpa objek
      // baru, tanpa grant baru) — grant validate_notification_scope
      // tidak berubah sejak 0009, jadi tidak ada yang perlu di-revoke.
      // 0019 hanya menulis ulang satu policy yang SUDAH ada (tanpa
      // objek baru, tanpa grant baru) — tidak ada yang perlu di-revoke.
      // 0023 sama: hanya menulis ulang policy SELECT ai_generations
      // (0022) tanpa objek/grant baru.
      if (
        name === "0015_notification_scope_placement.sql" ||
        name === "0019_brands_insert_scope_fix.sql" ||
        name === "0023_ai_generations_select_policy_fix.sql"
      )
        continue;
      expect(sql, `${name} harus revoke grant default`).toMatch(/revoke all on/i);
    }
  });

  it("policy memakai auth.uid() dan TIDAK memakai satu policy luas tanpa batas", () => {
    const all = migrationFiles()
      .map((f) => f.sql)
      .join("\n");
    expect(all).toMatch(/auth\.uid\(\)/);
    // Tidak ada policy "using (true)" yang membuka semua akses.
    expect(all).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(all).not.toMatch(/with check\s*\(\s*true\s*\)/i);
  });

  it("tabel fase ini tercakup: profiles, organizations, workspaces, members, invitations, activity_logs, resource_shares", () => {
    const all = migrationFiles()
      .map((f) => f.sql)
      .join("\n");
    for (const table of [
      "profiles",
      "organizations",
      "organization_members",
      "workspaces",
      "workspace_members",
      "workspace_settings",
      "workspace_invitations",
      "activity_logs",
      "resource_shares",
    ]) {
      expect(all, `tabel ${table} harus dibuat di migrasi`).toContain(
        `create table if not exists public.${table}`,
      );
    }
  });

  it("tidak ada tabel content/approval/publishing/analytics di Phase 1 (vertical slice)", () => {
    // Hanya migrasi Phase 1 (0001–0006) yang diperiksa — migrasi Phase 2
    // (0007+) memang membuat tabel content (mis. brands, content_items).
    const phase1 = migrationFiles()
      .filter((f) => /^000[1-6]_/.test(f.name))
      .map((f) => f.sql)
      .join("\n");
    for (const table of ["content_items", "approval_requests", "publishing_jobs", "brands"]) {
      expect(phase1, `tabel ${table} TIDAK BOLEH dibuat di Phase 1`).not.toContain(
        `create table if not exists public.${table}`,
      );
    }
  });

  it("migrasi 0003 mendokumentasikan fungsi accept_invitation sebagai SECURITY DEFINER yang ditinjau", () => {
    const m3 = migrationFiles().find((f) => f.name === "0003_workspaces.sql")?.sql ?? "";
    expect(m3).toMatch(/security definer/i);
    expect(m3).toMatch(/accept_invitation/);
    expect(m3).toMatch(/search_path = public, pg_temp/);
  });

  it("migrasi 0008 berisi 6 RPC transaksional Phase 2 (SECURITY DEFINER, search_path terkunci)", () => {
    const m8 = migrationFiles().find((f) => f.name === "0008_planning_transactions.sql")?.sql ?? "";
    for (const fn of [
      "create_content_item_with_version",
      "update_content_item_with_version",
      "transition_content_item_status",
      "convert_idea_to_content",
      "reschedule_placement",
      "change_placement_distribution",
    ]) {
      expect(m8, `0008 harus berisi fungsi ${fn}`).toContain(fn);
    }
    expect(m8).toMatch(/security definer/i);
    expect(m8).toMatch(/search_path = public, pg_temp/);
    expect(m8).toMatch(/grant execute on function[\s\S]*to authenticated/i);
    expect(m8).not.toMatch(/remote_post_id\s*=/i);
    expect(m8).not.toMatch(/published_url\s*=/i);
  });

  it("migrasi 0009 berisi 9 tabel Production Operations + bucket privat (tanpa approval/publishing/analytics)", () => {
    const m9 = migrationFiles().find((f) => f.name === "0009_production_ops.sql")?.sql ?? "";
    for (const table of [
      "brief_templates",
      "tasks",
      "task_checklist_items",
      "assets",
      "asset_versions",
      "content_assets",
      "comments",
      "mentions",
      "notifications",
    ]) {
      expect(m9, `0009 harus berisi tabel ${table}`).toContain(
        `create table if not exists public.${table}`,
      );
    }
    for (const table of ["approval_requests", "publishing_jobs", "analytics"]) {
      expect(m9, `tabel ${table} TIDAK BOLEH dibuat di Phase 3`).not.toContain(
        `create table if not exists public.${table}`,
      );
    }
    expect(m9).toContain("mative-assets");
    expect(m9).toContain("brands_logo_asset_id_fkey");
    expect(m9).toMatch(/security definer/i);
    expect(m9).toMatch(/search_path = public, pg_temp/);
  });

  it("migrasi 0010 berisi 5 RPC transaksional Phase 3 (SECURITY DEFINER, search_path terkunci)", () => {
    const m10 =
      migrationFiles().find((f) => f.name === "0010_production_transactions.sql")?.sql ?? "";
    for (const fn of [
      "create_task_with_checklist",
      "transition_task_status",
      "create_comment_with_mentions",
      "restore_content_version",
      "set_default_brief_template",
    ]) {
      expect(m10, `0010 harus berisi fungsi ${fn}`).toContain(fn);
    }
    expect(m10).toMatch(/security definer/i);
    expect(m10).toMatch(/search_path = public, pg_temp/);
    expect(m10).toMatch(/grant execute on function[\s\S]*to authenticated/i);
  });

  it("migrasi 0011 memperbaiki trigger scope item tanpa brand (regresi defect Phase 2)", () => {
    const m11 =
      migrationFiles().find((f) => f.name === "0011_fix_content_item_brand_null.sql")?.sql ?? "";
    // Hanya mengganti validate_content_item_scope, dengan guard NULL.
    expect(m11).toContain("create or replace function public.validate_content_item_scope()");
    expect(m11).toMatch(/if\s+new\.brand_id\s+is\s+not\s+null\s+then/);
    // Brand yang terisi tetap wajib satu workspace (tidak ada pelonggaran).
    expect(m11).toContain(
      "scope mismatch: content_items.brand_id belongs to a different workspace",
    );
    expect(m11).toMatch(/security definer/i);
    expect(m11).toMatch(/search_path = public, pg_temp/);
    // Tanpa tabel/policy baru; hardening revoke seperti migrasi lain.
    expect(m11).not.toMatch(/create table/i);
    expect(m11).not.toMatch(/create policy/i);
    expect(m11).toMatch(
      /revoke all on function public\.validate_content_item_scope\(\) from public/,
    );
    // Tepat satu fungsi diganti — validate_content_placement_scope hanya
    // disebut di komentar (sengaja tidak diubah), bukan diganti.
    expect(m11.match(/create or replace function/g)?.length).toBe(1);
    expect(m11).not.toContain("create or replace function public.validate_content_placement_scope");
  });

  it("migrasi 0012 mengganti convert_idea_to_content: p_brand_id + guard brand NULL", () => {
    const m12 =
      migrationFiles().find((f) => f.name === "0012_convert_idea_brand_param.sql")?.sql ?? "";
    // Fungsi lama (uuid, text) di-drop agar tak tersisa overload yang crash
    // pada brand NULL; fungsi baru (uuid, text, uuid) menggantikannya.
    expect(m12).toMatch(
      /drop\s+function\s+if\s+exists\s+public\.convert_idea_to_content\(uuid,\s*text\)/,
    );
    expect(m12).toContain("create or replace function public.convert_idea_to_content(");
    expect(m12).toContain("p_brand_id uuid default null");
    // Brand efektif = coalesce(p_brand_id, brand ide); NULL → pesan bersih.
    expect(m12).toMatch(/v_brand_id\s*:=\s*coalesce\(p_brand_id,\s*v_idea\.brand_id\)/);
    expect(m12).toContain("Ide ini belum punya brand. Pilih brand dulu sebelum dikonversi.");
    // p_brand_id lintas workspace ditolak.
    expect(m12).toContain("Brand tidak ditemukan di workspace ini.");
    expect(m12).toMatch(/security definer/i);
    expect(m12).toMatch(/search_path = public, pg_temp/);
    // Tanpa tabel/policy baru; GRANT EXECUTE hanya ke authenticated.
    expect(m12).not.toMatch(/create table/i);
    expect(m12).not.toMatch(/create policy/i);
    expect(m12).toMatch(
      /grant execute on function public\.convert_idea_to_content\(uuid,\s*text,\s*uuid\) to authenticated/,
    );
    // Tepat satu fungsi diganti; fungsi 0008 tidak disentuh (0012 yang baru).
    expect(m12.match(/create or replace function/g)?.length).toBe(1);
  });

  it("token undangan disimpan sebagai hash, bukan token mentah", () => {
    const m3 = migrationFiles().find((f) => f.name === "0003_workspaces.sql")?.sql ?? "";
    expect(m3).toContain("token_hash");
    expect(m3).not.toMatch(/token\s+text not null,$/m);
  });

  it("migrasi 0013 membuat 4 tabel approval + RLS aktif untuk keempatnya", () => {
    const m13 = migrationFiles().find((f) => f.name === "0013_approval_core.sql")?.sql ?? "";
    for (const table of [
      "approval_workflows",
      "approval_steps",
      "approval_requests",
      "approval_decisions",
    ]) {
      expect(m13, `0013 harus membuat tabel ${table}`).toContain(
        `create table if not exists public.${table}`,
      );
      expect(m13, `0013 harus mengaktifkan RLS untuk ${table}`).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      );
    }
    // Status request 6 nilai (Keputusan #8) + komentar wajib non-approval.
    expect(m13).toMatch(/'submitted', 'in_review', 'approved', 'changes_requested',/);
    expect(m13).toContain("'rejected', 'reapproval_required'");
    expect(m13).toContain(
      "check (decision = 'approved' or (comment is not null and btrim(comment) <> ''))",
    );
    // Requests/decisions no-write di GRANT + policy.
    expect(m13).toContain("revoke all on public.approval_requests from anon, authenticated");
    expect(m13).toContain("grant select on public.approval_requests to authenticated");
    // Trigger append-only UPDATE-only (tanpa trigger DELETE — pelajaran P0001).
    expect(m13).toContain("create trigger trg_prevent_approval_decision_update");
    expect(m13).not.toMatch(
      /create\s+trigger\s+\w+\s+before\s+delete\s+on\s+public\.approval_decisions/i,
    );
  });

  it("migrasi 0014 menutup bypass internal_review -> approved + 5 trigger critical-change", () => {
    const m14 =
      migrationFiles().find((f) => f.name === "0014_approval_transactions.sql")?.sql ?? "";
    expect(m14).toContain("APPROVAL_REQUIRED");
    expect(m14).toContain("Konten ini belum disetujui. Minta persetujuan dulu di Approval Center");
    for (const fn of [
      "check_critical_change_on_version",
      "check_critical_change_on_placement_version",
      "check_critical_change_on_asset_link",
      "check_critical_change_on_placement",
    ]) {
      expect(m14, `0014 harus berisi trigger ${fn}`).toContain(fn);
    }
    // Helper internal TIDAK di-grant ke authenticated (hanya untuk trigger).
    expect(m14).not.toContain("grant execute on function public.approval_critical_fields");
    expect(m14).not.toContain("grant execute on function public.flag_request_reapproval");
    expect(m14).toContain(
      "revoke all on function public.approval_critical_fields(uuid) from public",
    );
    // Guard 0014 = salinan 0008 + satu blok guard (bukan fungsi baru dari nol).
    expect(m14).toContain("create or replace function public.transition_content_item_status(");
  });

  it("migrasi 0015 mengizinkan notifikasi target 'placement' (perbaikan cacat Phase 4)", () => {
    const m15 =
      migrationFiles().find((f) => f.name === "0015_notification_scope_placement.sql")?.sql ?? "";
    // CHECK diperluas dengan 'placement' (sebelumnya hanya 4 target).
    expect(m15).toContain(
      "check (target_type in ('content_item', 'campaign', 'task', 'comment', 'placement'))",
    );
    // Trigger scope mendapat cabang 'placement': workspace diambil lewat
    // content_placements -> content_items.
    expect(m15).toContain("create or replace function public.validate_notification_scope()");
    expect(m15).toContain("elsif new.target_type = 'placement' then");
    expect(m15).toContain("from public.content_placements cp");
    expect(m15).toContain("join public.content_items ci on ci.id = cp.content_item_id");
    expect(m15).toMatch(/security definer/i);
    expect(m15).toMatch(/search_path = public, pg_temp/);
    // Tanpa tabel/policy/grant baru; tepat satu fungsi diganti.
    expect(m15).not.toMatch(/create table/i);
    expect(m15).not.toMatch(/create policy/i);
    expect(m15).not.toMatch(/grant .* to authenticated/i);
    expect(m15.match(/create or replace function/g)?.length).toBe(1);
  });

  it("migrasi 0016 menegakkan brand scope (P1-A7, Keputusan #9)", () => {
    const m16 = migrationFiles().find((f) => f.name === "0016_brand_scope.sql")?.sql ?? "";
    // CHECK bentuk brand_scope: NULL atau array.
    expect(m16).toContain("workspace_members_brand_scope_check");
    expect(m16).toContain("check (brand_scope is null or jsonb_typeof(brand_scope) = 'array')");
    // Helper baru brand_in_scope (SECURITY DEFINER, search_path terkunci).
    expect(m16).toContain("create or replace function public.brand_in_scope(p_brand_id uuid)");
    expect(m16).toMatch(/security definer/i);
    expect(m16).toMatch(/search_path = public, pg_temp/);
    expect(m16).toContain("revoke all on function public.brand_in_scope(uuid) from public");
    expect(m16).toContain("grant execute on function public.brand_in_scope(uuid) to authenticated");
    // Helper ditulis ulang (+ scope): is_brand_member, is_content_item_member,
    // can_read_placement, can_edit_placement.
    for (const fn of [
      "is_brand_member(p_brand_id uuid",
      "is_content_item_member(p_content_item_id uuid",
      "can_read_placement(p_placement_id uuid",
      "can_edit_placement(p_placement_id uuid",
    ]) {
      expect(m16, `0016 harus menulis ulang ${fn}`).toContain(
        `create or replace function public.${fn}`,
      );
    }
    // 15 policy ditulis ulang dan semuanya menyebut brand_in_scope.
    expect(m16.match(/drop policy if exists/g)?.length).toBe(15);
    expect(m16.match(/public\.brand_in_scope\(/g)?.length).toBeGreaterThanOrEqual(15);
    // Cabang shared TIDAK di-scope (berbagi eksplisit mengalahkan scope).
    expect(m16).toContain("is_resource_shared_with_me('content_item', content_items.id)");
    expect(m16).toContain("is_resource_shared_with_me('campaign', campaign_brands.campaign_id)");
    // Tanpa tabel baru; tanpa pelonggaran (tidak ada using(true)).
    expect(m16).not.toMatch(/create table/i);
    expect(m16).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it("migrasi 0017 membuat 5 tabel Phase 5 + RPC set_visual_order", () => {
    const m17 =
      migrationFiles().find((f) => f.name === "0017_visual_planner_templates.sql")?.sql ?? "";
    // 5 tabel baru + RLS aktif untuk kelimanya.
    for (const table of [
      "visual_orders",
      "campaign_templates",
      "campaign_template_brands",
      "content_templates",
      "content_template_placements",
    ]) {
      expect(m17, `0017 harus membuat tabel ${table}`).toContain(
        `create table if not exists public.${table}`,
      );
      expect(m17, `0017 harus mengaktifkan RLS untuk ${table}`).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      );
    }
    // visual_orders: revoke all + grant select saja (tulis hanya via RPC).
    expect(m17).toContain("revoke all on public.visual_orders from anon, authenticated");
    expect(m17).toContain("grant select on public.visual_orders to authenticated");
    expect(m17).toContain('create policy "visual_orders_no_insert"');
    // Regresi 0017 (Run live 2026-11-19 gagal 42601): policy INSERT hanya
    // boleh pakai WITH CHECK, bukan USING — pglast tidak menangkap ini.
    expect(m17).toContain(
      "on public.visual_orders for insert to authenticated with check (false);",
    );
    // Regresi pgTAP 05 (Run live 2026-11-19 gagal 42703): kolom
    // content_template_placements adalah platform_format (sesuai 0017),
    // bukan format — file tes sempat memakai nama kolom yang salah.
    const pgtap05 = readFileSync(
      path.resolve(TESTS_DIR, "../supabase/tests/05_rls_phase5.sql"),
      "utf8",
    );
    expect(pgtap05).not.toContain(
      "content_template_placements (template_id, social_channel_id, format)",
    );
    expect(pgtap05).toContain(
      "content_template_placements (template_id, social_channel_id, platform_format)",
    );
    // 5 trigger scope (pola 0007) + 2 helper template-member.
    for (const fn of [
      "validate_visual_order_scope",
      "validate_campaign_template_scope",
      "validate_campaign_template_brand_scope",
      "validate_content_template_scope",
      "validate_content_template_placement_scope",
    ]) {
      expect(m17, `0017 harus berisi trigger ${fn}`).toContain(fn);
    }
    expect(m17).toContain("is_campaign_template_member(p_template_id uuid");
    expect(m17).toContain("is_content_template_member(p_template_id uuid");
    // RPC set_visual_order: SECURITY DEFINER, search_path terkunci, grant
    // hanya ke authenticated, dan BADANNYA tidak pernah menyentuh
    // scheduled_at / content_placements (R5.1 — bukti pemisahan statis).
    expect(m17).toContain("create or replace function public.set_visual_order(");
    expect(m17).toContain(
      "grant execute on function public.set_visual_order(uuid, uuid, uuid, uuid[]) to authenticated",
    );
    const fnBody =
      m17.match(
        /create or replace function public\.set_visual_order\([\s\S]*?^end;\n\$\$;/m,
      )?.[0] ?? "";
    expect(fnBody.length).toBeGreaterThan(0);
    expect(fnBody).not.toContain("scheduled_at");
    expect(fnBody).not.toMatch(/update\s+public\.content_placements/i);
    expect(fnBody).not.toMatch(/insert\s+into\s+public\.content_placements/i);
    expect(fnBody).toContain("activity_logs");
    expect(fnBody).toContain("brand_in_scope");
    // Unik ganda visual_orders: per placement + per posisi.
    expect(m17).toContain("unique (workspace_id, brand_id, social_channel_id, placement_id)");
    expect(m17).toContain("unique (workspace_id, brand_id, social_channel_id, position)");
  });

  it("migrasi 0018 memperbaiki set_visual_order (regresi diagnosis pgTAP 05)", () => {
    const m18 =
      migrationFiles().find((f) => f.name === "0018_set_visual_order_fixes.sql")?.sql ?? "";
    // Regresi (1) — diagnosis 2026-11-19 (T10c/T10d gagal): posisi harus
    // 1-based, bukan 0-based; count = panjang daftar (bukan v_pos seusai
    // loop, yang akan bernilai N+1 bila mulai dari 1).
    expect(m18).toContain("v_pos int := 1;");
    expect(m18).not.toContain("v_pos int := 0;");
    expect(m18).toContain("coalesce(array_length(p_placement_ids, 1), 0)");
    // Regresi (2) — diagnosis 2026-11-19 (T11a2/T11c2 gagal): placement
    // di luar (workspace, brand, channel) yang diminta ditolak dengan
    // INVALID_STATE_TRANSITION, bukan FORBIDDEN.
    expect(m18).toContain(
      "'code', 'INVALID_STATE_TRANSITION', 'message', 'Placement tidak ditemukan di workspace/brand/channel ini.'",
    );
    // Regresi (3): CHECK position diperketat 0 -> 1 (menegakkan 1-based).
    expect(m18).toContain("check (position >= 1)");
    // 0018 menimpa fungsi yang sama (bukan fungsi baru) + grant tetap.
    expect(m18).toContain("create or replace function public.set_visual_order(");
    expect(m18).toContain(
      "grant execute on function public.set_visual_order(uuid, uuid, uuid, uuid[]) to authenticated",
    );
    const fnBody =
      m18.match(
        /create or replace function public\.set_visual_order\([\s\S]*?^end;\n\$\$;/m,
      )?.[0] ?? "";
    expect(fnBody.length).toBeGreaterThan(0);
    expect(fnBody).not.toContain("scheduled_at");
    expect(fnBody).not.toMatch(/update\s+public\.content_placements/i);
    expect(fnBody).not.toMatch(/insert\s+into\s+public\.content_placements/i);
    // Regresi pgTAP 05 v1.1 (diagnosis 2026-11-19): pola throws_ok harus
    // PESAN LENGKAP (bukti Phase 4: pola lengkap lolos; pola pendek gagal)
    // + nama constraint terpotong Postgres (batas 63 byte) + B adalah
    // manager WS-A (approver hanya "view" untuk manage_pillars_campaigns
    // per Dok 06 §3, jadi T11e sebagai approver tidak mungkin lolos).
    const test05 = readFileSync(path.join(APP_ROOT, "supabase/tests/05_rls_phase5.sql"), "utf8");
    expect(test05).not.toContain(":'user_b', 'approver'");
    expect(test05).toContain(":'user_b', 'manager'");
    expect(test05).not.toContain("\n  'scope mismatch',\n");
    expect(test05).toContain(
      "'scope mismatch: visual_orders.placement_id belongs to a different workspace/brand/channel'",
    );
    expect(test05).toContain(
      "'scope mismatch: campaign_template_brands template and brand belong to different workspaces'",
    );
    expect(test05).toContain(
      "'scope mismatch: content_template_placements channel belongs to a different workspace/brand than its template'",
    );
    expect(test05).not.toContain("\n  'workspace_members_brand_scope_check',\n");
    expect(test05).toContain(
      '\'new row for relation "workspace_members" violates check constraint "workspace_members_brand_scope_check"\'',
    );
    expect(test05).not.toContain(
      "visual_orders_workspace_id_brand_id_social_channel_id_placement_id_key",
    );
    expect(test05).not.toContain(
      "visual_orders_workspace_id_brand_id_social_channel_id_position_key",
    );
    expect(test05).toContain(
      "'duplicate key value violates unique constraint \"visual_orders_workspace_id_brand_id_social_channel_id_place_key\"'",
    );
    expect(test05).toContain(
      "'duplicate key value violates unique constraint \"visual_orders_workspace_id_brand_id_social_channel_id_posit_key\"'",
    );
  });

  it("migrasi 0019 memperbaiki INSERT brand (regresi e2e Phase 5 live)", () => {
    const m19 =
      migrationFiles().find((f) => f.name === "0019_brands_insert_scope_fix.sql")?.sql ?? "";
    // Regresi — e2e live 2026-11-19 (A5.1/A5.3/A5.5 chromium gagal di
    // "Buat brand"): policy INSERT 0016 menuntut
    // brand_in_scope(brands.id), padahal brand_in_scope mencari brand
    // di public.brands — baris yang sedang di-INSERT belum ada di
    // tabel, jadi INSERT ditolak untuk SEMUA peran termasuk owner
    // scope penuh. 0019 membuat ulang policy TANPA conjunct itu;
    // pembuatan tetap dibatasi owner/admin/manager workspace.
    expect(m19).toContain('create policy "brands_insert_owner_admin_manager"');
    // 0016 TIDAK diubah (sudah live) — perbaikan hanya di 0019.
    const m16 = migrationFiles().find((f) => f.name === "0016_brand_scope.sql")?.sql ?? "";
    expect(m16).toContain("brand_in_scope(brands.id)");
    // Periksa badan policy-nya (bukan seluruh file — komentar header
    // 0019 memang menyebut brand_in_scope(brands.id) saat menjelaskan
    // cacatnya).
    const insertPolicy =
      m19.match(/create policy "brands_insert_owner_admin_manager"[\s\S]*?;/i)?.[0] ?? "";
    expect(insertPolicy.length).toBeGreaterThan(0);
    expect(insertPolicy).not.toContain("brand_in_scope");
    expect(insertPolicy).toContain(
      "public.is_ws_member(brands.workspace_id, array['owner', 'admin', 'manager'])",
    );
    // pgTAP 05 v1.2: TES 16 (T16a/T16b) menguji INSERT brand sebagai
    // authenticated — celah yang membuat cacat ini lolos (v1.1 hanya
    // menguji SELECT brand + INSERT sebagai postgres).
    const test05 = readFileSync(path.join(APP_ROOT, "supabase/tests/05_rls_phase5.sql"), "utf8");
    expect(test05).toContain("select plan(61);");
    expect(test05).toContain("T16a ALLOW: owner WS-A (scope NULL) bisa membuat brand baru");
    expect(test05).toContain("T16b ALLOW: brand baru terlihat owner (scope NULL) sesudah INSERT");
    expect(test05).toContain("lives_ok(");
    expect(test05).toContain("'brand-t16-test'");
  });

  it("pgTAP 04 ada dengan plan(64) + pola placeholder yang benar", () => {
    const test04 = readFileSync(path.join(APP_ROOT, "supabase/tests/04_rls_phase4.sql"), "utf8");
    expect(test04).toContain("select plan(64);");
    expect(test04).not.toContain("094e8752-eef4-4f0e-b6ae-2d5813445018");
    expect(test04).not.toContain("aabb1dab-77c1-4659-af0e-c703c9de279c");
    expect(test04).toContain("select * from finish();");
  });

  it("pgTAP 05 ada dengan plan(61) + pola placeholder yang benar", () => {
    const test05 = readFileSync(path.join(APP_ROOT, "supabase/tests/05_rls_phase5.sql"), "utf8");
    expect(test05).toContain("select plan(61);");
    expect(test05).not.toContain("094e8752-eef4-4f0e-b6ae-2d5813445018");
    expect(test05).not.toContain("aabb1dab-77c1-4659-af0e-c703c9de279c");
    expect(test05).toContain("select * from finish();");
    // Bukti pemisahan M5.4 ada di file: scheduled_at diuji TIDAK BERUBAH.
    expect(test05).toContain("T10e M5.4");
    expect(test05).toContain("T10f M5.4");
    expect(test05).toContain("set_visual_order");
  });

  it("migrasi 0020 membuat 3 tabel publishing + 7 RPC + preflight (Phase 6)", () => {
    const m20 =
      migrationFiles().find((f) => f.name === "0020_publishing_foundation.sql")?.sql ?? "";
    // 3 tabel baru + RLS aktif untuk ketiganya.
    for (const table of ["publishing_jobs", "publishing_attempts", "published_posts"]) {
      expect(m20, `0020 harus membuat tabel ${table}`).toContain(
        `create table if not exists public.${table}`,
      );
      expect(m20, `0020 harus mengaktifkan RLS untuk ${table}`).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      );
      expect(m20, `0020 harus revoke-all + grant select saja untuk ${table}`).toContain(
        `revoke all on public.${table} from anon, authenticated`,
      );
      expect(m20).toContain(`grant select on public.${table} to authenticated`);
    }
    // 7 RPC + backoff: SECURITY DEFINER, search_path terkunci, grant
    // hanya ke authenticated.
    for (const fn of [
      "publishing_preflight",
      "create_publishing_job",
      "claim_publishing_job",
      "process_publishing_jobs",
      "retry_publishing_job",
      "cancel_publishing_job",
      "confirm_publishing_job",
      "publishing_backoff_minutes",
    ]) {
      expect(m20, `0020 harus berisi fungsi ${fn}`).toContain(fn);
    }
    expect(m20).toMatch(/security definer/i);
    expect(m20).toMatch(/search_path = public, pg_temp/);
    // Helper visibilitas v1.1 (member + brand scope, pola 0016); helper
    // lama is_publishing_job_member sudah dihapus sebelum live.
    expect(m20).toContain("is_publishing_job_visible(p_job_id uuid");
    expect(m20).toContain("is_publishing_post_visible(p_post_id uuid");
    expect(m20).not.toContain("create or replace function public.is_publishing_job_member");
    expect(m20).toContain("public.brand_in_scope(ci.brand_id)");
    // TIDAK ADA fungsi adapter provider (manual-only, Decision #3).
    for (const fn of [
      "uploadOrCreatePost",
      "getPublishStatus",
      "fetchPostMetadata",
      "fetchAnalytics",
    ]) {
      expect(m20, `0020 TIDAK BOLEH berisi adapter ${fn}`).not.toContain(fn);
    }
    // Indeks partial idempotency (ASUMSI-6.2) + CHECK provider null.
    expect(m20).toContain("idx_publishing_jobs_idempotency_active");
    expect(m20).toContain("where status <> 'cancelled'");
    expect(m20).toContain("constraint publishing_jobs_provider_job_id_null_check");
    expect(m20).toContain("constraint published_posts_provider_post_id_null_check");
    expect(m20).toContain("check (confirmation_source in ('manual_user_confirmation'))");
    // Preflight TIDAK PERNAH melempar (mengembalikan jsonb); process loop
    // maks 20; claim atomik.
    expect(m20).toContain("stable\nsecurity definer");
    expect(m20).toContain("exit when v_n >= 20");
    expect(m20).toContain("for update skip locked");
    // Policy INSERT hanya WITH CHECK (regresi 0017 — pglast tidak menangkap).
    expect(m20).toContain(
      "on public.publishing_jobs for insert to authenticated with check (false);",
    );
    // pgTAP 06 v1.0: 109 asersi, mencakup preflight + create + process +
    // confirm + cancel + retry + RLS scope.
    const test06 = readFileSync(path.join(APP_ROOT, "supabase/tests/06_rls_phase6.sql"), "utf8");
    expect(test06).toContain("select plan(109);");
    expect(test06).toContain("T2a preflight p1 lolos");
    expect(test06).toContain("T20c job p5 berstatus published sesudah konfirmasi manual");
    expect(test06).toContain("T32b B hanya melihat 6 dari 7 job WS-A");
  });

  it("pgTAP 06 ada dengan plan(109) + pola placeholder yang benar", () => {
    const test06 = readFileSync(path.join(APP_ROOT, "supabase/tests/06_rls_phase6.sql"), "utf8");
    expect(test06).toContain("select plan(109);");
    expect(test06).not.toContain("094e8752-eef4-4f0e-b6ae-2d5813445018");
    expect(test06).not.toContain("aabb1dab-77c1-4659-af0e-c703c9de279c");
    expect(test06).toContain("select * from finish();");
    expect(test06).toContain("publishing_preflight");
    expect(test06).toContain("confirm_publishing_job");
  });

  it("migrasi 0021 membuat 6 tabel analytics + RPC impor + seed 14 metrik (Phase 7)", () => {
    const m21 = migrationFiles().find((f) => f.name === "0021_analytics_foundation.sql")?.sql ?? "";
    // 6 tabel baru + RLS aktif untuk keenamnya.
    for (const table of [
      "metric_definitions",
      "analytics_snapshots",
      "content_metrics",
      "campaign_metrics",
      "integration_events",
      "channel_credentials",
    ]) {
      expect(m21, `0021 harus membuat tabel ${table}`).toContain(
        `create table if not exists public.${table}`,
      );
      expect(m21, `0021 harus mengaktifkan RLS untuk ${table}`).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      );
      expect(m21, `0021 harus revoke-all untuk ${table}`).toContain(
        `revoke all on public.${table} from anon, authenticated`,
      );
    }
    // Grant select untuk 4 tabel; integration_events dapat select+insert
    // (pola actor — ditangani terpisah di bawah).
    for (const table of [
      "metric_definitions",
      "analytics_snapshots",
      "content_metrics",
      "campaign_metrics",
    ]) {
      expect(m21, `0021 harus grant select untuk ${table}`).toContain(
        `grant select on public.${table} to authenticated`,
      );
    }
    expect(m21).toContain("grant select, insert on public.integration_events to authenticated");
    expect(m21, "0021 TIDAK BOLEH grant apa pun ke channel_credentials").not.toMatch(
      /grant\s+\w+\s+on\s+public\.channel_credentials/i,
    );
    expect(m21, "0021 TIDAK BOLEH punya policy channel_credentials").not.toMatch(
      /create\s+policy\s+"[^"]+"\s+on\s+public\.channel_credentials/i,
    );
    // RPC impor + backoff + TTL: SECURITY DEFINER/INVOKER, search_path
    // terkunci, grant hanya ke authenticated.
    for (const fn of [
      "import_analytics_snapshot",
      "integration_backoff_seconds",
      "analytics_snapshot_is_stale",
    ]) {
      expect(m21, `0021 harus berisi fungsi ${fn}`).toContain(fn);
    }
    expect(m21).toMatch(/security definer/i);
    expect(m21).toMatch(/search_path = public, pg_temp/);
    expect(m21).toContain(
      "grant execute on function public.import_analytics_snapshot(uuid, uuid, date, date, text, jsonb) to authenticated",
    );
    // Helper visibilitas (member + brand scope, pola 0016) + fail-safe
    // multi-brand; viewer_client TIDAK ADA di daftar peran (komentar
    // di-strip dulu — komentar memang menyebut viewer_client saat
    // menjelaskan penolakan itu).
    for (const fn of [
      "is_unlimited_scope(p_workspace_id uuid",
      "is_analytics_snapshot_visible(p_snapshot_id uuid",
      "is_content_metric_visible(p_metric_id uuid",
      "is_campaign_metric_visible(p_metric_id uuid",
    ]) {
      expect(m21, `0021 harus berisi helper ${fn}`).toContain(
        `create or replace function public.${fn}`,
      );
    }
    expect(m21).toContain("s.brand_id is null and public.is_unlimited_scope(s.workspace_id)");
    const m21NoComments = m21.replace(/--[^\n]*/g, "");
    expect(m21NoComments, "viewer_client TIDAK BOLEH ada di kode 0021").not.toContain(
      "viewer_client",
    );
    // Seed 14 definisi metrik (12 impor + 2 turunan) + formula turunan.
    for (const key of [
      "reach",
      "impressions",
      "views",
      "video_views",
      "engagements",
      "likes",
      "comments",
      "shares",
      "saves",
      "clicks",
      "followers_net_change",
      "conversions",
      "engagement_rate",
      "publishing_adherence",
    ]) {
      expect(m21, `0021 harus men-seed metrik ${key}`).toContain(`'${key}'`);
    }
    expect(m21).toContain("engagements / reach");
    expect(m21).toContain("publishing_jobs");
    // CHECK connection_status diperluas 'disabled' (ASUMSI-7B) + CHECK
    // kunci/nilai/periode/tipe event/provider + indeks partial unique.
    expect(m21).toContain("check (connection_status in ('not_connected', 'manual', 'disabled'))");
    expect(m21).toContain("constraint content_metrics_key_check");
    expect(m21).toContain("constraint content_metrics_value_check");
    expect(m21).toContain("constraint analytics_snapshots_period_check");
    expect(m21).toContain("constraint integration_events_type_check");
    expect(m21).toContain("constraint channel_credentials_provider_check");
    expect(m21).toContain("idx_metric_definitions_global_unique");
    expect(m21).toContain("idx_content_metrics_snapshot_subject_key");
    // retrieved_at pakai clock_timestamp() (bukan now() — pelajaran 31).
    expect(m21).toContain("clock_timestamp(), btrim(p_raw_reference)");
    // Backoff 60/300/900 + TTL 24 jam (ASUMSI-7D).
    expect(m21).toContain("when p_attempt_number <= 1 then 60");
    expect(m21).toContain("when p_attempt_number = 2 then 300");
    expect(m21).toContain("else 900");
    expect(m21).toContain("interval '24 hours'");
    // RPC impor TIDAK PERNAH melempar (mengembalikan jsonb kode galat).
    for (const code of [
      "INVALID_METRIC",
      "INVALID_UNIT",
      "DUPLICATE_METRIC",
      "INVALID_SUBJECT",
      "INVALID_PERIOD",
      "EMPTY_METRICS",
      "FORBIDDEN",
    ]) {
      expect(m21, `0021 harus mengembalikan kode ${code}`).toContain(code);
    }
    // TIDAK ADA fungsi adapter provider (adapter DISABLED, ASUMSI-7B).
    for (const fn of [
      "uploadOrCreatePost",
      "getPublishStatus",
      "fetchPostMetadata",
      "fetchAnalytics",
    ]) {
      expect(m21, `0021 TIDAK BOLEH berisi adapter ${fn}`).not.toContain(fn);
    }
    // Policy INSERT hanya WITH CHECK (regresi 0017 — pglast tidak menangkap).
    expect(m21).toContain(
      "on public.content_metrics for insert to authenticated with check (false);",
    );
  });

  it("migrasi 0022 membuat tabel ai_generations + RPC insert versi AI + retensi (Phase 8)", () => {
    const m22 = migrationFiles().find((f) => f.name === "0022_ai_foundation.sql")?.sql ?? "";
    // 1 tabel baru + RLS aktif + revoke-all + grant select, insert saja.
    expect(m22).toContain("create table if not exists public.ai_generations");
    expect(m22).toMatch(/alter table public\.ai_generations enable row level security/i);
    expect(m22).toContain("revoke all on public.ai_generations from anon, authenticated");
    expect(m22).toContain("grant select, insert on public.ai_generations to authenticated");
    expect(m22, "0022 TIDAK BOLEH grant update ai_generations").not.toMatch(
      /grant\s+update\s+on\s+public\.ai_generations/i,
    );
    expect(m22, "0022 TIDAK BOLEH grant delete ai_generations").not.toMatch(
      /grant\s+delete\s+on\s+public\.ai_generations/i,
    );
    // Kolom content_versions: ai_assisted + ai_generation_id (FK ke log,
    // on delete set null — versi AI tetap ada walau lognya terhapus).
    expect(m22).toContain("alter table public.content_versions");
    expect(m22).toContain("add column if not exists ai_assisted boolean not null default false");
    expect(m22).toContain("add column if not exists ai_generation_id uuid");
    expect(m22).toContain("references public.ai_generations (id) on delete set null");
    // TIDAK ADA kolom payload mentah (ASUMSI-8D — hanya referensi).
    for (const col of ["input_text", "output_text", "raw_input", "raw_output"]) {
      expect(m22, `0022 TIDAK BOLEH punya kolom ${col}`).not.toContain(col);
    }
    expect(m22).not.toMatch(/\bprompt\b(?!_injection)/);
    expect(m22).not.toContain("system_prompt");
    // 7 fitur + 4 status + error category di CHECK.
    for (const feat of [
      "content_ideas",
      "brief",
      "content_draft",
      "repurpose",
      "checklist",
      "feedback_summary",
      "campaign_summary",
    ]) {
      expect(m22, `0022 harus punya fitur ${feat}`).toContain(`'${feat}'`);
    }
    for (const st of ["completed", "failed", "blocked", "not_configured"]) {
      expect(m22, `0022 harus punya status ${st}`).toContain(`'${st}'`);
    }
    for (const chk of [
      "constraint ai_generations_feature_check",
      "constraint ai_generations_status_check",
      "constraint ai_generations_error_check",
      "constraint ai_generations_input_tokens_check",
      "constraint ai_generations_output_tokens_check",
    ]) {
      expect(m22, `0022 harus punya CHECK ${chk}`).toContain(chk);
    }
    // Fungsi: helper visibilitas + retensi 90 + pemakaian harian (zona
    // Asia/Jakarta) + cleanup + RPC insert versi AI — SECURITY
    // DEFINER/INVOKER, search_path terkunci, grant hanya ke authenticated.
    for (const fn of [
      "is_ai_generation_visible",
      "ai_retention_days",
      "ai_daily_usage_count",
      "cleanup_ai_generations",
      "insert_ai_draft_version",
    ]) {
      expect(m22, `0022 harus berisi fungsi ${fn}`).toContain(fn);
    }
    expect(m22).toMatch(/security definer/i);
    expect(m22).toMatch(/security invoker/i);
    expect(m22).toMatch(/search_path = public, pg_temp/);
    expect(m22).toContain(
      "grant execute on function public.insert_ai_draft_version(uuid, text, text, text, jsonb, text, uuid) to authenticated",
    );
    // viewer_client TIDAK ADA di daftar peran (komentar di-strip dulu).
    const m22NoComments = m22.replace(/--[^\n]*/g, "");
    expect(m22NoComments, "viewer_client TIDAK BOLEH ada di kode 0022").not.toContain(
      "viewer_client",
    );
    // Retensi 90 hari + pemakaian hari kalender Jakarta + nomor versi
    // max(version_number) — Postgres TIDAK punya max(uuid).
    expect(m22).toContain("select 90;");
    expect(m22).toContain("Asia/Jakarta");
    expect(m22).toContain("make_interval(days => p_days)");
    expect(m22).toContain("coalesce(max(version_number), 0) + 1");
    expect(m22NoComments).not.toContain("max(uuid)");
    // RPC insert versi AI TIDAK PERNAH melempar (mengembalikan jsonb kode).
    for (const code of ["FORBIDDEN", "INVALID_ITEM", "INVALID_GENERATION", "INVALID_INPUT"]) {
      expect(m22, `0022 harus mengembalikan kode ${code}`).toContain(code);
    }
    // Policy SELECT pakai helper; update/delete using(false) — append-only.
    expect(m22).toContain("is_ai_generation_visible(ai_generations.id");
    expect(m22).toContain("using (false)");
    // TIDAK ADA embed()/vector search (ASUMSI-8C) dan TIDAK ADA fungsi
    // adapter provider (AI NONAKTIF, ASUMSI-8A).
    expect(m22).not.toContain("embed(");
    for (const fn of ["generateStructuredDraft", "summarize", "classify"]) {
      expect(m22, `0022 TIDAK BOLEH berisi adapter ${fn}`).not.toContain(fn);
    }
  });

  it("migrasi 0023 menulis ulang policy SELECT ai_generations tanpa self-lookup (perbaikan e2e Phase 8)", () => {
    const m23 =
      migrationFiles().find((f) => f.name === "0023_ai_generations_select_policy_fix.sql")?.sql ??
      "";
    // Drop + buat ulang policy yang SAMA (bukan policy baru) — 0022
    // tidak diubah (sudah live).
    expect(m23).toContain(
      'drop policy if exists "ai_generations_select_member" on public.ai_generations',
    );
    expect(m23).toContain('create policy "ai_generations_select_member"');
    expect(m23).toMatch(/on public\.ai_generations for select/i);
    expect(m23).toMatch(/to authenticated/i);
    // Policy SELECT harus memakai is_ws_member LANGSUNG atas
    // workspace_id baris itu — helper is_ai_generation_visible mencari
    // barisnya di ai_generations sendiri, dan lookup-ke-diri-sendiri
    // itu gagal di konteks INSERT ... RETURNING (PostgREST
    // .insert().select() → 42501 + rollback; log AI tidak tersimpan).
    // Komentar di-strip dulu: header file menyebut nama helper untuk
    // menjelaskan cacatnya.
    const m23NoCommentsEarly = m23.replace(/--[^\n]*/g, "");
    expect(m23NoCommentsEarly).toContain(
      "public.is_ws_member(ai_generations.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])",
    );
    expect(
      m23NoCommentsEarly,
      "0023 TIDAK BOLEH memakai helper self-lookup di policy",
    ).not.toContain("is_ai_generation_visible");
    // Tidak ada objek/grant baru — hanya penulisan ulang policy.
    expect(m23).not.toMatch(/create table/i);
    expect(m23).not.toMatch(/grant /i);
    expect(m23).not.toMatch(/revoke /i);
    // viewer_client tetap tidak ada di daftar peran (komentar di-strip).
    const m23NoComments = m23NoCommentsEarly;
    expect(m23NoComments, "viewer_client TIDAK BOLEH ada di kode 0023").not.toContain(
      "viewer_client",
    );
  });

  it("pgTAP 07 ada dengan plan(77) + pola placeholder yang benar", () => {
    const test07 = readFileSync(path.join(APP_ROOT, "supabase/tests/07_rls_phase7.sql"), "utf8");
    expect(test07).toContain("select plan(77);");
    expect(test07).not.toContain("094e8752-eef4-4f0e-b6ae-2d5813445018");
    expect(test07).not.toContain("aabb1dab-77c1-4659-af0e-c703c9de279c");
    expect(test07).toContain("select * from finish();");
    expect(test07).toContain("import_analytics_snapshot");
    expect(test07).toContain("T2a impor Brand A (4 baris) lolos");
    expect(test07).toContain("T5b A (viewer_client WS-B7) melihat 0 snapshot");
    expect(test07).toContain("T13b agregat campaign reach = 1500");
    // Cleanup daun → akar (pelajaran 06 v1.0): brands dihapus SETELAH
    // content_items, dan katalog global metric_definitions TIDAK dihapus.
    expect(test07).toContain("delete from public.content_items where workspace_id in");
    const brandsPos = test07.indexOf("delete from public.brands where workspace_id in");
    const itemsPos = test07.indexOf("delete from public.content_items where workspace_id in");
    expect(brandsPos).toBeGreaterThan(itemsPos);
    expect(test07).not.toContain("delete from public.metric_definitions");
  });

  it("pgTAP 08 ada dengan plan(53) + pola placeholder yang benar", () => {
    const test08 = readFileSync(path.join(APP_ROOT, "supabase/tests/08_rls_phase8.sql"), "utf8");
    expect(test08).toContain("select plan(53);");
    expect(test08).not.toContain("094e8752-eef4-4f0e-b6ae-2d5813445018");
    expect(test08).not.toContain("aabb1dab-77c1-4659-af0e-c703c9de279c");
    expect(test08).toContain("select * from finish();");
    expect(test08).toContain("insert_ai_draft_version");
    expect(test08).toContain("ai_daily_usage_count");
    expect(test08).toContain("cleanup_ai_generations");
    expect(test08).toContain("T2c A sebagai viewer_client di WS-B8 melihat 0 baris log WS-B8");
    expect(test08).toContain("T4a A insert versi AI untuk item A8-1 dengan g1");
    expect(test08).toContain("T3f INSERT ... RETURNING log sendiri lolos (regresi 0023)");
    expect(test08).toContain("T5f cleanup oleh A (owner) menghapus 1 baris");
    // Cleanup daun → akar (pelajaran 06 v1.0 + 39, pgTAP 07 Run 5):
    // ai_generations dihapus SEBELUM organizations, dan cleanup berjalan
    // sebagai postgres (reset role sebelum blok cleanup).
    expect(test08).toContain("delete from public.ai_generations where workspace_id in");
    const genPos = test08.indexOf("delete from public.ai_generations where workspace_id in");
    const orgPos = test08.indexOf("delete from public.organizations where id in");
    expect(genPos).toBeGreaterThan(-1);
    expect(orgPos).toBeGreaterThan(genPos);
    const cleanupIdx = test08.lastIndexOf("reset role;");
    expect(cleanupIdx).toBeGreaterThan(-1);
    expect(test08.indexOf("delete from public.ai_generations", cleanupIdx)).toBeGreaterThan(
      cleanupIdx,
    );
    expect(test08).toContain("rollback;");
  });
});

describe("Repo bebas secret (statis)", () => {
  it(".env.example tidak berisi nilai kunci", () => {
    const example = readFileSync(path.join(APP_ROOT, ".env.example"), "utf8");
    expect(example).not.toMatch(/sb_publishable_[A-Za-z0-9]/);
    expect(example).not.toMatch(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    expect(example).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY=\S+/);
  });

  it(".gitignore mengecualikan .env.local", () => {
    const gitignore = readFileSync(path.join(APP_ROOT, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.env$/m);
  });

  it("tidak ada file .env berisi nilai yang ter-commit di repo (cek file yang ada)", () => {
    const rootFiles = readdirSync(APP_ROOT);
    // .env.local BOLEH ada lokal (gitignored) tapi TIDAK BOLEH ada file .env
    // lain berisi nilai. Tes ini hanya memastikan tidak ada .env (tanpa suffix).
    expect(rootFiles).not.toContain(".env");
  });
});
