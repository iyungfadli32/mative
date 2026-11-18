# Perbaikan Rekursi Policy RLS — Migrasi 0006

**Status:** MIGRASI DITULIS + VERIFIKASI STATIS LOLOS — **BELUM DITERAPKAN ke database live, pgTAP BELUM dijalankan ulang.**
**Tanggal:** 2026-11-19 (VM Asia/Jakarta)
**File:** `supabase/migrations/0006_rls_recursion_fix.sql` (21.810 byte, sha256 `a0d813aa19ea1ebf1b2db8d0934918f2e14d5581f7b11b36a8cc9a8691b62ac9`)
**Skrip verifikasi:** `supabase/tests/rls_audit.py`, `supabase/tests/rls_verify_0006.py` (butuh `pglast`; pasang via `python3 -m venv /tmp/pglast-venv && /tmp/pglast-venv/bin/pip install pglast`)

---

## 1. Defect yang diperbaiki

- **Bukti live (2026-11-19 03:51 WIB):** pgTAP `supabase/tests/01_rls_phase1.sql` menghasilkan **0/14** — eksekusi berhenti di T1 dengan error persis:
  `ERROR: 42P17: infinite recursion detected in policy for relation "workspace_members"` — saat `SELECT` dari `public.workspaces`.
- **File 0001–0005 TIDAK diubah** (sudah diterapkan di database live). Perbaikan hanya berupa migrasi baru 0006. Hash sha256 0001–0005 saat laporan ini ditulis (untuk membuktikan tidak ada perubahan):
  - `0001_profiles.sql` — `04c8fcc2c3d980a52cf3b7d3ad491de20141a7f30c053bd696af22a05ae84401`
  - `0002_organizations.sql` — `c0ee961ff5e5dd0498e67b736dcb972e83cabcb2f83f73ae035182fa45463a04`
  - `0003_workspaces.sql` — `e79ee341718872a9a38978523cc81517866a7267dd5c88b22fd0b52d48895e41`
  - `0004_activity_logs.sql` — `975bf86d351c969cd5bb77183812b0ddf0c76a821f91c53d4de455312c84ed15`
  - `0005_resource_shares.sql` — `959b8c56274023ff5b4e69a8974b7198ca1fa2c97fed563a5d979fef794ac30e`

---

## 2. Audit: peta siklus rekursi (36 policy di 0001–0005)

Metode: ekstrak semua `CREATE POLICY`, cari scan tabel nyata di dalam ekspresi policy (`FROM`/`JOIN public.<tabel>` — **bukan** referensi kolom berkualifikasi seperti `workspace_members.workspace_id` yang merujuk ke baris yang sedang dievaluasi), bangun graf dependensi, deteksi siklus. Skrip: `supabase/tests/rls_audit.py`. Hasil:

| #   | Siklus                                                            | Policy yang terlibat                                                                                                                                          |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | `workspace_members` → `workspace_members` (self-loop)             | `ws_members_select_member`, `ws_members_insert_owner_admin_or_self`, `ws_members_update_owner_admin`, `ws_members_delete_owner`                               |
| B   | `organization_members` → `organization_members` (self-loop)       | `org_members_select_member`, `org_members_insert_owner_or_admin`, `org_members_update_owner_or_admin`, `org_members_delete_owner`                             |
| C   | `organization_members` → `organizations` → `organization_members` | `org_members_insert_owner_or_admin` (subquery `organizations`) + `organizations_select_member` (subquery `organization_members`)                              |
| D   | `workspace_members` → `workspaces` → `workspace_members`          | `ws_members_insert_owner_admin_or_self` (subquery `workspaces`) + `workspaces_select_member` / `workspaces_update_owner_admin` (subquery `workspace_members`) |

**Jalur pemicu lain (bukan siklus sendiri, tapi memicu siklus di atas):**

| Policy                                                      | Merujuk                                      | Memicu siklus                        |
| ----------------------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| `workspaces_select_member`, `workspaces_update_owner_admin` | `workspace_members`                          | A — **inilah jalur T1 yang meledak** |
| `workspaces_insert_org_member`                              | `organization_members`                       | B                                    |
| `profiles_select_own_or_same_workspace`                     | `workspace_members` (self-join)              | A                                    |
| `ws_settings_*` (4 policy), `ws_invitations_*` (3 policy)   | `workspace_members`                          | A                                    |
| `activity_select_member`, `activity_insert_member_as_actor` | `workspace_members` + `organization_members` | A + B                                |
| `shares_*` (3 policy)                                       | `workspace_members`                          | A                                    |

