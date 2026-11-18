-- MaTive Phase 1 — Migrasi 0001: profiles
-- Dok 05 §3: profiles (id = auth user id, display_name, avatar, locale, timezone).
-- Timestamp disimpan UTC (timestamptz). Timezone default Asia/Jakarta (Keputusan #13).
-- RLS: default deny. Kebijakan eksplisit per operasi (Dok 06 §5).
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

-- SELECT: profil sendiri, atau profil pengguna yang berbagi workspace dengan pemanggil.
create policy "profiles_select_own_or_same_workspace"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.workspace_members wm_self
      join public.workspace_members wm_other
        on wm_other.workspace_id = wm_self.workspace_id
      where wm_self.user_id = auth.uid()
        and wm_self.membership_status = 'active'
        and wm_other.user_id = profiles.id
        and wm_other.membership_status = 'active'
    )
  );

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
