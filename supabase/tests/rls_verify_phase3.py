#!/usr/bin/env python3
"""Verifikasi statis MaTive Phase 3 (P3-01 s.d. P3-03) — tanpa database nyata.

Memeriksa:
  1. Migrasi 0009 + 0010 + tes 03 ter-parse penuh oleh pglast (parser PostgreSQL asli).
  2. Jumlah asersi pgTAP di 03 == angka plan(N).
  3. Semua throws_ok di 03 memakai bentuk 4 argumen (sql, kode SQLSTATE,
     pola = pesan lengkap, deskripsi).
  4. Tidak ada UUID pengguna uji nyata yang di-hardcode di 03; UUID palsu
     1111.../2222... hanya di baris \\set; tidak ada placeholder :'user_a' /
     :'user_b' di dalam string $$...$$ / $f$...$f$.
  5. 0009 hanya membuat 9 tabel Phase 3 (tidak ada tabel fase lain) dan
     memuat kolom wajib tasks + assets + comments (Dok 05 §3).
  6. Tidak ada forward-reference: setiap tabel yang dirujuk policy/helper/
     trigger di 0009 sudah dibuat di 0001–0009; setiap helper yang dipanggil
     policy didefinisikan di 0006/0007/0009; tidak ada policy yang memindai
     tabel lain (FROM/JOIN).
  7. CHECK penegas fase ini ada: tasks parent_type/status/priority,
     assets byte_size <= 10 MB, notifications type/target_type,
     content_assets usage_role, no-delete untuk tasks/comments (using false)
     dan mentions/notifications (with check false), FK brands.logo_asset_id,
     bucket privat mative-assets + 5 policy storage tanpa pemindaian tabel.
  8. Graf RLS EFEKTIF 0001–0009 (definisi terakhir per nama policy; 0006
     menulis ulang 0001–0005): 0 siklus, 0 self-loop. Catatan jujur: audit
     mentah semua file (tanpa deduplikasi) masih menampilkan 4 siklus LAMA
     dari teks 0001–0005 yang sudah digantikan 0006 — itu teks yang sudah
     tidak berlaku, bukan keadaan efektif.
  9. 0010 berisi 5 RPC transaksional Phase 3 (SECURITY DEFINER, search_path
     terkunci, GRANT EXECUTE hanya ke authenticated).
  10. File 0001–0008 TIDAK diubah (diperiksa lewat git di luar skrip ini).

Jalankan:  python3 supabase/tests/rls_verify_phase3.py
Keluar 0 bila semua pemeriksaan lolos.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rls_audit import POLICY_RE, find_cycles  # noqa: E402

APP_ROOT = Path(__file__).resolve().parent.parent.parent
MIG9 = APP_ROOT / "supabase" / "migrations" / "0009_production_ops.sql"
MIG10 = APP_ROOT / "supabase" / "migrations" / "0010_production_transactions.sql"
TEST_FILE = Path(__file__).resolve().parent / "03_rls_phase3.sql"
FAKE_A = "11111111-1111-1111-1111-111111111111"
FAKE_B = "22222222-2222-2222-2222-222222222222"
# UUID pengguna uji nyata yang dipakai file 01 (DILARANG di file 03).
REAL_A = "094e8752-eef4-4f0e-b6ae-2d5813445018"
REAL_B = "aabb1dab-77c1-4659-af0e-c703c9de279c"

ALLOWED_TABLES = {
    "brief_templates", "tasks", "task_checklist_items", "assets",
    "asset_versions", "content_assets", "comments", "mentions",
    "notifications",
}
FORBIDDEN_TABLES = {
    "approval_workflows", "approval_steps", "approval_requests",
    "approval_decisions", "publishing_jobs", "publishing_attempts",
    "published_posts", "metric_definitions", "analytics_snapshots",
    "content_metrics", "integration_events", "ai_generations",
    "channel_credentials",
}
REQUIRED_TASK_COLS = [
    "workspace_id", "parent_type", "parent_id", "title", "description",
    "assignee_user_id", "created_by", "due_at", "priority", "status",
    "estimate_minutes",
]
REQUIRED_ASSET_COLS = [
    "workspace_id", "storage_bucket", "object_key", "original_filename",
    "mime_type", "byte_size", "width", "height", "duration_ms", "checksum",
    "rights_notes", "license_expiry_at", "uploaded_by", "processing_status",
]
REQUIRED_COMMENT_COLS = [
    "workspace_id", "target_type", "target_id", "parent_comment_id",
    "body", "author_user_id", "edited_at", "deleted_at", "deleted_by",
]

DROP_POLICY_RE = re.compile(
    r"drop\s+policy\s+(?:if\s+exists\s+)?\"([^\"]+)\"\s+on\s+public\.(\w+)",
    re.I,
)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


def strip_comments(sql):
    sql = re.sub(r"--[^\n]*", "", sql)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return sql


def main():
    mig9 = MIG9.read_text()
    mig10 = MIG10.read_text()
    test = TEST_FILE.read_text()

    # 1. Parse pglast.
    try:
        import pglast
    except ImportError:
        check("pglast tersedia", False, "modul pglast tidak terpasang")
        return 1
    for label, sql in (("0009", mig9), ("0010", mig10)):
        try:
            stmts = pglast.parse_sql(sql)
            check(f"pglast parse {label} penuh", True, f"{len(stmts)} statement")
        except Exception as exc:  # noqa: BLE001
            check(f"pglast parse {label} penuh", False, str(exc)[:300])
            return 1
    stripped_lines = [ln for ln in test.splitlines() if not ln.lstrip().startswith("\\set")]
    stripped = "\n".join(stripped_lines)
    stripped = stripped.replace(":'user_a'", f"'{FAKE_A}'").replace(":'user_b'", f"'{FAKE_B}'")
    try:
        stmts = pglast.parse_sql(stripped)
        check("pglast parse tes 03 penuh", True, f"{len(stmts)} statement")
    except Exception as exc:  # noqa: BLE001
        check("pglast parse tes 03 penuh", False, str(exc)[:300])
        return 1

    # 2. Jumlah asersi vs plan(N).
    plan_m = re.search(r"select\s+plan\((\d+)\)", test)
    plan_n = int(plan_m.group(1)) if plan_m else None
    assertion_res = [
        r"select\s+is_empty\s*\(",
        r"select\s+isnt_empty\s*\(",
        r"select\s+throws_ok\s*\(",
        r"select\s+lives_ok\s*\(",
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
    check("tidak ada UUID uji nyata di 03", REAL_A not in test and REAL_B not in test)
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

    # 5. Scope tabel 0009.
    mig9_nc = strip_comments(mig9)
    created = set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", mig9_nc, flags=re.I))
    check("0009 membuat tepat 9 tabel Phase 3", created == ALLOWED_TABLES,
          f"{len(created)} tabel; selisih: {sorted(created ^ ALLOWED_TABLES) or 'tidak ada'}")
    forbidden_found = sorted(FORBIDDEN_TABLES & set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", mig9_nc, flags=re.I)))
    check("tidak ada tabel fase lain di 0009", not forbidden_found, str(forbidden_found))

    def table_block(table):
        m = re.search(r"create\s+table\s+if\s+not\s+exists\s+public\." + table + r"\s*\((.*?)\n\);",
                      mig9_nc, flags=re.I | re.S)
        return m.group(1) if m else ""
    for table, cols in (
        ("tasks", REQUIRED_TASK_COLS),
        ("assets", REQUIRED_ASSET_COLS),
        ("comments", REQUIRED_COMMENT_COLS),
    ):
        block = table_block(table)
        missing = [c for c in cols if not re.search(rf"\b{c}\b", block)]
        check(f"kolom {table} lengkap (Dok 05 §3)", not missing, f"hilang: {missing}")
    rls_tables = set(re.findall(r"alter\s+table\s+public\.(\w+)\s+enable\s+row\s+level\s+security", mig9_nc, flags=re.I))
    check("RLS aktif untuk ke-9 tabel", rls_tables == ALLOWED_TABLES,
          f"kurang: {sorted(ALLOWED_TABLES - rls_tables)}")

    # 6. Forward-reference: tabel/helper yang dirujuk 0009 sudah ada.
    earlier = set()
    helper_defs = set()
    for f in sorted((APP_ROOT / "supabase" / "migrations").glob("000[1-9]_*.sql")):
        txt = strip_comments(f.read_text())
        earlier |= set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", txt, flags=re.I))
        helper_defs |= set(re.findall(r"function\s+public\.(\w+)\s*\(", txt))
    policy_bodies = re.findall(
        r"create\s+policy\s+\"[^\"]+\"\s+on\s+public\.(\w+)\s+for\s+\w+\s+to\s+\w+\s*(.*?)(?=;\s*(?:create|drop|alter|revoke|grant|comment|create\s+or|drop\s+trigger|create\s+trigger|insert|select|$))",
        mig9_nc, flags=re.I | re.S)
    referenced = set()
    for _tbl, body in policy_bodies:
        referenced |= set(re.findall(r"public\.(\w+)", body))
    table_refs = {r for r in referenced if r not in helper_defs}
    policy_tables = {t for t, _b in policy_bodies}
    table_refs -= policy_tables
    check("policy tidak merujuk tabel yang belum dibuat", table_refs <= earlier,
          f"rujukan tabel: {sorted(table_refs) or 'tidak ada'}; belum dibuat: {sorted(table_refs - earlier)}")
    called_helpers = set()
    for _tbl, body in policy_bodies:
        called_helpers |= set(re.findall(r"public\.(\w+)\s*\(", body))
    check("helper yang dipanggil policy terdefinisi (0006/0007/0009)",
          called_helpers <= helper_defs,
          f"dipanggil: {sorted(called_helpers)}; tak terdefinisi: {sorted(called_helpers - helper_defs)}")
    scans = set()
    for _tbl, body in policy_bodies:
        scans |= set(re.findall(r"\b(?:from|join)\s+public\.(\w+)\b", body, flags=re.I))
    check("policy 0009: 0 pemindaian tabel (FROM/JOIN)", not scans, f"scan: {sorted(scans)}")
    check("jumlah policy tabel 0009", len(policy_bodies) == 36, f"{len(policy_bodies)} policy (9 tabel x 4 operasi)")
    # Semua public.<nama> di 0009 harus tabel yang sudah dibuat atau helper.
    all_refs = set(re.findall(r"public\.(\w+)", mig9_nc))
    unknown = all_refs - earlier - helper_defs
    check("semua rujukan public.* di 0009 dikenal", not unknown, f"tak dikenal: {sorted(unknown)}")

    # 7. CHECK penegas fase ini.
    check("CHECK tasks parent_type dikunci",
          bool(re.search(r"tasks_parent_type_check\s+check\s*\(parent_type in \('content_item', 'campaign'\)\)", mig9_nc)))
    check("CHECK tasks status dikunci (6 nilai)",
          "check (status in ('todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'))" in mig9_nc)
    check("CHECK tasks priority dikunci",
          "check (priority in ('low', 'medium', 'high', 'urgent'))" in mig9_nc)
    check("CHECK assets byte_size <= 10 MB",
          "check (byte_size > 0 and byte_size <= 10485760)" in mig9_nc)
    check("CHECK notifications type dikunci",
          "check (type in ('mention', 'task_assigned', 'task_status_change', 'comment_reply'))" in mig9_nc)
    check("CHECK content_assets usage_role dikunci",
          "check (usage_role in ('primary', 'reference', 'thumbnail', 'attachment'))" in mig9_nc)
    check("no-delete tasks/comments (using false)",
          mig9_nc.count('for delete to authenticated using (false)') >= 2)
    check("no-insert mentions/notifications (with check false)",
          mig9_nc.count('for insert to authenticated with check (false)') >= 2)
    check("FK brands.logo_asset_id -> assets ada",
          "brands_logo_asset_id_fkey" in mig9_nc and "references public.assets (id) on delete set null" in mig9_nc)
    check("bucket privat mative-assets dibuat",
          "insert into storage.buckets (id, name, public)" in mig9_nc
          and "values ('mative-assets', 'mative-assets', false)" in mig9_nc)
    storage_policies = re.findall(
        r"create\s+policy\s+\"[^\"]+\"\s+on\s+storage\.(\w+)\s+for\s+\w+\s+to\s+\w+\s*(.*?)(?=;\s*(?:create|drop|alter|revoke|grant|comment|create\s+or|drop\s+trigger|create\s+trigger|insert|select|$))",
        mig9_nc, flags=re.I | re.S)
    check("jumlah policy storage 0009", len(storage_policies) == 5, f"{len(storage_policies)} policy (1 buckets + 4 objects)")
    storage_scans = set()
    for _tbl, body in storage_policies:
        storage_scans |= set(re.findall(r"\b(?:from|join)\s+public\.(\w+)\b", body, flags=re.I))
    check("policy storage: 0 pemindaian tabel", not storage_scans, f"scan: {sorted(storage_scans)}")

    # 8. Graf RLS EFEKTIF 0001–0009: definisi terakhir per nama policy.
    effective = {}  # nama policy -> (tabel, scans)
    for f in sorted((APP_ROOT / "supabase" / "migrations").glob("000[1-9]_*.sql")):
        txt = strip_comments(f.read_text())
        events = []
        for m in POLICY_RE.finditer(txt):
            events.append((m.start(), "create", m.group(1), m.group(2), m.group(4)))
        for m in DROP_POLICY_RE.finditer(txt):
            events.append((m.start(), "drop", m.group(1), m.group(2), ""))
        for _pos, kind, name, table, body in sorted(events, key=lambda e: e[0]):
            if kind == "drop":
                effective.pop(name, None)
            else:
                scans_p = sorted(set(re.findall(r"\b(?:from|join)\s+public\.(\w+)\b", body, flags=re.I)))
                effective[name] = (table, scans_p)
    edges = {}
    for _name, (table, scans_p) in effective.items():
        edges.setdefault(table, set()).update(scans_p)
    cycles = find_cycles(edges)
    self_loops = [t for t, tgts in edges.items() if t in tgts]
    check("graf RLS efektif 0001–0009: 0 siklus",
          not cycles, f"siklus: {cycles}" if cycles else f"{len(effective)} policy efektif, {len(edges)} tabel")
    check("graf RLS efektif 0001–0009: 0 self-loop",
          not self_loops, f"self-loop: {self_loops}" if self_loops else "")

    # 9. RPC 0010.
    mig10_nc = strip_comments(mig10)
    for fn in [
        "create_task_with_checklist",
        "transition_task_status",
        "create_comment_with_mentions",
        "restore_content_version",
        "set_default_brief_template",
    ]:
        check(f"0010 berisi fungsi {fn}", fn in mig10_nc)
    check("0010: semua RPC SECURITY DEFINER",
          mig10_nc.count("security definer") >= 5, f"{mig10_nc.count('security definer')} SECURITY DEFINER")
    check("0010: search_path terkunci",
          mig10_nc.count("search_path = public, pg_temp") >= 5)
    check("0010: GRANT EXECUTE hanya ke authenticated",
          bool(re.search(r"grant execute on function[\s\S]*to authenticated", mig10_nc, flags=re.I))
          and len(re.findall(r"grant execute on function", mig10_nc, flags=re.I)) == 5
          and not re.search(r"grant execute on function[^;]*to public", mig10_nc, flags=re.I),
          "5 grant execute ke authenticated; tidak ada grant execute ke public")
    check("0010: tidak ada tabel baru",
          not re.search(r"create\s+table", mig10_nc, flags=re.I))

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} pemeriksaan lolos.")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
