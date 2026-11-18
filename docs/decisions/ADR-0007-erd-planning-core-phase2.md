# ADR-0007 — Perbaikan ERD + skema Planning Core Phase 2 (P2-01 s.d. P2-03)

- **Status:** Diterima (DRAF fase — migrasi 0007 belum diterapkan ke database live).
- **Tanggal:** 2026-11-19. **Konteks:** PLAN-MATIVE-001 Phase 2 (P2-01 s.d. P2-03), Dok 05 §3–§7, Dok 06 §2–§3/§5/§8, Keputusan #7/#8/#9/#12/#13, rencana detail Phase 2 (P2-A1 s.d. P2-A10).
- **Cakupan ADR ini:** HANYA P2-01 (ERD), P2-02 (14 tabel + constraint + index), P2-03 (RLS + 12 helper baru). TIDAK ada kode aplikasi, TIDAK ada perubahan 0001–0006.

## Keputusan

### 1. Perbaikan ERD (P2-01)

- Satu-satunya perbaikan: tambah relasi `CONTENT_ITEMS ||--o{ COMMENTS : discusses` ke `kit/.../docs/MaTive_ERD.mmd`.
- Verifikasi: file `.mmd` kini identik baris-per-baris (26 baris) dengan blok mermaid Dok 05 §5.
- `.mmd` tetap HANYA peta relasi (24 entitas) — BUKAN dasar migrasi. Sumber kolom/tabel tetap Dok 05 §3. Tabel yang tidak ada di ERD (audiences, campaign_brands, placement_versions, content_status_events, tags, content_tags) dilengkapi dari §3, bukan dari ERD (P2-A1, R2-06).
- Dicatat juga di `kit/.../docs/assumptions-and-decisions.md` (baris D-011).

### 2. KOREKSI terhadap P2-A10: `client_review` BUKAN production_status (Keputusan #8 menang)

- Rencana detail P2-A10 memperlakukan `client_review` sebagai tahap production yang mendahului approval channel-specific. Itu **bertentangan** dengan Keputusan #8 (dikunci 2026-11-19 01:54 WIB): `client_review` = channel-specific approval, **satu gerbang** — bukan tahap production.
- Yang dipakai: `content_items.production_status` TIDAK memuat `client_review`. Nilai yang diizinkan (CHECK `content_items_production_status_check`):
  `idea, brief, scripting, ready_for_production, in_production, editing, internal_review, approved, archived` + exception `changes_requested, blocked, cancelled`.
- Client review terjadi per placement di Phase 4 (approval), bukan sebagai nilai status produksi. Sisa P2-A10 tetap dipakai: exception masuk dari stage mana pun dengan alasan wajib, keluar hanya ke `editing`/`idea` dengan alasan wajib — aturan transisi itu ditegakkan di domain service (P2-12/P2-14), BUKAN di CHECK database; `content_status_events.reason` mencatat alasannya.
- Dicatat di kit sebagai D-012. Bila Tuan mengubah Keputusan #8, enum diubah lewat migrasi baru (bukan edit 0007).

### 3. Dua status terpisah (R2-02)

- `content_items.production_status` dan `content_placements.distribution_status` adalah dua field terpisah sejak migrasi, masing-masing dengan CHECK sendiri.
- `distribution_status` (CHECK `content_placements_distribution_status_check`): `draft, ready, scheduled_locally, sending, uploaded_or_draft_created, published, failed, needs_manual_action, cancelled` (Dok 05 §4 harfiah).

### 4. Enum sementara yang dipakai (CHECK text, pola Phase 1 — bukan tipe enum Postgres)

- `campaigns.status` (P2-A3, sementara): `draft, active, completed, archived, cancelled`.
- `social_channels.connection_status` (P2-A2): `not_connected, manual` saja. TIDAK ada nilai `connected` di fase ini — tidak ada klaim channel "terhubung" (R2-05).
- Alasan memakai CHECK text, bukan `CREATE TYPE`: mengikuti pola 0001–0003 (status text + CHECK) dan memudahkan perubahan enum lewat migrasi ALTER tanpa `ALTER TYPE` yang mengunci.

