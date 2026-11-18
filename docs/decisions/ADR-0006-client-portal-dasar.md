# ADR-0006 — Client portal dasar (P1-16, Keputusan #12)

- **Status:** Diterima (scope Phase 1 saja). **Tanggal:** 2026-11-19.
- **Konteks:** Rencana v2 bagian (a); Dok 06 §2 (`viewer_client`).
- **Keputusan:**
  - Login portal memakai auth yang sama; role `viewer_client`.
  - Izin ditegakkan di server (`features/portal/actions.ts`) + RLS
    (`resource_shares`, migrasi 0005): klien hanya membaca share yang
    `shared_with_user_id = auth.uid()` (atau member workspace pemilik share).
  - Daftar share dicatat di audit lewat trigger `trg_audit_resource_share`
    → `activity_logs`.
  - Komentar klien default TIDAK BOLEH; tidak ada endpoint komentar klien
    di fase ini (baru Phase 4 bila workspace mengizinkan eksplisit).
  - Detail isi konten (judul, naskah, aset) dirender penuh di Phase 2 saat
    tabel content ada; di fase ini portal menampilkan metadata share yang
    terverifikasi — tanpa isi karangan.
- **Uji:** allow/deny portal sebagai bagian dari 8 tes keamanan Dok 06 §8
  (pgTAP T5/T5b: klien bisa membaca share-nya; tidak bisa menebak UUID
  resource yang tidak dibagikan; tidak bisa mutasi apa pun — T4/T4b).
- **Yang tetap ditunda:** billing portal, white-label/agency portal,
  workflow builder kustom, custom fields, self-serve publik.
