#!/usr/bin/env python3
"""Verifikasi statis MaTive Phase 4 (P4-01 s.d. P4-03) — tanpa database nyata.

Memeriksa:
  1. Migrasi 0013 + 0014 + tes 04 ter-parse penuh oleh pglast (parser PostgreSQL asli).
  2. Jumlah asersi pgTAP di 04 == angka plan(N).
  3. throws_ok di 04 memakai bentuk 4 argumen (sql, kode SQLSTATE,
     pola = pesan lengkap, deskripsi).
  4. Tidak ada UUID pengguna uji nyata yang di-hardcode di 04; UUID palsu
     1111.../2222... hanya di baris \\set; tidak ada placeholder :'user_a' /
     :'user_b' di dalam string $$...$$ / $f$...$f$.
  5. 0013 hanya membuat 4 tabel Phase 4 (tidak ada tabel fase lain) dan
     memuat kolom wajib (Dok 05 §3 + ADR-0010).
  6. Tidak ada forward-reference: setiap tabel yang dirujuk policy/helper/
     trigger di 0013 sudah dibuat di 0001–0013; setiap helper yang dipanggil
     policy didefinisikan di 0006/0007/0009/0013; tidak ada policy yang
     memindai tabel lain (FROM/JOIN).
  7. CHECK penegas fase ini ada: status request 6 nilai (Keputusan #8),
     decision 3 nilai, komentar wajib untuk non-approval, satu request
     aktif per (target, versi), satu workflow default per workspace,
     unique (request, step, approver), XOR assignee step, required_count
     >= 1, no-write requests/decisions di GRANT + policy, trigger
     append-only UPDATE-only (bukan DELETE — pelajaran P0001 Phase 3).
  8. Graf RLS EFEKTIF 0001–0014 (definisi terakhir per nama policy; 0006
     menulis ulang 0001–0005; 0014 tidak mengubah policy): 0 siklus,
     0 self-loop. Catatan jujur: audit mentah semua file (tanpa
     deduplikasi) masih menampilkan 4 siklus LAMA dari teks 0001–0005
     yang sudah digantikan 0006 — itu teks yang sudah tidak berlaku,
     bukan keadaan efektif.
  9. 0014 berisi 7 fungsi transaksional/helper Phase 4 (SECURITY DEFINER,
     search_path terkunci; 6 RPC publik di-grant EXECUTE ke authenticated,
     2 helper internal — approval_critical_fields + flag_request_reapproval
     — TIDAK di-grant karena dibaca/dipanggil tanpa pemeriksaan keanggotaan)
     + guard bypass (APPROVAL_REQUIRED) di transition_content_item_status
     + 5 trigger critical-change (reapproval_required) + wrapper client
     review + create_client_comment; tanpa tabel/policy baru; tanpa
     pelonggaran RLS.
  10. File 0001–0012 TIDAK diubah (diperiksa lewat git di luar skrip ini).

Jalankan:  python3 supabase/tests/rls_verify_phase4.py
Keluar 0 bila semua pemeriksaan lolos.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rls_audit import POLICY_RE, find_cycles  # noqa: E402

APP_ROOT = Path(__file__).resolve().parent.parent.parent
MIG13 = APP_ROOT / "supabase" / "migrations" / "0013_approval_core.sql"
MIG14 = APP_ROOT / "supabase" / "migrations" / "0014_approval_transactions.sql"
TEST_FILE = Path(__file__).resolve().parent / "04_rls_phase4.sql"
FAKE_A = "11111111-1111-1111-1111-111111111111"
FAKE_B = "22222222-2222-2222-2222-222222222222"
# UUID pengguna uji nyata yang dipakai file 01 (DILARANG di file 04).
REAL_A = "094e8752-eef4-4f0e-b6ae-2d5813445018"
REAL_B = "aabb1dab-77c1-4659-af0e-c703c9de279c"

ALLOWED_TABLES = {
    "approval_workflows", "approval_steps", "approval_requests",
    "approval_decisions",
}
FORBIDDEN_TABLES = {
    "publishing_jobs", "publishing_attempts", "published_posts",
    "metric_definitions", "analytics_snapshots", "content_metrics",
    "integration_events", "ai_generations", "channel_credentials",
}
REQUIRED_REQUEST_COLS = [
    "workspace_id", "target_type", "target_id", "content_version_id",
    "placement_version_id", "workflow_id", "request_type", "status",
    "submitted_by", "submitted_at", "completed_at", "current_step_order",
]
REQUIRED_DECISION_COLS = [
    "approval_request_id", "step_id", "approver_user_id", "decision",
    "comment",
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
    mig13 = MIG13.read_text()
    mig14 = MIG14.read_text()
    test = TEST_FILE.read_text()

    # 1. Parse pglast.
    try:
        import pglast
    except ImportError:
        check("pglast tersedia", False, "modul pglast tidak terpasang")
        return 1
    for label, sql in (("0013", mig13), ("0014", mig14)):
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
        check("pglast parse tes 04 penuh", True, f"{len(stmts)} statement")
    except Exception as exc:  # noqa: BLE001
        check("pglast parse tes 04 penuh", False, str(exc)[:300])
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
    check(
        "throws_ok 4 argumen + SQLSTATE",
        len(throws_calls) == len(throws_4arg) and len(throws_calls) > 0,
        f"{len(throws_4arg)}/{len(throws_calls)} throws_ok bentuk 4 argumen",
    )

    # 4. UUID: tidak ada UUID nyata; palsu hanya di \set; tidak ada placeholder di $$.
    check("tidak ada UUID uji nyata di 04", REAL_A not in test and REAL_B not in test)
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

    # 5. Scope tabel 0013.
    mig13_nc = strip_comments(mig13)
    created = set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", mig13_nc, flags=re.I))
    check("0013 membuat tepat 4 tabel Phase 4", created == ALLOWED_TABLES,
          f"{len(created)} tabel; selisih: {sorted(created ^ ALLOWED_TABLES) or 'tidak ada'}")
    forbidden_found = sorted(FORBIDDEN_TABLES & created)
    check("tidak ada tabel fase lain di 0013", not forbidden_found, str(forbidden_found))

    def table_block(table):
        m = re.search(r"create\s+table\s+if\s+not\s+exists\s+public\." + table + r"\s*\((.*?)\n\);",
                      mig13_nc, flags=re.I | re.S)
        return m.group(1) if m else ""
    for table, cols in (
        ("approval_requests", REQUIRED_REQUEST_COLS),
        ("approval_decisions", REQUIRED_DECISION_COLS),
    ):
        block = table_block(table)
        missing = [c for c in cols if not re.search(rf"\b{c}\b", block)]
        check(f"kolom {table} lengkap (Dok 05 §3 + ADR-0010)", not missing, f"hilang: {missing}")
    rls_tables = set(re.findall(r"alter\s+table\s+public\.(\w+)\s+enable\s+row\s+level\s+security", mig13_nc, flags=re.I))
    check("RLS aktif untuk ke-4 tabel", rls_tables == ALLOWED_TABLES,
          f"kurang: {sorted(ALLOWED_TABLES - rls_tables)}")

    # 6. Forward-reference: tabel/helper yang dirujuk 0013 sudah ada.
    earlier = set()
    helper_defs = set()
    for f in sorted((APP_ROOT / "supabase" / "migrations").glob("00*.sql")):
        txt = strip_comments(f.read_text())
        earlier |= set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", txt, flags=re.I))
        helper_defs |= set(re.findall(r"function\s+public\.(\w+)\s*\(", txt))
    policy_bodies = re.findall(
        r"create\s+policy\s+\"[^\"]+\"\s+on\s+public\.(\w+)\s+for\s+\w+\s+to\s+\w+\s*(.*?)(?=;\s*(?:create|drop|alter|revoke|grant|comment|create\s+or|drop\s+trigger|create\s+trigger|insert|select|$))",
        mig13_nc, flags=re.I | re.S)
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
    check("helper yang dipanggil policy terdefinisi (0006/0007/0009/0013)",
          called_helpers <= helper_defs,
          f"dipanggil: {sorted(called_helpers)}; tak terdefinisi: {sorted(called_helpers - helper_defs)}")
    scans = set()
    for _tbl, body in policy_bodies:
        scans |= set(re.findall(r"\b(?:from|join)\s+public\.(\w+)\b", body, flags=re.I))
    check("policy 0013: 0 pemindaian tabel (FROM/JOIN)", not scans, f"scan: {sorted(scans)}")
    check("jumlah policy tabel 0013", len(policy_bodies) == 16, f"{len(policy_bodies)} policy (4+4+4+4)")
    all_refs = set(re.findall(r"public\.(\w+)", mig13_nc))
    unknown = all_refs - earlier - helper_defs
    check("semua rujukan public.* di 0013 dikenal", not unknown, f"tak dikenal: {sorted(unknown)}")

    # 7. CHECK penegas fase ini (mig13_flat: whitespace dinormalisasi agar
    # CHECK multi-baris tetap tercocokkan).
    mig13_flat = re.sub(r"\s+", " ", mig13_nc)
    check("CHECK status request 6 nilai (Keputusan #8)",
          "check (status in ( 'submitted', 'in_review', 'approved', 'changes_requested', 'rejected', 'reapproval_required' ))" in mig13_flat)
    check("CHECK decision 3 nilai",
          "check (decision in ('approved', 'changes_requested', 'rejected'))" in mig13_nc)
    check("CHECK komentar wajib untuk non-approval",
          "check (decision = 'approved' or (comment is not null and btrim(comment) <> ''))" in mig13_nc)
    check("indeks satu request aktif per (target, versi)",
          "idx_approval_requests_one_active" in mig13_nc
          and "where status in ('submitted', 'in_review', 'reapproval_required')" in mig13_nc)
    check("indeks satu workflow default per workspace",
          "idx_approval_workflows_one_default" in mig13_nc and "where is_default" in mig13_nc)
    check("unique (request, step, approver) keputusan",
          "unique (approval_request_id, step_id, approver_user_id)" in mig13_nc)
    check("CHECK assignee step: minimal satu terisi (OR, amandemen ADR-0010)",
          "check (assignee_role is not null or assignee_user_id is not null)" in mig13_nc)
    check("CHECK required_count >= 1 (kuorum)",
          "check (required_count >= 1)" in mig13_nc)
    check("no-write requests/decisions di GRANT",
          mig13_nc.count("revoke all on public.approval_requests from anon, authenticated") == 1
          and mig13_nc.count("revoke all on public.approval_decisions from anon, authenticated") == 1
          and mig13_nc.count("grant select on public.approval_requests to authenticated") == 1
          and mig13_nc.count("grant select on public.approval_decisions to authenticated") == 1)
    check("no-write requests/decisions di policy",
          mig13_nc.count("for insert to authenticated with check (false)") >= 2
          and mig13_nc.count("for update to authenticated using (false)") >= 2
          and mig13_nc.count("for delete to authenticated using (false)") >= 2)
    check("trigger append-only UPDATE-only (tanpa trigger DELETE)",
          "create trigger trg_prevent_approval_decision_update" in mig13_nc
          and "before update on public.approval_decisions" in mig13_nc
          and "on public.approval_decisions" in mig13_nc
          and not re.search(r"create\s+trigger\s+\w+\s+before\s+delete\s+on\s+public\.approval_decisions", mig13_nc, flags=re.I))
    policy_only = " ".join(body for _t, body in policy_bodies)
    check("policy tidak memanggil is_approval_request_approver",
          "is_approval_request_approver" not in policy_only)
    check("CHECK notifications type diperluas 3 jenis approval",
          "check (type in ( 'mention', 'task_assigned', 'task_status_change', 'comment_reply', 'approval_requested', 'approval_decided', 'approval_reapproval_required' ))" in mig13_flat)

    # 8. Graf RLS EFEKTIF 0001–0014: definisi terakhir per nama policy.
    effective = {}  # nama policy -> (tabel, scans)
    for f in sorted((APP_ROOT / "supabase" / "migrations").glob("00*.sql")):
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
    check("graf RLS efektif 0001–0014: 0 siklus",
          not cycles, f"siklus: {cycles}" if cycles else f"{len(effective)} policy efektif, {len(edges)} tabel")
    check("graf RLS efektif 0001–0014: 0 self-loop",
          not self_loops, f"self-loop: {self_loops}" if self_loops else "")

    # 9. RPC 0014.
    mig14_nc = strip_comments(mig14)
    for fn in [
        "get_or_create_default_workflow",
        "create_approval_request",
        "decide_approval_request",
        "submit_content_for_client_review",
        "create_client_comment",
        "flag_request_reapproval",
        "transition_content_item_status",
    ]:
        check(f"0014 berisi fungsi {fn}", fn in mig14_nc)
    check("0014: semua RPC SECURITY DEFINER",
          mig14_nc.count("security definer") >= 7, f"{mig14_nc.count('security definer')} SECURITY DEFINER")
    check("0014: search_path terkunci",
          mig14_nc.count("search_path = public, pg_temp") >= 7)
    check("0014: GRANT EXECUTE hanya ke authenticated (6 RPC publik)",
          len(re.findall(r"grant execute on function", mig14_nc, flags=re.I)) == 6
          and not re.search(r"grant execute on function[^;]*to public", mig14_nc, flags=re.I),
          "6 grant execute; tidak ada grant execute ke public")
    check("0014: helper internal TIDAK di-grant (approval_critical_fields, flag_request_reapproval)",
          "grant execute on function public.approval_critical_fields" not in mig14_nc
          and "grant execute on function public.flag_request_reapproval" not in mig14_nc
          and "revoke all on function public.approval_critical_fields(uuid) from public" in mig14_nc
          and "revoke all on function public.flag_request_reapproval(uuid, text) from public" in mig14_nc)
    check("0014: guard bypass APPROVAL_REQUIRED ada",
          "APPROVAL_REQUIRED" in mig14_nc
          and "Konten ini belum disetujui. Minta persetujuan dulu di Approval Center" in mig14_nc)
    check("0014: 5 trigger critical-change ada",
          mig14_nc.count("flag_request_reapproval") >= 5
          and "check_critical_change_on_version" in mig14_nc
          and "check_critical_change_on_placement_version" in mig14_nc
          and "check_critical_change_on_asset_link" in mig14_nc
          and "check_critical_change_on_placement" in mig14_nc)
    check("0014: daftar field kritis default ADR-0010",
          "array['script', 'caption', 'cta', 'asset', 'channel', 'format', 'scheduled_time']" in mig14_nc)
    check("0014: tidak ada tabel baru",
          not re.search(r"create\s+table", mig14_nc, flags=re.I))
    check("0014: tidak ada policy baru/diubah",
          not re.search(r"create\s+policy|drop\s+policy", mig14_nc, flags=re.I))
    check("0014: tidak melonggarkan RLS lama",
          "disable row level security" not in mig14_nc.lower())
    check("0014: komentar klien tidak jadi keputusan (bukan approval_decisions)",
          "create_client_comment" in mig14_nc
          and "insert into public.comments" in mig14_nc)

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} pemeriksaan lolos.")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