### 5. Bentuk JSONB yang didokumentasikan (bukan bebas)

- `brands.brand_settings`: objek; kunci yang dikenal aplikasi: `primary_color`, `tone`, `voice`, `guidelines`. Kunci lain diabaikan aplikasi.
- `social_channels.capability_snapshot`: `{}` (kosong) + keterangan "belum diperiksa" sampai capability check pertama (Phase 7). Bentuk saat diperiksa: `{"checked_at": "<timestamptz>", "capabilities": {...}}`. TIDAK ada token/OAuth di fase ini (P2-A2).
- `audiences.attributes`: objek; kunci yang dikenal: `age_range`, `gender`, `location`, `interests[]`, `pain_points[]`, `notes`.
- `campaigns.target_metrics`: objek pemetaan kunci metrik → angka target, mis. `{"reach": 10000}`.
- `content_placements.platform_metadata`: objek; kunci yang dikenal: `format_options`, `duration_seconds`, `aspect_ratio`.
- `ideas.tags`: `text[]` (daftar label sederhana), bukan JSONB — tag ternormalisasi ada di tabel `tags`/`content_tags`.
- `content_placements.platform_hashtags`: `text[]` (tanpa `#` di depan; aplikasi yang menambahkan `#` saat render).

### 6. Hal yang sengaja TIDAK dibuat / ditunda di 0007

- `brands.logo_asset_id` adalah `uuid` polos TANPA FK — tabel `assets` baru ada di Phase 3. FK ditambahkan oleh migrasi Phase 3 (dicatat di komentar migrasi). Nilai boleh null (logo bisa kosong di fase ini, P2-04).
- `content_placements.remote_post_id` / `published_url` WAJIB null di fase ini: ditegakkan CHECK `content_placements_remote_post_id_null_check`. CHECK ini DICABUT oleh migrasi Phase 6 saat publishing manual dimulai.
- `publishing_jobs.idempotency_key` (P2-A8) BUKAN kolom placement — scope "unik per placement" itu berlaku untuk `publishing_jobs` Phase 6, bukan untuk tabel fase ini.
- TIDAK ada tabel fase lain (brief/templates, tasks, assets, comments, approval, publishing, analytics, AI).
- `assignee_user_id` (indeks Dok 05 §7) tidak ada di tabel fase ini — penugasan lewat task baru ada di Phase 3. "Ditugaskan" di fase ini = `content_items.owner_user_id` (lihat §8).
- `updated_at` TIDAK ada di tabel append-only (`content_versions`, `placement_versions`, `content_status_events`) — mengikuti preseden Phase 1 (`activity_logs` hanya `created_at`). Semua tabel mutable punya `created_at` + `updated_at` (UTC, `timestamptz`). Tidak ada trigger `updated_at` — mengikuti repo (aplikasi yang mengisi `updated_at`).

### 7. Aturan scope lintas-tabel (Dok 05 §6) — trigger, bukan CHECK

CHECK tidak bisa memeriksa tabel lain. Karena itu semua aturan "workspace yang cocok" ditegakkan oleh 7 trigger `BEFORE INSERT OR UPDATE` (fungsi `SECURITY DEFINER`, `search_path` dikunci, hanya membaca kolom scope dan melempar `P0001` bila tidak cocok — ditinjau seperti helper 0006):

