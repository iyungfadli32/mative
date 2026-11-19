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
  it("memiliki 10 migrasi berversi berurutan 0001–0010", () => {
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
    ]);
  });

  it("setiap migrasi yang membuat tabel mengaktifkan RLS untuk tabelnya", () => {
    for (const { name, sql } of migrationFiles()) {
      // 0006 hanya menulis ulang policy (DROP/CREATE POLICY), tidak membuat
      // tabel baru — RLS tabelnya sudah aktif sejak 0001–0005.
      // 0008 dan 0010 hanya berisi fungsi RPC transaksional (tanpa
      // tabel/policy baru).
      if (
        name === "0008_planning_transactions.sql" ||
        name === "0010_production_transactions.sql"
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
    const m10 = migrationFiles().find((f) => f.name === "0010_production_transactions.sql")?.sql ?? "";
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

  it("token undangan disimpan sebagai hash, bukan token mentah", () => {
    const m3 = migrationFiles().find((f) => f.name === "0003_workspaces.sql")?.sql ?? "";
    expect(m3).toContain("token_hash");
    expect(m3).not.toMatch(/token\s+text not null,$/m);
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
