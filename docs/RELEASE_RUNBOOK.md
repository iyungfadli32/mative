# Release Runbook — MaTive

Versi: 0.9.0 (Phase 9, 20 November 2026 — DRAF).
Status prosedur backup/restore: **DIUJI 21 November 2026** (lihat §5).

## 1. Checklist pra-rilis (semua harus hijau)

| #   | Gate             | Perintah / bukti                                                                                              |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Typecheck        | `npx tsc --noEmit` → 0 error                                                                                  |
| 2   | Lint             | `npx eslint .` → 0 problem                                                                                    |
| 3   | Unit             | `npx vitest run` → semua lolos                                                                                |
| 4   | Migrasi (statis) | Verifier pgTAP per fase + `tests/migrations.test.ts`                                                          |
| 5   | pgTAP live       | File `supabase/tests/0X_rls_phaseN.sql` ditempel utuh di SQL Editor, Run sekali → plan penuh lolos            |
| 6   | e2e              | `npx playwright test` (chromium + mobile) → 0 gagal (skip hanya yang ditandai `@needs-db` bila DB belum siap) |
| 7   | Build produksi   | `npm run build` → exit 0                                                                                      |
| 8   | Visual QA        | 7 layar × 3 viewport di `docs/visual-qa/`                                                                     |
| 9   | Keamanan         | 8 tes Dok 06 §8 (lihat `docs/phase-9-report.md` §9.4)                                                         |
| 10  | Dokumen          | `CHANGELOG.md`, `PRIVACY.md`, `TERMS.md` diperbarui                                                           |

Catatan: repo GitHub (B5) belum ada — CI otomatis dan deploy Vercel belum bisa jalan. Sampai B5 selesai, semua gate di atas dijalankan manual dari repo lokal.

## 2. Deploy (aliran yang dimaksud — menunggu B5)

1. Pastikan working tree bersih dan HEAD adalah commit yang lolos semua gate (§1).
2. Push ke `main` di `github.com/iyungfadli32/mative` (repo belum dibuat — butuh tindakan owner).
3. Vercel (terhubung ke repo) men-deploy otomatis; pastikan variabel environment terisi (lihat `.env.example` — 6 variabel; `SUPABASE_SERVICE_ROLE_KEY` hanya di server).
4. Verifikasi pasca-deploy: `GET /api/health` → `status: "ok"`, `phase` dan `version` sesuai rilis; buka `/dashboard` (logged-out) + `/masuk`.
5. Bila health gagal: JANGAN lanjut — lihat §4 (rollback).

Deploy pertama adalah **preview/staging, bukan produksi publik** (ASUMSI-9A). Go-live publik butuh persetujuan eksplisit owner.

## 3. Backup

### 3.1 Apa yang di-backup

- Database Supabase (semua tabel + RLS + fungsi) — sumber utama.
- Storage bucket `mative-assets` (file aset).
- Kode: repo git lokal + (sesudah B5) GitHub.

### 3.2 Cara backup (Supabase Free)

- **Dashboard (utama):** Supabase Dashboard → Project Settings → Database → Backups. Paket Free menyediakan backup harian otomatis dengan retensi terbatas; Point-in-Time Recovery (PITR) **tidak tersedia** di paket Free — pulihkan ke snapshot harian terakhir yang ada.
- **Manual (sebelum perubahan berisiko):** `pg_dump` dengan connection string (mode session, user `postgres`) — simpan file `.dump` di luar repo dengan tanggal. Jangan pernah menulis kredensial ke file yang di-commit.
- **Sebelum menerapkan migrasi baru ke live:** selalu buat backup manual dulu; catat nama file + waktu di `docs/apply-migrations.md`.

## 4. Rollback (ASUMSI-9D)

Prinsip: **migrasi hanya maju, tidak ada down-migration.** Rollback = (a) redeploy build terakhir yang lolos gate + (b) bila perlu, migrasi kompensasi yang membatalkan efek migrasi bermasalah.

1. **Rollback kode:** deploy ulang commit terakhir yang lolos semua gate (Vercel → Deployments → pilih deployment lama → Redeploy; atau `git revert` + push).
2. **Rollback data/skema:** JANGAN `DROP` tabel/kolom secara membabi buta. Tulis migrasi kompensasi baru (mis. mengembalikan policy lama, atau membuat ulang kolom dari backup), uji di staging, lalu terapkan ke live dengan prosedur yang sama seperti migrasi biasa (§1 butir 5).
3. **Bila migrasi gagal di tengah jalan:** satu file SQL Editor yang error 42601/42883 berarti TIDAK ADA statement yang jalan — verifikasi state DB dulu (lihat `docs/apply-migrations.md`), lalu pilih re-run penuh vs sisa saja. Jangan menebak.
4. **Bila data rusak:** pulihkan dari backup §3.2 ke database staging dulu, verifikasi isinya, baru promosikan ke live. Jangan restore langsung ke live tanpa verifikasi.

## 5. Restore — status pengujian