| Trigger                            | Aturan                                                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate_content_pillar_scope`    | `content_pillars.brand_id` (bila diisi) harus milik `workspace_id` yang sama                                                                                                                                                            |
| `validate_campaign_scope`          | `campaigns.audience_id` (bila diisi) harus milik workspace yang sama                                                                                                                                                                    |
| `validate_campaign_brand_scope`    | `campaign_brands` — campaign dan brand harus satu workspace                                                                                                                                                                             |
| `validate_idea_scope`              | `ideas.brand_id` (bila diisi) harus milik workspace yang sama                                                                                                                                                                           |
| `validate_content_item_scope`      | `content_items.brand_id` harus milik `workspace_id` yang sama; begitu pula `campaign_id`, `pillar_id`, `audience_id`, `origin_idea_id` (bila diisi)                                                                                     |
| `validate_content_placement_scope` | placement HANYA ke channel yang `brand_id`-nya = `content_items.brand_id` (otomatis satu workspace). Reuse channel lintas-brand yang diotorisasi + diaudit BELUM ADA mekanismenya di fase ini, jadi ditolak — bukan diizinkan diam-diam |
| `validate_content_tag_scope`       | `content_tags` — tag harus milik workspace yang sama dengan content item                                                                                                                                                                |

Trigger adalah backstop untuk SEMUA penulis (termasuk service role yang melewati RLS). RLS tetap menjadi penegak membership/role untuk pengguna aplikasi.

### 8. RLS — interpretasi matriks Phase 1 (Dok 06 §3 + `lib/permissions.ts`)

Satu file migrasi 0007 berisi tabel + RLS (mengikuti preseden 0002/0003; 0006 terpisah hanya karena menulis ulang policy lama). 12 helper SECURITY DEFINER baru (pola 0006: STABLE, `search_path = public, pg_temp`, grant EXECUTE hanya ke `authenticated`, hanya boolean): `is_brand_member`, `is_channel_member`, `is_campaign_member`, `is_content_item_member`, `is_content_item_owner`, `is_placement_member`, `can_read_content_item`, `can_edit_content_item`, `can_read_placement`, `can_edit_placement`, `is_resource_shared_with_me`, `is_placement_shared_with_me`. Tidak ada policy yang memindai tabel lain (`FROM`/`JOIN`) — graf dependensi policy asiklik, 0 self-loop (terverifikasi statis, lihat laporan fase 2).

- **Baca (SELECT):** semua member aktif workspace BOLEH membaca, KECUALI `creator`/`editor` dan `viewer_client`:
  - `creator`/`editor` membaca `content_items` (+ turunannya: placements, versions, status events, content_tags) HANYA yang `owner_user_id`-nya = dirinya (P1-A6/Keputusan #9: "limited = lihat + edit yang ditugaskan saja"; "ditugaskan" di fase ini = `owner_user_id`, karena task/assignee baru Phase 3).
  - `creator`/`editor` tetap membaca SEMUA brands/channels/pillars/audiences/campaigns/ideas/tags workspace-nya (matriks: `view` untuk pillars/campaigns, `✓` untuk ideas) — pembatasan "hanya yang ditugaskan" berlaku untuk konten, bukan untuk referensi perencanaan.
  - `approver`/`analyst` membaca konten (tanpa mutasi) — matriks `—` pada `create_edit_content` dibaca sebagai "tidak boleh mutasi", bukan "tidak boleh lihat"; approver butuh melihat untuk Phase 4, analyst untuk Phase 7.
  - `viewer_client` TIDAK membaca apa pun lewat keanggotaan workspace — HANYA lewat share eksplisit (`resource_shares`: `content_item` → item + turunannya; `campaign` → campaign + `campaign_brands`-nya). Tanpa share, SELECT kosong.
- **Tulis (INSERT/UPDATE):**
  - brands/channels: `owner, admin, manager` (manager "limited" di sini = boleh kelola brand, tanpa hapus; brand scope P1-A7 tetap ditunda ke Phase 5).
  - pillars/audiences/campaigns/campaign_brands/tags: `owner, admin, manager, strategist`.
  - ideas: `owner, admin, manager, strategist, creator, editor` — `creator`/`editor` hanya dengan `owner_user_id` = dirinya.
  - content_items (+ placements, versions, status events, content_tags): `owner, admin, manager, strategist` penuh; `creator`/`editor` hanya yang `owner_user_id`-nya = dirinya (INSERT harus `owner` = diri; UPDATE tidak boleh mengalihkan kepemilikan ke orang lain).
  - `content_status_events` INSERT mensyaratkan `actor_user_id = auth.uid()`.
- **Hapus (DELETE):** TIDAK ADA hard-delete entitas (Keputusan #10: archive/soft-delete dulu) — policy `*_no_delete` (`using (false)`) untuk brands, channels, pillars, campaigns, ideas, content_items, content_versions, placement_versions, content_status_events. Pengarsipan lewat `status` / `active` / `archived_at`. Pengecualian: baris tautan (`campaign_brands`, `content_tags`) BOLEH dihapus oleh yang berhak mengedit induknya (melepas tautan ≠ menghapus entitas); `content_placements` BOLEH dihapus oleh editor konten (melepas penjadwalan); `audiences`/`tags` (tanpa kolom status) BOLEH dihapus hanya `owner`/`admin`.
- **Grant:** `grant select, insert, update, delete ... to authenticated` untuk ke-14 tabel (penegakan sepenuhnya di RLS, termasuk `using (false)`). Penyimpangan sadar dari 0001/0003 yang tidak memberi grant delete pada tabel tertentu: tanpa grant, penolakan DELETE muncul sebagai error 42501 `permission denied` (menggugurkan transaksi pgTAP/aplikasi), sedangkan lewat RLS penolakan teramati sebagai 0 baris terpengaruh — perilaku yang sama dengan pola T3/T4b Phase 1.
- **FK sirkular ideas ↔ content_items:** `ideas.converted_content_item_id` ↔ `content_items.origin_idea_id`. Dipecah dengan `ALTER TABLE ... ADD CONSTRAINT` setelah kedua tabel dibuat (semua di dalam 0007, bukan forward-reference antar file).

### 9. Asumsi P2 yang dipakai (reversible)

P2-A1 ERD kanonis (dikunci Keputusan #7); P2-A2 channel metadata saja; P2-A3 enum campaigns sementara; P2-A5 collision = peringatan + pilihan pengguna (bukan aturan DB — TIDAK ada unique constraint `(channel, scheduled_at)` di 0007, karena resolusi collision adalah pilihan pengguna, bukan penolakan); P2-A6 WIP unlimited (tidak ada kolom/limit WIP di 0007); P2-A7 `placement_versions` wajib; P2-A8 idempotency per placement (berlaku Phase 6, lihat §6); P2-A9 timezone placement untuk penjadwalan, timezone item untuk due date produksi (disimpan UTC, `timezone` IANA per baris, default `Asia/Jakarta` — Keputusan #13); P2-A10 exception sebagai production status (lihat koreksi §2).

### 10. Daftar nilai yang BELUM dikunci (teks polos, tanpa CHECK — jangan ditebak)

`content_items.priority`, `content_items.funnel_stage`, `ideas.status`, `ideas.source_type`, `social_channels.platform`, `content_placements.platform_format`. Daftar nilai dikunci di langkah aplikasi (P2-04 s.d. P2-10) atau oleh Tuan; CHECK ditambahkan oleh migrasi berikutnya bila sudah dikunci.

## Konsekuensi

- 0007 adalah SATU-SATUNYA file baru; 0001–0006 tidak diubah. Penerapan ke live oleh koordinator (lihat `docs/phase-2-report.md`).
- Bila Tuan memutuskan `client_review` kembali menjadi production status, atau brand scope ditegakkan lebih awal, perubahannya lewat migrasi baru + ADR baru — bukan edit 0007 setelah diterapkan.
- Tes pgTAP `supabase/tests/02_rls_phase2.sql` (20 asersi) membuktikan: cross-tenant deny, creator hanya assigned, placement lintas workspace/brand ditolak trigger, uniqueness versi, viewer_client hanya yang dibagikan, CHECK `remote_post_id` null, dan CHECK penolakan `client_review`.
- `tests/migrations.test.ts` (daftar file migrasi 0001–0006) HARUS diperbarui ke 0001–0007 agar suite tetap hijau — perubahan daftar itu dicatat di laporan fase 2 sebagai pemeliharaan tes, bukan kode aplikasi.
