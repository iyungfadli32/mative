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
