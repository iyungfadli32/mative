# Menerapkan migrasi Phase 1 ke database live (untuk koordinator)

> Dokumen ini berisi perintah persis yang harus dijalankan koordinator.
> Coding agent TIDAK memegang service-role key / DATABASE_URL, jadi TIDAK
> menjalankan langkah di bawah ini. Jangan klaim migrasi sudah diterapkan
> sebelum perintah di sini dijalankan dan keluarannya dicatat.

## Prasyarat

- Proyek Supabase "mative" — ref `kwyqtlxglhlvtghfrnhr`, region ap-southeast-1 (Singapore), Free.
- Dashboard: https://supabase.com/dashboard/project/kwyqtlxglhlvtghfrnhr
- `DATABASE_URL` (koneksi Postgres langsung, dari Dashboard → Settings → Database → Connection string, mode Session/Transaction + password).
- Supabase CLI terpasang (opsional, bila memakai `supabase db push`).

## Opsi A — lewat Supabase CLI (disarankan)

Dari dalam folder repo (`mative/`):

```bash
# 1. Login + tautkan proyek (sekali saja)
npx supabase login
npx supabase link --project-ref kwyqtlxglhlvtghfrnhr

# 2. Terapkan SEMUA migrasi 0001–0008 ke database live
npx supabase db push

# 3. Verifikasi tabel + RLS aktif
npx supabase db diff --help   # (opsional) pastikan tidak ada drift
psql "$DATABASE_URL" -c "select schemaname, tablename, rowsecurity from pg_tables where schemaname='public' order by tablename;"
# Ekspektasi: profiles, organizations, organization_members, workspaces,
# workspace_members, workspace_settings, workspace_invitations,
# activity_logs, resource_shares — semuanya rowsecurity = t.
```

## Opsi B — lewat psql langsung (tanpa CLI)

```bash
export DATABASE_URL='postgresql://postgres:<PASSWORD>@db.kwyqtlxglhlvtghfrnhr.supabase.co:5432/postgres'

for f in supabase/migrations/0001_profiles.sql \
         supabase/migrations/0002_organizations.sql \
         supabase/migrations/0003_workspaces.sql \
         supabase/migrations/0004_activity_logs.sql \
         supabase/migrations/0005_resource_shares.sql \
         supabase/migrations/0006_rls_recursion_fix.sql \
         supabase/migrations/0007_planning_core.sql \
         supabase/migrations/0008_planning_transactions.sql; do
  echo "== $f =="
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

**Urutan wajib: 0007 dulu, lalu 0008** (0008 memanggil tabel + helper RLS dari 0007).

Verifikasi fungsi RPC Phase 2 (ekspektasi: 6 baris):

```bash
psql "$DATABASE_URL" -c "select proname from pg_proc where proname in ('create_content_item_with_version','update_content_item_with_version','transition_content_item_status','convert_idea_to_content','reschedule_placement','change_placement_distribution');"
```

Semua file idempotent (`create table if not exists`, `create policy` akan gagal
bila policy sudah ada — bila menjalankan ulang, hapus policy dulu atau jalankan
sekali saja di database bersih).

## RLS policy tests (pgTAP) — setelah migrasi

```bash
# 1. Aktifkan ekstensi pgtap (Dashboard → Database → Extensions → pgtap),
#    atau:  psql "$DATABASE_URL" -c "create extension if not exists pgtap;"

# 2. Buat 2 pengguna auth uji (Dashboard → Authentication → Add user),
#    catat UUID-nya sebagai USER_A dan USER_B.

# 3. Jalankan tes (14 tes; ekspektasi: semua ok, tidak ada "not ok"):
psql "$DATABASE_URL" \
  -v user_a='<UUID-USER-A>' -v user_b='<UUID-USER-B>' \
  -f supabase/tests/01_rls_phase1.sql
```

## RLS policy tests Phase 2 (pgTAP) — setelah migrasi 0007 + 0008

```bash
# Jalankan tes Phase 2 (20 tes; ekspektasi: semua ok, tidak ada "not ok"):
psql "$DATABASE_URL" \
  -v user_a='<UUID-USER-A>' -v user_b='<UUID-USER-B>' \
  -f supabase/tests/02_rls_phase2.sql

