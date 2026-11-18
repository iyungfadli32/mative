# Perbaikan file tes pgTAP Phase 1 — v2 (2026-11-19)

File: `supabase/tests/01_rls_phase1.sql` (v1 → v2).
Migrasi 0001–0006 TIDAK diubah. Yang rusak adalah file tesnya, bukan policy RLS.

## Hasil tes ulang v1 (04:19 WIB, Supabase live)

- Error rekursi `42P17` dari tes pertama **SUDAH HILANG** — migrasi 0006 terbukti memperbaiki rekursi.
- Tapi file v1 abort sebelum `finish()`: setup T7 ditolak `42501`, sehingga tidak ada ringkasan 14 tes.
- Diagnostik per tes (asersi identik): lolos T1, T1b, T2, T5, T5b, T6, T7; gagal T3, T3b, T4, T4b, T8, T9 — semuanya cacat file tes (lihat bawah). Probe T3-real membuktikan policy benar: UPDATE role oleh B = 0 baris terpengaruh, role A tetap `owner`.

## 6 cacat v1 dan perbaikannya

| #   | Cacat v1                                                                                                                                                                                                                                    | Perbaikan v2                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Setup T7: INSERT undangan dijalankan sebagai `authenticated` + JWT user B ke workspace A. B bukan member workspace A → policy INSERT menolak (`42501`) → seluruh transaksi abort.                                                           | INSERT undangan dipindah ke bagian setup yang dijalankan sebagai `postgres` (sebelum `set local role authenticated`). Bagian T7 kini hanya berisi asersi `accept_invitation`.                                                                                                               |
| 2   | `throws_ok(sql, deskripsi)` 2 argumen: pgTAP memperlakukan argumen ke-2 sebagai **pola pesan error yang diharapkan** (terbukti: `wanted: an exception: <teks deskripsi>`), sehingga penolakan `42501` yang benar pada T3b/T4 dinilai GAGAL. | `throws_ok` dipakai bentuk 3 argumen dengan kode SQLSTATE: `throws_ok(sql, '42501', 'deskripsi')` untuk T3b/T4, `throws_ok(sql, '23505', 'deskripsi')` untuk T8.                                                                                                                            |
| 3   | UPDATE/DELETE di bawah RLS **tidak pernah melempar exception** saat policy memfilter baris (0 baris terpengaruh). T3 (menarget UUID `1111...` yang barisnya tidak ada) dan T4b tidak akan pernah lolos dengan `throws_ok`.                  | T3/T4b diganti asersi jumlah baris terpengaruh via CTE data-modifikasi + `is(count, 0)`. T3 menarget user A NYATA (barisnya ada) dan punya asersi ke-2: role A tetap `owner` (dibaca sebagai A). T4b: `is(count, 0)`; T5 sesudahnya membuktikan share masih ada.                            |
| 4   | T8 memakai UUID palsu `1111...`/`2222...` yang bukan auth user → foreign key `23503` menolak lebih dulu sebelum unique constraint sempat diperiksa.                                                                                         | T8 memakai UUID uji nyata via placeholder `:'user_b'` (shared_with) dan `:'user_a'` (shared_by). SQL dibangun lewat `format()` karena interpolasi psql TIDAK terjadi di dalam string `$$...$$`. Hal yang sama diterapkan ke T3b/T4 (lebih kuat dari sekadar mengandalkan urutan RLS-vs-FK). |
| 5   | T9: role `anon` tidak punya hak SELECT pada `public.workspaces` → `42501 permission denied` di dalam `is_empty`, bukan hasil RLS.                                                                                                           | `grant select on public.workspaces to anon;` ditambahkan DI DALAM transaksi file, sebelum `set local role anon` (ikut `rollback` di akhir — tidak mengubah database permanen). Yang menolak anon tetap policy RLS (`to authenticated`): query jalan, hasilnya 0 baris.                      |
| 6   | `plan(14)` tetapi hanya 13 panggilan asersi.                                                                                                                                                                                                | `plan(14)` kini benar: 14 asersi — T3 punya 2 asersi (0 baris terpengaruh + role tetap `owner`). Daftar: T1, T1b, T2, T3, T3-role, T3b, T4, T4b, T5, T5b, T6, T7, T8, T9.                                                                                                                   |

