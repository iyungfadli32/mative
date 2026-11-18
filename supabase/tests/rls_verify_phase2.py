#!/usr/bin/env python3
"""Verifikasi statis MaTive Phase 2 (P2-01 s.d. P2-03) — tanpa database nyata.

Memeriksa:
  1. Migrasi 0007 + tes 02 ter-parse penuh oleh pglast (parser PostgreSQL asli).
  2. Jumlah asersi pgTAP di 02 == angka plan(N).
  3. Semua throws_ok di 02 memakai bentuk 4 argumen (sql, kode SQLSTATE,
     pola = pesan lengkap, deskripsi).
  4. Tidak ada UUID pengguna uji nyata yang di-hardcode di 02; UUID palsu
     1111.../2222... hanya di baris \\set; tidak ada placeholder :'user_a' /
     :'user_b' di dalam string $$...$$ / $f$...$f$.
  5. 0007 hanya membuat 14 tabel Phase 2 (tidak ada tabel fase lain) dan
     memuat kolom wajib content_items + content_placements (Dok 05 §3).
  6. Tidak ada forward-reference: setiap tabel yang dirujuk policy/helper/
     trigger di 0007 sudah dibuat di 0001–0007; setiap helper yang dipanggil
     policy didefinisikan di 0006 atau 0007; tidak ada policy yang memindai
     tabel lain (FROM/JOIN) — graf dependensi asiklik (lihat rls_audit.py).
  7. CHECK penegas fase ini ada: production_status TANPA 'client_review',
     remote_post_id/published_url WAJIB null, unique (content_item_id,
     version_number) + (placement_id, version_number).
  8. File 0001–0006 TIDAK diubah (diperiksa lewat git di luar skrip ini).

Jalankan:  python3 supabase/tests/rls_verify_phase2.py
Keluar 0 bila semua pemeriksaan lolos.
"""
import re
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent.parent
MIG = APP_ROOT / "supabase" / "migrations" / "0007_planning_core.sql"
TEST_FILE = Path(__file__).resolve().parent / "02_rls_phase2.sql"
FAKE_A = "11111111-1111-1111-1111-111111111111"
FAKE_B = "22222222-2222-2222-2222-222222222222"
# UUID pengguna uji nyata yang dipakai file 01 (DILARANG di file 02).
REAL_A = "094e8752-eef4-4f0e-b6ae-2d5813445018"
REAL_B = "aabb1dab-77c1-4659-af0e-c703c9de279c"

ALLOWED_TABLES = {
    "brands", "social_channels", "content_pillars", "audiences",
    "campaigns", "campaign_brands", "ideas", "content_items",
    "content_placements", "content_versions", "placement_versions",
    "content_status_events", "tags", "content_tags",
}
FORBIDDEN_TABLES = {
    "brief_templates", "assets", "asset_versions", "content_assets",
    "tasks", "task_checklist_items", "comments", "mentions",
    "approval_workflows", "approval_steps", "approval_requests",
    "approval_decisions", "publishing_jobs", "publishing_attempts",
    "published_posts", "metric_definitions", "analytics_snapshots",
    "content_metrics", "notifications", "integration_events",
    "ai_generations", "channel_credentials",
}
REQUIRED_ITEM_COLS = [
    "workspace_id", "brand_id", "campaign_id", "pillar_id", "title",
    "internal_description", "objective", "audience_id", "funnel_stage",
    "production_status", "priority", "owner_user_id", "due_at",
    "timezone", "origin_idea_id", "archived_at",
]
REQUIRED_PLACEMENT_COLS = [
    "content_item_id", "social_channel_id", "platform_format",
    "platform_caption", "platform_hashtags", "scheduled_at", "timezone",
    "distribution_status", "platform_metadata", "remote_post_id",
    "published_url",
]

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


def strip_comments(sql):
    sql = re.sub(r"--[^\n]*", "", sql)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return sql


