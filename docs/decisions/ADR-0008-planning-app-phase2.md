# ADR-0008 — Kode aplikasi Planning Core Phase 2 (P2-04 s.d. P2-15)

- **Status:** Diterima (DRAF fase — migrasi 0007 + 0008 belum diterapkan ke database live).
- **Tanggal:** 2026-11-19. **Konteks:** PLAN-MATIVE-001 Phase 2 (P2-04 s.d. P2-15), Dok 05 §3–§7, Dok 06 §3, ADR-0007, rencana detail Phase 2 (P2-A1 s.d. P2-A10).
- **Cakupan ADR ini:** HANYA kode aplikasi Phase 2 + migrasi 0008 (RPC transaksional). TIDAK mengubah 0001–0007, TIDAK mengubah tes pgTAP 01/02.

## Keputusan

### 1. Drag/drop: HTML5 native + alternatif tombol (tanpa dnd-kit)

- **Dipilih:** drag/drop native HTML5 (`draggable` + `dataTransfer`) di kalender dan board, ditambah kontrol alternatif yang bisa disentuh/keyboard di setiap tempat (kalender: tombol "Jadwalkan 09:00" per backlog + input tanggal; board: pemilih "Pindah ke…" per kartu; collision: dialog 3 pilihan).
- **Alasan:** nol dependensi baru (dnd-kit belum ada di `package.json`; menambahkannya berarti menambah permukaan API + risiko versi tanpa kebutuhan yang memaksa), perilaku drag/drop yang dibutuhkan sederhana (satu kartu → satu tanggal/kolom), dan alternatif tombol menjamin perangkat sentuh + keyboard tetap bisa bekerja — dnd-kit pun butuh sensor sentuh terpisah untuk itu.
- **Konsekuensi:** bila nanti butuh sortable multi-kolom yang kompleks (mis. Visual Planner Phase 5), keputusan ini ditinjau ulang dan dnd-kit dipertimbangkan lagi dengan ADR baru.
- **Collision (P2-A5):** tetap peringatan + pilihan pengguna (tetap / geser 1 jam / batal), ditegakkan di RPC `reschedule_placement` (`p_force`), bukan hanya di UI.

### 2. Nilai enum yang dikunci di aplikasi (sebelumnya teks bebas di 0007)

0007 sengaja membiarkan 6 kolom sebagai teks polos (ADR-0007 §10). Di fase ini dikunci di Zod + domain service (CHECK database menyusul bila Tuan mengunci enum final):

| Kolom                                | Nilai yang dikunci                                                  |
| ------------------------------------ | ------------------------------------------------------------------- |
| `content_items.priority`             | `low, medium, high, urgent` (sama dengan `PriorityBadge` Phase 1)   |
| `content_items.funnel_stage`         | `awareness, consideration, conversion, retention, advocacy`         |
| `ideas.status`                       | `new, considering, converted, dropped`                              |
| `ideas.source_type`                  | `chat, meeting, social, research, internal, other`                  |
| `social_channels.platform`           | `instagram, tiktok, youtube, facebook, linkedin, x, threads, other` |
| `content_placements.platform_format` | `feed, reel, story, carousel, video, short, live, article, other`   |

- `social_channels.connection_status` tetap HANYA `not_connected, manual` (CHECK 0007) — tidak ada nilai `connected` di fase ini.
- `campaigns.status` tetap enum sementara P2-A3 (`draft, active, completed, archived, cancelled`).

### 3. Tabel transisi status (cermin ganda: TS + SQL)

- Production (Dok 05 §4, tanpa `client_review` — ADR-0007 §2): maju satu langkah `idea → brief → scripting → ready_for_production → in_production → editing → internal_review → approved → archived`; mundur satu langkah diizinkan; exception (`changes_requested, blocked, cancelled`) masuk dari tahap normal mana pun dengan alasan wajib, keluar hanya ke `editing`/`idea` dengan alasan wajib; `archived → idea` dengan alasan wajib.
- Distribusi (terpisah, R2-02): `draft → ready → scheduled_locally → sending → uploaded_or_draft_created → published`; `sending`/`uploaded` → `failed`/`needs_manual_action`; `failed`/`needs_manual_action`/`cancelled` → `ready`; `published` terminal.
- Tabel yang sama ditulis dua kali: `features/planning/transitions.ts` (UI + validasi awal server action) dan migrasi 0008 (fungsi RPC — yang di database yang menang bila berbeda). Tes Vitest mengunci tabel TS; tes pgTAP untuk tabel SQL adalah tindak lanjut saat apply live (lihat laporan fase 2 §9).

### 4. Transaksionalitas lewat RPC 0008 (bukan insert berurutan)

