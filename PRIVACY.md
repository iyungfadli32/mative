# Kebijakan Privasi — MaTive

Terakhir diperbarui: 20 November 2026 (Phase 9, v0.9.0 — DRAF).

MaTive adalah platform operasi konten (Plan → Create → Collaborate → Approve → Publish → Analyze) untuk tim. Dokumen ini menjelaskan data apa yang dikumpulkan, bagaimana data dipakai, dan apa yang belum tersedia.

## 1. Data yang kami kumpulkan

| Data                                                                       | Sumber                   | Tujuan                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Email + kata sandi (ter-hash)                                              | Pendaftaran / masuk      | Autentikasi (Supabase Auth). MaTive tidak pernah menyimpan kata sandi dalam bentuk yang bisa dibaca.                                                               |
| Nama tampilan, locale, timezone                                            | Profil pengguna          | Personalisasi tampilan dan penjadwalan.                                                                                                                            |
| Organisasi, workspace, peran anggota                                       | Dibuat pengguna          | Isolasi tenant: pengguna hanya melihat workspace tempat ia menjadi anggota (ditegakkan RLS di database).                                                           |
| Konten, brief, script, placement, task, komentar, campaign, brand, channel | Dibuat pengguna          | Fungsi inti aplikasi.                                                                                                                                              |
| Aset (gambar/dokumen)                                                      | Diunggah pengguna        | Disimpan di bucket privat `mative-assets`; akses hanya lewat URL bertanda tangan yang kedaluwarsa 1 jam. Ukuran maks 10 MB; tipe file divalidasi dari magic bytes. |
| Metrik analitik (impor CSV)                                                | Diunggah pengguna        | Dashboard performa.                                                                                                                                                |
| Log aktivitas (`activity_logs`)                                            | Otomatis                 | Jejak audit aksi penting (siapa, apa, kapan).                                                                                                                      |
| Log pemakaian AI (`ai_generations`)                                        | Otomatis bila AI dipakai | Audit pemakaian AI; retensi 90 hari.                                                                                                                               |

## 2. AI — nonaktif

Asisten AI MaTive **nonaktif** (tidak ada provider yang dikonfigurasi). Selama nonaktif, **tidak ada data pengguna yang dikirim ke model AI eksternal mana pun**. Bila AI diaktifkan di kemudian hari, dokumen ini akan diperbarui sebelum aktivasi, dan keluaran AI tetap berstatus draf sampai disetujui manusia.

## 3. Pihak ketiga

- **Supabase** (hosting database, auth, storage) — region ap-southeast-1. Data disimpan di Supabase; MaTive tidak memakai layanan analitik pihak ketiga, tidak ada iklan, dan tidak ada pelacak.
- **Tidak ada** pengiriman data ke platform media sosial secara otomatis — publikasi saat ini manual (pengguna menekan terbitkan dan mengonfirmasi sendiri).

## 4. Keamanan

- Row Level Security (RLS) aktif di semua tabel; kebijakan diuji otomatis (pgTAP) tiap fase.
- Kunci service-role hanya dipakai di server, tidak pernah masuk ke bundle browser atau log.
- URL aset privat kedaluwarsa 1 jam dan tidak bisa dipakai ulang sesudahnya.
- Undangan berlaku 7 hari, satu kali pakai, bisa dicabut; token disimpan sebagai hash SHA-256.

## 5. Hak pengguna

- **Akses & koreksi:** pengguna dapat melihat dan mengubah profilnya sendiri di halaman Profil.
- **Pencabutan akses anggota:** owner workspace dapat menghapus anggota dari halaman Tim & Peran — akses anggota tersebut tercabut seketika.
- **Penghapusan akun / data:** **belum tersedia secara self-service.** Pengguna yang ingin akunnya dihapus dapat meminta owner workspace menghapus keanggotaannya; penghapusan akun penuh (termasuk data auth) saat ini hanya bisa dilakukan operator melalui dashboard Supabase. Fitur penghapusan akun mandiri direncanakan untuk fase berikutnya dan akan dicantumkan di sini bila tersedia.

## 6. Retensi

- Log pemakaian AI: 90 hari.
- Data workspace (konten, aset, metrik): tersimpan selama workspace ada; tidak ada penghapusan otomatis.
- Undangan kedaluwarsa: tetap tercatat dengan status kedaluwarsa.

## 7. Perubahan

Perubahan kebijakan ini dicatat di `CHANGELOG.md` dan tanggal "Terakhir diperbarui" di atas. Penggunaan MaTive sesudah perubahan berarti menyetujui kebijakan yang diperbarui.

## 8. Kontak

MaTive masih dalam tahap pengembangan (DRAF — belum rilis publik). Belum ada alamat kontak dukungan resmi; pertanyaan privasi saat ini disampaikan langsung ke pemilik proyek.