def main():
    mig = MIG.read_text()
    test = TEST_FILE.read_text()

    # 1. Parse pglast.
    try:
        import pglast
    except ImportError:
        check("pglast tersedia", False, "modul pglast tidak terpasang")
        return 1
    try:
        stmts = pglast.parse_sql(mig)
        check("pglast parse 0007 penuh", True, f"{len(stmts)} statement")
    except Exception as exc:  # noqa: BLE001
        check("pglast parse 0007 penuh", False, str(exc)[:300])
        return 1
    stripped_lines = [ln for ln in test.splitlines() if not ln.lstrip().startswith("\\set")]
    stripped = "\n".join(stripped_lines)
    stripped = stripped.replace(":'user_a'", f"'{FAKE_A}'").replace(":'user_b'", f"'{FAKE_B}'")
    try:
        stmts = pglast.parse_sql(stripped)
        check("pglast parse tes 02 penuh", True, f"{len(stmts)} statement")
    except Exception as exc:  # noqa: BLE001
        check("pglast parse tes 02 penuh", False, str(exc)[:300])
        return 1

    # 2. Jumlah asersi vs plan(N).
    plan_m = re.search(r"select\s+plan\((\d+)\)", test)
    plan_n = int(plan_m.group(1)) if plan_m else None
    assertion_res = [
        r"select\s+is_empty\s*\(",
        r"select\s+isnt_empty\s*\(",
        r"select\s+throws_ok\s*\(",
        r"select\s+is\s*\(",
    ]
    assertions = sum(len(re.findall(p, test)) for p in assertion_res)
    check("jumlah asersi == plan(N)", plan_n == assertions, f"plan({plan_n}) vs {assertions} asersi")

    # 3. throws_ok 4 argumen (sql, 'SQLSTATE', 'pesan lengkap', 'deskripsi').
    throws_calls = re.findall(r"throws_ok\s*\(", test)
    throws_4arg = re.findall(
        r"throws_ok\s*\(\s*\$\$.*?\$\$\s*,\s*'(?:42501|23505|23514|P0001)'\s*,\s*'[^']+'\s*,\s*'[^']+'\s*\)",
        test, flags=re.DOTALL,
    )
    throws_4arg_fmt = re.findall(
        r"throws_ok\s*\(\s*format\(", test
    )
    check(
        "throws_ok 4 argumen + SQLSTATE",
        len(throws_calls) == len(throws_4arg) + len(throws_4arg_fmt) and len(throws_calls) > 0,
        f"{len(throws_4arg) + len(throws_4arg_fmt)}/{len(throws_calls)} throws_ok bentuk 4 argumen",
    )

    # 4. UUID: tidak ada UUID nyata; palsu hanya di \set; tidak ada placeholder di $$.
    check("tidak ada UUID uji nyata di 02", REAL_A not in test and REAL_B not in test)
    bad_fake = [
        i for i, line in enumerate(test.splitlines(), 1)
        if (FAKE_A in line or FAKE_B in line) and not line.lstrip().startswith("\\set")
    ]
    check("UUID palsu hanya di \\set", not bad_fake, f"baris bermasalah: {bad_fake}" if bad_fake else "hanya 2 baris \\set")
    blocks = []
    for tag in ("$$", "$f$"):
        for m in re.finditer(re.escape(tag) + r"(.*?)" + re.escape(tag), test, flags=re.DOTALL):
            blocks.append(m.group(1))
    bad_ph = [b[:60] for b in blocks if ":'user_a'" in b or ":'user_b'" in b]
    check("tidak ada placeholder di dalam $$/$f$", not bad_ph, f"blok bermasalah: {bad_ph}" if bad_ph else "")

    # 5. Scope tabel 0007.
    mig_nc = strip_comments(mig)
    created = set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", mig_nc, flags=re.I))
    check("0007 membuat tepat 14 tabel Phase 2", created == ALLOWED_TABLES,
          f"{len(created)} tabel; selisih: {sorted(created ^ ALLOWED_TABLES) or 'tidak ada'}")
    forbidden_found = sorted(FORBIDDEN_TABLES & set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", mig_nc, flags=re.I)))
    check("tidak ada tabel fase lain di 0007", not forbidden_found, str(forbidden_found))
    # Kolom wajib: ambil blok CREATE TABLE tiap tabel.
    def table_block(table):
        m = re.search(r"create\s+table\s+if\s+not\s+exists\s+public\." + table + r"\s*\((.*?)\n\);",
                      mig_nc, flags=re.I | re.S)
        return m.group(1) if m else ""
    item_block = table_block("content_items")
    missing_items = [c for c in REQUIRED_ITEM_COLS if not re.search(rf"\b{c}\b", item_block)]
    check("kolom content_items lengkap (Dok 05 §3)", not missing_items, f"hilang: {missing_items}")
    pl_block = table_block("content_placements")
    missing_pl = [c for c in REQUIRED_PLACEMENT_COLS if not re.search(rf"\b{c}\b", pl_block)]
    check("kolom content_placements lengkap (Dok 05 §3)", not missing_pl, f"hilang: {missing_pl}")

    # 6. Forward-reference: tabel yang dirujuk policy/helper/trigger harus
    #    sudah dibuat di 0001–0007; helper yang dipanggil harus ada.
    earlier = set()
    for f in sorted((APP_ROOT / "supabase" / "migrations").glob("*.sql")):
        earlier |= set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)",
                                  strip_comments(f.read_text()), flags=re.I))
    # Tabel yang dirujuk di dalam ekspresi policy (public.<tabel>).
    policy_bodies = re.findall(
        r"create\s+policy\s+\"[^\"]+\"\s+on\s+public\.(\w+)\s+for\s+\w+\s+to\s+\w+\s*(.*?)(?=;\s*(?:create|drop|alter|revoke|grant|comment|create\s+or|drop\s+trigger|create\s+trigger|insert|select|$))",
        mig_nc, flags=re.I | re.S)
    referenced = set()
    for _tbl, body in policy_bodies:
        referenced |= set(re.findall(r"public\.(\w+)", body))
    # public.<nama> di body policy mencakup helper (fungsi) + kolom tabel itu
    # sendiri; pisahkan: yang BUKAN helper = tabel.
    helper_defs = set(re.findall(r"function\s+public\.(\w+)\s*\(", mig_nc))
    for f in sorted((APP_ROOT / "supabase" / "migrations").glob("000[1-6]_*.sql")):
        helper_defs |= set(re.findall(r"function\s+public\.(\w+)\s*\(", strip_comments(f.read_text())))
    table_refs = {r for r in referenced if r not in helper_defs}
    # Kolom baris sendiri (mis. brands.workspace_id) merujuk tabel policy itu
    # sendiri — bukan forward-reference; keluarkan tabel-tabel policy.
    policy_tables = {t for t, _b in policy_bodies}
    table_refs -= policy_tables
    check("policy tidak merujuk tabel yang belum dibuat", table_refs <= earlier,
          f"rujukan tabel: {sorted(table_refs) or 'tidak ada'}; belum dibuat: {sorted(table_refs - earlier)}")
    called_helpers = set()
    for _tbl, body in policy_bodies:
        called_helpers |= set(re.findall(r"public\.(\w+)\s*\(", body))
    check("helper yang dipanggil policy terdefinisi (0006/0007)",
          called_helpers <= helper_defs,
          f"dipanggil: {sorted(called_helpers)}; tak terdefinisi: {sorted(called_helpers - helper_defs)}")
    # Policy tidak memindai tabel lain (FROM/JOIN public.<tabel>).
    scans = set()
    for _tbl, body in policy_bodies:
        scans |= set(re.findall(r"\b(?:from|join)\s+public\.(\w+)\b", body, flags=re.I))
    check("policy 0007: 0 pemindaian tabel (FROM/JOIN)", not scans, f"scan: {sorted(scans)}")
    check("jumlah policy 0007", len(policy_bodies) == 56, f"{len(policy_bodies)} policy (14 tabel x 4 operasi)")

    # 7. CHECK penegas fase ini.
    check("CHECK production_status TANPA client_review",
          "'client_review'" not in re.search(
              r"content_items_production_status_check\s*\n?\s*check\s*\((.*?)\)\)",
              mig_nc, flags=re.I | re.S).group(1) if re.search(
              r"content_items_production_status_check\s*\n?\s*check\s*\((.*?)\)\)",
              mig_nc, flags=re.I | re.S) else False,
          "nilai client_review tidak ada di CHECK production_status")
    check("CHECK remote_post_id/published_url null ada",
          "content_placements_remote_post_id_null_check" in mig_nc
          and "remote_post_id is null and published_url is null" in mig_nc)
    check("unique (content_item_id, version_number) ada",
          bool(re.search(r"unique\s*\(\s*content_item_id\s*,\s*version_number\s*\)", mig_nc)))
    check("unique (placement_id, version_number) ada",
          bool(re.search(r"unique\s*\(\s*placement_id\s*,\s*version_number\s*\)", mig_nc)))
    check("dua status terpisah (production vs distribution)",
          "production_status" in mig_nc and "distribution_status" in mig_nc
          and mig_nc.count("production_status") >= 2 and mig_nc.count("distribution_status") >= 2)
    # Semua 14 tabel: RLS aktif.
    rls_tables = set(re.findall(r"alter\s+table\s+public\.(\w+)\s+enable\s+row\s+level\s+security", mig_nc, flags=re.I))
    check("RLS aktif untuk ke-14 tabel", rls_tables == ALLOWED_TABLES,
          f"kurang: {sorted(ALLOWED_TABLES - rls_tables)}")

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} pemeriksaan lolos.")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
