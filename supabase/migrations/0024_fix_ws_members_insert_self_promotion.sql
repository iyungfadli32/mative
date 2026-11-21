-- 0024_fix_ws_members_insert_self_promotion.sql — MaTive (perbaikan temuan audit K-1, Area (a)).
--
-- CACAT (audit super detail 2026-11-21, (a) K-1 — TERVERIFIKASI koordinator):
--   Policy `ws_members_insert_owner_admin_or_self` (0006:303-312; versi asli
--   0003:160-180 sama cacatnya) cabang (a) hanya mensyaratkan
--   `user_id = auth.uid()` + `is_org_member_of_workspace(workspace_id)` —
--   TANPA batasan role dan TANPA bukti "workspace baru". Akibatnya anggota
--   organisasi biasa (role org `member`, bahkan BUKAN member workspace itu)
--   bisa lewat PostgREST langsung melakukan
--     INSERT INTO workspace_members (workspace_id=<workspace orang lain>,
--       user_id=<diri>, workspace_role='owner')
--   dan LOLOS RLS. Seluruh model invite-only workspace runtuh di tangan
--   insider: satu akun org level rendah menjadi owner semua workspace di
--   org itu.
--
-- PERBAIKAN (saran terbaik audit — jalur RPC, bukan tambal policy):
--   (1) Cabang (a) DIHAPUS dari policy. Policy insert baru
--       `ws_members_insert_owner_admin` HANYA mengizinkan owner/admin
--       workspace menambahkan anggota (cabang (b) yang lama). Insert
--       diri-sendiri ke workspace mana pun — dengan role apa pun — kini
--       DITOLAK RLS (42501).
--   (2) Pembuatan membership owner dipindah ke RPC SECURITY DEFINER baru
--       `create_workspace_with_owner(...)` — SATU transaksi atomik:
--       periksa pemanggil member AKTIF organisasi induk, lalu sisipkan
--       baris workspaces + baris workspace_members (owner) sekaligus.
--       Server action `createWorkspaceAction` (features/tenancy/actions.ts)
--       kini memanggil RPC ini, bukan insert langsung.
--   Kenapa RPC, bukan "kunci role + cek workspace baru" di policy:
--   policy tidak bisa membedakan workspace baru vs lama secara andal
--   (cek `created_at` sangat baru adalah heuristik rapuh — balapan waktu
--   + jam server), sedangkan RPC memeriksa keanggotaan org DAN membuat
--   kedua baris sekaligus, sehingga tidak ada jendela di mana workspace
--   ada tanpa owner atau owner ada tanpa workspace.
--
-- TIDAK DIUBAH (di luar cakupan K-1):
--   - Policy UPDATE/DELETE `workspace_members` (temuan Tinggi T-1) dan
--     policy `organization_members` (temuan Tinggi T-2) — TIDAK disentuh.
--   - Helper SECURITY DEFINER 0006 (`is_org_member`, `is_ws_member`,
--     `is_org_member_of_workspace`, dsb.) — TIDAK diubah menjadi
--     SECURITY INVOKER (rekursi akan kembali).
--   - Migrasi 0003 dan 0006 TIDAK diubah (sudah live); perbaikan hanya di
--     file ini. Idempotent: DROP POLICY IF EXISTS + CREATE OR REPLACE
--     FUNCTION, aman diterapkan ulang.
--
-- PENGAMAN RPC (pola yang sama seperti accept_invitation (0003) dan RPC
-- transaksional 0008/0010/0012):
--   (1) search_path dikunci (public, pg_temp) + semua objek di-qualify
--       skema; (2) TIDAK PERNAH melempar — semua penolakan dikembalikan
--       sebagai jsonb {ok:false, code, message}; (3) role owner TIDAK
--       diambil dari parameter pemanggil — selalu 'owner' untuk pembuat
--       workspace; (4) slug duplikat per organisasi ditangkap
--       (unique_violation → DUPLICATE_SLUG), bukan error mentah;
--       (5) grant EXECUTE hanya ke authenticated.
--   RPC ini TIDAK memeriksa brand scope (di luar cakupan K-1) dan TIDAK
--   mengubah perilaku `createOrganizationAction` (keanggotaan owner
--   organisasi tetap lewat policy org_members_insert_owner_or_admin).