Mekanisme ledakan T1: `SELECT FROM workspaces` → policy `workspaces_select_member` menjalankan subquery ke `workspace_members` → RLS `workspace_members` mengevaluasi `ws_members_select_member` → subquery-nya membaca `workspace_members` lagi → policy dievaluasi lagi, tanpa henti → PostgreSQL menghentikan dengan 42P17.

---

## 3. Perbaikan: 5 helper SECURITY DEFINER + 25 policy ditulis ulang

Pola standar Supabase: fungsi `SECURITY DEFINER` **tidak pernah di-inline** oleh planner dan dieksekusi sebagai pemilik fungsi (postgres — bypass RLS), sehingga pembacaan membership di dalam fungsi **tidak memicu evaluasi policy lagi**. Siklus terputus tepat di sini.

### 3.1 Helper yang dibuat (Bagian 1 migrasi 0006)

| Helper                                                      | Membaca                               | Menggantikan                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `is_org_member(p_org_id uuid, p_roles text[] default null)` | `organization_members`                | `exists (... om.organization_id = <org> and om.user_id = auth.uid() and om.membership_status = 'active' [and om.organization_role in (...)])` |
| `is_org_owner(p_org_id uuid)`                               | `organizations`                       | `exists (... o.id = <org> and o.owner_user_id = auth.uid())`                                                                                  |
| `is_ws_member(p_ws_id uuid, p_roles text[] default null)`   | `workspace_members`                   | `exists (... wm.workspace_id = <ws> and wm.user_id = auth.uid() and wm.membership_status = 'active' [and wm.workspace_role in (...)])`        |
| `is_org_member_of_workspace(p_ws_id uuid)`                  | `workspaces` + `organization_members` | join `workspaces`/`organization_members` (member aktif organisasi induk workspace)                                                            |
| `shares_workspace_with(p_other_user uuid)`                  | `workspace_members` (self-join)       | self-join `wm_self`/`wm_other` (berbagi workspace aktif)                                                                                      |

Pengaman helper (semuanya, jangan dilonggarkan):

- `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp`; semua objek di-qualify skema; `auth.uid()` dibaca dari JWT sesi — berfungsi di dalam SECURITY DEFINER.
- Helper hanya mengembalikan **BOOLEAN tentang keanggotaan pemanggil sendiri** — tidak pernah mengembalikan baris atau data pengguna lain; tanpa dynamic SQL.
- `REVOKE ALL ... FROM public` + `GRANT EXECUTE ... TO authenticated` untuk kelima helper.
- **JANGAN ubah helper menjadi SECURITY INVOKER — rekursi akan kembali.** Helper harus dimiliki role yang bypass RLS (postgres, pemilik migrasi di Supabase).

### 3.2 Policy yang diubah (Bagian 2 migrasi 0006 — 25 policy)

Setiap policy lama di-`DROP POLICY IF EXISTS` dulu, lalu `CREATE POLICY` dengan nama, tabel, dan perintah yang sama — migrasi idempotent, aman diterapkan di atas 0001–0005.

