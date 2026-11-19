# ADR-0010 — Model Approval Phase 4 (Review & Approval)

- **Status:** Diterima (mengunci Keputusan #8 + ASUMSI-4.6/4.7 sebagai default)
- **Tanggal:** 2026-11-19
- **Konteks:** Rencana detail Phase 4 §4.1–4.7 + Dok 05 §3, Dok 06 §4/§8,
  Dok 07 §3–§4/§6, prompt 05. Keputusan #8 (dikunci Tuan 2026-11-19
  01:54 WIB) sudah menutup risiko "approval status tidak terdefinisi";
  ADR ini menuangkan model itu ke implementasi + mengunci default yang
  masih terbuka (ASUMSI-4.6, ASUMSI-4.7, gerbang client_review) agar
  Phase 4 bisa dibangun tanpa bertanya lagi (mode One-Shot).

## 1. Model status approval (Keputusan #8 — dikunci)

`approval_requests.status` enum (CHECK di migrasi 0013):

```text
submitted → in_review → approved | changes_requested | rejected | reapproval_required
```

- `reapproval_required` adalah NILAI status request, bukan flag terpisah.
  Request kembali ke `in_review` setelah versi baru dikirim (submit ulang).
- `client_review` BUKAN `production_status` (sudah diputuskan di ADR-0007
  §2; CHECK `content_items_production_status_check` di 0007 tidak memuatnya).
  `client_review` adalah gerbang approval per channel — satu gerbang setelah
  internal review (ASUMSI-4.2) — yang hidup di `approval_requests` dengan
  `request_type = 'client'`.
- `changes_requested` / `blocked` / `cancelled` adalah HASIL yang tercatat
  di `content_status_events` + `approval_requests.status`, BUKAN nilai
  `production_status` yang berdiri sendiri (ASUMSI-4.3).
- Workflow default MVP: 1 workflow default per workspace
  (`is_default = true`), 1 step, 1 approver yang ditugaskan (ASUMSI-4.4).
  Multi-step / paralel didukung model data + service, tetapi default yang
  diuji dan dipakai di MVP adalah satu step.

## 2. Pemetaan hasil keputusan → production_status

| Keputusan request | `approval_requests.status` | `content_items.production_status` |
| --- | --- | --- |
| Approve (semua step selesai, tipe internal) | `approved` | `approved` |
| Approve (tipe client) | `approved` | tetap `approved` (sudah disetujui internal) |
| Request changes | `changes_requested` | `editing` (ASUMSI-4.3) |
| Reject | `rejected` | `editing` (kreator harus rework + submit ulang) |
| Critical change sesudah approval | `reapproval_required` | tetap `approved`, TAPI request tidak lagi `approved` |

Alasan tabel ini: `reapproval_required` adalah sinyal di tingkat request,
bukan status produksi. Phase 6 (publishing) WAJIB memeriksa status
request, bukan hanya `production_status` — konten `approved` yang
request-nya `reapproval_required` TIDAK boleh dijadwalkan. Ini dicatat
di sini agar Phase 6 tidak salah mengandalkan `production_status` saja.

## 3. Daftar critical change (ASUMSI-4.6 — default dikunci)

Default bila workspace belum mengonfigurasi (disimpan di
`workspace_settings`, key `approval.critical_fields`,
`value_json = {"fields": [...]}`):

```json
["script", "caption", "cta", "asset", "channel", "format", "scheduled_time"]
```

Pemetaan ke data (ditegakkan trigger di migrasi 0014):

| Field kritis | Sumber perbandingan |
| --- | --- |
| `script`, `caption`, `cta` | `content_versions.script/caption/cta` (versi baru vs versi yang disetujui) |
| `asset` | `content_assets` (lampiran aset baru / lepas sesudah approval) |
| `channel`, `format`, `scheduled_time` | `placement_versions.payload_snapshot` (versi placement baru vs versi placement yang disetujui) |

Perubahan field non-kritis (mis. typo metadata internal, `change_summary`)
tidak memicu reapproval. Bila field kritis berubah sesudah approval:
request → `reapproval_required` + notifikasi ke approver + activity log.
Penjadwalan diblokir sampai reapproval selesai (penegakan di Phase 6).

## 4. Quorum (ASUMSI-4.7 — default dikunci)

`required_count = 1` per step, kecuali step dikonfigurasi lain.
`step_order` yang sama = step paralel (semuanya harus selesai);
`step_order` berikutnya baru dibuka setelah step sebelumnya selesai.
Satu step selesai hanya bila jumlah approver berbeda yang menyetujui
mencapai `required_count` (dihitung di server dari `approval_decisions`
append-only). Satu approver = satu keputusan per step per request
(`unique (approval_request_id, step_id, approver_user_id)`).

## 5. Gerbang client_review (ASUMSI-4.2 — default dikunci)

- Gerbang client_review OPT-IN per workspace:
  `workspace_settings` key `approval.client_review_enabled`
  (`value_json = {"enabled": true}`); default MATI.