## Yang TIDAK berubah

- Maksud dan nama semua tes (T1–T9) sama; policy/migrasi tidak disentuh.
- Placeholder `:'user_a'` / `:'user_b'` dipertahankan (file tetap gaya psql). UUID palsu `1111...`/`2222...` kini hanya ada di dua baris `\set` sebagai nilai default yang memang wajib diganti (lihat bawah) — tidak ada lagi di dalam pernyataan tes.
- Header file diperbarui: langkah 1 kini menyebut migrasi 0001–**0006** (0006 wajib — tanpa 0006, T1 gagal `42P17`).

## Cara menjalankan ulang yang benar

### Via psql (koordinator)

```sh
psql "$DATABASE_URL" \
  -v user_a='094e8752-eef4-4f0e-b6ae-2d5813445018' \
  -v user_b='aabb1dab-77c1-4659-af0e-c703c9de279c' \
  -f supabase/tests/01_rls_phase1.sql
```

UUID di atas adalah 2 pengguna auth uji yang sudah ada di proyek live
(`mative-test-a@example.com` = A, `mative-test-b@example.com` = B).
Ekspektasi: **14/14 ok**, tanpa `not ok`, tanpa `42P17`.

### Via SQL Editor Supabase (tanpa psql)

1. Buka SQL Editor proyek `mative`.
2. Tempel seluruh isi file.
3. **Hapus** kedua baris `\set user_a ...` / `\set user_b ...`.
4. Ganti **setiap** `:'user_a'` dengan literal `'094e8752-eef4-4f0e-b6ae-2d5813445018'` dan **setiap** `:'user_b'` dengan literal `'aabb1dab-77c1-4659-af0e-c703c9de279c'`.
   - Termasuk yang berada di dalam argumen `format(...)` pada T3b, T4, dan T8 — ketiganya berada DI LUAR string `$$...$$`, jadi penggantian literal berfungsi.
   - JANGAN mengganti apa pun di dalam string `$$...$$` (tidak ada placeholder di sana).
5. Jalankan seluruh file sebagai satu query. `begin ... rollback` di akhir membersihkan semua data uji; GRANT untuk T9 ikut rollback.

## Verifikasi statis (VM, 2026-11-19)

- Parse pglast v8.8: **lolos penuh — 54 statement** (setelah membuang 2 baris `\set` dan mengganti placeholder dengan literal, karena pglast tidak mengenal sintaks psql).
- Pemeriksa statis `supabase/tests/rls_verify_test_v2.py`: **10/10 PASS, 0 FAIL**:
  1. pglast parse penuh (54 statement); 2. jumlah asersi == plan(14); 3. throws_ok 3 argumen + SQLSTATE 3/3; 4. UUID palsu hanya di 2 baris `\set`; 5. INSERT undangan T7 di setup postgres (sebelum `set local role authenticated` pertama); 6. tidak ada placeholder di dalam string dollar-quoted (14 blok diperiksa); 7. tidak ada UUID nyata di-hardcode; 8. GRANT SELECT anon untuk T9 di dalam transaksi; 9. CTE upd + del untuk T3/T4b ada; 10. `finish()` + `rollback` di akhir.
- `git status`: hanya `supabase/tests/01_rls_phase1.sql` yang berubah (96 tambah, 22 hapus) + 2 file baru (`docs/rls-test-fix.md`, `supabase/tests/rls_verify_test_v2.py`). Migrasi 0001–0006 TIDAK tersentuh.

## Batas jujur

- **Tidak ada uji terap ke database nyata dari VM ini** (Postgres langsung diblokir; database live tidak disentuh). Hasil 14/14 hanya bisa dibuktikan oleh koordinator lewat psql atau SQL Editor di atas.
- Perilaku policy yang sudah terbukti benar di live (diagnostik 04:19 WIB): T1, T1b, T2, T5, T5b, T6, T7 lolos; probe T3-real (0 baris, role tetap `owner`).
