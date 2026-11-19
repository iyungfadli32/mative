# ADR-0011 — Campaign & Visual Planning Phase 5 (Campaign Core + Visual Planner + Brand Scope)

- **Status:** Diterima (menuangkan Keputusan #4 + Keputusan #9 + ASUMSI-5.1 s.d. 5.6 sebagai default)
- **Tanggal:** 2026-11-19
- **Konteks:** Rencana kanonis v2 (`Rencana-MaTive-Lengkap-v2.md`, Phase 5) +
  rencana detail Phase 5 §5.1–5.7 + Dok 05 §3, Dok 06 §1/§3/§4, Dok 12
  Phase 5. Keputusan #4 (dikunci Tuan 2026-11-19 01:52 WIB) sudah
  menyelesaikan konflik Visual Planner; Keputusan #9 (dikunci 01:54 WIB)
  mewajibkan brand scope ditegakkan paling lambat sebelum Phase 5. ADR
  ini menuangkan keduanya ke implementasi + mengunci default ASUMSI-5.x
  agar Phase 5 bisa dibangun tanpa bertanya lagi (mode One-Shot).

## 1. Konflik Visual Planner — SELESAI oleh Keputusan #4 (dikunci)

Rencana detail §5.3 mencatat konflik C-2 (PRD: visual planner sesudah
MVP; README + Dok 12: Phase 5) dan meminta persetujuan Tuan sebelum
coding langkah 5.3. Persetujuan itu SUDAH ADA: **Keputusan #4** (v2,
dikunci Tuan 01:52 WIB) — ikuti Dok 12 Phase 5, dengan dua pengaman:

1. Campaign core wajib di Phase 5; visual planner dibangun di Phase 5
   tetapi dirancang sebagai modul yang BISA dilepas (bila suatu hari
   ditunda ke sesudah MVP, campaign core + Phase 6 tetap jalan).
2. Urutan visual disimpan sebagai data tersendiri sejak hari pertama
   (ASUMSI-5.1), TIDAK PERNAH sebagai perubahan `scheduled_at`.

Konsekuensi implementasi: visual planner hidup di modul terpisah
`features/visual-planner/` + route sendiri `/kampanye/[id]/visual`
(migrasi 0017, tabel `visual_orders`). Campaign Workspace (`/kampanye/[id]`)
hanya menautkan ke route itu; menghapus modul + route + tabelnya tidak
merusak campaign core, jadwal, atau Phase 6.

## 2. Brand scope P1-A7 — bentuk + penegakan (Keputusan #9)

`workspace_members.brand_scope` (JSONB, ada sejak 0003, selama ini
tidak dipakai) kini ditegakkan. Bentuk yang dikunci:

- `NULL` = semua brand di workspace (default; perilaku lama dipertahankan).
- Array JSON berisi UUID brand, mis. `["<uuid-brand-1>"]` = member hanya
  boleh melihat/memakai brand itu. Array kosong `[]` = tidak ada brand.
- CHECK di migrasi 0016: `brand_scope IS NULL OR
  jsonb_typeof(brand_scope) = 'array'`. Elemen yang bukan UUID diabaikan
  secara fail-closed oleh helper (tidak pernah melonggarkan akses);
  aplikasi memvalidasi UUID lewat Zod sebelum menulis.

Penegakan tiga lapis (migrasi 0016):

1. **RLS (penegak sesungguhnya):** helper baru
   `public.brand_in_scope(p_brand_id uuid)` (STABLE, SECURITY DEFINER,
   `search_path = public, pg_temp`; NULL → true; bukan member → false)
   dipakai di:
   - `is_brand_member` (channels ikut ter-scope tanpa ubah policy);
   - `is_content_item_member` (placements + versions ikut ter-scope
     lewat `can_read/can_edit_content_item`);
   - policy yang ditulis ulang: `brands` (select/insert/update),
     `content_items` (select/insert/update), `ideas`
     (select/insert/update), `content_pillars` (select/insert/update),
     `campaign_brands` (select/insert/delete).
   - **Cabang shared TIDAK di-scope** (`is_resource_shared_with_me`
     tetap berdiri sendiri): berbagi eksplisit ke klien mengalahkan
     scope menurut desain — portal tetap jalan.
   - Campaigns sendiri TIDAK di-scope (wadah; tautan brand +
     deliverable-nya yang ter-scope). Unbranded ideas/pillars
     (`brand_id` NULL) tetap terlihat semua member.