| Policy                                  | Helper pengganti                                                                | Alasan                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `organizations_select_member`           | `is_org_member(organizations.id)`                                               | Subquery `organization_members` memicu siklus B/C        |
| `org_members_select_member`             | `is_org_member(organization_members.organization_id)`                           | SELF-LOOP (B)                                            |
| `org_members_insert_owner_or_admin`     | `is_org_owner(...)` + `is_org_member(..., array['owner','admin'])`              | SELF-LOOP (B) + subquery `organizations` memicu siklus C |
| `org_members_update_owner_or_admin`     | `is_org_member(..., array['owner','admin'])` (USING + WITH CHECK)               | SELF-LOOP (B)                                            |
| `org_members_delete_owner`              | `is_org_member(..., array['owner'])`                                            | SELF-LOOP (B)                                            |
| `workspaces_select_member`              | `is_ws_member(workspaces.id)`                                                   | Memicu siklus A — jalur T1                               |
| `workspaces_insert_org_member`          | `is_org_member(workspaces.organization_id)`                                     | Memicu siklus B                                          |
| `workspaces_update_owner_admin`         | `is_ws_member(..., array['owner','admin'])` (USING + WITH CHECK)                | Memicu siklus A                                          |
| `ws_members_select_member`              | `is_ws_member(workspace_members.workspace_id)`                                  | SELF-LOOP (A)                                            |
| `ws_members_insert_owner_admin_or_self` | `is_org_member_of_workspace(...)` + `is_ws_member(..., array['owner','admin'])` | SELF-LOOP (A) + siklus D + siklus B                      |
| `ws_members_update_owner_admin`         | `is_ws_member(..., array['owner','admin'])` (USING + WITH CHECK)                | SELF-LOOP (A); anti-tampering tetap                      |
| `ws_members_delete_owner`               | `is_ws_member(..., array['owner'])`                                             | SELF-LOOP (A)                                            |
| `profiles_select_own_or_same_workspace` | `shares_workspace_with(profiles.id)`                                            | Self-join `workspace_members` memicu siklus A            |
| `ws_settings_select_member`             | `is_ws_member(...)`                                                             | Memicu siklus A                                          |
| `ws_settings_write_owner_admin`         | `is_ws_member(..., array['owner','admin'])`                                     | Memicu siklus A                                          |
| `ws_settings_update_owner_admin`        | `is_ws_member(..., array['owner','admin'])`                                     | Memicu siklus A                                          |
| `ws_settings_delete_owner_admin`        | `is_ws_member(..., array['owner','admin'])`                                     | Memicu siklus A                                          |
| `ws_invitations_select_owner_admin`     | `is_ws_member(..., array['owner','admin'])`                                     | Memicu siklus A                                          |
| `ws_invitations_insert_owner_admin`     | `is_ws_member(..., array['owner','admin'])`                                     | Memicu siklus A                                          |
| `ws_invitations_update_owner_admin`     | `is_ws_member(..., array['owner','admin'])`                                     | Memicu siklus A                                          |
| `activity_select_member`                | `is_ws_member(...)` + `is_org_member(...)`                                      | Memicu siklus A + B                                      |
| `activity_insert_member_as_actor`       | `is_ws_member(...)` + `is_org_member(...)`                                      | Memicu siklus A + B                                      |
| `shares_select_recipient_or_member`     | `is_ws_member(...)`                                                             | Memicu siklus A                                          |
| `shares_insert_owner_admin_manager`     | `is_ws_member(..., array['owner','admin','manager'])`                           | Memicu siklus A                                          |
| `shares_delete_owner_admin_manager`     | `is_ws_member(..., array['owner','admin','manager'])`                           | Memicu siklus A                                          |

### 3.3 Yang TIDAK diubah

- 11 policy tanpa referensi tabel (`auth.uid()`/`false` saja): `profiles_insert_own`, `profiles_update_own`, `profiles_no_delete`, `organizations_insert_owner`, `organizations_update_owner`, `organizations_no_delete`, `workspaces_no_delete`, `ws_invitations_no_delete`, `activity_no_update`, `activity_no_delete`, `shares_no_update`.
- Fungsi `accept_invitation()` (0003) dan trigger `audit_resource_share` (0005) — tidak disentuh. `accept_invitation` sudah SECURITY DEFINER dan tidak rekursif.
- Tidak ada tabel, kolom, index, constraint, atau trigger yang dibuat/diubah di 0006.

### 3.4 Semantik TETAP IDENTIK — bukti per policy

Perbandingan mekanis (skrip verifikasi §5): setiap policy baru mempertahankan (a) pengecekan langsung yang sama (`owner_user_id = auth.uid()`, `user_id = auth.uid()`, `id = auth.uid()`, `actor_user_id = auth.uid()`, `shared_with_user_id = auth.uid()`, `shared_by = auth.uid()`), dan (b) himpunan literal role yang sama (`owner`/`admin`/`manager`; policy DELETE memakai kesamaan tunggal `= 'owner'`). Setiap subquery lama dipetakan 1:1 ke helper yang membaca tabel dan kondisi yang sama persis (kolom, `membership_status = 'active'`, filter role) — hanya konteks eksekusinya yang berubah (di dalam SECURITY DEFINER, bypass RLS). Tidak ada kondisi yang ditambah, dikurangi, atau dilonggarkan.

---

## 4. Hasil verifikasi statis

Perintah: `/tmp/pglast-venv/bin/python supabase/tests/rls_verify_0006.py` (dari folder repo) — **SEMUA LOLOS, exit 0.**