-- ============================================================================
-- BAGIAN 1 — RPC create_workspace_with_owner (SECURITY DEFINER).
-- ============================================================================
create or replace function public.create_workspace_with_owner(
  p_organization_id uuid,
  p_name text,
  p_slug text,
  p_timezone text default 'Asia/Jakarta',
  p_default_locale text default 'id'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Anda harus masuk dulu.');
  end if;

  -- Validasi input (cermin workspaceSchema di lib/validation/schemas.ts:
  -- nama min 2 maks 120, slug huruf kecil/angka/tanda hubung maks 80).
  if p_organization_id is null
    or btrim(coalesce(p_name, '')) = ''
    or char_length(btrim(p_name)) < 2
    or char_length(btrim(p_name)) > 120
    or lower(btrim(coalesce(p_slug, ''))) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or char_length(btrim(p_slug)) > 80
    or btrim(coalesce(p_timezone, '')) = ''
    or btrim(coalesce(p_default_locale, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'Data workspace tidak valid.');
  end if;

  -- Hanya member AKTIF organisasi induk yang boleh membuat workspace di
  -- dalamnya (sama seperti policy workspaces_insert_org_member).
  if not public.is_org_member(p_organization_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Anda bukan anggota organisasi ini.');
  end if;

  begin
    insert into public.workspaces (organization_id, name, slug, timezone, default_locale)
    values (p_organization_id, btrim(p_name), lower(btrim(p_slug)), btrim(p_timezone), btrim(p_default_locale))
    returning id into v_workspace_id;

    -- Pembuat otomatis menjadi owner — role TIDAK diambil dari parameter.
    insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, joined_at)
    values (v_workspace_id, auth.uid(), 'owner', 'active', now());
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'DUPLICATE_SLUG', 'message', 'Slug workspace sudah dipakai di organisasi ini.');
  end;

  return jsonb_build_object('ok', true, 'code', 'OK', 'message', 'Workspace dibuat.', 'workspace_id', v_workspace_id);
end;
$$;

comment on function public.create_workspace_with_owner(uuid, text, text, text, text) is
  'Buat workspace + keanggotaan owner pembuatnya dalam satu transaksi (SECURITY DEFINER, 0024 — perbaikan K-1). Satu-satunya jalur sah membuat membership owner; insert langsung ke workspace_members oleh diri sendiri kini ditolak RLS. Jangan ubah jadi SECURITY INVOKER.';

revoke all on function public.create_workspace_with_owner(uuid, text, text, text, text) from public;
grant execute on function public.create_workspace_with_owner(uuid, text, text, text, text) to authenticated;

-- ============================================================================
-- BAGIAN 2 — Tulis ulang policy INSERT workspace_members TANPA cabang (a).
-- ============================================================================
-- ws_members_insert_owner_admin: HANYA owner/admin workspace yang boleh
-- menambahkan anggota. Cabang lama "(a) diri sendiri sebagai owner saat
-- workspace baru dibuat" DIHAPUS — cabang itu yang memungkinkan anggota
-- org biasa mengangkat diri jadi owner workspace mana pun (K-1).
-- Jalur sah membuat membership owner kini hanya RPC
-- create_workspace_with_owner (Bagian 1) dan penerimaan undangan lewat
-- accept_invitation() (0003) — keduanya SECURITY DEFINER dan melewati
-- policy ini, jadi tidak terdampak.
drop policy if exists "ws_members_insert_owner_admin_or_self" on public.workspace_members;
create policy "ws_members_insert_owner_admin"
  on public.workspace_members for insert
  to authenticated
  with check (
    public.is_ws_member(workspace_members.workspace_id, array['owner', 'admin'])
  );

-- ============================================================================
-- CATATAN PENERAPAN (untuk koordinator — database live TIDAK disentuh dari VM):
--   Terapkan 0024 SETELAH 0001–0023, di database yang sama:
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0024_fix_ws_members_insert_self_promotion.sql
--   atau: npx supabase db push   (dari folder repo mative/)
--   Lalu jalankan pgTAP 09 (24 asersi, 3 pengguna auth uji + 1 UUID palsu
--   non-anggota — lihat header supabase/tests/09_rls_critical_k1.sql):
--     psql "$DATABASE_URL" -v user_a='<UUID-USER-A>' -v user_b='<UUID-USER-B>' \
--       -v user_c='<UUID-USER-C>' -f supabase/tests/09_rls_critical_k1.sql
--   Ekspektasi: 24/24 ok, tanpa "not ok".
--   Lalu jalankan e2e k1-security (butuh 2 akun uji + migrasi live):
--     npx playwright test e2e/k1-security.spec.ts
--   Ekspektasi: promosi diri member lewat PostgREST ditolak 403/42501,
--   dan owner tetap bisa membuat workspace lewat UI (regresi RPC).
-- ============================================================================