# Lalu jalankan spek penerimaan Phase 2 (e2e live, butuh akun uji):
E2E_TEST_EMAIL='<email-akun-uji>' E2E_TEST_PASSWORD='<password-akun-uji>' \
  npx playwright test --project=chromium e2e/planning.spec.ts
# Ekspektasi: semua tes lolos (tidak lagi skip).
```

## RLS policy tests Phase 3 (pgTAP) — setelah migrasi 0009 + 0010 + 0011 + 0012

```bash
# Jalankan tes Phase 3 (35 tes v1.1; ekspektasi: semua ok, tidak ada "not ok"):
psql "$DATABASE_URL" \
  -v user_a='<UUID-USER-A>' -v user_b='<UUID-USER-B>' \
  -f supabase/tests/03_rls_phase3.sql

# Lalu jalankan spek penerimaan Phase 3 (e2e live, butuh akun uji):
E2E_TEST_EMAIL='<email-akun-uji>' E2E_TEST_PASSWORD='<password-akun-uji>' \
  npx playwright test --project=chromium e2e/production.spec.ts
# Ekspektasi: 3/3 (1 tes penerimaan live + 2 smoke tanpa login).
# Juga jalankan ulang regresi Phase 2 (editor bertab):
E2E_TEST_EMAIL='<email-akun-uji>' E2E_TEST_PASSWORD='<password-akun-uji>' \
  npx playwright test --project=chromium e2e/planning.spec.ts
# Ekspektasi: 4/4.
```

**Urutan wajib Phase 3: 0009 dulu, lalu 0010, lalu 0011, lalu 0012** (0010 memakai
tabel dari 0009; 0011 mengganti fungsi trigger dari 0007; 0012 mengganti RPC
convert_idea_to_content dari 0008 — 0007 dan 0008 tidak diubah). **0009, 0010,
0011 DITERAPKAN live 19 Nov 2026 (14:08–14:16 WIB, terverifikasi); 0012
DITERAPKAN live 19 Nov 2026 15:22 WIB, terverifikasi: definisi fungsi 3-arg
(p_idea_id, p_title, p_brand_id) + guard brand + count pg_proc = 1 (overload
lama hilang).** Detail lengkap + verifikasi per langkah + pembersihan data uji:
`docs/phase-3-report.md` §8.

## RLS policy tests Phase 4 (pgTAP) — setelah migrasi 0013 + 0014

```bash
# Jalankan tes Phase 4 (64 tes v1.4; ekspektasi: semua ok, tidak ada "not ok"):
psql "$DATABASE_URL" \
  -v user_a='<UUID-USER-A>' -v user_b='<UUID-USER-B>' \
  -f supabase/tests/04_rls_phase4.sql

# Lalu jalankan spek penerimaan Phase 4 (e2e live, butuh akun uji):
E2E_TEST_EMAIL='<email-akun-uji>' E2E_TEST_PASSWORD='<redacted>' \
  npx playwright test --project=chromium e2e/approval.spec.ts
# Ekspektasi: 2 lolos (1 penerimaan + 1 smoke); 1 tes dua-peran SKIP kecuali
# E2E_APPROVER_EMAIL/E2E_APPROVER_PASSWORD diisi (akun approver kedua
# harus sudah dibuat sebelumnya).
# Juga jalankan ulang regresi Phase 2 + Phase 3:
E2E_TEST_EMAIL='<email-akun-uji>' E2E_TEST_PASSWORD='<redacted>' \
  npx playwright test --project=chromium e2e/planning.spec.ts e2e/production.spec.ts