- Alasan default mati: workflow default MVP adalah 1 step 1 approver
  internal (ASUMSI-4.4); gerbang klien hanya bermakna bila workspace
  memang bekerja dengan klien luar. Mengaktifkannya tanpa klien hanya
  menambah gerbang yang tidak pernah dilewati.
- Bila aktif: request tipe `client` hanya boleh dibuat SESUDAH request
  internal untuk versi yang sama `approved`; request client menunjuk
  `placement_version_id` (channel-specific) bila relevan.
- Keputusan gerbang client dibuat oleh approver internal yang ditugaskan
  (bukan oleh `viewer_client`) — komentar klien TIDAK PERNAH menjadi
  keputusan approval (Keputusan #12, langkah 4.14). Klien melihat status
  request di portal + berkomentar bila workspace mengizinkan eksplisit.
- Bila gerbang aktif dan request client belum `approved`, placement
  tersebut BELUM siap dijadwalkan (penegakan di Phase 6).

## 6. Otorisasi keputusan — 7 poin Dok 06 §4

Setiap keputusan (`decide_approval_request`) memvalidasi, berurutan:
1. pemanggil terautentikasi; 2. member workspace pemilik request;
3. membership aktif; 4. role punya kapabilitas `approve_assigned`
   (`approver` penuh; `owner`/`admin`/`manager` HANYA bila ditugaskan
   eksplisit sebagai `assignee_user_id` di step — matriks "limited");
5. akses tingkat resource (step saat ini menugaskan pemanggil — lewat
   `assignee_user_id` ATAU `assignee_role` yang cocok dengan role
   pemanggil); 6. resource di dalam batas tenant (request milik
   workspace pemanggil); 7. transisi state valid (request `in_review`,
   versi yang ditinjau adalah versi TERBARU — stale ditolak).
- Request-changes / reject WAJIB komentar (ditolak server bila kosong).
- Keputusan append-only: TIDAK ADA UPDATE/DELETE pada
  `approval_decisions` (trigger + tanpa policy UPDATE/DELETE).
- TIDAK ADA endpoint yang mengubah status approval secara langsung —
  satu-satunya jalan sah adalah RPC keputusan + RPC submit.

## 7. Anti-bypass (R4.3 / langkah 4.11d)

Transisi langsung `internal_review → approved` lewat RPC lama
`transition_content_item_status` (0008) DITUTUP oleh migrasi 0014:
transisi itu hanya lolos bila ada request internal `approved` untuk
versi TERBARU item tersebut; bila tidak, RPC mengembalikan
`ok:false` + kode `APPROVAL_REQUIRED` + pesan yang menjelaskan cara
pemulihan (minta persetujuan dulu). Salinan fungsi 0008 dipertahankan
byte-identik kecuali guard ini (pola yang sama dengan migrasi 0012).

## 8. Batas jujur yang diketahui

- **Pemisahan tugas (submitter ≠ approver) TIDAK ditegakkan keras di
  database.** Otorisasi mengikuti 7 poin Dok 06 §4 (role + penugasan
  step); workspace yang butuh SoD ketat harus menugaskan approver yang
  berbeda dari submitter. Alasan: Dok 06 §4 tidak memuat larangan
  self-approval, dan rencana 4.11 tidak mengujinya. e2e Phase 4 memakai
  penugasan eksplisit pemilik sebagai approver (pengecualian R4.3 yang
  sah) agar perjalanan dua peran bisa diuji dengan satu akun; pgTAP 04
  menguji pemisahan dua pengguna (A submit, B decide).
- **Tidak ada workflow builder kustom** (UI bebas membuat workflow) —
  ditunda ke advanced / setelah validasi produk (rencana 4.3). Yang
  dibangun: workflow default + penugasan step (pilih member/role +
  `required_count`) di Approval Center.
- **Tidak ada approval otomatis oleh AI** — tidak pernah (D-010).
- **Tidak ada notifikasi berbayar** (SMS/WA gateway) — notifikasi hanya
  di dalam aplikasi (tabel `notifications`).
- Keputusan TIDAK PERNAH menerima `organization_id`, `workspace_id`,
  `user_id`, atau `role` dari payload client sebagai identitas
  tepercaya (Dok 06 §4) — tenant selalu dibaca dari sesi/membership.

## 9. Konsekuensi

- Phase 4 membangun: `approval_workflows`, `approval_steps`,
  `approval_requests`, `approval_decisions` (0013); RPC
  `create_approval_request`, `decide_approval_request`,
  `submit_content_for_client_review`, `get_or_create_default_workflow`
  + trigger critical-change + guard transisi (0014); Approval Center
  desktop + mobile (`/persetujuan`); tab Approval di editor konten;
  portal review klien (4.14); API `POST /api/v1/approvals/:id/decisions`
  (+ GET antrean/detail) dengan kode error Dok 07 §6.
- Phase 5 memakai: hanya konten approved yang dihitung "siap" di
  campaign. Phase 6 memakai: hanya versi approved/current yang boleh
  dijadwalkan + gerbang client bila aktif.
