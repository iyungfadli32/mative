#!/usr/bin/env python3
"""Verifikasi statis MaTive Phase 6 (P6-01 s.d. P6-09) — tanpa database nyata.

Memeriksa:
  1. Migrasi 0020 v1.1 + tes 06 ter-parse penuh oleh pglast.
  2. Jumlah asersi pgTAP di 06 == angka plan(N).
  3. throws_ok di 06 memakai bentuk 4 argumen (sql, kode SQLSTATE,
     pola = pesan lengkap, deskripsi); argumen pertama boleh $$...$$ atau
     format($f$...$f$, :'user_x') (pola T14 — placeholder di luar blok $f$).
  4. Tidak ada UUID pengguna uji nyata yang di-hardcode di 06; UUID palsu
     1111.../2222... hanya di baris \\\\set; tidak ada placeholder :'user_a' /
     :'user_b' di dalam string $$...$$ / $f$...$f$.
  5. 0020: tepat 3 tabel Phase 6 + RLS aktif ketiganya + revoke-all +
     grant select saja + 7 RPC + backoff (SECURITY DEFINER, search_path
     terkunci, grant hanya authenticated) + helper visibilitas (scope
     pola 0016; helper lama is_publishing_job_member TIDAK ADA) + policy
     SELECT memakai helper visibilitas + policy tulis = false + indeks
     partial idempotency + CHECK provider null / status / sumber manual /
     remote_post_id null + TIDAK ADA fungsi adapter provider.
  6. Tidak ada forward-reference: setiap tabel yang dirujuk policy/helper
     di 0020 sudah dibuat di 0001–0020; setiap helper yang dipanggil
     policy didefinisikan di 0001–0020; tidak ada policy yang memindai
     tabel lain (FROM/JOIN).
  7. Graf RLS EFEKTIF 0001–0020 (definisi terakhir per nama policy): 0
     siklus, 0 self-loop.
  8. File 0001–0019 TIDAK diubah (diperiksa lewat git di luar skrip ini).

Jalankan:  python3 supabase/tests/rls_verify_phase6.py
Keluar 0 bila semua pemeriksaan lolos.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rls_audit import POLICY_RE, find_cycles  # noqa: E402

APP_ROOT = Path(__file__).resolve().parent.parent.parent
MIG20 = APP_ROOT / "supabase" / "migrations" / "0020_publishing_foundation.sql"
TEST_FILE = Path(__file__).resolve().parent / "06_rls_phase6.sql"
FAKE_A = "11111111-1111-1111-1111-111111111111"
FAKE_B = "22222222-2222-2222-2222-222222222222"
# UUID pengguna uji nyata yang dipakai file 01 (DILARANG di file 06).
REAL_A = "094e8752-eef4-4f0e-b6ae-2d5813445018"
REAL_B = "aabb1dab-77c1-4659-af0e-c703c9de279c"

ALLOWED_TABLES_20 = {
    "publishing_jobs",
    "publishing_attempts",
    "published_posts",
}

RPC_NAMES_20 = [
    "publishing_preflight",
    "create_publishing_job",
    "claim_publishing_job",
    "process_publishing_jobs",
    "retry_publishing_job",
    "cancel_publishing_job",
    "confirm_publishing_job",
]

RPC_GRANTS_20 = [
    "publishing_preflight(uuid, timestamptz, text, uuid)",
    "create_publishing_job(uuid, timestamptz, text)",
    "claim_publishing_job(uuid, uuid)",
    "process_publishing_jobs(uuid, uuid)",
    "retry_publishing_job(uuid)",
    "cancel_publishing_job(uuid, text)",
    "confirm_publishing_job(uuid, text, timestamptz)",
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
    mig20 = MIG20.read_text()
    test = TEST_FILE.read_text()

    # 1. Parse pglast.
    try:
        import pglast
    except ImportError:
        check("pglast tersedia", False, "modul pglast tidak terpasang")
        return 1
    try:
        stmts = pglast.parse_sql(mig20)
        check("pglast parse 0020 penuh", True, f"{len(stmts)} statement")
    except Exception as exc:  # noqa: BLE001
        check("pglast parse 0020 penuh", False, str(exc)[:300])
        return 1
    stripped_lines = [ln for ln in test.splitlines() if not ln.lstrip().startswith("\\set")]
    stripped = "\n".join(stripped_lines)
    stripped = stripped.replace(":'user_a'", f"'{FAKE_A}'").replace(":'user_b'", f"'{FAKE_B}'")
    try:
        stmts = pglast.parse_sql(stripped)
        check("pglast parse tes 06 penuh", True, f"{len(stmts)} statement")
    except Exception as exc:  # noqa: BLE001
        check("pglast parse tes 06 penuh", False, str(exc)[:300])
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
        r"throws_ok\s*\(\s*(?:\$\$.*?\$\s*|format\(\$f\$.*?\$f\$[^)]*\))\s*,\s*'(?:42501|23505|23514|P0001)'\s*,\s*'[^']+'\s*,\s*'[^']+'\s*\)",
        test, flags=re.DOTALL,
    )
    check(
        "throws_ok 4 argumen + SQLSTATE",
        len(throws_calls) == len(throws_4arg) and len(throws_calls) > 0,
        f"{len(throws_4arg)}/{len(throws_calls)} throws_ok bentuk 4 argumen",
    )

    # 4. UUID: tidak ada UUID nyata; palsu hanya di \\set; tidak ada placeholder di $$/$f$.
    check("tidak ada UUID uji nyata di 06", REAL_A not in test and REAL_B not in test)
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

    mig20_nc = strip_comments(mig20)

    # 5. Scope 0020.
    created20 = set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", mig20_nc, flags=re.I))
    check("0020 membuat tepat 3 tabel Phase 6", created20 == ALLOWED_TABLES_20,
          f"{len(created20)} tabel; selisih: {sorted(created20 ^ ALLOWED_TABLES_20) or 'tidak ada'}")
    rls20 = set(re.findall(r"alter\s+table\s+public\.(\w+)\s+enable\s+row\s+level\s+security", mig20_nc, flags=re.I))
    check("RLS aktif untuk ke-3 tabel 0020", rls20 == ALLOWED_TABLES_20,
          f"kurang: {sorted(ALLOWED_TABLES_20 - rls20)}")
    for tbl in sorted(ALLOWED_TABLES_20):
        check(f"0020: {tbl} revoke-all + grant select saja",
              f"revoke all on public.{tbl} from anon, authenticated" in mig20_nc
              and f"grant select on public.{tbl} to authenticated" in mig20_nc
              and not re.search(rf"grant\s+(insert|update|delete)\s+on\s+public\.{tbl}", mig20_nc, flags=re.I))
    check("0020: 7 RPC ada (SECURITY DEFINER, search_path terkunci)",
          all(f"create or replace function public.{name}(" in mig20_nc for name in RPC_NAMES_20)
          and mig20_nc.count("security definer") >= 9
          and mig20_nc.count("search_path = public, pg_temp") >= 9,
          f"{sum(1 for name in RPC_NAMES_20 if f'create or replace function public.{name}(' in mig20_nc)}/7 RPC")
    check("0020: RPC di-grant hanya ke authenticated",
          all(f"grant execute on function public.{sig} to authenticated" in mig20_nc for sig in RPC_GRANTS_20)
          and not re.search(r"grant execute on function public\.(publishing_|create_|claim_|process_|retry_|cancel_|confirm_).*to public", mig20_nc, flags=re.I))
    check("0020: helper visibilitas ada (job + post, SECURITY DEFINER)",
          "create or replace function public.is_publishing_job_visible(p_job_id uuid" in mig20_nc
          and "create or replace function public.is_publishing_post_visible(p_post_id uuid" in mig20_nc
          and "grant execute on function public.is_publishing_job_visible(uuid, text[]) to authenticated" in mig20_nc
          and "grant execute on function public.is_publishing_post_visible(uuid, text[]) to authenticated" in mig20_nc)
    check("0020: helper lama is_publishing_job_member TIDAK ADA (digantikan helper visibilitas)",
          "create or replace function public.is_publishing_job_member" not in mig20_nc
          and "is_publishing_job_member(" not in mig20_nc)
    check("0020: policy SELECT memakai helper visibilitas (scope pola 0016)",
          mig20_nc.count("is_publishing_job_visible(") >= 2
          and mig20_nc.count("is_publishing_post_visible(") >= 1)
    check("0020: helper visibilitas menegakkan brand scope + cabang shared",
          "public.brand_in_scope(ci.brand_id)" in mig20_nc
          and "public.is_placement_shared_with_me(j.placement_id)" in mig20_nc
          and "public.is_placement_shared_with_me(pp.placement_id)" in mig20_nc)
    check("0020: policy tulis = false (3 tabel x insert/update/delete)",
          mig20_nc.count("with check (false)") == 3
          and mig20_nc.count("using (false)") == 6)
    check("0020: indeks partial idempotency ada",
          "create unique index if not exists idx_publishing_jobs_idempotency_active" in mig20_nc
          and "where status <> 'cancelled'" in mig20_nc)
    check("0020: CHECK provider null + sumber manual + status + remote_post_id",
          "constraint publishing_jobs_provider_job_id_null_check" in mig20_nc
          and "constraint published_posts_provider_post_id_null_check" in mig20_nc
          and "check (confirmation_source in ('manual_user_confirmation'))" in mig20_nc
          and "constraint publishing_jobs_status_check" in mig20_nc
          and "constraint content_placements_remote_post_id_null_check" in mig20_nc)
    check("0020: TIDAK ADA fungsi adapter provider",
          not any(fn in mig20_nc for fn in [
              "uploadOrCreatePost", "getPublishStatus", "fetchPostMetadata", "fetchAnalytics",
          ]))
    check("0020: backoff 1/5/15 di fungsi SQL",
          "when p_attempt_number <= 1 then 1" in mig20_nc
          and "when p_attempt_number = 2 then 5" in mig20_nc
          and "else 15" in mig20_nc)
    check("0020: claim atomik (FOR UPDATE SKIP LOCKED) + lease 5 menit",
          "for update skip locked" in mig20_nc
          and "now() + interval '5 minutes'" in mig20_nc)
    check("0020: process loop maks 20 job",
          "exit when v_n >= 20" in mig20_nc)
    check("0020: published_posts hanya ditulis RPC confirm",
          mig20_nc.count("insert into public.published_posts") == 1)
    check("0020: preflight STABLE + tidak melempar (mengembalikan jsonb)",
          "create or replace function public.publishing_preflight(" in mig20_nc
          and "stable\nsecurity definer" in mig20_nc)
    check("0020: tanpa pelonggaran (tidak ada using(true))",
          not re.search(r"using\s*\(\s*true\s*\)", mig20_nc, flags=re.I))

    # 6. Forward-reference 0020.
    earlier = set()
    helper_defs = set()
    for f in sorted((APP_ROOT / "supabase" / "migrations").glob("00*.sql")):
        txt = strip_comments(f.read_text())
        earlier |= set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", txt, flags=re.I))
        helper_defs |= set(re.findall(r"function\s+public\.(\w+)\s*\(", txt))
    policy_bodies = re.findall(
        r"create\s+policy\s+\"[^\"]+\"\s+on\s+public\.(\w+)\s+for\s+\w+\s+to\s+\w+\s*(.*?)(?=;\s*(?:create|drop|alter|revoke|grant|comment|create\s+or|drop\s+trigger|create\s+trigger|insert|select|$))",
        mig20_nc, flags=re.I | re.S)
    referenced = set()
    for _tbl, body in policy_bodies:
        referenced |= set(re.findall(r"public\.(\w+)", body))
    table_refs = {r for r in referenced if r not in helper_defs}
    policy_tables = {t for t, _b in policy_bodies}
    table_refs -= policy_tables
    check("policy 0020: tidak merujuk tabel yang belum dibuat",
          table_refs <= earlier,
          f"belum dibuat: {sorted(table_refs - earlier)}" if table_refs - earlier else f"{len(policy_bodies)} policy")
    called_helpers = set()
    for _tbl, body in policy_bodies:
        called_helpers |= set(re.findall(r"public\.(\w+)\s*\(", body))
    check("policy 0020: helper yang dipanggil terdefinisi",
          called_helpers <= helper_defs,
          f"tak terdefinisi: {sorted(called_helpers - helper_defs)}" if called_helpers - helper_defs else f"dipanggil: {sorted(called_helpers)}")
    scans = set()
    for _tbl, body in policy_bodies:
        scans |= set(re.findall(r"\b(?:from|join)\s+public\.(\w+)\b", body, flags=re.I))
    check("policy 0020: 0 pemindaian tabel (FROM/JOIN)", not scans, f"scan: {sorted(scans)}")

    # 7. Graf RLS EFEKTIF 0001–0020: definisi terakhir per nama policy.
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
    check("graf RLS efektif 0001–0020: 0 siklus",
          not cycles, f"siklus: {cycles}" if cycles else f"{len(effective)} policy efektif, {len(edges)} tabel")
    check("graf RLS efektif 0001–0020: 0 self-loop",
          not self_loops, f"self-loop: {self_loops}" if self_loops else "")

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} pemeriksaan lolos.")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
