-- 0034_batch_s1_invitation_checks.sql
-- Batch S-1, temuan S-8: validasi ulang undangan terhadap status pengundang
-- dan keanggotaan penerima di accept_invitation().
--
-- Fungsi menerima p_token_hash (hash sha256 hex dari token; aplikasi yang
-- melakukan hashing) dan mengembalikan jsonb {ok, message, workspace_id}.
-- Sebelumnya accept_invitation() hanya memeriksa token, status pending,
-- expires_at, dan kecocokan email. Dua celah ditutup di sini:
--   1. Penerima yang SUDAH menjadi anggota aktif workspace tidak lagi
--      "menerima" undangan secara diam-diam (sebelumnya ON CONFLICT DO
--      NOTHING membuat penerimaan itu tampak berhasil).
--   2. Undangan ditolak bila invited_by bukan lagi owner/admin aktif
--      workspace (mis. peran dicabut atau keanggotaan dihapus sesudah
--      undangan dikirim).
-- Pemeriksaan yang sudah ada (token, pending, kedaluwarsa, email) dan
-- bentuk hasil jsonb tidak berubah. Tidak ada mutasi pada penolakan:
-- tidak ada baris member/invitation yang diubah.
-- Catatan: tidak ada kolom status pada workspaces, jadi "workspace masih
-- aktif" hanya bisa diperiksa sebatas workspace itu ada (FK).
-- Isi fungsi di bawah disalin dari 0003_workspaces.sql lalu ditambahi dua
-- pemeriksaan S-8 (agar logika token/hash tidak berubah).

create or replace function public.accept_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.workspace_invitations%rowtype;
  v_email text;
begin
  v_email := lower((auth.jwt() ->> 'email')::text);
  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', false, 'message', 'Anda harus masuk dulu.');
  end if;

  select * into v_inv
  from public.workspace_invitations
  where token_hash = p_token_hash;

  if v_inv.id is null then
    return jsonb_build_object('ok', false, 'message', 'Undangan tidak ditemukan atau sudah tidak berlaku.');
  end if;
  if v_inv.status <> 'pending' then
    return jsonb_build_object('ok', false, 'message', 'Undangan ini sudah dipakai atau dicabut.');
  end if;
  if v_inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'message', 'Undangan sudah kedaluwarsa (7 hari).');
  end if;
  if lower(v_inv.email) <> v_email then
    return jsonb_build_object('ok', false, 'message', 'Undangan ini ditujukan ke email lain.');
  end if;

  -- S-8: penerima sudah menjadi anggota aktif workspace ini.
  if exists (
    select 1
    from public.workspace_members
    where workspace_id = v_inv.workspace_id
      and user_id = auth.uid()
      and membership_status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'message', 'Anda sudah menjadi anggota aktif workspace ini.');
  end if;

  -- S-8: pengundang harus masih owner/admin aktif workspace ini.
  if not exists (
    select 1
    from public.workspace_members
    where workspace_id = v_inv.workspace_id
      and user_id = v_inv.invited_by
      and workspace_role in ('owner', 'admin')
      and membership_status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'message', 'Undangan ini tidak lagi berlaku karena pengundang bukan lagi owner atau admin workspace.');
  end if;

  insert into public.workspace_members (workspace_id, user_id, workspace_role, membership_status, invited_by, joined_at)
  values (v_inv.workspace_id, auth.uid(), v_inv.role, 'active', v_inv.invited_by, now())
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
  set status = 'accepted'
  where id = v_inv.id;

  return jsonb_build_object('ok', true, 'message', 'Undangan diterima.', 'workspace_id', v_inv.workspace_id);
end;
$$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;
