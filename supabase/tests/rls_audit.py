#!/usr/bin/env python3
"""Audit dependensi policy RLS MaTive Phase 1.

Mengekstrak CREATE POLICY dari file migrasi, menemukan tabel yang benar-benar
di-scan di dalam ekspresi policy (FROM/JOIN public.<tabel> — BUKAN referensi
kolom berkualifikasi seperti workspace_members.workspace_id yang merujuk ke
baris yang sedang dievaluasi), lalu membangun graf dependensi
tabel_policy -> tabel_yang_dirujuk dan mendeteksi siklus (termasuk self-loop).

Pemakaian: python3 rls_audit.py <dir-migrasi> [file ...]
"""
import re
import sys
from pathlib import Path

# Hilangkan komentar -- ... dan /* ... */ agar tidak ikut ter-parse.
def strip_comments(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", "", sql)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return sql

# CREATE POLICY "nama" ON public.tabel FOR <cmd> TO ... USING (...) [WITH CHECK (...)]
POLICY_RE = re.compile(
    r'create\s+policy\s+"([^"]+)"\s+on\s+public\.(\w+)\s+for\s+(\w+)'
    r'\s+to\s+\w+\s*(.*?)(?=;\s*(?:create|drop|alter|revoke|grant|comment|create\s+or|drop\s+trigger|create\s+trigger|insert|select|$))',
    re.I | re.S,
)

# Scan tabel nyata di dalam ekspresi: FROM public.t / JOIN public.t
SCAN_RE = re.compile(r"\b(?:from|join)\s+public\.(\w+)\b", re.I)

# Referensi fungsi helper public.nama(...)
FUNC_RE = re.compile(r"\bpublic\.(\w+)\s*\(", re.I)

def audit_file(path: Path):
    text = strip_comments(path.read_text())
    policies = []
    for m in POLICY_RE.finditer(text):
        name, table, cmd, body = m.group(1), m.group(2), m.group(3), m.group(4)
        scans = sorted(set(SCAN_RE.findall(body)))
        funcs = sorted(set(FUNC_RE.findall(body)))
        # Hapus referensi fungsi yang sebenarnya nama tabel (tidak ada di sini,
        # tapi jaga-jaga): fungsi helper dikenali dari daftar yang diketahui.
        policies.append({
            "file": path.name, "name": name, "table": table,
            "cmd": cmd.lower(), "scans": scans, "funcs": funcs,
        })
    return policies

def find_cycles(edges):
    """edges: dict node -> set(node). Kembalikan daftar siklus (list node)."""
    cycles = []
    state = {}  # 0=unvisited, 1=in stack, 2=done
    stack = []

    def dfs(u):
        state[u] = 1
        stack.append(u)
        for v in sorted(edges.get(u, set())):
            if state.get(v, 0) == 1:
                i = stack.index(v)
                cycles.append(stack[i:] + [v])
            elif state.get(v, 0) == 0:
                dfs(v)
        stack.pop()
        state[u] = 2

    for n in sorted(edges):
        if state.get(n, 0) == 0:
            dfs(n)
    return cycles

def main():
    files = [Path(a) for a in sys.argv[1:]]
    all_policies = []
    for f in files:
        all_policies.extend(audit_file(f))

    print(f"Policy ditemukan: {len(all_policies)}")
    edges = {}
    for p in all_policies:
        tgt = set(p["scans"])
        edges.setdefault(p["table"], set()).update(tgt)
        tag = ""
        if p["table"] in tgt:
            tag = "  <-- SELF-LOOP (rekursi langsung)"
        print(f"  [{p['file']}] {p['name']} ON {p['table']} FOR {p['cmd']}: "
              f"scan={p['scans'] or '-'} funcs={p['funcs'] or '-'}{tag}")

    print("\nGraf dependensi (tabel policy -> tabel yang di-scan di policy-nya):")
    for k in sorted(edges):
        print(f"  {k} -> {sorted(edges[k]) or '(tidak ada)'}")

    cycles = find_cycles(edges)
    print(f"\nSiklus terdeteksi: {len(cycles)}")
    for c in cycles:
        print("  SIKLUS: " + " -> ".join(c))
    if not cycles:
        print("  TIDAK ADA SIKLUS — graf asiklik.")
    # Rekursi juga terjadi bila policy memanggil helper yang membaca tabel
    # yang sama? TIDAK: helper SECURITY DEFINER dijalankan sebagai owner
    # (postgres, bypass RLS), jadi tidak memicu evaluasi policy. Dicatat
    # di laporan, bukan di graf ini.
    return 0 if not cycles else 1

if __name__ == "__main__":
    sys.exit(main())