# Ekspektasi: planning 4/4 + production 3/3.
```

**Urutan wajib Phase 4: 0013 dulu, lalu 0014** (0014 memakai tabel dari
0013 dan mengganti `transition_content_item_status` dari 0008 — 0008
tidak diubah kecuali guard itu; migrasi 0001–0012 tidak diubah).
**0013 DITERAPKAN live 19 Nov 2026 17:40 WIB, 0014 DITERAPKAN live
19 Nov 2026 17:54 WIB — keduanya terverifikasi** (4 tabel RLS ×4,
16 policy, 7 fungsi, 0 grant helper ke authenticated, guard
APPROVAL_REQUIRED). **Migrasi 0015 (perbaikan cacat produk: notifikasi
target 'placement') DITERAPKAN live 19 Nov 2026 18:35 WIB,
terverifikasi** (CHECK mencakup 'placement'; definisi
`validate_notification_scope()` memuat cabang placement). **pgTAP 04
v1.4: 64/64 PASS live 19 Nov 2026 18:42 WIB. E2E live 19 Nov 2026
20:21 WIB: approval 2 passed + 1 skip, planning 4/4, production 3/3.**
Detail lengkap + saga kegagalan + cacat yang ditemukan selama e2e:
`docs/phase-4-report.md` §11 (deklarasi). **Migrasi kini 0001–0015.**

## RLS policy tests Phase 5 (pgTAP) — setelah migrasi 0016 + 0017 + 0018 + 0019

```bash
# Jalankan tes Phase 5 (61 tes v1.2; ekspektasi: semua ok, tidak ada "not ok"):
psql "$DATABASE_URL" \
  -v user_a='<UUID-USER-A>' -v user_b='<UUID-USER-B>' \
  -f supabase/tests/05_rls_phase5.sql

# Lalu jalankan spek penerimaan Phase 5 (e2e live, butuh akun uji):
E2E_TEST_EMAIL='<email-akun-uji>' E2E_TEST_PASSWORD='<password-akun-uji>' \
  npx playwright test --project=chromium e2e/campaign.spec.ts
# Ekspektasi: 4/4 (3 tes @needs-db + 1 smoke).
# Juga jalankan ulang regresi Phase 2 + Phase 3 + Phase 4:
E2E_TEST_EMAIL='<email-akun-uji>' E2E_TEST_PASSWORD='<password-akun-uji>' \
  npx playwright test --project=chromium e2e/planning.spec.ts e2e/approval.spec.ts e2e/production.spec.ts