2. **Server actions (pertahanan + pesan jelas):** `getCallerBrandScope`
   + `brandInScope` di `features/planning/context.ts` /
   `lib/permissions.ts`; setiap action yang menerima `brandId` menolak
   brand di luar cakupan dengan pesan "Brand di luar cakupan Anda."
   SEBELUM menyentuh DB (RLS tetap menolak bila lolos).
3. **UI:** editor scope di `/pengaturan/anggota` (hanya owner/admin) —
   tanpa UI, scope hanya bisa diubah lewat SQL.

**Batas yang dicatat jujur (bukan kelalaian):** tasks, checklist,
assets, comments, notifications TIDAK di-scope per brand di fase ini —
itu artefak produksi workspace-level; tautan induknya (content item)
yang ter-scope, jadi member ter-scope melihat baris task tapi tautan
kontennya kosong. Bila Tuan menghendaki scope penuh sampai task, itu
pekerjaan lanjutan (butuh helper `can_read_task` + penulisan ulang
policy 0009).

## 3. Bentuk `target_metrics` — ASUMSI-5.3 MENGGANTIKAN ADR-0007 §5

ADR-0007 §5 + ADR-0008 §5 mendokumentasikan `target_metrics` sebagai
pemetaan kunci metrik → angka (`{"reach": 10000}`), dan
`campaignTargetMetricsSchema` (Zod) mengikutinya. Rencana detail Phase 5
§5.7 (ASUMSI-5.3) + mitigasi R5.6 menetapkan bentuk minimal yang
LEBIH KETAT untuk fase ini — hanya tiga field yang diizinkan:

```json
{ "target_deliverables": 12, "target_date": "2026-12-31", "notes": "..." }
```

- `target_deliverables`: integer ≥ 0 (opsional).
- `target_date`: tanggal ISO `YYYY-MM-DD` (opsional).
- `notes`: teks ≤ 500 karakter (opsional).
- Field lain DITOLAK di server (Zod `strict()`).

Alasan: Dok 05 tidak mendefinisikan bentuk JSONB ini; bentuk bebas
membuat tiap campaign isinya berbeda-beda (R5.6). CHECK database
DITUNDA mengikuti preseden ADR-0008 (JSONB dikunci di Zod + domain
service; CHECK menyusul bila Tuan mengunci bentuk final). Pembacaan
tetap toleran terhadap baris lama (`{}` atau peta metrik) — di live
tidak ada baris seperti itu (DB seed-only, seed tanpa campaign).
`CampaignForm` diubah dari textarea JSON bebas menjadi 3 field.

## 4. Rumus progres campaign (ASUMSI-5.2 — dihitung, bukan disimpan)

Progres dihitung di server setiap kali dibaca dari `content_items`
yang terhubung (`campaign_id`), di SATU tempat
(`features/campaign/progress.ts`):

- `total` = jumlah deliverables terhubung.
- `ready` = `production_status = 'approved'` (SATU-SATUNYA yang
  dihitung "siap" — konten belum approved TIDAK dihitung siap, §5.10).
- `inProduction` = `ready_for_production, in_production, editing`.
- `waitingApproval` = `internal_review`.
- `notStarted` = `idea, brief, scripting`.
- `exception` = `changes_requested, blocked, cancelled`.
- `archived` = `archived`.
- Persentase = `ready / total` (0 bila total 0). TIDAK ADA field
  persentase yang bisa diketik manual; UI menampilkan rumus +
  jumlah per status.

## 5. Status campaign (ASUMSI-5.5 — DIKONFIRMASI, tanpa migrasi)

Enum CHECK 0007 (`draft, active, completed, archived, cancelled`)
SUDAH sama persis dengan ASUMSI-5.5 — tidak ada perubahan skema.
Transisi yang diizinkan (domain service, `features/campaign/transitions.ts`):

```text
draft → active → completed → archived
draft → cancelled (alasan wajib)
active → cancelled (alasan wajib)
```

`archived` terminal; `cancelled` terminal; tidak ada lompatan lain.
Alasan pembatalan disimpan di `activity_logs` (bukan kolom baru).

## 6. Urutan visual (ASUMSI-5.1 — data terpisah)

