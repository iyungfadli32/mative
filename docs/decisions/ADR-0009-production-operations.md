# ADR-0009 — Production Operations Phase 3 (P3-01 s.d. P3-12)

- **Status:** Diterima (DRAF fase — migrasi 0009 + 0010 belum diterapkan ke database live).
- **Tanggal:** 2026-11-19. **Konteks:** PLAN-MATIVE-001 Phase 3, Dok 05 §3–§8, Dok 06 §3/§5/§8, Dok 02 §1/§3 (sitemap + Content Workspace + Asset Library), Dok 12 Phase 3, prompts/04, rencana detail Phase 3 (P3-A1 s.d. P3-A6), Rencana-MaTive-Lengkap-v2 (Keputusan #8, #9, #12).
- **Cakupan ADR ini:** HANYA migrasi 0009 + 0010 + kode aplikasi Phase 3. TIDAK mengubah 0001–0008, TIDAK mengubah tes pgTAP 01/02, TIDAK membangun approval/publishing/integrasi/analytics/AI/billing.

## Keputusan

### 1. Daftar nilai polimorfik dikunci (P3-A1)

| Kolom                       | Nilai yang diizinkan (CHECK di DB)                                         |
| --------------------------- | -------------------------------------------------------------------------- |
| `tasks.parent_type`         | `content_item`, `campaign`                                                 |
| `comments.target_type`      | `content_item`, `campaign`, `task`                                         |
| `notifications.target_type` | `content_item`, `campaign`, `task`, `comment`                              |
| `notifications.type`        | `mention`, `task_assigned`, `task_status_change`, `comment_reply`          |
| `content_assets.usage_role` | `primary`, `reference`, `thumbnail`, `attachment`                          |
| `tasks.status`              | `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled` (P3-A2) |
| `tasks.priority`            | `low`, `medium`, `high`, `urgent` (P3-A2)                                  |
| `assets.processing_status`  | `uploading`, `ready`, `failed`                                             |

- Nilai di luar daftar ditolak DB (CHECK), bukan hanya UI. Menambah nilai baru hanya lewat migrasi + ADR.
- `approval_requests.target_type` (Phase 4) dicatat di sini sebagai `content_item`, `placement` (P3-A1) tetapi TIDAK dibuat tabelnya di fase ini.

### 2. Mesin status task (cermin ganda: TS + SQL)

- Maju: `todo → in_progress → in_review → done`.
- `todo`/`in_progress`/`in_review` → `blocked`; `blocked` → `todo`.
- Status apa pun kecuali `done` → `cancelled`; `cancelled` → `todo` (buka lagi).
- `done` terminal kecuali `done` → `todo` TIDAK diizinkan (tugas selesai tidak dibuka lagi diam-diam; buat task baru bila perlu diulang).
- Setiap transisi menulis `activity_logs` (RPC `transition_task_status`, satu transaksi). Tabel yang sama ditulis dua kali: `features/production/transitions.ts` dan migrasi 0010 — yang di database yang menang bila berbeda.
- Checklist: `task_checklist_items` (title, sort_order, is_done, completed_by, completed_at). Menandai selesai mengisi `completed_by`/`completed_at`; membuka lagi mengosongkannya.

### 3. Izin "limited" untuk task (preceden content_items 0007)

- `manage_tasks` (Dok 06 §3): owner/admin/manager penuh; strategist/creator/editor/approver "limited"; analyst hanya baca; viewer_client tidak boleh.
- **INSERT (RLS):** peran penuh boleh menugaskan ke siapa pun; peran "limited" hanya boleh membuat task dengan `assignee_user_id` = dirinya sendiri ATAU kosong (belum ditugaskan) — cermin `items_insert_editors` (owner = diri). Server action memeriksa ulang agar pesannya jelas.
- **UPDATE/DELETE (RLS):** peran penuh bebas; peran "limited" hanya task yang `assignee_user_id` = dirinya (P3-02: "creator hanya bisa mengedit task yang ditugaskan"). Mengalihkan assignee ke orang lain oleh peran "limited" ditolak RLS.
- **SELECT:** semua member aktif workspace (kecuali viewer_client) melihat semua task workspace; viewer_client hanya task yang parent-nya (content_item/campaign) dibagikan eksplisit kepadanya (helper `is_resource_shared_with_me`, reuse 0007).

### 4. Aset privat (P3-A3) — bucket `mative-assets`

- Bucket Supabase Storage `mative-assets`, **privat** (`public = false`), dibuat migrasi 0009. Tidak ada URL publik permanen; akses hanya lewat signed URL 1 jam (`createSignedUrl`, 3600 detik).
- `object_key` = `<workspace_id>/<asset_id>/<nama-file-disarankan>` — workspace_id sebagai folder pertama agar policy storage bisa memeriksa keanggotaan lewat `is_ws_member` + guard regex UUID.
- Batas: **maks 10 MB per file** (CHECK `byte_size <= 10485760` + validasi server); allowlist MIME **dari isi file (magic bytes, bukan ekstensi)**: `image/png`, `image/jpeg`, `image/webp`, `video/mp4`, `video/webm`, `application/pdf`. Executable/script/arsip ditolak.
- `checksum` = SHA-256 isi file. `width`/`height` diurai server-side hanya untuk PNG/JPEG (header IHDR / marker SOF); WebP/video/PDF: `null` (batas jujur — bukan kegagalan). `duration_ms`: `null` di fase ini (tidak ada parser durasi; dicatat, bukan ditebak).
- **Tanpa pemindaian virus di MVP** — known limitation, jangan klaim aman dari malware (P3-A3).
- `asset_versions` v1 dibuat saat upload berhasil. Upload gagal → baris aset tetap ada dengan `processing_status = 'failed'` (jejak, bukan record setengah jadi yang hilang diam-diam).
- Hapus aset: hanya bila TIDAK ada baris `content_assets` yang merujuk (diperiksa server action; bila masih ada, tolak dengan pesan yang jelas) + cek retensi P3-A4 (archive/soft-delete dulu; tidak ada hard-delete file storage sebelum kebijakan Phase 9). Menghapus lampiran (`content_assets`) TIDAK menghapus file aset.
- `brands.logo_asset_id` kini ber-FK ke `assets(id) ON DELETE SET NULL` (janji 0007 ditepati).

### 5. Komentar, mention, dan gerbang klien (v2: Keputusan #12)

- **Mention eksplisit, bukan parsing teks.** Penyebutan dipilih lewat pemilih anggota workspace di form komentar; `p_mentioned_user_ids` diserahkan eksplisit ke RPC. Parsing `@nama` dari teks TIDAK dilakukan di fase ini (rapuh: nama duplikat, ejaan) — peningkatan nanti, bukan tebakan sekarang.
- RPC `create_comment_with_mentions` (satu transaksi): sisipkan `comments` + `mentions` + `notifications` (type `mention`) + `activity_logs`. Mention hanya untuk member aktif workspace yang sama (diperiksa RPC; menyebut non-member ditolak).
- Komentar tidak bisa dihapus diam-diam: edit mengisi `edited_at`; hapus = soft-delete (`deleted_at` + `deleted_by`); isi komentar yang dihapus tampil sebagai "Komentar ini dihapus" (bukan hilang tanpa jejak).
- **Komentar klien (viewer_client):** hanya bila (a) target (content_item/campaign, atau task yang parent-nya) dibagikan eksplisit kepadanya, DAN (b) workspace mengizinkan klien berkomentar — setting `workspace_settings` key `allow_client_comments` (JSON boolean, **default false / tidak ada = TIDAK BOLEH**). Toggle-nya ada di `/pengaturan` (hanya owner/admin). Ditegakkan di RLS lewat helper `is_client_comment_allowed` + `is_comment_visible_to_client` (SECURITY DEFINER, pola 0006). Tanpa setting ini, policy komentar klien selalu menolak.
- **Notifikasi dasar saja (P3-A6):** `mention`, `task_assigned`, `task_status_change`, `comment_reply`. Tidak ada email/SMS. Notifikasi hanya dibuat lewat RPC (SECURITY DEFINER); TIDAK ADA policy INSERT/UPDATE/DELETE untuk `notifications` bagi `authenticated` (server action tidak pernah menulis langsung). Pengguna hanya bisa membaca notifikasinya sendiri + menandai `read_at`.

### 6. Brief + template (P3-A4/P3-A5)

- `brief_snapshot` (JSONB di `content_versions`): `{ objective, audience, angle, format, key_messages: [], cta, references: [] }`. Disimpan lewat RPC 0008 yang SUDAH ADA (`update_content_item_with_version`, parameter `p_brief_snapshot`) — tidak ada RPC baru untuk simpan brief. `change_summary` wajib (ditegakkan RPC 0008).
- `brief_templates.schema_json`: `{ "fields": [{ "key", "label", "type": "text"|"list", "required": bool }] }`. Editor brief merender field dari template yang dipilih; nilai disimpan sebagai `brief_snapshot` di atas.
- 1 template default per workspace: partial unique index `unique (workspace_id) where is_default`. Template default TIDAK bisa dihapus (hanya diganti default-nya); template non-default bisa dihapus. Ganti default lewat RPC `set_default_brief_template` (satu UPDATE atomik). Template default dibuat malas (lazy `ensureDefaultBriefTemplate` saat halaman template/brief dibuka; idempotent, backstop unique index).
- Template kustom per workspace bisa dibuat/diedit (nama + daftar field). Pustaka template lengkap ditunda ke sesudah MVP (P3-A5).

### 7. Versi: bandingkan + pulihkan (P3-10)

- Setiap edit field kunci = versi baru (RPC 0008); JANGAN PERNAH menimpa versi lama diam-diam.
- **Pulihkan = versi BARU** (RPC `restore_content_version`): salin snapshot versi lama (brief/script/caption/CTA/creative_notes) menjadi versi bernomor berikut + `change_summary` "Dipulihkan dari vN" + activity log. Versi lama tetap utuh.
- **Bandingkan:** tampilan berdampingan dua versi (field demi field; field yang berbeda ditandai). Bukan diff baris-per-baris otomatis — perbandingan nilai per field sudah cukup untuk milestone ini dan jujur tentang batasnya.
- Daftar versi menampilkan nomor, waktu, pembuat, dan ringkasan perubahan.

### 8. Content Workspace/Editor (P3-11)

- Tab lewat `?tab=` (server-rendered, tanpa state klien): `overview` (metadata + edit + transisi + riwayat), `brief`, `script` (script/caption/CTA/creative_notes → versi baru), `media` (lampirkan aset), `placements` (placement + preview), `tasks`, `comments`, `versions`. Default: `overview`.
- Save state terlihat ("Menyimpan… / Tersimpan / Ada perubahan belum tersimpan") + autosave recovery: draf editor disimpan ke `localStorage` per content item; bila ada draf yang belum tersimpan saat membuka editor, tampilkan peringatan + tombol pulihkan/buang — jangan hilangkan diam-diam (R3-06).
- Ringkasan approval/publishing tampil sebagai **"belum tersedia di fase ini"** — bukan angka/status palsu.
- Master content dibedakan dari placement variant (label jelas di tab placements: caption/format per channel adalah varian, bukan master).

### 9. Ideas Inbox (P3-03)

- Konversi memakai RPC 0008 yang SUDAH ADA (`convert_idea_to_content`, satu transaksi: item + v1 + `converted` + `origin_idea_id` + event + log; tolak konversi ulang). Yang BARU di fase ini adalah UI inbox: filter status/owner/brand, detail ide, tombol konversi disabled dengan alasan bila sudah dikonversi.
- Daftar ide tetap memakai `listIdeas` (Phase 2) + filter di server.

### 10. Storage policies (0009)

- `storage.objects` SELECT/INSERT/UPDATE/DELETE untuk bucket `mative-assets`, hanya `authenticated`, dengan syarat folder pertama path = workspace_id tempat pemanggil member aktif (`is_ws_member`, guard regex UUID agar path tak berbentuk tidak melempar error cast).
- Signed URL dibuat server-side lewat session client (butuh SELECT policy). Browser mengunduh lewat signed URL (tanpa auth tambahan — URL-nya sendiri yang kedaluwarsa 1 jam).

### 11. Yang TIDAK dibangun di fase ini

- Approval workflow/center, notifikasi penuh (reminder/approval/publishing), campaign lanjutan, visual planner, template lanjutan, CSV, publishing, integrasi, analytics, AI, billing — sesuai rencana detail §3.3.
- Tidak ada tombol approve/publish yang berfungsi, tidak ada angka analytics, tidak ada klaim AI, tidak ada URL publik permanen untuk aset privat.
