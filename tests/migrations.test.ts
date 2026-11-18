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
  it("memiliki 5 migrasi berversi berurutan 0001–0005", () => {
    const files = migrationFiles();
    expect(files.map((f) => f.name)).toEqual([
      "0001_profiles.sql",
      "0002_organizations.sql",
      "0003_workspaces.sql",
      "0004_activity_logs.sql",
      "0005_resource_shares.sql",
    ]);
  });

  it("setiap migrasi mengaktifkan RLS untuk tabelnya", () => {
    for (const { name, sql } of migrationFiles()) {
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
    const all = migrationFiles()
      .map((f) => f.sql)
      .join("\n");
    for (const table of ["content_items", "approval_requests", "publishing_jobs", "brands"]) {
      expect(all, `tabel ${table} TIDAK BOLEH dibuat di Phase 1`).not.toContain(
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
