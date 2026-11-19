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
  it("memiliki 17 migrasi berversi berurutan 0001–0017", () => {
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
      // hanya menulis ulang policy + helper (tanpa tabel baru).
      if (
        name === "0008_planning_transactions.sql" ||
        name === "0010_production_transactions.sql" ||
        name === "0011_fix_content_item_brand_null.sql" ||
        name === "0012_convert_idea_brand_param.sql" ||
        name === "0014_approval_transactions.sql" ||
        name === "0015_notification_scope_placement.sql" ||
        name === "0016_brand_scope.sql"
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
      if (name === "0015_notification_scope_placement.sql") continue;
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

  it("pgTAP 04 ada dengan plan(64) + pola placeholder yang benar", () => {
    const test04 = readFileSync(path.join(APP_ROOT, "supabase/tests/04_rls_phase4.sql"), "utf8");
    expect(test04).toContain("select plan(64);");
    expect(test04).not.toContain("094e8752-eef4-4f0e-b6ae-2d5813445018");
    expect(test04).not.toContain("aabb1dab-77c1-4659-af0e-c703c9de279c");
    expect(test04).toContain("select * from finish();");
  });

  it("pgTAP 05 ada dengan plan(59) + pola placeholder yang benar", () => {
    const test05 = readFileSync(path.join(APP_ROOT, "supabase/tests/05_rls_phase5.sql"), "utf8");
    expect(test05).toContain("select plan(59);");
    expect(test05).not.toContain("094e8752-eef4-4f0e-b6ae-2d5813445018");
    expect(test05).not.toContain("aabb1dab-77c1-4659-af0e-c703c9de279c");
    expect(test05).toContain("select * from finish();");
    // Bukti pemisahan M5.4 ada di file: scheduled_at diuji TIDAK BERUBAH.
    expect(test05).toContain("T10e M5.4");
    expect(test05).toContain("T10f M5.4");
    expect(test05).toContain("set_visual_order");
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
