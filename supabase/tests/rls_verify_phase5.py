#!/usr/bin/env python3
"""Verifikasi statis MaTive Phase 5 (P5-01 s.d. P5-03) — tanpa database nyata.

Memeriksa:
  1. Migrasi 0016 + 0017 + tes 05 ter-parse penuh oleh pglast (parser PostgreSQL asli).
  2. Jumlah asersi pgTAP di 05 == angka plan(N).
  3. throws_ok di 05 memakai bentuk 4 argumen (sql, kode SQLSTATE,
     pola = pesan lengkap, deskripsi); argumen pertama boleh $$...$$ atau
     format($f$...$f$, :'user_x') (pola T14 — placeholder di luar blok $f$).
  4. Tidak ada UUID pengguna uji nyata yang di-hardcode di 05; UUID palsu
     1111.../2222... hanya di baris \\set; tidak ada placeholder :'user_a' /
     :'user_b' di dalam string $$...$$ / $f$...$f$.
  5. 0016: CHECK brand_scope (NULL atau array) + helper brand_in_scope
     (SECURITY DEFINER, search_path terkunci, grant hanya authenticated) +
     15 policy ditulis ulang + cabang shared TIDAK di-scope + tanpa tabel baru.
  6. 0017: tepat 5 tabel Phase 5 + RLS aktif kelimanya + visual_orders
     revoke-all + grant select saja + RPC set_visual_order (SECURITY DEFINER,
     search_path terkunci, grant hanya authenticated; BADANNYA tidak pernah
     menyentuh scheduled_at / content_placements — R5.1) + 5 trigger scope +
     2 helper template-member + unik ganda visual_orders.
  7. Tidak ada forward-reference: setiap tabel yang dirujuk policy/helper/
     trigger di 0016/0017 sudah dibuat di 0001–0017; setiap helper yang
     dipanggil policy didefinisikan di 0006/0007/0009/0016/0017; tidak ada
     policy yang memindai tabel lain (FROM/JOIN).
  8. Graf RLS EFEKTIF 0001–0017 (definisi terakhir per nama policy; 0006
     menulis ulang 0001–0005; 0016 menulis ulang policy 0007/0009): 0 siklus,
     0 self-loop.
  9. File 0001–0015 TIDAK diubah (diperiksa lewat git di luar skrip ini).

Jalankan:  python3 supabase/tests/rls_verify_phase5.py
Keluar 0 bila semua pemeriksaan lolos.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rls_audit import POLICY_RE, find_cycles  # noqa: E402

APP_ROOT = Path(__file__).resolve().parent.parent.parent
MIG16 = APP_ROOT / "supabase" / "migrations" / "0016_brand_scope.sql"
MIG17 = APP_ROOT / "supabase" / "migrations" / "0017_visual_planner_templates.sql"
TEST_FILE = Path(__file__).resolve().parent / "05_rls_phase5.sql"
FAKE_A = "11111111-1111-1111-1111-111111111111"
FAKE_B = "22222222-2222-2222-2222-222222222222"
# UUID pengguna uji nyata yang dipakai file 01 (DILARANG di file 05).
REAL_A = "094e8752-eef4-4f0e-b6ae-2d5813445018"
REAL_B = "aabb1dab-77c1-4659-af0e-c703c9de279c"

ALLOWED_TABLES_17 = {
    "visual_orders",
    "campaign_templates",
    "campaign_template_brands",
    "content_templates",
    "content_template_placements",
}

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
    mig16 = MIG16.read_text()
    mig17 = MIG17.read_text()
    test = TEST_FILE.read_text()

    # 1. Parse pglast.
    try:
        import pglast
    except ImportError:
        check("pglast tersedia", False, "modul pglast tidak terpasang")
        return 1
    for label, sql in (("0016", mig16), ("0017", mig17)):
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
        check("pglast parse tes 05 penuh", True, f"{len(stmts)} statement")
    except Exception as exc:  # noqa: BLE001
        check("pglast parse tes 05 penuh", False, str(exc)[:300])
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

    # 3. throws_ok 4 argumen (sql $$...$$ ATAU format($f$...$f$, ...), 'SQLSTATE', 'pesan', 'deskripsi').
    throws_calls = re.findall(r"throws_ok\s*\(", test)
    throws_4arg = re.findall(
        r"throws_ok\s*\(\s*(?:\$\$.*?\$|format\(\$f\$.*?\$f\$[^)]*\))\s*,\s*'(?:42501|23505|23514|P0001)'\s*,\s*'[^']+'\s*,\s*'[^']+'\s*\)",
        test, flags=re.DOTALL,
    )
    check(
        "throws_ok 4 argumen + SQLSTATE",
        len(throws_calls) == len(throws_4arg) and len(throws_calls) > 0,
        f"{len(throws_4arg)}/{len(throws_calls)} throws_ok bentuk 4 argumen",
    )

    # 4. UUID: tidak ada UUID nyata; palsu hanya di \\set; tidak ada placeholder di $$/$f$.
    check("tidak ada UUID uji nyata di 05", REAL_A not in test and REAL_B not in test)
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

    mig16_nc = strip_comments(mig16)
    mig17_nc = strip_comments(mig17)

    # 5. Scope 0016.
    check("0016: CHECK brand_scope (NULL atau array)",
          "check (brand_scope is null or jsonb_typeof(brand_scope) = 'array')" in mig16_nc)
    check("0016: helper brand_in_scope ada (SECURITY DEFINER, search_path terkunci)",
          "create or replace function public.brand_in_scope(p_brand_id uuid)" in mig16_nc
          and mig16_nc.count("security definer") >= 5
          and mig16_nc.count("search_path = public, pg_temp") >= 5)
    check("0016: brand_in_scope di-grant hanya ke authenticated",
          "grant execute on function public.brand_in_scope(uuid) to authenticated" in mig16_nc
          and "grant execute on function public.brand_in_scope(uuid) to public" not in mig16_nc)
    check("0016: 15 policy ditulis ulang",
          mig16_nc.count("drop policy if exists") == 15,
          f"{mig16_nc.count('drop policy if exists')} drop policy")
    check("0016: cabang shared TIDAK di-scope",
          "is_resource_shared_with_me('content_item', content_items.id)" in mig16_nc
          and "is_resource_shared_with_me('campaign', campaign_brands.campaign_id)" in mig16_nc)
    check("0016: tanpa tabel baru",
          not re.search(r"create\s+table", mig16_nc, flags=re.I))
    check("0016: tanpa pelonggaran (tidak ada using(true))",
          not re.search(r"using\s*\(\s*true\s*\)", mig16_nc, flags=re.I))

    # 6. Scope 0017.
    created17 = set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", mig17_nc, flags=re.I))
    check("0017 membuat tepat 5 tabel Phase 5", created17 == ALLOWED_TABLES_17,
          f"{len(created17)} tabel; selisih: {sorted(created17 ^ ALLOWED_TABLES_17) or 'tidak ada'}")
    rls17 = set(re.findall(r"alter\s+table\s+public\.(\w+)\s+enable\s+row\s+level\s+security", mig17_nc, flags=re.I))
    check("RLS aktif untuk ke-5 tabel 0017", rls17 == ALLOWED_TABLES_17,
          f"kurang: {sorted(ALLOWED_TABLES_17 - rls17)}")
    check("0017: visual_orders revoke-all + grant select saja",
          "revoke all on public.visual_orders from anon, authenticated" in mig17_nc
          and "grant select on public.visual_orders to authenticated" in mig17_nc
          and not re.search(r"grant\s+(insert|update|delete)\s+on\s+public\.visual_orders", mig17_nc, flags=re.I))
    check("0017: 5 trigger scope ada",
          all(fn in mig17_nc for fn in [
              "validate_visual_order_scope",
              "validate_campaign_template_scope",
              "validate_campaign_template_brand_scope",
              "validate_content_template_scope",
              "validate_content_template_placement_scope",
          ]))
    check("0017: helper template-member ada",
          "is_campaign_template_member(p_template_id uuid" in mig17_nc
          and "is_content_template_member(p_template_id uuid" in mig17_nc)
    check("0017: unik ganda visual_orders",
          "unique (workspace_id, brand_id, social_channel_id, placement_id)" in mig17_nc
          and "unique (workspace_id, brand_id, social_channel_id, position)" in mig17_nc)
    fn_body_m = re.search(
        r"create or replace function public\.set_visual_order\([\s\S]*?^end;\n\$\$;",
        mig17_nc, flags=re.M,
    )
    fn_body = fn_body_m.group(0) if fn_body_m else ""
    check("0017: RPC set_visual_order ada (SECURITY DEFINER, search_path terkunci)",
          "create or replace function public.set_visual_order(" in mig17_nc
          and "security definer" in mig17_nc
          and "grant execute on function public.set_visual_order(uuid, uuid, uuid, uuid[]) to authenticated" in mig17_nc)
    check("0017: badan RPC TIDAK menyentuh scheduled_at (R5.1)",
          bool(fn_body) and "scheduled_at" not in fn_body,
          "badan RPC tidak ditemukan" if not fn_body else "0 kemunculan scheduled_at di badan RPC")
    check("0017: badan RPC TIDAK menulis content_placements",
          bool(fn_body)
          and not re.search(r"update\s+public\.content_placements", fn_body, flags=re.I)
          and not re.search(r"insert\s+into\s+public\.content_placements", fn_body, flags=re.I))
    check("0017: RPC mencatat jejak audit ke activity_logs",
          "activity_logs" in fn_body)

    # 7. Forward-reference 0016/0017.
    earlier = set()
    helper_defs = set()
    for f in sorted((APP_ROOT / "supabase" / "migrations").glob("00*.sql")):
        txt = strip_comments(f.read_text())
        earlier |= set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", txt, flags=re.I))
        helper_defs |= set(re.findall(r"function\s+public\.(\w+)\s*\(", txt))
    for label, mig_nc in (("0016", mig16_nc), ("0017", mig17_nc)):
        policy_bodies = re.findall(
            r"create\s+policy\s+\"[^\"]+\"\s+on\s+public\.(\w+)\s+for\s+\w+\s+to\s+\w+\s*(.*?)(?=;\s*(?:create|drop|alter|revoke|grant|comment|create\s+or|drop\s+trigger|create\s+trigger|insert|select|$))",
            mig_nc, flags=re.I | re.S)
        referenced = set()
        for _tbl, body in policy_bodies:
            referenced |= set(re.findall(r"public\.(\w+)", body))
        table_refs = {r for r in referenced if r not in helper_defs}
        policy_tables = {t for t, _b in policy_bodies}
        table_refs -= policy_tables
        check(f"policy {label}: tidak merujuk tabel yang belum dibuat",
              table_refs <= earlier,
              f"belum dibuat: {sorted(table_refs - earlier)}" if table_refs - earlier else f"{len(policy_bodies)} policy")
        called_helpers = set()
        for _tbl, body in policy_bodies:
            called_helpers |= set(re.findall(r"public\.(\w+)\s*\(", body))
        check(f"policy {label}: helper yang dipanggil terdefinisi",
              called_helpers <= helper_defs,
              f"tak terdefinisi: {sorted(called_helpers - helper_defs)}" if called_helpers - helper_defs else f"dipanggil: {sorted(called_helpers)}")
        scans = set()
        for _tbl, body in policy_bodies:
            scans |= set(re.findall(r"\b(?:from|join)\s+public\.(\w+)\b", body, flags=re.I))
        check(f"policy {label}: 0 pemindaian tabel (FROM/JOIN)", not scans, f"scan: {sorted(scans)}")

    # 8. Graf RLS EFEKTIF 0001–0017: definisi terakhir per nama policy.
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
    check("graf RLS efektif 0001–0017: 0 siklus",
          not cycles, f"siklus: {cycles}" if cycles else f"{len(effective)} policy efektif, {len(edges)} tabel")
    check("graf RLS efektif 0001–0017: 0 self-loop",
          not self_loops, f"self-loop: {self_loops}" if self_loops else "")

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} pemeriksaan lolos.")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
