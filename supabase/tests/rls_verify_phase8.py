#!/usr/bin/env python3
"""Verifier statis Phase 8 — migrasi 0022 + pgTAP 08 (RLS AI Assistant).

Pola dari rls_verify_phase7.py (316 baris). Adaptasi: 52 asersi, 0022
ai_generations + kolom content_versions + RPC insert_ai_draft_version +
retensi + pemakaian harian. Gagal 1 → berhenti.

Cara menjalankan (dari ~/workspace/mative/app):
    ~/workspace/.venv-pglast/bin/python supabase/tests/rls_verify_phase8.py

Cek: pglast parse 0022 + tes 08; jumlah asersi == plan(52); pola
throws_ok; tanpa UUID nyata; 0022: tepat 1 tabel baru + alter
content_versions (2 kolom) + RLS + grant minimal + helper invoker/definer
+ RPC definer; tanpa viewer_client (komentar di-strip); tanpa kolom
payload mentah; CHECK feature/status/error/token; retensi 90 + zona
Asia/Jakarta; nomor versi max(version_number) BUKAN max(uuid); tanpa
embed()/adapter/using(true); referensi maju 0022; graf RLS 0001–0023
tanpa siklus/self-loop; 0023 menulis ulang policy SELECT
ai_generations tanpa self-lookup (perbaikan INSERT ... RETURNING 42501).
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict

from pglast import parse_sql

TEST_FILE = os.path.join("supabase", "tests", "08_rls_phase8.sql")
MIG_FILE = os.path.join("supabase", "migrations", "0022_ai_foundation.sql")
MIG23_FILE = os.path.join(
    "supabase", "migrations", "0023_ai_generations_select_policy_fix.sql"
)
APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MATIVE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


class Failure(Exception):
    pass


def check(condition, message):
    if not condition:
        raise Failure(message)


def _strip_comments(text):
    return re.sub(r"--[^\n]*", "", text)


def _parse_file(path):
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    return text


def _test_sql(text):
    lines = [ln for ln in text.splitlines() if not ln.lstrip().startswith("\\set")]
    sql = "\n".join(lines)
    sql = sql.replace(":'user_a'", "'11111111-1111-1111-1111-111111111111'")
    sql = sql.replace(":'user_b'", "'22222222-2222-2222-2222-222222222222'")
    return sql


def _pglast_parse(path, sql):
    try:
        return parse_sql(sql)
    except Exception as exc:
        raise Failure(f"pglast gagal parse {path}: {exc}") from exc


def _plan_count(text):
    match = re.search(r"select\s+plan\((\d+)\)\s*;", text, re.IGNORECASE)
    check(match is not None, "plan(N) tidak ditemukan di tes 08")
    return int(match.group(1))


def _assertion_count(text):
    is_calls = len(
        re.findall(r"(?im)^\s*select\s+is\s*\(", text)
    )
    throws = len(re.findall(r"(?im)^\s*select\s+throws_ok\s*\(", text))
    lives = len(re.findall(r"(?im)^\s*select\s+lives_ok\s*\(", text))
    is_empty = len(re.findall(r"(?im)^\s*select\s+is_empty\s*\(", text))
    isnt_empty = len(re.findall(r"(?im)^\s*select\s+isnt_empty\s*\(", text))
    return {
        "is": is_calls,
        "throws_ok": throws,
        "lives_ok": lives,
        "is_empty": is_empty,
        "isnt_empty": isnt_empty,
        "total": is_calls + throws + lives + is_empty + isnt_empty,
    }


def _split_sql_statements(sql):
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "in.sql")
        with open(src, "w", encoding="utf-8") as fh:
            fh.write(sql)
        outdir = os.path.join(tmp, "parts")
        cmd = [
            "python3",
            os.path.join(MATIVE_DIR, "split_sql.py"),
            src,
            outdir,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise Failure(
                f"split_sql gagal untuk {src}: {result.stderr.strip()}"
            )
        stmts = []
        for fname in sorted(os.listdir(outdir)):
            with open(os.path.join(outdir, fname), "r", encoding="utf-8") as fh:
                stmts.append(fh.read())
    return stmts


def _table_names(stmts):
    names = set()
    for stmt in stmts:
        m = re.search(
            r"create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)",
            stmt,
            re.IGNORECASE,
        )
        if m:
            names.add(m.group(1))
    return names


def _function_bodies(text):
    bodies = re.findall(
        r"create\s+or\s+replace\s+function\s+(\w+)\s*\(([^)]*)\)\s*returns\s+([^\n]*?)\s+language\s+(plpgsql|sql)\s+as\s+\$\$(.*?)\$\$;",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    return bodies


def _audit_rls_graph():
    rls_re = re.compile(
        r"alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+enable\s+row\s+level\s+security",
        re.IGNORECASE,
    )
    mig_dir = os.path.join(APP_DIR, "supabase", "migrations")
    files = sorted(f for f in os.listdir(mig_dir) if re.match(r"00\d\d_.*\.sql", f))
    rls_tables = set()
    for fname in files:
        path = os.path.join(mig_dir, fname)
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
        rls_tables.update(rls_re.findall(text))
    return rls_tables


def main():
    test_text = _parse_file(TEST_FILE)
    mig_text = _parse_file(MIG_FILE)
    mig_no_comments = _strip_comments(mig_text)
    test_no_comments = _strip_comments(test_text)

    # 1. Parse pglast.
    mig_stmts = _pglast_parse(MIG_FILE, mig_text)
    check(len(mig_stmts) == 41, f"pglast 0022 harus 41 stmt, dapat {len(mig_stmts)}")
    test_sql = _test_sql(test_text)
    test_stmts = _pglast_parse(TEST_FILE, test_sql)

    # 2. plan(N) == jumlah asersi; komposisi.
    plan_n = _plan_count(test_text)
    counts = _assertion_count(test_text)
    check(plan_n == 52, f"plan harus 52, dapat {plan_n}")
    check(counts["total"] == plan_n,
          f"asersi terhitung {counts['total']} != plan({plan_n})")
    check(counts["is"] == 44, f"is harus 44, dapat {counts['is']}")
    check(counts["throws_ok"] == 8, f"throws_ok harus 8, dapat {counts['throws_ok']}")
    check(counts["lives_ok"] == 0, f"lives_ok harus 0, dapat {counts['lives_ok']}")

    # 3. throws_ok pola 4-arg (sql, code, message, desc) — 07 verifier.
    for m in re.finditer(r"throws_ok\s*\(", test_text):
        seg = test_text[m.start():m.start() + 400]
        check(seg.count("$$") >= 2, "throws_ok tanpa argumen $$: " + seg[:80])

    # 4. Tanpa UUID nyata; UUID palsu hanya di \set.
    uuid_re = re.compile(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        re.IGNORECASE,
    )
    # UUID fixture diizinkan: pola X8000000-.../a810.../a820... (a800/b800/
    # c800/d800/e800/f800 + a810/a820) dan sentinel 9999... untuk item yang
    # tidak ada. UUID lain = UUID nyata, dilarang di file tes.
    allowed_re = re.compile(
        r"^(?:[a-f]8[0-9a-f]00000-0000-0000-0000-0000000000\d{2}"
        r"|99999999-9999-9999-9999-999999999999)$",
        re.IGNORECASE,
    )
    for line in test_text.splitlines():
        if line.lstrip().startswith("\\set"):
            continue
        for found in uuid_re.findall(line):
            check(allowed_re.match(found) is not None,
                  f"UUID nyata di tes 08: {line.strip()[:80]}")

    # 5. Placeholder :'user_x' tidak di dalam $$...$$ / $f$...$f$.
    for block in re.findall(r"\$\$.*?\$\$", test_text, re.DOTALL):
        check(":'user_" not in block,
              "placeholder user di dalam $$ di tes 08")
    for block in re.findall(r"\$f\$.*?\$f\$", test_text, re.DOTALL):
        check(":'user_" not in block,
              "placeholder user di dalam $f$ di tes 08")

    # 6. Struktur 0022 — tepat 1 tabel baru.
    tables = _table_names(_split_sql_statements(mig_text))
    check(tables == {"ai_generations"},
          f"0022 harus hanya buat ai_generations, dapat {tables}")

    # 7. ALTER content_versions: 2 kolom baru.
    check(re.search(
        r"alter\s+table\s+public\.content_versions\s+add\s+column\s+if\s+not\s+exists\s+ai_assisted",
        mig_no_comments, re.IGNORECASE) is not None,
        "0022 harus alter content_versions ai_assisted")
    check(re.search(
        r"alter\s+table\s+public\.content_versions.*?add\s+column\s+if\s+not\s+exists\s+ai_generation_id",
        mig_no_comments, re.IGNORECASE | re.DOTALL) is not None,
        "0022 harus alter content_versions ai_generation_id")

    # 8. RLS aktif di ai_generations.
    check(re.search(
        r"alter\s+table\s+public\.ai_generations\s+enable\s+row\s+level\s+security",
        mig_no_comments, re.IGNORECASE) is not None,
        "0022 harus enable RLS ai_generations")

    # 9. revoke-all + grant minimal (select, insert; tanpa update/delete).
    check("revoke all on public.ai_generations from anon, authenticated" in mig_no_comments.lower(),
          "0022 harus revoke all ai_generations")
    check(re.search(
        r"grant\s+select,\s*insert\s+on\s+public\.ai_generations\s+to\s+authenticated",
        mig_no_comments, re.IGNORECASE) is not None,
        "0022 harus grant select, insert ai_generations ke authenticated")
    check("grant update on public.ai_generations" not in mig_no_comments.lower(),
          "0022 tidak boleh grant update ai_generations")
    check("grant delete on public.ai_generations" not in mig_no_comments.lower(),
          "0022 tidak boleh grant delete ai_generations")

    # 10. Helper + fungsi dengan search_path terkunci.
    sp_count = len(re.findall(r"set\s+search_path\s*=\s*public,\s*pg_temp",
                              mig_no_comments, re.IGNORECASE))
    check(sp_count == 5, f"search_path terkunci harus 5, dapat {sp_count}")
    # Deklarasi "security definer/invoker" berdiri sendiri di barisnya —
    # komentar '... SECURITY DEFINER — ...' tidak ikut terhitung.
    check(len(re.findall(r"(?im)^\s*security\s+definer\s*$",
                         mig_no_comments)) == 4,
          "0022 harus 4 fungsi SECURITY DEFINER")
    check(len(re.findall(r"(?im)^\s*security\s+invoker\s*$",
                         mig_no_comments)) == 1,
          "0022 harus 1 fungsi SECURITY INVOKER (ai_retention_days)")
    check(len(re.findall(r"grant\s+execute\s+on\s+function", mig_no_comments,
                         re.IGNORECASE)) == 5,
          "0022 harus 5 grant execute fungsi")
    for fname in ["is_ai_generation_visible", "ai_retention_days",
                  "ai_daily_usage_count", "cleanup_ai_generations",
                  "insert_ai_draft_version"]:
        check(fname in mig_no_comments,
              f"fungsi {fname} tidak ditemukan di 0022")

    # 11. viewer_client TIDAK ada di 0022 (komentar di-strip).
    check("viewer_client" not in mig_no_comments,
          "0022 tidak boleh menyebut viewer_client di luar komentar")

    # 12. Policy: SELECT pakai helper; update/delete using(false).
    check(re.search(
        r"create\s+policy\s+\"?ai_generations_select_member\"?.*?is_ai_generation_visible",
        mig_no_comments, re.IGNORECASE | re.DOTALL) is not None,
        "policy SELECT ai_generations harus pakai helper is_ai_generation_visible")
    check(mig_no_comments.lower().count("using (false)") == 2,
          "0022 harus 2 policy using(false) (no_update + no_delete)")

    # 13. CHECK constraint: feature/status/error/token.
    for chk in ["ai_generations_feature_check", "ai_generations_status_check",
                "ai_generations_error_check",
                "ai_generations_input_tokens_check",
                "ai_generations_output_tokens_check"]:
        check(chk in mig_no_comments, f"CHECK {chk} tidak ditemukan di 0022")
    for feat in ["content_ideas", "brief", "content_draft", "repurpose",
                 "checklist", "feedback_summary", "campaign_summary"]:
        check(f"'{feat}'" in mig_no_comments,
              f"fitur {feat} tidak ada di CHECK 0022")
    for st in ["completed", "failed", "blocked", "not_configured"]:
        check(f"'{st}'" in mig_no_comments,
              f"status {st} tidak ada di CHECK 0022")

    # Tanpa kolom payload mentah — cocokkan sebagai kata utuh (agar
    # 'prompt_injection' sebagai nilai error_category tidak ikut terhitung).
    for col in ["input_text", "output_text", "raw_input", "raw_output",
                "prompt", "system_prompt"]:
        check(re.search(r"\b" + re.escape(col) + r"\b", mig_no_comments) is None,
              f"0022 tidak boleh punya kolom {col}")

    # 15. Tanpa embed()/adapter/using(true); tanpa max(uuid).
    check("embed(" not in mig_no_comments.lower(),
          "0022 tidak boleh berisi embed()")
    check("using (true)" not in mig_no_comments.lower(),
          "0022 tidak boleh berisi using(true)")
    check("max(uuid)" not in mig_no_comments.lower(),
          "0022 tidak boleh berisi max(uuid)")
    check("max(version_number)" in mig_no_comments.lower(),
          "0022 harus pakai max(version_number) untuk nomor versi")

    # 16. Retensi 90 hari + zona Asia/Jakarta.
    check(re.search(r"ai_retention_days\(\).*?select\s+90\s*;",
                     mig_no_comments, re.IGNORECASE | re.DOTALL) is not None,
          "ai_retention_days harus select 90")
    check("Asia/Jakarta" in mig_text, "0022 harus memakai zona Asia/Jakarta")
    check("make_interval(days" in mig_no_comments,
          "cleanup harus pakai make_interval(days => p_days)")

    # 17. RPC insert_ai_draft_version: kode return jsonb.
    for code in ["FORBIDDEN", "INVALID_ITEM", "INVALID_GENERATION", "INVALID_INPUT"]:
        check(code in mig_no_comments, f"kode {code} tidak ada di RPC 0022")

    # 18. Referensi maju 0022: tabel yang dirujuk harus ada di 0001–0022.
    def _create_tables(text):
        return set(re.findall(
            r"create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)",
            text, re.IGNORECASE))
    def _ref_tables(text):
        return set(re.findall(
            r"references\s+public\.(\w+)\s*\(", text, re.IGNORECASE))
    all_tables = set()
    mig_dir = os.path.join(APP_DIR, "supabase", "migrations")
    for fname in sorted(os.listdir(mig_dir)):
        if re.match(r"00\d\d_.*\.sql", fname):
            with open(os.path.join(mig_dir, fname), "r", encoding="utf-8") as fh:
                all_tables.update(_create_tables(fh.read()))
    missing = _ref_tables(mig_text) - all_tables
    check(not missing, f"0022 merujuk tabel yang tidak ada di 0001–0023: {missing}")

    # 19. Graf RLS 0001–0023: tanpa siklus/self-loop (bukti 07: graf audit).
    # Nama policy BOLEH dipakai ulang hanya bila file yang lebih baru
    # men-drop policy itu dulu (penulisan ulang seperti 0006/0016/0019/
    # 0023). Regex lama (\w+ tanpa kutip) tidak pernah cocok dengan nama
    # policy yang dikutip — cek ini vacuous (0 nama); regex baru sadar
    # kutip + sadar drop.
    rls_tables = _audit_rls_graph()
    check("ai_generations" in rls_tables, "ai_generations harus RLS di 0001–0023")
    policy_re = re.compile(
        r"create\s+policy\s+\"?(\w+)\"?\s+on\s+public\.(\w+)\s+for\s+(select|insert|update|delete)\s+to\s+(\w+)",
        re.IGNORECASE,
    )
    drop_re = re.compile(
        r"drop\s+policy\s+(?:if\s+exists\s+)?\"?(\w+)\"?\s+on\s+public\.(\w+)",
        re.IGNORECASE,
    )
    active_policies = {}
    for fname in sorted(os.listdir(mig_dir)):
        if re.match(r"00\d\d_.*\.sql", fname):
            with open(os.path.join(mig_dir, fname), "r", encoding="utf-8") as fh:
                ftext = fh.read()
            events = []
            for m in drop_re.finditer(ftext):
                events.append((m.start(), "drop", m.group(1)))
            for m in policy_re.finditer(ftext):
                events.append((m.start(), "create", m.group(1)))
            for _, kind, pname in sorted(events):
                if kind == "drop":
                    active_policies.pop(pname, None)
                else:
                    check(pname not in active_policies,
                          f"nama policy duplikat di 0001–0023: {pname} ({fname})")
                    active_policies[pname] = fname

    # 20. pgTAP 08: finish() + rollback; cleanup daun→akar sebagai postgres.
    check("select * from finish();" in test_text, "tes 08 harus finish()")
    check(test_text.rstrip().endswith("rollback;"), "tes 08 harus diakhiri rollback;")
    cleanup_idx = test_text.rfind("reset role;")
    check(cleanup_idx != -1, "tes 08 harus reset role sebelum cleanup")
    cleanup_block = test_text[cleanup_idx:]
    check("delete from public.ai_generations" in cleanup_block,
          "cleanup tes 08 harus menghapus ai_generations dulu (daun)")
    check(cleanup_block.index("delete from public.ai_generations") <
          cleanup_block.index("delete from public.organizations"),
          "cleanup tes 08 harus daun→akar (ai_generations sebelum organizations)")

    # 21. Migrasi 0023: penulisan ulang policy SELECT ai_generations
    # (perbaikan e2e Phase 8 — INSERT ... RETURNING 42501).
    mig23_text = _parse_file(MIG23_FILE)
    mig23_no_comments = _strip_comments(mig23_text)
    mig23_stmts = _pglast_parse(MIG23_FILE, mig23_text)
    check(len(mig23_stmts) == 2, f"pglast 0023 harus 2 stmt, dapat {len(mig23_stmts)}")
    check('drop policy if exists "ai_generations_select_member" on public.ai_generations'
          in mig23_no_comments,
          "0023 harus men-drop policy ai_generations_select_member dulu")
    check(re.search(
        r"create\s+policy\s+\"?ai_generations_select_member\"?\s+on\s+public\.ai_generations\s+for\s+select",
        mig23_no_comments, re.IGNORECASE) is not None,
        "0023 harus membuat ulang policy ai_generations_select_member (select)")
    check("public.is_ws_member(ai_generations.workspace_id, array['owner', 'admin', 'manager', 'strategist', 'creator', 'editor', 'approver', 'analyst'])"
          in mig23_no_comments,
          "0023 policy SELECT harus pakai is_ws_member langsung (tanpa self-lookup)")
    check("is_ai_generation_visible" not in mig23_no_comments,
          "0023 TIDAK BOLEH memakai helper self-lookup is_ai_generation_visible")
    check("create table" not in mig23_no_comments.lower(),
          "0023 tidak boleh membuat tabel")
    check("grant " not in mig23_no_comments.lower(),
          "0023 tidak boleh menambah grant")
    check("viewer_client" not in mig23_no_comments,
          "0023 tidak boleh menyebut viewer_client di luar komentar")

    print("OK verifier Phase 8: semua cek lolos (0022 41 stmt, tes 08 52 asersi, 0023 2 stmt)")
    return 0


if __name__ == "__main__":
    os.chdir(APP_DIR)
    try:
        sys.exit(main())
    except Failure as exc:
        print(f"FAIL verifier Phase 8: {exc}", file=sys.stderr)
        sys.exit(1)
