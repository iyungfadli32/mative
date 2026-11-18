# ADR-0002 — Hierarki tenancy: Organization → Workspace → (Brand di Phase 2)

- **Status:** Diterima. **Tanggal:** 2026-11-19. **Konteks:** Dok 05 §2, P1-08/P1-09.
- **Keputusan:** Hierarki tiga tingkat — Organization (akun pelanggan/agensi) →
  Workspace (batas kerja tim) → Brand (Phase 2). Setiap baris tenant-owned
  membawa scope organisasi/workspace atau dapat dijangkau lewat parent terverifikasi.
- **Satu user bisa punya role berbeda di workspace berbeda** (matriks per workspace,
  bukan per akun global).
- **Brand scope (P1-A7):** dicatat sebagai kolom `workspace_members.brand_scope`
  (JSONB) untuk masa depan, BELUM ditegakkan sebagai filter terpisah di fase ini —
  ditegakkan paling lambat sebelum Phase 5 (Keputusan #9).
- **"Limited" (P1-A6, Keputusan #9):** lihat + edit yang ditugaskan saja; TIDAK
  boleh mengubah settings, mengundang/mengubah member, menghapus, mengubah role,
  atau mengakses tenant lain. Ditegakkan di `lib/permissions.ts` (cermin UI/server)
  DAN di RLS (penegak sesungguhnya).
- **Undangan (P1-A5):** 7 hari, satu kali pakai, bisa dicabut. Token disimpan
  sebagai hash sha256; penerimaan lewat fungsi `accept_invitation()` (SECURITY
  DEFINER, ditinjau — lihat komentar migrasi 0003) karena penerima belum member.
- **Konsekuensi:** semua query tenant-scoped harus membawa workspace_id;
  RLS adalah pertahanan terakhir, bukan UI.