**DIUJI 21 November 2026** (proyek staging `mative-staging`, ref `fharxhdpgjdrcspsvdou`, ap-southeast-1, Nano):

- **Dump:** `pg_dump` live via pooler dari GitHub Codespace (pg_dump langsung dari VM diblokir jaringan VM — port 5432 dijawab invalid SSL; Codespace memakai postgresql-client-17 karena server PG 17.12 menolak pg_dump 16.15). File: public 438.486 byte + auth 5.506 byte (tersimpan di `/tmp` Codespace "scaling robot").
- **Restore:** pooler staging ada di host `aws-1` (bukan `aws-0` seperti live — ambil host persis dari dashboard Connect → Session pooler). Dua rintangan: (a) `CREATE SCHEMA public` di dump gagal karena skema sudah ada → restore memakai salinan dump tanpa baris itu; (b) FK ke `auth.users` gagal bila public di-restore dulu → urutan benar: restore auth dulu, baru public (skema public sempat dikosongkan ulang `DROP SCHEMA public CASCADE` untuk mengulang dari bersih).
- **Hitungan identik:** live 53 tabel public (8 berisi) + auth.users 5 + auth.identities 5; staging sesudah restore 51 tabel, semua nilai sama persis + auth 5/5. Selisih hanya 2 VIEW milik extension pgtap (`pg_all_foreign_keys`, `tap_funky`) — pg_dump tidak menyertakan objek milik extension, bukan data aplikasi; staging tidak memasang pgtap.
- **Cacat restore yang ditemukan + diperbaiki:** restore kehilangan seluruh grant (dump memakai `--no-privileges`, dan `DROP SCHEMA public CASCADE` menghapus USAGE default skema). Gejala: buat organisasi gagal `permission denied for schema public` (42501), REST `GET /rest/v1/organizations` 403; login tetap jalan. Perbaikan: skrip 256 pernyataan (seluruh REVOKE/GRANT migrasi 0001–0023 + `USAGE ON SCHEMA public`) — `backup-test/staging-grants-fix.sql`; 254/256 diterapkan (2 dilewati: `convert_idea_to_content(uuid, text)` 2-arg sudah tidak ada, diganti versi 3-arg). Verifikasi grant: auth_usage true, anon_usage true, table_privs_authenticated 159, table_privs_anon 0, fn_privs_authenticated 73 (73 sudah benar: 76 hitungan kasar − 2 grant ganda untuk fungsi yang sama − 1 fungsi usang).
- **Alur kritis TERBUKTI di staging** (aplikasi lokal menunjuk staging, Chromium, 21 Nov 01:49 WIB, 12 tes, 10 lolos / 2 gagal / 0 skip, 5,2 menit): masuk → buat organisasi + workspace → buat konten (2 placement, kalender, edit, pindah stage, reschedule) → submit v1 → revisi → v2 → stale ditolak → v3 → setujui → Disetujui → jadwalkan segera → handoff manual → konfirmasi → Published. Kedua kegagalan adalah cacat locator tes, bukan aplikasi: (a) `approval.spec.ts:230` — `getByText('disetujui')` cocok ke 3 elemen (snapshot membuktikan keputusan approver tercatat; tes dua-peran ini baru pertama kali dieksekusi — sebelumnya selalu skip karena `E2E_APPROVER_*` kosong); (b) `auth.spec.ts:47` — `getByRole('cell', {name: 'active'})` cocok ke 2 elemen karena tes dua-peran berjalan paralel (isolasi tes, bukan aplikasi). Perbaikan locator belum diterapkan.
- **Catatan:** password DB live di-reset atas persetujuan owner untuk uji ini (password baru tidak disimpan di mana pun); hang `POST /auth/v1/token` staging ±20 menit pada uji pertama, pulih sendiri, tidak terulang pada uji ulang. File dump tidak dipertahankan sebagai arsip (hanya di `/tmp` Codespace) — untuk arsip backup, ikuti §3.2.

## 6. Insiden

1. **Kenali:** `/api/health` gagal / error rate naik / laporan pengguna. Cek log Vercel + Supabase Dashboard → Logs.
2. **Batasi dampak:** bila satu rute bermasalah, pertimbangkan rollback kode (§4.1) sebelum menyelidiki lebih jauh.
3. **Kabari:** laporkan ke owner di chat utama — cepat, akurat, tanpa delay (aturan kabar 2026-11-19).
4. **Jangan** memutar ulang aksi yang gagal berulang kali tanpa diagnosis; jangan mengubah data live langsung tanpa backup (§3.2).
5. **Pasca-insiden:** tulis apa yang terjadi + perbaikan di `CHANGELOG.md` (bagian "Diperbaiki").

## 7. Monitoring (saat ini)

- `/api/health` — status, phase, version, `supabaseConfigured`.
- `activity_logs` — jejak audit aksi penting.
- **Belum ada:** structured logging, alerting otomatis, dashboard uptime. Tidak ada layanan berbayar yang dipakai tanpa persetujuan owner (ASUMSI-9B).
