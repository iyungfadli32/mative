#!/usr/bin/env python3
"""Verifikasi statis supabase/tests/01_rls_phase1.sql (v2).

Memeriksa, tanpa database nyata:
  1. File ter-parse penuh oleh pglast (parser PostgreSQL asli).
  2. Jumlah asersi pgTAP == angka plan(N).
  3. Tidak ada lagi throws_ok 2 argumen (semua memakai kode SQLSTATE).
  4. Tidak ada lagi UUID palsu 1111.../2222... di pernyataan tes
     (hanya boleh di dua baris \\set sebagai placeholder psql).
  5. INSERT undangan T7 berada SEBELUM `set local role authenticated`
     pertama (dijalankan sebagai postgres, bukan authenticated B).
  6. Tidak ada placeholder :'user_a'/:'user_b' di dalam string $$...$$
     (interpolasi psql tidak terjadi di sana).
  7. Tidak ada UUID uji nyata yang di-hardcode di file SQL.

Jalankan:  python3 supabase/tests/rls_verify_test_v2.py
Keluar 0 bila semua pemeriksaan lolos.
"""
import re
import sys
from pathlib import Path

TEST_FILE = Path(__file__).resolve().parent / "01_rls_phase1.sql"
FAKE_A = "11111111-1111-1111-1111-111111111111"
FAKE_B = "22222222-2222-2222-2222-222222222222"
REAL_A = "094e8752-eef4-4f0e-b6ae-2d5813445018"
REAL_B = "aabb1dab-77c1-4659-af0e-c703c9de279c"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


def main():
    text = TEST_FILE.read_text()

    # 1. Parse pglast (buang baris psql \set; ganti placeholder dgn literal).
    try:
        import pglast
    except ImportError:
        check("pglast tersedia", False, "modul pglast tidak terpasang")
        return 1
    stripped_lines = [ln for ln in text.splitlines() if not ln.lstrip().startswith("\\set")]
    stripped = "\n".join(stripped_lines)
    stripped = stripped.replace(":'user_a'", f"'{REAL_A}'").replace(":'user_b'", f"'{REAL_B}'")
    try:
        stmts = pglast.parse_sql(stripped)
        check("pglast parse penuh", True, f"{len(stmts)} statement")
    except Exception as exc:  # noqa: BLE001
        check("pglast parse penuh", False, str(exc)[:300])
        return 1

    # 2. Jumlah asersi vs plan(N).
    plan_m = re.search(r"select\s+plan\((\d+)\)", text)
    plan_n = int(plan_m.group(1)) if plan_m else None
    assertion_res = [
        r"select\s+is_empty\s*\(",
        r"select\s+isnt_empty\s*\(",
        r"select\s+throws_ok\s*\(",
        r"select\s+is\s*\(",  # 'is(' saja; is_empty/isnt_empty tidak cocok karena '_' sesudah 'is'
    ]
    assertions = sum(len(re.findall(p, text)) for p in assertion_res)
    check("jumlah asersi == plan(N)", plan_n == assertions, f"plan({plan_n}) vs {assertions} asersi")

    # 3. Semua throws_ok memakai bentuk 3 argumen dengan kode SQLSTATE.
    throws_calls = re.findall(r"throws_ok\s*\(", text)
    throws_3arg = re.findall(
        r"throws_ok\s*\(.*?,\s*'(?:42501|23505)'\s*,", text, flags=re.DOTALL
    )
    check(
        "throws_ok 3 argumen + SQLSTATE",
        len(throws_calls) == len(throws_3arg) and len(throws_calls) > 0,
        f"{len(throws_3arg)}/{len(throws_calls)} throws_ok memakai '42501'/'23505'",
    )

    # 4. UUID palsu hanya di baris \set.
    bad_fake = []
    for i, line in enumerate(text.splitlines(), 1):
        if (FAKE_A in line or FAKE_B in line) and not line.lstrip().startswith("\\set"):
            bad_fake.append(i)
    check("UUID palsu hanya di \\set", not bad_fake, f"baris bermasalah: {bad_fake}" if bad_fake else "hanya 2 baris \\set")

    # 5. INSERT undangan T7 sebelum `set local role authenticated` pertama.
    inv_pos = text.find("insert into public.workspace_invitations")
    auth_pos = text.find("set local role authenticated")
    check(
        "INSERT undangan T7 di setup postgres",
        0 <= inv_pos < auth_pos,
        f"insert@{inv_pos} < set-local-authenticated@{auth_pos}",
    )

    # 6. Tidak ada placeholder di dalam string $$...$$ / $f$...$f$.
    # Periksa per blok $tag$...$tag$ secara eksplisit.
    blocks = []
    for tag in ("$$", "$f$"):
        for m in re.finditer(re.escape(tag) + r"(.*?)" + re.escape(tag), text, flags=re.DOTALL):
            blocks.append(m.group(1))
    bad_blocks = [b for b in blocks if ":'user_" in b]
    check(
        "tidak ada placeholder di dalam string dollar-quoted",
        not bad_blocks,
        f"{len(blocks)} blok diperiksa" + (f", {len(bad_blocks)} bermasalah" if bad_blocks else ""),
    )

    # 7. Tidak ada UUID uji nyata yang di-hardcode di file SQL.
    hard = [u for u in (REAL_A, REAL_B) if u in text]
    check("tidak ada UUID nyata di-hardcode", not hard, f"ditemukan: {hard}" if hard else "hanya placeholder")

    # Pemeriksaan tambahan: GRANT T9 ada dan berada di dalam transaksi (sebelum rollback).
    grant_pos = text.find("grant select on public.workspaces to anon;")
    rollback_pos = text.rfind("rollback;")
    check(
        "GRANT SELECT anon untuk T9 (di dalam transaksi)",
        0 <= grant_pos < rollback_pos,
        "grant sebelum rollback" if 0 <= grant_pos < rollback_pos else "tidak ditemukan",
    )
    # T3 memakai CTE UPDATE + asersi count; T4b memakai CTE DELETE + asersi count.
    check(
        "T3/T4b asersi jumlah baris (CTE)",
        "with upd as (" in text and "with del as (" in text,
        "CTE upd + del ada",
    )
    # finish() dan rollback di akhir.
    check(
        "finish() + rollback di akhir",
        "select * from finish();" in text and text.rstrip().endswith("rollback;"),
        "",
    )

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} PASS, {len(failed)} FAIL")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