# Ekspektasi: planning 4/4 + approval 2 lolos/1 skip + production 3/3.
```

**Urutan wajib Phase 5: 0016 dulu, lalu 0017, lalu 0018, lalu 0019**
(0018 memperbaiki RPC `set_visual_order` dari 0017; 0019 memperbaiki
policy INSERT brands dari 0016; migrasi 0001–0015 tidak diubah).
**0016 DITERAPKAN live 19 Nov 2026 21:13–21:15 WIB; 0017 DITERAPKAN
live 19 Nov 2026 21:40–21:42 WIB** (Run pertama gagal 42601 — policy
INSERT `visual_orders` memakai `using (false)`; diperbaiki commit
`f3f1e7a`; 42601 = parse error, tidak ada statement yang dieksekusi —
jangan berasumsi penerapan parsial); **0018 DITERAPKAN live 19 Nov
2026 22:30–22:34 WIB; 0019 DITERAPKAN live 19 Nov 2026 23:01–23:02
WIB** — semuanya terverifikasi. **pgTAP 05 v1.2: 61/61 PASS live
19 Nov 2026 23:11 WIB (v1.0 sempat 47/59; v1.1 59/59). E2E live
(Chromium, re-run sekuensial `--workers=1`): 13 lolos + 1 skip,
0 gagal, 19–20 Nov 2026** (tes mobile WebKit belum dijalankan —
library sistem hilang, menunggu keputusan Tuan/B4). Detail lengkap +
saga kegagalan + cacat yang ditemukan selama e2e:
`docs/phase-5-report.md` §11 (deklarasi). **Migrasi kini 0001–0019**
(sebelum Phase 6).

**Phase 6 — 0020 DITERAPKAN live 20 Nov 2026 01:35–01:36 WIB**
(v1.1, 979 baris; 3 tabel RLS + 12 policy + 10 fungsi, terverifikasi
01:37–01:39 WIB). **pgTAP 06 v1.1: 109/109 PASS live 20 Nov 2026
02:32 WIB** (v1.0 sempat gagal 23503 — cleanup menghapus `brands`
sebelum `content_items`; v1.1 urutan daun → akar). **E2E publishing
live 6/6 (Chromium + mobile iPhone 13, `--workers=1`)** — tes mobile
WebKit SUDAH dijalankan di Phase 6 (library sistem sempat hilang lalu
diinstal ulang); regresi 22 lolos + 2 skip, 4 gagal (1 flake A5.1 —
run ulang solo lolos; 3 smoke mobile pre-existing, sidebar hidden <
md). Dua cacat aplikasi diperbaiki selama e2e (`a2ed6cb` bug
`new Date(v)` 7 jam jalur placement; `e6d705e` preflight halaman
buat-job). Detail lengkap: `docs/phase-6-report.md` §11 (deklarasi).
**Migrasi kini 0001–0020.**

**Phase 7 — 0021 DITERAPKAN live 20 Nov 2026 ~04:44 WIB**
(v1.1, 846 baris; 6 tabel RLS + 20 policy — `channel_credentials` 0
by design — + 7 fungsi + seed 14 kunci metrik, terverifikasi).
v1.0 sempat gagal 42883 (`max(uuid)` tidak ada di Postgres — RPC
baru ketahuan saat dieksekusi, padahal lolos pglast + verifier);
v1.1 memakai subquery skalar, diterapkan 04:58–04:59 WIB.
**pgTAP 07 v1.5: 77/77 PASS live 20 Nov 2026 06:38 WIB** (v1.0
abort 42883; v1.1 T6a/T6d jadi `throws_ok` 42501; v1.2 perbaiki
16 kegagalan Run 3 — bug role `_set_user` + 2 ekspektasi;
v1.3 perbaiki abort 21000 T13b — subquery campaign_metrics tanpa
filter periode; v1.4 perbaiki abort 42501 cleanup — `reset role`
sebelum cleanup; v1.5 perbaiki T14c — `count(*)` tanpa filter
periode; Run 6 "failed 5" vs diag Run 7 "1 (T14c)" — selisih
tidak terjawab, dicatat jujur; Run 8 77/77 menyusul Run 6).
**E2E analytics live (Chromium + mobile iPhone 13,
`--workers=1`): 6 lolos + 1 skip (A7.5 skip by design), 0 gagal** —
Chromium dua run hijau berturut-turut, mobile percobaan pertama.
Regresi Chromium 16 lolos + 1 skip, 0 gagal; regresi mobile
13 lolos + 1 skip, 3 gagal pre-existing (sidebar hidden < md —
keputusan produk masih menggantung sejak Phase 6). Satu cacat
aplikasi diperbaiki selama e2e (`cbca252` — kolom query analytics
tidak ada di 0021, PostgREST 400); locator test-only (3 commit) +
timeout config 30 → 120 dtk (`409406b`); flake hang UI server
action tercatat untuk Phase 9 (DB selalu ter-commit, tombol
tetap disabled — tersangka belum terbukti). Detail lengkap:
`docs/phase-7-report.md` §11 (deklarasi).
**Migrasi kini 0001–0021.**

## Seed demo (local/preview SAJA — JANGAN di database produksi)

```bash
psql "$DATABASE_URL" \
  -v owner_user='<UUID-OWNER>' -v member_user='<UUID-MEMBER>' \
  -f supabase/seed.sql
```

## Setelah migrasi diterapkan

1. Isi env var di Vercel (preview): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`.
   (`SUPABASE_SERVICE_ROLE_KEY` hanya bila server action admin membutuhkannya;
   di Phase 1 hanya dipakai untuk pengiriman email undangan otomatis — tanpa
   itu, undangan tetap bisa dibuat dan tautannya diteruskan manual.)
2. Jalankan e2e critical flow:
   ```bash
   E2E_TEST_EMAIL='<email-akun-uji>' E2E_TEST_PASSWORD='<password-akun-uji>' \
     npx playwright test e2e/auth.spec.ts --project=chromium
   ```
3. Catat output (migrasi + pgTAP + e2e) ke laporan fase dan tandai gate 1, 5, 6, 9
   sebagai LOLOS — baru setelah itu Phase 1 boleh dinyatakan selesai dan
   Phase 2 boleh dimulai.