Tabel `visual_orders` (migrasi 0017): satu baris per
`(workspace_id, brand_id, channel_id, placement_id)` + `position int`.
Unique `(workspace_id, brand_id, channel_id, placement_id)` dan
`(workspace_id, brand_id, channel_id, position)`.

- Reorder HANYA lewat RPC `set_visual_order(p_workspace_id,
  p_brand_id, p_channel_id, p_placement_ids uuid[])` (SECURITY
  DEFINER, search_path terkunci): validasi 7 poin Dok 06 §4 (auth,
  member aktif, role `manage_pillars_campaigns`, scope brand,
  tenant boundary, placement milik workspace+brand+channel yang
  sama), hapus + tulis ulang posisi dalam SATU transaksi, tulis
  jejak audit ke `activity_logs`. **RPC ini TIDAK PERNAH menulis
  `scheduled_at`** — tidak ada kode apa pun di jalur reorder yang
  menyentuh kolom itu (R5.1).
- Preview grid/feed diberi label "approximate" yang selalu terlihat
  (R5.3); tidak ada logo/aset proprietary pihak ketiga di preview.
- Konten belum approved BOLEH tampil di planner, tetapi dengan label
  statusnya yang jelas (R5.7) — bukan disamarkan sebagai siap.

## 7. Template dasar (ASUMSI-5.4 — salinan, tanpa builder)

- `campaign_templates` (+ `campaign_template_brands`): salinan field
  campaign (name, objective, audience, target_metrics 3-field) +
  tautan brand. Aksi: simpan campaign sebagai template; buat campaign
  baru dari template (status awal `draft`, owner = pembuat).
- `content_templates` (+ `content_template_placements`): salinan
  konten (title, brand, pillar, script, caption) + struktur placement
  (channel + format SAJA — tanpa `scheduled_at`). Aksi: simpan konten
  sebagai template; buat konten baru dari template (status awal
  `idea`, tanpa placement terjadwal).
- TIDAK termasuk: field kustom bebas, logika kondisional, template
  marketplace (ditunda, §5.3 rencana detail).

## 8. CSV import/export (ASUMSI-5.6 — format tetap)

Kolom tetap (urutan tetap, tanggal ISO `YYYY-MM-DD`):

```text
name, objective, audience_name, start_at, end_at, status, owner_email,
target_deliverables, target_date, notes, brands, deliverables
```

- `brands`: nama brand dipisah `;` (di-resolve ke UUID di workspace
  saat import; nama tak dikenal → baris ditolak dengan pesan yang
  menyebut namanya).
- `deliverables`: judul konten dipisah `;` — saat export, daftar judul
  konten terhubung; saat import, judul di-resolve ke content item yang
  sudah ada di workspace yang sama (cocok persis + unik); judul tak
  ditemukan / ambigu → tautan dilewati + dicatat di laporan (bukan
  gagal baris).
- `owner_email`: harus member aktif workspace itu; bila tidak, baris
  ditolak. `status` kosong = `draft`. Nama campaign duplikat (di file
  atau sudah ada di workspace) → baris ditolak.
- Import: SEMUA baris divalidasi dulu; baris valid diimpor (satu
  baris = satu campaign + tautan brand + tautan deliverable yang
  ter-resolve), baris tidak valid ditolak PER BARIS dengan pesan jelas;
  laporan hasil lengkap `{total, imported, failed, errors[{row,
  message}], linkedDeliverables, skippedDeliverables}` + satu entri
  `activity_logs`. Tidak ada import sebagian tanpa jejak (R5.4).
- Parser CSV ditulis sendiri di `lib/csv.ts` (RFC 4180: kutip ganda,
  koma di dalam kutip, baris baru di dalam kutip) — tanpa dependensi
  baru; diuji unit (termasuk kutip + baris kosong + BOM).

## 9. Yang TIDAK dibangun di fase ini (dicatat, bukan dilupakan)

- Advanced campaign planning (multi-gelombang, alokasi budget).
- Template builder lanjutan.
- Analytics performa campaign dari provider (Phase 7); di fase ini
  hanya "planned vs completed" dari record internal + label
  "belum ada data" bila belum ada sumber.
- Visual planner sebagai editor desain (crop/edit gambar) — non-goal.
- Penutupan otomatis request approval basi (keputusan terbuka Phase 4).
- Hardening "tampilkan galat query, bukan daftar kosong" (Phase 9).
