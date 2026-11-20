# Release Runbook — MaTive

Versi: 0.9.0 (Phase 9, 20 November 2026 — DRAF).
Status prosedur backup/restore: **DITULIS, BELUM DIUJI** (lihat §5 — pengujian butuh akses DB staging yang belum tersedia di lingkungan ini).

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

**BELUM DIUJI.** Prosedur di atas ditulis dari dokumentasi Supabase + pola migrasi proyek, tetapi belum pernah dijalankan end-to-end di lingkungan staging (tidak ada DB staging / kredensial DATABASE_URL di lingkungan kerja ini). Sebelum go-live publik, owner harus:

1. Buat proyek Supabase staging (atau gunakan backup harian Free).
2. Jalankan backup manual (§3.2) → restore ke staging → verifikasi hitungan tabel + login + satu alur kritis (masuk → buat konten → approve → jadwalkan).
3. Catat hasil uji di `docs/phase-9-report.md` (atau laporan fase berikutnya) dan ubah status bagian ini menjadi DIUJI + tanggal.

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
