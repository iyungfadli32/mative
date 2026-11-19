#!/usr/bin/env python3
"""Verifikasi statis MaTive Phase 7 (P7-01 s.d. P7-09) — tanpa database nyata.

Memeriksa:
  1. Migrasi 0021 v1.0 + tes 07 ter-parse penuh oleh pglast.
  2. Jumlah asersi pgTAP di 07 == angka plan(N).
  3. throws_ok di 07 memakai bentuk 4 argumen (sql, kode SQLSTATE,
     pola = pesan lengkap, deskripsi); argumen pertama boleh $$...$$
     atau format($f$...$f$, :'user_x') (pola T14 — placeholder di luar
     blok $f$).
  4. Tidak ada UUID pengguna uji nyata yang di-hardcode di 07; UUID palsu
     1111.../2222... hanya di baris \\set; tidak ada placeholder :'user_a' /
     :'user_b' di dalam string $$...$$ / $f$...$f$.
  5. 0021: tepat 6 tabel Phase 7 + RLS aktif keenamnya + revoke-all +
     grant select saja (5 tabel; channel_credentials TANPA grant) + RPC
     impor (SECURITY DEFINER, search_path terkunci, grant hanya
     authenticated) + backoff + TTL (SECURITY INVOKER, search_path
     terkunci) + helper visibilitas (scope pola 0016 + fail-safe
     multi-brand; viewer_client TIDAK ADA di daftar peran) + policy
     SELECT memakai helper visibilitas + policy tulis = false +
     seed 14 definisi metrik (2 turunan) + CHECK kunci/nilai/periode/
     tipe event/provider + connection_status 'disabled' + indeks partial
     unique + retrieved_at pakai clock_timestamp() + TIDAK ADA fungsi
     adapter provider.
  6. Tidak ada forward-reference: setiap tabel yang dirujuk policy/helper
     di 0021 sudah dibuat di 0001–0021; setiap helper yang dipanggil
     policy didefinisikan di 0001–0021; tidak ada policy yang memindai
     tabel lain (FROM/JOIN).
  7. Graf RLS EFEKTIF 0001–0021 (definisi terakhir per nama policy): 0
     siklus, 0 self-loop.
  8. File 0001–0020 TIDAK diubah (diperiksa lewat git di luar skrip ini).

Jalankan:  python3 supabase/tests/rls_verify_phase7.py
Keluar 0 bila semua pemeriksaan lolos.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rls_audit import POLICY_RE, find_cycles  # noqa: E402

APP_ROOT = Path(__file__).resolve().parent.parent.parent
MIG21 = APP_ROOT / "supabase" / "migrations" / "0021_analytics_foundation.sql"
TEST_FILE = Path(__file__).resolve().parent / "07_rls_phase7.sql"
FAKE_A = "11111111-1111-1111-1111-111111111111"
FAKE_B = "22222222-2222-2222-2222-222222222222"
# UUID pengguna uji nyata yang dipakai file 01 (DILARANG di file 07).
REAL_A = "094e8752-eef4-4f0e-b6ae-2d5813445018"
REAL_B = "aabb1dab-77c1-4659-af0e-c703c9de279c"

ALLOWED_TABLES_21 = {
    "metric_definitions",
    "analytics_snapshots",
    "content_metrics",
    "campaign_metrics",
    "integration_events",
    "channel_credentials",
}

# 5 tabel dengan grant select (channel_credentials TANPA grant).
SELECT_TABLES_21 = ALLOWED_TABLES_21 - {"channel_credentials"}

RPC_GRANTS_21 = [
    "import_analytics_snapshot(uuid, uuid, date, date, text, jsonb)",
    "integration_backoff_seconds(integer)",
    "analytics_snapshot_is_stale(uuid)",
]

METRIC_KEYS_14 = [
    "reach", "impressions", "views", "video_views", "engagements",
    "likes", "comments", "shares", "saves", "clicks",
    "followers_net_change", "conversions",
    "engagement_rate", "publishing_adherence",
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
    mig21 = MIG21.read_text()
    test = TEST_FILE.read_text()

    # 1. Parse pglast.
    try:
        import pglast
    except ImportError:
        check("pglast tersedia", False, "modul pglast tidak terpasang")
        return 1
    try:
        stmts = pglast.parse_sql(mig21)
        check("pglast parse 0021 penuh", True, f"{len(stmts)} statement")
    except Exception as exc:  # noqa: BLE001
        check("pglast parse 0021 penuh", False, str(exc)[:300])
        return 1
    stripped_lines = [ln for ln in test.splitlines() if not ln.lstrip().startswith("\\set")]
    stripped = "\n".join(stripped_lines)
    stripped = stripped.replace(":'user_a'", f"'{FAKE_A}'").replace(":'user_b'", f"'{FAKE_B}'")
    try:
        stmts = pglast.parse_sql(stripped)
        check("pglast parse tes 07 penuh", True, f"{len(stmts)} statement")
    except Exception as exc:  # noqa: BLE001
        check("pglast parse tes 07 penuh", False, str(exc)[:300])
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
    check("tidak ada UUID uji nyata di 07", REAL_A not in test and REAL_B not in test)
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

    mig21_nc = strip_comments(mig21)

    # 5. Scope 0021.
    created21 = set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", mig21_nc, flags=re.I))
    check("0021 membuat tepat 6 tabel Phase 7", created21 == ALLOWED_TABLES_21,
          f"{len(created21)} tabel; selisih: {sorted(created21 ^ ALLOWED_TABLES_21) or 'tidak ada'}")
    rls21 = set(re.findall(r"alter\s+table\s+public\.(\w+)\s+enable\s+row\s+level\s+security", mig21_nc, flags=re.I))
    check("RLS aktif untuk ke-6 tabel 0021", rls21 == ALLOWED_TABLES_21,
          f"kurang: {sorted(ALLOWED_TABLES_21 - rls21)}")
    for tbl in sorted(SELECT_TABLES_21):
        if tbl == "integration_events":
            # Pola activity_logs 0004: INSERT butuh grant (policy actor);
            # update/delete tetap dilarang.
            check(f"0021: {tbl} revoke-all + grant select+insert saja (pola actor)",
                  f"revoke all on public.{tbl} from anon, authenticated" in mig21_nc
                  and f"grant select, insert on public.{tbl} to authenticated" in mig21_nc
                  and not re.search(rf"grant\s+(update|delete)\s+on\s+public\.{tbl}", mig21_nc, flags=re.I))
            continue
        check(f"0021: {tbl} revoke-all + grant select saja",
              f"revoke all on public.{tbl} from anon, authenticated" in mig21_nc
              and f"grant select on public.{tbl} to authenticated" in mig21_nc
              and not re.search(rf"grant\s+(insert|update|delete)\s+on\s+public\.{tbl}", mig21_nc, flags=re.I))
    check("0021: channel_credentials revoke-all TANPA grant apa pun (server-only)",
          "revoke all on public.channel_credentials from anon, authenticated" in mig21_nc
          and not re.search(r"grant\s+\w+\s+on\s+public\.channel_credentials", mig21_nc, flags=re.I)
          and not re.search(r"create\s+policy\s+\"[^\"]+\"\s+on\s+public\.channel_credentials", mig21_nc, flags=re.I))
    check("0021: RPC impor ada (SECURITY DEFINER, search_path terkunci, grant authenticated)",
          "create or replace function public.import_analytics_snapshot(" in mig21_nc
          and mig21_nc.count("security definer") == 5
          and mig21_nc.count("search_path = public, pg_temp") == 7
          and "grant execute on function public.import_analytics_snapshot(uuid, uuid, date, date, text, jsonb) to authenticated" in mig21_nc)
    check("0021: backoff + TTL ada (SECURITY INVOKER, search_path terkunci, grant authenticated)",
          "create or replace function public.integration_backoff_seconds(" in mig21_nc
          and "create or replace function public.analytics_snapshot_is_stale(" in mig21_nc
          and mig21_nc.count("security invoker") == 2
          and all(f"grant execute on function public.{sig} to authenticated" in mig21_nc for sig in RPC_GRANTS_21))
    check("0021: helper visibilitas ada (4 helper, SECURITY DEFINER, grant authenticated)",
          "create or replace function public.is_unlimited_scope(p_workspace_id uuid" in mig21_nc
          and "create or replace function public.is_analytics_snapshot_visible(p_snapshot_id uuid, p_roles text[] default null" in mig21_nc
          and "create or replace function public.is_content_metric_visible(p_metric_id uuid, p_roles text[] default null" in mig21_nc
          and "create or replace function public.is_campaign_metric_visible(p_metric_id uuid, p_roles text[] default null" in mig21_nc
          and "grant execute on function public.is_unlimited_scope(uuid) to authenticated" in mig21_nc
          and "grant execute on function public.is_analytics_snapshot_visible(uuid, text[]) to authenticated" in mig21_nc
          and "grant execute on function public.is_content_metric_visible(uuid, text[]) to authenticated" in mig21_nc
          and "grant execute on function public.is_campaign_metric_visible(uuid, text[]) to authenticated" in mig21_nc)
    check("0021: viewer_client TIDAK ADA di daftar peran helper visibilitas",
          "viewer_client" not in mig21_nc)
    check("0021: helper snapshot punya fail-safe multi-brand (brand_scope null → unlimited)",
          "s.brand_id is null and public.is_unlimited_scope(s.workspace_id)" in mig21_nc
          and "cm.brand_id is null and public.is_unlimited_scope(cm.workspace_id)" in mig21_nc)
    check("0021: policy SELECT memakai helper visibilitas (scope pola 0016)",
          mig21_nc.count("is_analytics_snapshot_visible(") >= 2
          and mig21_nc.count("is_content_metric_visible(") >= 2
          and mig21_nc.count("is_campaign_metric_visible(") >= 2)
    check("0021: policy tulis = false (4 insert + 10 update/delete)",
          mig21_nc.count("with check (false)") == 4
          and mig21_nc.count("using (false)") == 10)
    check("0021: seed 14 definisi metrik (2 turunan) + formula turunan",
          all(f"'{key}'" in mig21_nc for key in METRIC_KEYS_14)
          and "engagements / reach" in mig21_nc
          and "publishing_jobs" in mig21_nc)
    check("0021: indeks partial unique (katalog global + workspace + snapshot)",
          "create unique index if not exists idx_metric_definitions_global_unique" in mig21_nc
          and "create unique index if not exists idx_metric_definitions_ws_unique" in mig21_nc
          and "create unique index if not exists idx_content_metrics_snapshot_subject_key" in mig21_nc)
    check("0021: CHECK kunci/nilai/periode/tipe event/provider/status koneksi",
          "constraint content_metrics_key_check" in mig21_nc
          and "constraint content_metrics_value_check" in mig21_nc
          and "constraint analytics_snapshots_period_check" in mig21_nc
          and "constraint integration_events_type_check" in mig21_nc
          and "constraint channel_credentials_provider_check" in mig21_nc
          and "check (connection_status in ('not_connected', 'manual', 'disabled'))" in mig21_nc)
    check("0021: retrieved_at pakai clock_timestamp() (bukan now())",
          "clock_timestamp(), btrim(p_raw_reference)" in mig21_nc)
    check("0021: backoff 60/300/900 + TTL 24 jam di fungsi SQL",
          "when p_attempt_number <= 1 then 60" in mig21_nc
          and "when p_attempt_number = 2 then 300" in mig21_nc
          and "else 900" in mig21_nc
          and "interval '24 hours'" in mig21_nc)
    check("0021: RPC impor tidak pernah melempar (return jsonb kode galat)",
          "INVALID_METRIC" in mig21_nc
          and "INVALID_UNIT" in mig21_nc
          and "DUPLICATE_METRIC" in mig21_nc
          and "INVALID_SUBJECT" in mig21_nc
          and "INVALID_PERIOD" in mig21_nc
          and "EMPTY_METRICS" in mig21_nc
          and "FORBIDDEN" in mig21_nc)
    check("0021: TIDAK ADA fungsi adapter provider",
          not any(fn in mig21_nc for fn in [
              "uploadOrCreatePost", "getPublishStatus", "fetchPostMetadata", "fetchAnalytics",
          ]))
    check("0021: tanpa pelonggaran (tidak ada using(true))",
          not re.search(r"using\s*\(\s*true\s*\)", mig21_nc, flags=re.I))

    # 6. Forward-reference 0021.
    earlier = set()
    helper_defs = set()
    for f in sorted((APP_ROOT / "supabase" / "migrations").glob("00*.sql")):
        txt = strip_comments(f.read_text())
        earlier |= set(re.findall(r"create\s+table\s+if\s+not\s+exists\s+public\.(\w+)", txt, flags=re.I))
        helper_defs |= set(re.findall(r"function\s+public\.(\w+)\s*\(", txt))
    policy_bodies = re.findall(
        r"create\s+policy\s+\"[^\"]+\"\s+on\s+public\.(\w+)\s+for\s+\w+\s+to\s+\w+\s*(.*?)(?=;\s*(?:create|drop|alter|revoke|grant|comment|create\s+or|drop\s+trigger|create\s+trigger|insert|select|$))",
        mig21_nc, flags=re.I | re.S)
    referenced = set()
    for _tbl, body in policy_bodies:
        referenced |= set(re.findall(r"public\.(\w+)", body))
    table_refs = {r for r in referenced if r not in helper_defs}
    policy_tables = {t for t, _b in policy_bodies}
    table_refs -= policy_tables
    check("policy 0021: tidak merujuk tabel yang belum dibuat",
          table_refs <= earlier,
          f"belum dibuat: {sorted(table_refs - earlier)}" if table_refs - earlier else f"{len(policy_bodies)} policy")
    called_helpers = set()
    for _tbl, body in policy_bodies:
        called_helpers |= set(re.findall(r"public\.(\w+)\s*\(", body))
    check("policy 0021: helper yang dipanggil terdefinisi",
          called_helpers <= helper_defs,
          f"tak terdefinisi: {sorted(called_helpers - helper_defs)}" if called_helpers - helper_defs else f"dipanggil: {sorted(called_helpers)}")
    scans = set()
    for _tbl, body in policy_bodies:
        scans |= set(re.findall(r"\b(?:from|join)\s+public\.(\w+)\b", body, flags=re.I))
    check("policy 0021: 0 pemindaian tabel (FROM/JOIN)", not scans, f"scan: {sorted(scans)}")

    # 7. Graf RLS EFEKTIF 0001–0021: definisi terakhir per nama policy.
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
    check("graf RLS efektif 0001–0021: 0 siklus",
          not cycles, f"siklus: {cycles}" if cycles else f"{len(effective)} policy efektif, {len(edges)} tabel")
    check("graf RLS efektif 0001–0021: 0 self-loop",
          not self_loops, f"self-loop: {self_loops}" if self_loops else "")

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} pemeriksaan lolos.")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