1. **Parse sintaks (pglast v8.8, parser PostgreSQL asli):** 0006 ter-parse penuh — **70 statement**: 5 `CreateFunctionStmt`, 5 `CommentStmt`, 10 `GrantStmt` (5 revoke + 5 grant), 25 `DropStmt`, 25 `CreatePolicyStmt`. Tidak ada error parse.
2. **Graf dependensi efektif pasca-0006:** 36 policy berlaku (11 lama tak berubah + 25 baru), **0 siklus**. Tidak ada policy 0006 yang memindai tabel langsung; policy 0006 hanya memanggil 5 helper yang dikenal.
3. **Cross-check DROP/CREATE:** 25 policy rekursif di 0001–0005 = 25 yang di-DROP = 25 yang di-CREATE ulang; himpunan (nama, tabel, perintah) identik; tidak ada policy tambahan.
4. **Helper:** tepat 5; semuanya SECURITY DEFINER + `search_path = public, pg_temp` + STABLE + `returns boolean`; grant EXECUTE hanya ke `authenticated`; revoke dari `public`; tidak ada grant lain; setiap helper hanya membaca tabel yang diizinkan; tanpa dynamic SQL.
5. **Semantik:** 9 pengecekan langsung dipertahankan; himpunan role identik dengan policy lama; 0006 tidak membuat/mengubah tabel, tidak menyentuh `accept_invitation()` maupun trigger audit.

**Catatan koreksi selama verifikasi (jujur):** dua pemeriksaan awal skrip sempat FAIL karena model pemeriksanya yang salah, bukan karena migrasi: (a) graf pertama menggabungkan policy lama + baru tanpa memperhitungkan DROP — setelah diperbaiki ke graf _efektif_ pasca-0006, hasilnya 0 siklus; (b) pembanding role pertama hanya mengenali sintaks `IN (...)` dan melewatkan kesamaan tunggal `= 'owner'` pada dua policy DELETE — setelah diperbaiki, himpunan role identik. Kedua perbaikan ada di skrip final yang tersimpan di repo.

---

## 5. Batas jujur — yang BELUM terbukti

1. **Tidak ada uji terap ke database nyata dari VM ini.** Koneksi Postgres langsung dari VM diblokir dan database live TIDAK boleh disentuh dari sini (sesuai perintah tugas). Verifikasi di atas bersifat **statis** (parse + analisis graf + perbandingan semantik) — kuat, tetapi bukan bukti eksekusi.
2. **pgTAP 14 tes belum dijalankan ulang.** Wajib dilakukan koordinator SETELAH menerapkan 0006 ke database live, sebelum Phase 1 dinyatakan selesai dan Phase 2 dimulai.
3. **Perilaku `auth.uid()` di dalam helper SECURITY DEFINER** diasumsikan bekerja seperti pola standar Supabase (membaca `request.jwt.claims` sesi). Bila pgTAP menunjukkan `auth.uid()` bernilai NULL di dalam helper, seluruh policy berbasis helper akan menolak semua akses (fail-closed, aman tapi lumpuh) — pgTAP T2/T5 (ALLOW) akan menangkapnya.

## 6. Langkah selanjutnya (untuk koordinator)

```bash
# 1. Terapkan 0006 ke database live (SETELAH 0001–0005; jangan ubah 0001–0005)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0006_rls_recursion_fix.sql
#    atau: npx supabase db push   (dari folder repo mative/)

# 2. Jalankan ulang pgTAP 14 tes dengan UUID pengguna uji yang sudah ada di live
psql "$DATABASE_URL" \
  -v user_a='094e8752-eef4-4f0e-b6ae-2d5813445018' \
  -v user_b='aabb1dab-77c1-4659-af0e-c703c9de279c' \
  -f supabase/tests/01_rls_phase1.sql
#    Ekspektasi: 14/14 ok, tanpa ERROR 42P17.

# 3. Verifikasi cepat (opsional, sebagai postgres):
#    select count(*) from pg_policies where schemaname = 'public';
#    select proname from pg_proc where proname in
#      ('is_org_member','is_org_owner','is_ws_member',
#       'is_org_member_of_workspace','shares_workspace_with');
```

Bila pgTAP masih gagal setelah 0006, JANGAN lanjut ke Phase 2 — laporkan output pgTAP lengkap beserta langkah yang gagal.
