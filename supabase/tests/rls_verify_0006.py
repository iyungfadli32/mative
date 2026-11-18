#!/usr/bin/env python3
"""Verifikasi statis migrasi 0006_rls_recursion_fix.sql.

1. Parse sintaks penuh file 0006 dengan pglast (parser PostgreSQL asli).
2. Audit graf dependensi policy 0001-0006: harus 0 siklus; policy di 0006
   tidak boleh memindai tabel apa pun secara langsung (hanya helper).
3. Cross-check: setiap policy rekursif di 0001-0005 harus di-DROP + CREATE
   ulang di 0006 dengan nama, tabel, dan perintah yang sama.
4. Helper: SECURITY DEFINER + search_path dikunci + STABLE + boolean;
   grant EXECUTE hanya ke authenticated.
5. Semantik: setiap policy hasil tulis ulang harus mempertahankan pengecekan
   langsung (auth.uid() / false) dan daftar role yang sama dengan aslinya.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rls_audit import strip_comments, POLICY_RE, SCAN_RE, FUNC_RE, find_cycles

MIG = Path.home() / "workspace/mative/app/supabase/migrations"
OLD = ["0001_profiles.sql", "0002_organizations.sql", "0003_workspaces.sql",
       "0004_activity_logs.sql", "0005_resource_shares.sql"]
NEW = "0006_rls_recursion_fix.sql"

fails = []
def check(ok, msg):
    print(("  PASS " if ok else "  FAIL ") + msg)
    if not ok:
        fails.append(msg)

# --- 1. Parse pglast -------------------------------------------------------
from pglast import parse_sql
new_sql = (MIG / NEW).read_text()
try:
    stmts = parse_sql(new_sql)
    print(f"[1] pglast parse 0006: OK — {len(stmts)} statement")
except Exception as e:
    print(f"[1] pglast parse 0006: GAGAL — {e}")
    fails.append(f"pglast parse gagal: {e}")
    stmts = []

# pglast v8: parse() mengembalikan list RawStmt; pastikan semua statement
# dikenali tipenya (tidak ada statement yang gagal di-parse sebagian).
if stmts:
    kinds = {}
    for s in stmts:
        k = type(s.stmt).__name__
        kinds[k] = kinds.get(k, 0) + 1
    print(f"    jenis statement: {kinds}")

# --- 2. Audit graf 0001-0006 ------------------------------------------------
def policies_of(fname):
    text = strip_comments((MIG / fname).read_text())
    out = []
    for m in POLICY_RE.finditer(text):
        out.append({"file": fname, "name": m.group(1), "table": m.group(2),
                    "cmd": m.group(3).lower(), "body": m.group(4),
                    "scans": sorted(set(SCAN_RE.findall(m.group(4)))),
                    "funcs": sorted(set(FUNC_RE.findall(m.group(4))))})
    return out

old_pols = [p for f in OLD for p in policies_of(f)]
new_pols = policies_of(NEW)

# Graf EFEKTIF pasca-0006: policy lama yang di-DROP tidak ada lagi — hanya
# policy lama yang TIDAK diganti + 25 policy baru yang berlaku. Menggabungkan
# lama+baru tanpa DROP adalah model yang salah (menghitung dua versi sekaligus).
new_text_pre = strip_comments(new_sql)
dropped_pairs = set(re.findall(
    r"drop\s+policy\s+if\s+exists\s+\"([^\"]+)\"\s+on\s+public\.(\w+)",
    new_text_pre, re.I))
effective_pols = [p for p in old_pols
                  if (p["name"], p["table"]) not in dropped_pairs] + new_pols
print(f"[2] Policy efektif pasca-0006: {len(old_pols)} lama - "
      f"{len(old_pols) - len(effective_pols) + len(new_pols)} diganti + "
      f"{len(new_pols)} baru = {len(effective_pols)} policy berlaku")
edges = {}
for p in effective_pols:
    edges.setdefault(p["table"], set()).update(p["scans"])
cycles = find_cycles(edges)
print(f"    siklus di graf efektif: {len(cycles)}")
check(not cycles, "tidak ada siklus di graf dependensi EFEKTIF pasca-0006")
for c in cycles:
    print("    SIKLUS: " + " -> ".join(c))

new_scans = [p for p in new_pols if p["scans"]]
check(not new_scans, "tidak ada policy 0006 yang memindai tabel langsung")
for p in new_scans:
    print(f"    policy bermasalah: {p['name']} scan={p['scans']}")

# Setiap policy 0006 hanya boleh memanggil helper yang dikenal.
KNOWN_HELPERS = {"is_org_member", "is_org_owner", "is_ws_member",
                 "is_org_member_of_workspace", "shares_workspace_with"}
bad_funcs = [(p["name"], sorted(set(p["funcs"]) - KNOWN_HELPERS))
             for p in new_pols if set(p["funcs"]) - KNOWN_HELPERS]
check(not bad_funcs, "policy 0006 hanya memanggil 5 helper yang dikenal")
for n, f in bad_funcs:
    print(f"    {n}: fungsi asing {f}")

# --- 3. Cross-check DROP + CREATE -------------------------------------------
new_text = strip_comments(new_sql)
dropped = set(re.findall(r"drop\s+policy\s+if\s+exists\s+\"([^\"]+)\"", new_text, re.I))
recursive_old = [p for p in old_pols if p["scans"]]
rec_names = {(p["name"], p["table"], p["cmd"]) for p in recursive_old}
new_names = {(p["name"], p["table"], p["cmd"]) for p in new_pols}
print(f"[3] Policy rekursif di 0001-0005: {len(rec_names)}; "
      f"di-DROP di 0006: {len(dropped)}; di-CREATE ulang: {len(new_names)}")
check(rec_names == new_names,
      "himpunan (nama, tabel, perintah) policy rekursif == policy baru 0006")
missing_drop = {n for (n, _, _) in rec_names} - dropped
check(not missing_drop, "semua policy lama yang diganti di-DROP dulu")
if missing_drop:
    print(f"    belum di-DROP: {missing_drop}")
extra = new_names - rec_names
check(not extra, "tidak ada policy baru di luar daftar rekursif")
if extra:
    print(f"    policy tambahan: {extra}")

# --- 4. Helper: atribut keamanan --------------------------------------------
print("[4] Helper SECURITY DEFINER:")
helper_defs = re.findall(
    r"create\s+or\s+replace\s+function\s+public\.(\w+)\(([^)]*)\)\s*"
    r"returns\s+(\w+)\s+language\s+(\w+)\s+(.*?)\s+as\s+\$\$",
    new_sql, re.I | re.S)
check(len(helper_defs) == 5, f"tepat 5 helper didefinisikan (ketemu {len(helper_defs)})")
for name, args, ret, lang, attrs in helper_defs:
    a = attrs.lower()
    ok = ("security definer" in a and "set search_path = public, pg_temp" in a
          and "stable" in a and ret.lower() == "boolean" and lang.lower() == "sql")
    check(ok, f"helper {name}({args}): SECURITY DEFINER + search_path terkunci + STABLE + returns boolean")
    if not ok:
        print(f"    atribut mentah: returns {ret} lang {lang} | {attrs!r}")

# Grant EXECUTE hanya ke authenticated; tidak ada grant ke public/anon.
grants = re.findall(r"grant\s+execute\s+on\s+function\s+public\.(\w+)\([^)]*\)\s+to\s+(\w+)", new_sql, re.I)
check(len(grants) == 5 and all(g[1].lower() == "authenticated" for g in grants),
      "grant EXECUTE 5 helper hanya ke authenticated")
revokes = re.findall(r"revoke\s+all\s+on\s+function\s+public\.(\w+)\([^)]*\)\s+from\s+(\w+)", new_sql, re.I)
check(len(revokes) == 5 and all(r[1].lower() == "public" for r in revokes),
      "revoke ALL 5 helper dari public")
# Tidak ada GRANT lain di file (mis. ke anon/service_role).
other_grants = [g for g in re.findall(r"grant\s+\w+.*?to\s+(\w+)", new_sql, re.I)
                if g.lower() not in ("authenticated",)]
check(not other_grants, "tidak ada grant lain di 0006")

# Helper TIDAK membaca auth.users / tabel lain di luar yang diizinkan.
ALLOWED_READS = {
    "is_org_member": {"organization_members"},
    "is_org_owner": {"organizations"},
    "is_ws_member": {"workspace_members"},
    "is_org_member_of_workspace": {"workspaces", "organization_members"},
    "shares_workspace_with": {"workspace_members"},
}
for name, args, ret, lang, attrs in helper_defs:
    body_m = re.search(r"create\s+or\s+replace\s+function\s+public\." + name +
                       r"\([^)]*\)\s*returns\s+\w+\s+language\s+\w+\s+.*?as\s+\$\$(.*?)\$\$",
                       new_sql, re.I | re.S)
    reads = set(SCAN_RE.findall(body_m.group(1))) if body_m else set()
    check(reads == ALLOWED_READS[name],
          f"helper {name} hanya membaca {sorted(ALLOWED_READS[name])} (ketemu {sorted(reads)})")
    # Helper tidak mengandung dynamic SQL / EXECUTE / SECURITY INVOKER.
    b = body_m.group(1).lower() if body_m else ""
    check("execute " not in b and "format(" not in b and "query" not in b,
          f"helper {name} tanpa dynamic SQL")

# --- 5. Semantik: pengecekan langsung + role dipertahankan --------------------
print("[5] Pengecekan semantik per policy (bandingkan 0001-0005 vs 0006):")
DIRECT_CHECKS = [
    # (pola yang harus tetap ada di policy baru, deskripsi)
    ("organizations_select_member", [r"owner_user_id\s*=\s*auth\.uid\(\)"]),
    ("org_members_select_member", [r"user_id\s*=\s*auth\.uid\(\)"]),
    ("org_members_insert_owner_or_admin", [r"user_id\s*=\s*auth\.uid\(\)"]),
    ("ws_members_select_member", [r"user_id\s*=\s*auth\.uid\(\)"]),
    ("ws_members_insert_owner_admin_or_self", [r"user_id\s*=\s*auth\.uid\(\)"]),
    ("profiles_select_own_or_same_workspace", [r"id\s*=\s*auth\.uid\(\)"]),
    ("activity_insert_member_as_actor", [r"actor_user_id\s*=\s*auth\.uid\(\)"]),
    ("shares_select_recipient_or_member", [r"shared_with_user_id\s*=\s*auth\.uid\(\)"]),
    ("shares_insert_owner_admin_manager", [r"shared_by\s*=\s*auth\.uid\(\)"]),
]
new_by_name = {p["name"]: p for p in new_pols}
for name, pats in DIRECT_CHECKS:
    body = new_by_name[name]["body"]
    for pat in pats:
        check(bool(re.search(pat, body, re.I)),
              f"{name}: pengecekan langsung {pat} tetap ada")

# Daftar role per policy harus sama dengan aslinya.
# Policy lama menulis role sebagai IN ('owner', 'admin'); policy baru sebagai
# array['owner', 'admin'] (argumen helper). Bandingkan HIMPUNAN literal role.
def roles_old(body):
    out = set()
    for grp in re.findall(r"\bin\s*\(\s*((?:'[\w]+'\s*,?\s*)+)\)", body, re.I):
        out.update(re.findall(r"'([\w]+)'", grp))
    # Policy DELETE memakai kesamaan tunggal: organization_role = 'owner'.
    out.update(re.findall(r"(?:organization_role|workspace_role)\s*=\s*'([\w]+)'", body, re.I))
    return sorted(out)

def roles_new(body):
    out = set()
    for grp in re.findall(r"array\[([^\]]+)\]", body):
        out.update(re.findall(r"'([\w]+)'", grp))
    return sorted(out)

old_by_name = {p["name"]: p for p in old_pols}
role_mismatch = []
for name in new_by_name:
    ro, rn = roles_old(old_by_name[name]["body"]), roles_new(new_by_name[name]["body"])
    if ro != rn:
        role_mismatch.append((name, ro, rn))
check(not role_mismatch, "daftar role array[...] identik dengan policy lama")
for n, ro, rn in role_mismatch:
    print(f"    {n}: lama {ro} vs baru {rn}")

# File 0001-0005 tidak berubah (hash dicatat di laporan; di sini hanya pastikan
# 0006 tidak memuat definisi ulang tabel / trigger / accept_invitation).
check("create table" not in new_text.lower(), "0006 tidak membuat/mengubah tabel")
check("accept_invitation" not in new_text.lower(), "0006 tidak menyentuh accept_invitation()")
check("audit_resource_share" not in new_text.lower(), "0006 tidak menyentuh trigger audit")

print()
print(f"HASIL: {'SEMUA VERIFIKASI STATIS LOLOS' if not fails else f'{len(fails)} KEGAGALAN'}")
for f in fails:
    print("  - " + f)
sys.exit(1 if fails else 0)