- PostgREST tidak mendukung transaksi multi-statement dari klien. Operasi yang harus atomik — buat konten + v1 + event + log; edit + versi baru; transisi + event + log; konversi ide; reschedule + placement version; ubah distribusi + event + log — dijalankan sebagai fungsi Postgres `SECURITY DEFINER` di `supabase/migrations/0008_planning_transactions.sql` (6 fungsi, pola `accept_invitation`/0003 + helper 0006/0007: `search_path` dikunci, cek keanggotaan + role pemanggil sendiri lewat `is_ws_member`/`can_edit_content_item`/`can_edit_placement`, kembalikan `jsonb {ok, message, ...}` bukan exception untuk penolakan bisnis, grant EXECUTE hanya ke `authenticated`).
- Server action TIDAK PERNAH menulis `content_status_events`/`activity_logs` secara langsung untuk operasi di atas.
- Pengecualian yang didokumentasikan: tambah placement memakai insert biasa + `placement_versions` v1 berurutan — bila insert versi gagal, placement yang barusan dibuat dihapus (RLS mengizinkan delete placement), sehingga tidak ada record setengah jadi. Alasan tidak memakai RPC di sini: satu-satunya kegagalan yang mungkin adalah constraint versi, dan kompensasi delete-nya aman + teruji polanya di RLS.

### 5. Bentuk JSONB yang dikunci (melengkapi ADR-0007 §5)

- `audiences.attributes`: kunci yang dikenal `age_range, gender, location, interests[], pain_points[], notes` (kunci lain diabaikan aplikasi; dirakit di server dari field form, bukan JSON mentah klien).
- `campaigns.target_metrics`: pemetaan kunci metrik → angka target (mis. `{"reach": 10000}`).
- `content_placements.platform_metadata`: `format_options, duration_seconds, aspect_ratio`.
- `brands.brand_settings`: `primary_color, tone, voice, guidelines`.
- `content_placements.platform_hashtags` / `ideas.tags`: `text[]` tanpa `#` di depan (aplikasi yang menambahkan `#` saat render).

### 6. Kalender: Month + Agenda saja (P2-A4)

- Week/Day/List TIDAK dibangun — ditunda dan dicatat di laporan fase 2, bukan setengah jadi. Alasan: Month (gambaran) + Agenda (kerja harian, mobile-first) sudah memenuhi milestone M2; Week/Day menambah permukaan drag/drop + logika zona waktu tanpa kebutuhan pengguna yang sudah dinyatakan.
- Backlog unscheduled adalah panel/list di halaman kalender yang sama (bukan halaman terpisah).
- Label timezone selalu terlihat di header kalender dan di tiap tile agenda; penjadwalan memakai `content_placements.timezone`, due date memakai `content_items.timezone` (P2-A9).

### 7. Board: 8 tahap + Arsip + Terkendala; WIP tanpa batas (P2-A6)

- Kolom Kanban mengikuti `production_status` Dok 05 §4; tiga exception digabung dalam satu kolom "Terkendala" (kartu tetap menampilkan status persisnya lewat badge) agar board tetap terbaca di 10 kolom, bukan 12.
- WIP limit default tanpa batas (tidak ada kolom/limit WIP di database).
- List/Timeline view board ditunda sampai Kanban stabil (sesudah MVP).

### 8. Daftar nilai polimorfik untuk Phase 3 (R2-07 — dikunci sekarang, dipakai nanti)

Nilai `*_type` berikut adalah SATU-SATUNYA yang diizinkan di Phase 3 (ditegakkan CHECK + Zod saat tabelnya dibuat; bukan ditebak saat coding Phase 3):

- `tasks.parent_type` ∈ {`content_item`, `campaign`}
- `comments.target_type` ∈ {`content_item`, `campaign`, `task`}
- `approval_requests.target_type` (Phase 4) ∈ {`content_item`, `placement`}
- `notifications.entity_type` ∈ {`content_item`, `campaign`, `task`, `comment`, `approval_request`}
- `activity_logs.entity_type` (dipakai sejak Phase 1, kini dikunci): {`content_item`, `content_placement`, `campaign`, `idea`, `brand`, `workspace`, `organization`, `workspace_member`, `resource_share`}

Nilai di luar daftar ditolak database, bukan hanya UI. Di fase ini, `ideas` dan `content_items` memakai FK langsung (bukan polimorfik).

### 9. Yang sengaja TIDAK ada (penegasan ulang)

Tidak ada tombol publish, tidak ada klaim channel "terhubung" (UI selalu menampilkan "belum terhubung" + "kemampuan: belum diperiksa"), `remote_post_id`/`published_url` tidak pernah diisi aplikasi (CHECK 0007 menolak), tidak ada angka analytics (KPI dashboard hanya dari record nyata), tidak ada ideas inbox lengkap / brief editor / task / aset / komentar / version compare-restore / approval / publishing / AI / billing / export kalender / CSV.

## Konsekuensi

- 0008 adalah SATU-SATUNYA migrasi baru; 0001–0007 tidak diubah. Penerapan ke live oleh koordinator (0007 dulu, lalu 0008).
- Bila Tuan mengubah enum/daftar di atas, perubahannya lewat migrasi baru + ADR baru — bukan edit 0008 setelah diterapkan.
- Tes Vitest Phase 2 (84 tes) mengunci: transisi, kalender/timezone, skema Zod, search/filter, izin peran, migrasi 0008 statis.
- Spek Playwright penerimaan prompts/03 ditulis (`e2e/planning.spec.ts`, `@needs-db`) dan di-skip sampai migrasi live + akun uji tersedia.
