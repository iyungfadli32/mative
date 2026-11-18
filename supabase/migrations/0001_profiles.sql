-- MaTive Phase 1 — Migrasi 0001: profiles
-- Dok 05 §3: profiles (id = auth user id, display_name, avatar, locale, timezone).
-- Timestamp disimpan UTC (timestamptz). Timezone default Asia/Jakarta (Keputusan #13).
-- RLS: default deny. Kebijakan eksplisit per operasi (Dok 06 §5).
-- CATATAN URUTAN (perbaikan 2026-11-19): policy SELECT profiles dibuat di
-- 0003_workspaces.sql, bukan di sini — ekspresinya butuh workspace_members.
-- TIDAK ADA security-definer function di file ini.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar text,
  locale text not null default 'id',
  timezone text not null default 'Asia/Jakarta',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Profil pengguna MaTive. id = auth.users.id. Dibuat/diisi aplikasi setelah sign up (upsert), bukan trigger.';

create index if not exists idx_profiles_timezone on public.profiles (timezone);

alter table public.profiles enable row level security;

-- Cabut grant default; beri hanya operasi yang dimaksud ke authenticated.
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

-- SELECT: policy ini TIDAK dibuat di sini — lihat 0003_workspaces.sql.
-- Alasan: ekspresi policy merujuk ke public.workspace_members, tabel yang
-- baru dibuat di 0003. PostgreSQL memvalidasi semua relasi dalam ekspresi
-- policy saat CREATE POLICY dijalankan, sehingga policy ini GAGAL di 0001
-- dengan ERROR 42P01 (relation "public.workspace_members" does not exist).
-- Sampai 0003 dijalankan, SELECT pada profiles ditolak untuk semua orang
-- (RLS aktif tanpa policy SELECT = default deny) — aman selama migrasi
-- karena belum ada data maupun trafik aplikasi. Setelah 0003, policy
-- "profiles_select_own_or_same_workspace" berlaku dengan semantik yang
-- identik dengan yang semula ditulis di sini (profil sendiri, atau profil
-- pengguna yang berbagi workspace aktif dengan pemanggil).

-- INSERT: hanya profil sendiri (id harus = auth.uid()).
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- UPDATE: hanya profil sendiri.
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- DELETE: tidak diizinkan lewat API (penghapusan akun mengikuti prosedur
-- privasi Phase 9; jangan hard-delete diam-diam).
create policy "profiles_no_delete"
  on public.profiles for delete
  to authenticated
  using (false);
