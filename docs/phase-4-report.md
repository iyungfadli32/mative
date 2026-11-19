# Laporan Fase 4 — Review & Approval, P4-01 s.d. P4-14 (MaTive DRAF)

> Status: **DRAF — kode + migrasi + tes SELESAI dan lolos gate lokal; bukti
> live (migrasi 0013–0014, pgTAP 04, e2e approval) MENUNGGU parent**
> (koordinator tidak bisa menerapkan migrasi live — koneksi Postgres
> langsung dari VM diblokir; lihat §9). JANGAN klaim Phase 4 LOLOS PENUH
> sebelum §12 diisi parent setelah bukti live.

Tanggal kerja: 2026-11-19 (16:52–17:30 WIB). Koordinator: Phase 4
coordinator (sesi `53a7a877`). Commit: `03c1f0a` (lapisan DB),
`3891882` (kode aplikasi), + commit laporan/e2e ini (lihat §10).

Sumber kanonis: `~/workspace/mative/plan/Rencana-MaTive-Lengkap-v2.md`
(v2) + `Rencana-Detail-Phase-4-5-6-MaTive.md` bagian Phase 4 (v2 menang
bila bertentangan — teks pra-v2 soal ASUMSI-4.8 / penundaan portal klien
SUDAH DICABUT oleh Keputusan #12).

## 1. Ringkasan hasil

| Milestone                                                 | Status                  | Bukti                                                                                     |
| --------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| M4.1 Approval Center (desktop + mobile)                   | ✅ selesai (kode)       | `/persetujuan` + 5 antrean; screenshot 3 viewport di `docs/visual-qa/persetujuan-*.png`   |
| M4.2 Perjalanan dua peran + audit v1 utuh                 | ✅ selesai (kode + tes) | pgTAP 04 T7 (64 asersi, belum live); e2e `approval.spec.ts` tes penerimaan (belum live)   |
| M4.3 Approve versi basi DITOLAK + pesan + recovery        | ✅ selesai (kode + tes) | RPC 0014 + pgTAP 04 T4/T16; e2e langkah 7                                                 |
| M4.4 Keputusan orang tak ditugaskan DITOLAK di server     | ✅ selesai (kode + tes) | RPC 0014 + pgTAP 04 T2/T3/T9                                                              |
| M4.5 Critical change → `reapproval_required` + notifikasi | ✅ selesai (kode + tes) | 5 trigger 0014 + pgTAP 04 T10                                                             |
| 4.14 Portal klien (Keputusan #12)                         | ✅ selesai (kode)       | `ClientReviewPanel` di `/portal/[shareId]`; RPC `create_client_comment`; pgTAP 04 T11/T12 |

**Yang TIDAK dibangun** (sesuai larangan Phase 4): integrasi platform
sosial apa pun; auto publishing; AI approving (AI nonaktif di MVP,
D-011/ASUMSI-8A); custom workflow builder (ditunda pasca-validasi
produk); notifikasi berbayar (SMS/WA gateway) — hanya notifikasi in-app.

## 2. P4-01 — Model status dikunci (ADR-0010)

File: `docs/decisions/ADR-0010-approval-model.md` (8.791 byte, commit
`03c1f0a`).

Model yang dikunci (Keputusan #8 + default paling aman untuk
sub-keputusan terbuka):

- Status request: `submitted → in_review → approved | changes_requested
| rejected | reapproval_required`. `reapproval_required` adalah NILAI
  STATUS; request kembali ke `in_review` setelah versi baru disubmit.
- `client_review` = gerbang channel-specific SETELAH review internal;
  default MVP = 1 langkah, 1 approver yang ditugaskan.
- `changes_requested/blocked/cancelled` dicatat sebagai hasil di status
  history + status approval, BUKAN nilai production-status.
- **Daftar critical change (ASUMSI-4.6, default):**
  `["script", "caption", "cta", "asset", "channel", "format",
"scheduled_time"]`. Pemetaan data: script/caption/cta → kolom
  `content_versions`; asset → baris `content_assets`; channel/format/
  scheduled_time → `payload_snapshot` di `placement_versions` (channel =
  placement BARU ditambahkan; format/caption/scheduled_at = payload
  berubah). Diubah per workspace lewat `workspace_settings` key
  `approval.critical_fields`.
- **Kuorum (ASUMSI-4.7, default): 1 per step.** Step paralel = semua step
  di `step_order` yang sama harus mencapai kuorumnya.
- **Client review = OPT-IN per workspace, default MATI** (alasan:
  workflow default 1 langkah internal; gerbang klien hanya bermakna bila
  ada klien eksternal). Request klien hanya setelah internal approved;
  keputusan klien dibuat oleh approver internal yang ditugaskan —
  komentar klien TIDAK PERNAH menjadi keputusan approval.
- **Anti-bypass:** transisi `internal_review → approved` langsung di
  `transition_content_item_status` kini DITOLAK kecuali ada request
  internal yang approved untuk versi SAAT INI (kode
  `APPROVAL_REQUIRED` + pesan recovery). Guard ini defense-in-depth:
  alur normal sudah memindahkan produksi ke approved lewat RPC
  `decide_approval_request`; yang bisa diuji live hanyalah penolakannya
  (pgTAP 04 T8).
- **Batas jujur (ditulis di ADR): separation of duties (submitter ≠
  approver) TIDAK di-enforce keras di DB** — otorisasi 7 poin (Dok 06
  §4) saja; SoD lewat penugasan step. pgTAP 04 menguji pemisahan dua
  pengguna (A submit / B decide); e2e satu-akun memakai pengecualian
  R4.3 (owner ditugaskan eksplisit sebagai `assignee_user_id`) agar
  perjalanan bisa diuji dengan satu akun.

## 3. P4-02/P4-03 — Migrasi 0013 + 0014 + verifikasi statis

### 0013 — `supabase/migrations/0013_approval_core.sql` (61 pernyataan pglast OK)

- 4 tabel: `approval_workflows` (1 default per workspace — partial
  unique index), `approval_steps` (step_order, step_type
  sequential/parallel, `assignee_role` ATAU `assignee_user_id` — CHECK
  OR "minimal satu terisi", bukan XOR ketat; bila keduanya terisi,
  salah satu yang cocok sudah cukup untuk penugasan), `approval_requests`
  (target_type content_item/placement; `content_version_id` NOT NULL;
  `placement_version_id` wajib bila target placement; request_type
  internal/client; status CHECK 6 nilai, default `in_review`; partial
  unique index: 1 request aktif per (target, versi, placement, type)),
  `approval_decisions` (decision CHECK 3 nilai; komentar wajib untuk
  non-approval via CHECK; unique (request, step, approver)).
- `notifications.type` CHECK diperluas: `approval_requested` /
  `approval_decided` / `approval_reapproval_required` (DROP + ADD nama
  constraint yang sama, idempotent).
- RLS aktif di ke-4 tabel; **16 policy** (4+4+4+4): workflows/steps —
  select member 8 peran, insert/update manager, delete owner/admin;
  requests/decisions — select member-atau-klien-yang-dibagikan, TANPA
  policy insert/update/delete (tulis hanya lewat RPC). Grant: select/
  insert/update/delete untuk workflows/steps; **select-only** untuk
  requests/decisions (tulis diblokir di lapisan grant sebelum RLS).
- 4 helper SECURITY DEFINER (`is_workflow_member`,
  `is_approval_request_member`, `is_approval_request_approver`,
  `is_approval_request_visible_to_client`). `is_approval_request_approver`
  HANYA dipakai RPC 0014, TIDAK dipakai policy mana pun — graf policy
  tetap asiklik.
- Append-only: trigger `prevent_approval_decision_update` (UPDATE saja).
  DELETE sengaja TIDAK diblokir trigger agar cleanup CASCADE
  workspace/request tidak macet (pelajaran Phase 3 P0001); DELETE
  langsung diblokir RLS (`using (false)`).

### 0014 — `supabase/migrations/0014_approval_transactions.sql` (1.013 baris, 41 pernyataan pglast OK)

- 6 RPC publik (grant EXECUTE ke `authenticated`): `get_or_create_default_workflow`
  (workflow default malas: 1 step, role `approver`, required_count 1),
  `create_approval_request`, `decide_approval_request`,
  `submit_content_for_client_review`, `create_client_comment`, +
  guard `transition_content_item_status` (DROP + CREATE OR REPLACE —
  diff vs 0008 terverifikasi byte-identik kecuali blok guard).
- `create_approval_request`: validasi izin edit (`can_edit_content_item`),
  versi harus current (basi → `INVALID_STATE_TRANSITION` menyebut versi
  terbaru), placement version current, gerbang klien aktif + internal
  approved dulu, 1 request aktif, produksi → internal_review + status
  event + activity + notifikasi ke assignee step-1. Semua satu transaksi.
- `decide_approval_request`: komentar wajib untuk non-approval; 7 poin
  otorisasi (approver penuh; owner/admin/manager HANYA bila ditugaskan
  eksplisit sebagai `assignee_user_id` — R4.3); step dipilih dari
  penugasan caller (paralel diperbaiki); cek stale versi konten +
  placement; produksi harus masih internal_review (internal) / approved
  (klien); keputusan append (unique-violation → pesan ramah); evaluasi
  kuorum incl. step paralel di order yang sama; maju ke step_order
  berikut atau approved; transisi produksi + event + log; notifikasi ke
  submitter.
- 5 trigger critical-change (idempotent — hanya bertindak bila request
  masih `approved`; notifikasi ke approver + submitter):
  `check_critical_change_on_version` (script/caption/cta),
  `check_critical_change_on_placement_version` (payload format/caption/
  scheduled_at), `check_critical_change_on_asset_link` (content_assets
  insert/delete), `check_critical_change_on_placement` (placement insert /
  scheduled_at update), + reader `approval_critical_fields` (default
  dari `workspace_settings.approval.critical_fields`).
- **Keamanan — 2 helper internal TIDAK di-grant ke publik**
  (perbaikan §7.2/§7.3): `approval_critical_fields` dan
  `flag_request_reapproval` hanya bisa dipanggil trigger (SECURITY
  DEFINER); grant publik = 6 RPC.
- Verifikasi statis: pglast 0013 = 61 pernyataan OK, 0014 = 41 OK;
  audit forward-reference 0 masalah; audit graf RLS
  (`supabase/tests/rls_audit.py`): 4 siklus yang dilaporkan SUDAH ADA
  di 0001–0012 (organization_members/organizations/workspace_members/
  workspaces — dimediasi helper, identik dengan/tanpa 0013/0014); 0013
  sendiri = 0 siklus; graf efektif 0001–0014 = **144 policy, 0 siklus,
  0 self-loop** (verifier). Catatan jujur: frasa "0 siklus" di Phase 2/3
  merujuk graf efektif setelah resolusi helper — catat persis, jangan
  klaim berlebih.

### pgTAP 04 — `supabase/tests/04_rls_phase4.sql` (plan(64), 64 asersi)

Setup: org A/B, WS-A (A owner, B approver), WS-B (B admin), WS-C (A
owner, B creator), WS-D (A owner, B viewer_client) — B memegang peran
berbeda per workspace. Cakupan: T1 cross-tenant deny; T2 creator tidak
boleh decide (FORBIDDEN); T3 approver tak ditugaskan ditolak, T3b owner
yang ditugaskan eksplisit BOLEH decide (pengecualian R4.3); T4 approve
v1 basi setelah v2 → INVALID_STATE_TRANSITION menyebut versi terbaru;
T5 append-only via RLS (UPDATE/DELETE → 0 baris), T5b trigger blokir
UPDATE sebagai postgres (P0001); T6 request-changes tanpa komentar
ditolak, T6b dengan komentar → changes_requested + produksi editing +
v1 utuh; T7 perjalanan dua peran penuh (submit v1 → minta revisi →
buat v2 → submit v2 → setujui v2 → approved, v1 utuh); T8 transisi
langsung internal_review → approved tanpa request approved →
APPROVAL_REQUIRED (hanya penolakan yang bisa diuji — lihat §2); T9
tampering (A decide request WS-B → FORBIDDEN); T10 critical change
(caption baru setelah approval → reapproval_required + notifikasi); T11
gerbang klien (mati → FORBIDDEN; hidup + internal approved → request
klien dibuat + approved); T12 komentar klien (share + setting false →
FORBIDDEN; true → ok); T13 sequential 2-step (step 1 approve → masih
in_review, current_step_order 2; step 2 approve → approved); T13b
paralel (order sama, keduanya harus approve); T14 anon tidak bisa baca
tabel approval; T15 anon DENY; T16 placement version basi →
INVALID_STATE_TRANSITION.

Penolakan RPC mengembalikan jsonb `{ok:false}` (TIDAK throw) — pgTAP
meng-assert `->>'ok'` / `->>'code'`, BUKAN `throws_ok`, kecuali tes
trigger (T5c, P0001 asli). Cleanup mengikuti pelajaran v1.3 (tidak ada
brief_templates di file ini — tidak perlu unset-default; hapus
children-first, drop helper, finish(), rollback).

**Verifier statis `supabase/tests/rls_verify_phase4.py`: 51/51 PASS**
(pglast 0013=61, 0014=41, tes 04=159 pernyataan; jumlah asersi ==
plan(64); throws_ok 4-arg; UUID hygiene; 0013 tepat 4 tabel + RLS di
ke-4; forward-reference 0; policy 0 FROM/JOIN; 16 policy; CHECK status
6 nilai, decision 3 nilai, komentar-wajib, index 1-request-aktif,
1-workflow-default, unique (request, step, approver), assignee OR,
required_count ≥ 1, GRANT no-write + policy, trigger UPDATE-only,
policy tidak pernah memanggil `is_approval_request_approver`,
notifications type diperluas; graf efektif 0001–0014 0 siklus /
0 self-loop; 0014 7 fungsi, SECURITY DEFINER ×12, search_path terkunci,
6 grant publik, helper internal TIDAK di-grant, guard
APPROVAL_REQUIRED, 5 trigger critical-change, daftar critical default,
tidak ada tabel/policy baru, tidak ada pelonggaran RLS).

## 4. P4-04 s.d. P4-11 — Kode aplikasi

### Domain `features/approval/` (14 file)

- `types.ts` (status, keputusan, workflow/step/request/decision,
  tipe hasil RPC), `constants.ts` (5 tab antrean + label, label status/
  keputusan, DEFAULT_CRITICAL_FIELDS, DEFAULT_REQUIRED_COUNT = 1,
  STALE_APPROVAL_MESSAGE), `transitions.ts` (logika murni:
  `isActiveRequestStatus`, `isCurrentVersionRequest`, `isStepQuorumMet`
  menghitung approver DISTINCT, `openStepsAtOrder`, `isWorkflowComplete`,
  `criticalFieldsChanged` / `needsReapproval`, `nextStepOrder`).
- `queries.ts`: listWorkflows, getDefaultWorkflow, listWorkflowSteps,
  listApprovalQueue (5 tab — filter "menunggu_saya" dihitung di aplikasi
  dari step di current_step_order via assignee_user_id ATAU
  assignee_role == role caller), getApprovalRequest,
  listApprovalDecisions, listContentApprovalRequests,
  getActiveApprovalRequest, isClientReviewEnabled (default MATI),
  isClientCommentAllowed (default false), getCriticalFields.
- `actions.ts` ("use server"; Zod dulu, session + role dari DB, RPC 0014
  untuk multi-write): submitForApprovalAction, decideApprovalAction,
  submitClientReviewAction, assignWorkflowStepAction (owner/admin/
  manager; update approval_steps langsung — RLS menegakkan manager),
  updateApprovalSettingsAction (upsert baris `workspace_settings`
  sebagai JSON OBJECT `{"enabled": true}` / `{"allowed": false}` /
  `{"fields": [...]}` — kode 0014 membacanya dengan `->`/`->>` sehingga
  boolean telanjang akan mengembalikan NULL), clientCommentAction (RPC
  create_client_comment; komentar tidak pernah menjadi keputusan).
- Komponen (semua form `useActionState` TETAP MOUNTED setelah aksi —
  pelajaran pola Phase 3): DecisionForm (radio approve/changes_requested/
  rejected + komentar, wajib untuk non-approval), SubmitForApprovalForm,
  SubmitClientReviewForm, StepAssignmentForm (select role ATAU select
  pengguna; minimal satu terisi), ApprovalSettingsForm (select Ya/Tidak —
  BUKAN checkbox: checkbox yang tidak dicentang tidak ter-submit sehingga
  "false" tidak pernah bisa disimpan), ClientCommentForm, ApprovalTab
  (server: request aktif + keputusan + canDecide + peringatan stale +
  form submit + bagian client review + riwayat request + penugasan step
  default untuk owner/admin/manager), ApprovalCenterClient (tab antrean +
  kartu request + DecisionForm inline), ClientReviewPanel (portal: status
  request klien + komentar yang ada + ClientCommentForm hanya bila
  diizinkan).

### Halaman, API, wiring

- `app/(app)/persetujuan/page.tsx` — Approval Center (PlanningShell;
  memperkaya baris dengan judul konten/produksi, nomor versi, nama
  submitter, canDecide, isStale; form pengaturan untuk owner/admin/
  manager).
- Editor konten kini 9 tab (`features/production/constants.ts`:
  "approval" ditambahkan ke EDITOR_TABS + EDITOR_TAB_LABELS);
  `<ApprovalTab>` di-render di `app/(app)/konten/[id]/page.tsx` bila
  `tab === "approval"`.
- `<ClientReviewPanel>` di-render di `app/portal/[shareId]/page.tsx`
  (menggantikan teks placeholder "tombol komentar akan muncul di sini").
- Sidebar dinyalakan: AppSidebar + MobileBottomNav `/persetujuan`
  `available: true` (sebelumnya `false` + "Belum tersedia di fase ini
  (Phase 4).").
- API v1 (kode error Dok 07 §6): `app/api/v1/approvals/route.ts` GET
  antrean; `app/api/v1/approvals/[id]/route.ts` GET detail (request +
  keputusan + step); `app/api/v1/approvals/[id]/decisions/route.ts` POST
  keputusan; `app/api/v1/approvals/helpers.ts` (errorJson +
  requireContext). Perbaikan struktural saat penulisan: draf pertama
  menaruh GET_BY_ID/POST_DECISION di route.ts — tidak valid; dipecah
  jadi 3 file dengan nama GET/POST yang benar.
- Skema Zod baru di `lib/validation/schemas.ts`: submitApprovalSchema,
  decideApprovalSchema (refine: non-approval wajib komentar),
  submitClientReviewSchema, assignWorkflowStepSchema,
  updateApprovalSettingsSchema, clientCommentSchema,
  APPROVAL_REQUEST_STATUSES / APPROVAL_DECISIONS / APPROVAL_ROLES.
  Perbaikan saat penulisan: (a) duplikat definisi `optionalUuid`
  dihapus (sudah ada di baris 92, perilaku identik); (b) transform
  `assigneeRole` string kosong "" → null (FormData "" gagal enum).
- **Koreksi saat penulisan `criticalFieldsChanged`:** pemetaan pertama
  "channel" ke perbandingan platform_caption — SALAH; diselaraskan ke
  trigger DB: script/caption/cta → kolom content_versions; format/
  caption/scheduled_time (placement) → payload_snapshot
  platform_format/platform_caption/scheduled_at; asset → perubahan
  jumlah content_assets; channel → placement BARU ditambahkan
  (parameter boolean `newPlacementAdded`).

### Tes unit

- `tests/approval.test.ts` (20 tes): status aktif, versi basi, kuorum
  incl. 2 approver distinct, step paralel, penyelesaian workflow,
  nextStepOrder, critical change incl. caption placement → "caption"
  (bukan "channel"), jumlah aset, placement baru → "channel", field di
  luar daftar diabaikan.
- `tests/migrations.test.ts` diperbarui ke 14 migrasi (0001–0014) +
  0014 di daftar pengecualian function-only + 3 tes Phase 4 baru (0013:
  4 tabel + RLS + status 6 nilai + CHECK komentar + GRANT no-write +
  trigger UPDATE-only, tanpa trigger DELETE; 0014: APPROVAL_REQUIRED +
  4 nama trigger critical-change + helper internal TIDAK di-grant +
  guard adalah CREATE OR REPLACE dari transition_content_item_status;
  pgTAP 04: plan(64), tanpa UUID asli, finish() ada).

### e2e — `e2e/approval.spec.ts` (3 tes × chromium + mobile = 6)

1. **Penerimaan satu-akun:** masuk → buat org + workspace → brand →
   konten v1 → tab Approval → tugaskan step ke diri sendiri (eksplisit,
   R4.3; workspace baru hanya punya 1 member jadi opsi select pengguna
   index 1 = owner) → submit v1 → edit script jadi v2 → kembali ke tab
   Approval: peringatan stale tampil → approve v1 DITOLAK ("sudah basi")
   → minta revisi v1 (komentar wajib) → submit v2 → setujui v2 →
   "Status produksi: approved" → Approval Center `?tab=disetujui`
   memuat konten; `?tab=menunggu_saya` kosong → reload tab Approval:
   riwayat "Disetujui" persist. Timeout: expect 30 dtk + test 240 dtk
   (round-trip Supabase dari VM kerap >5 dtk, kadang >15 dtk — pola
   planning/production.spec.ts). Slug: `p4-${Date.now().toString(36)}`.
2. **Dua peran (SKIP bila `E2E_APPROVER_EMAIL`/`E2E_APPROVER_PASSWORD`
   tidak diisi):** owner undang approver (role approver) → token
   undangan dari halaman (bila tidak tampil — email otomatis aktif —
   tes skip dengan jelas) → approver masuk + terima undangan → owner
   buat brand + konten + submit v1 (step default menugaskan role
   approver — approver baru cocok lewat role, tanpa penugasan eksplisit)
   → approver: antrean Menunggu saya → buka konten → setujui →
   "Status produksi: approved".
3. **Smoke tanpa login:** `/persetujuan` menampilkan "Anda belum masuk".

**Catatan penugasan (penting untuk run live):** workflow default
menugaskan role `approver`; owner/admin/manager HANYA boleh memutuskan
bila ditugaskan EKSPLISIT sebagai assignee_user_id (RPC 0014, R4.3).
Tanpa penugasan, form keputusan tidak muncul dan teks "Anda tidak
ditugaskan di step saat ini" yang tampil — itu BUKAN defect, itu
penegakan R4.3 di UI.

## 5. P4-12 — Gate lokal (perintah + output aktual)

| Gate                                        | Perintah                                                                                           | Hasil                                                                                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint                                        | `npm run lint`                                                                                     | ✅ 0 error, 0 warning                                                                                                                                                                                          |
| Typecheck                                   | `npx tsc --noEmit`                                                                                 | ✅ exit 0                                                                                                                                                                                                      |
| Vitest                                      | `npm run test`                                                                                     | ✅ **131/131** (12 file: approval 20, migrations 19, production 20, planning-transitions 18, planning-calendar 12, planning-schemas 11, permissions 8, planning-search 7, time 6, validation 5, env 3, kpis 2) |
| Production build                            | `npm run build`                                                                                    | ✅ sukses; 28/28 static pages; route table 32 baris = 27 halaman + 4 API route (`/api/health` + 3 approval) + `/_not-found` (Phase 3: 26 halaman; kini 27 halaman + 4 API = 31 file route)                     |
| Playwright smoke+visual+approval (chromium) | `npx playwright test e2e/smoke.spec.ts e2e/visual.spec.ts e2e/approval.spec.ts --project=chromium` | ✅ **38 lolos, 2 skip** (@needs-db: 2 tes penerimaan approval — butuh migrasi live + akun uji), 0 gagal                                                                                                        |
| Visual QA                                   | (sama, visual.spec.ts)                                                                             | ✅ 3 screenshot baru `docs/visual-qa/persetujuan-desktop-1440.png` / `-tablet-1024.png` / `-mobile-390.png` (shell belum-login; keadaan login masih belum ada — lihat §8)                                      |
| Prettier                                    | `npx prettier --check .`                                                                           | ⚠️ **2 file pra-Phase 4 tidak bersih** (lihat §6.5) — semua file Phase 4 bersih                                                                                                                                |
| Secret scan                                 | grep kredensial di file Phase 4                                                                    | ✅ bersih — satu-satunya hit adalah referensi `process.env.E2E_TEST_PASSWORD` (bukan nilai)                                                                                                                    |

## 6. Defect yang ditemukan & diperbaiki (tidak disembunyikan)

### 6.1 Defect keamanan — grant EXECUTE `approval_critical_fields` ke authenticated (0014)

Fungsi itu membaca `workspace_settings` untuk workspace_id sembarang
TANPA cek keanggotaan — pemanggilan langsung akan membocorkan daftar
critical-fields workspace lain. **Perbaikan:** grant DIHAPUS (revoke
dari public dipertahankan); trigger (SECURITY DEFINER) tetap bekerja.
Ditemukan verifier statis sebelum commit. Commit `03c1f0a`.

### 6.2 Defect keamanan — grant EXECUTE `flag_request_reapproval` ke authenticated (0014)

Pemanggilan langsung bisa memaksa reapproval atas konten approved milik
orang lain (manipulasi state — lebih parah dari 6.1). **Perbaikan:**
grant DIHAPUS (revoke dari public dipertahankan). Grant publik kini = 6
RPC. Ditemukan verifier statis sebelum commit. Commit `03c1f0a`.

### 6.3 Defect file tes — pgTAP 04 T10d memakai UUID palsu literal di dalam blok `$$`

`'22222222-2222-2222-2222-222222222222'` di dalam blok `$$...$$` untuk
cek penerima notifikasi — setelah normalisasi SQL Editor TIDAK akan
disubstitusi dengan UUID user-B asli, sehingga asersi gagal live.
**Perbaikan:** `format($f$...%L...$f$,:'user_b')` (pola mapan file
01/02; `%L` meng-quote literal — `%s` salah karena memasukkan UUID
tanpa quote dan menghasilkan SQL tidak valid). Pelajaran 6 Phase 4.
Ditemukan verifier statis sebelum commit. Commit `03c1f0a`.

### 6.4 Defect tes pra-Phase 4 — smoke "tombol modul fase berikut" gagal deterministik

`e2e/smoke.spec.ts:72` mengharapkan tombol disabled "Unggah aset"
(`title="Belum tersedia di fase ini (Phase 3)."` di Topbar) terlihat
di /dashboard — tetapi tombol itu ada di dalam Dialog "Buat cepat"
yang hanya me-render isinya bila dibuka (`if (!open) return null`).
Tes gagal "element(s) not found" — deterministik, juga saat dijalankan
sendirian. **Bukan dari Phase 4:** `git diff e806b2c..HEAD` untuk
Topbar/Dialog/dashboard/smoke.spec.ts KOSONG — kode yang diuji tes itu
byte-identik dengan Phase 3. **Perbaikan (file tes saja, aplikasi
benar):** tes kini mengklik "Buat cepat" dulu sebelum meng-assert
tombol disabled. Tes lolos setelah perbaikan; suite penuh 38/38.
Commit laporan/e2e ini.

### 6.5 Prettier — 2 file pra-Phase 4 tidak bersih (dibiarkan, sengaja)

`npx prettier --check .` menandai `docs/phase-3-report.md` dan
`e2e/production.spec.ts` (hanya format tabel/baris). Verifikasi:
`git show e806b2c:<file> | prettier --check` → exit 1 untuk keduanya —
**sudah tidak bersih sejak commit Phase 3** (klaim "Prettier clean"
Phase 3 rupanya tercakup ke file yang diubah). Perbaikan formatnya
sengaja TIDAK diambil (revert setelah `prettier --write` menyentuhnya)
agar diff Phase 4 tidak tercemar perubahan kosmetik di luar cakupan.
Semua file Phase 4 Prettier-bersih (terverifikasi eksplisit, §5).
Parent memutuskan apakah 2 file itu diformat ulang.

## 7. Batas jujur — yang BELUM terbukti (wajib dibaca parent)

1. **Migrasi 0013 + 0014 BELUM diterapkan live** — hanya verifikasi
   statis (pglast + verifier 51/51 + audit graf). RLS/guard/trigger
   belum terbukti di database live.
2. **pgTAP 04 (64 asersi) BELUM terbukti live** — ekspektasi 64/64
   setelah §9 langkah 2.
3. **e2e approval.spec.ts BELUM terbukti live** — ekspektasi: 1
   penerimaan satu-akun + 1 smoke (chromium); tes dua-peran SKIP kecuali
   akun approver kedua disediakan. Alur penerimaan bergantung pada
   penugasan eksplisit step ke owner (R4.3) — bila UI penugasan berubah,
   tes perlu disesuaikan.
4. **Visual QA keadaan login belum ada** (daftar antrean berisi data,
   tab Approval berisi request, portal klien berisi konten) — hanya
   shell belum-login di 3 viewport.
5. **Separation of duties tidak di-enforce di DB** (§2) — bila produk
   nanti menuntut SoD keras, perlu constraint tambahan (mis. trigger
   yang menolak submitter = approver di step yang sama).
6. **Batas warisan Phase 2/3 masih berlaku:** dashboard KPI memakai
   workspace pertama bila pengguna punya beberapa; filter
   kalender/board limit 200 item; `getDashboardKpis` tidak membedakan
   "tidak ada data" vs "query gagal"; aset tanpa pemindaian virus;
   `duration_ms` selalu null; item tanpa brand tidak bisa diberi
   placement; WebKit (B4) tetap blocked; GitHub repo (B5) tetap belum
   dibuat — CI + deploy Vercel menunggu user.
7. **Dua peran sejati belum terbukti live** sampai akun approver kedua
   dibuat dan tes dua-peran dijalankan (pgTAP 04 T7 membuktikan
   pemisahan di level DB; e2e dua-peran membuktikan di level UI).

## 8. Instruksi penerapan ke live (untuk parent)

### Prasyarat

Sama seperti Phase 3 (`docs/apply-migrations.md`): proyek Supabase
"mative" ref `kwyqtlxglhlvtghfrnhr`, dashboard
https://supabase.com/dashboard/project/kwyqtlxglhlvtghfrnhr. JANGAN
sentuh pengguna Auth (khususnya `mative-test-a@` / `mative-test-b@` /
`mative-e2e@example.com` — UID `ef1c74e3-4a55-4e56-8799-db8f9a194f09`
(dibuat ulang 2026-11-19 18:49 WIB);
JANGAN hapus data seed; JANGAN ubah pengaturan Auth. Izin jaringan
Supabase allow_always sudah berlaku — tidak ada kartu persetujuan baru
yang diharapkan.

### Langkah 1 — Terapkan migrasi, URUTAN INI (lewat SQL Editor, per file per run, dalam beberapa part bila perlu)

1. `supabase/migrations/0013_approval_core.sql` — 4 tabel + 16 policy +
   4 helper + perluasan CHECK `notifications.type`.
2. `supabase/migrations/0014_approval_transactions.sql` — 6 RPC +
   5 trigger critical-change + guard `transition_content_item_status`.

Dialog yang mungkin muncul (preseden Phase 1–3): part yang membuat
tabel → dialog RLS → **"Run without RLS"** (migrasi mengaktifkan RLS
sendiri); dialog destructive-operation karena `drop trigger/policy/
function if exists` yang sah di file migrasi terverifikasi → **"Run
query"** — HANYA setelah memverifikasi dari disk bahwa objek yang
di-drop dibuat ulang di file yang sama. Part dipotong di batas
pernyataan (di luar blok `$$`); verifikasi jumlah baris + isi dari
disk sebelum menjawab pertanyaan browser (pelajaran: header "44 baris"
dan "119 baris" parent pernah salah; hitungan task yang benar).

Verifikasi setelah tiap langkah (SQL Editor):

```sql
-- Setelah 0013: 4 tabel baru, semuanya RLS aktif.
select tablename from pg_tables
where schemaname = 'public'
  and tablename in ('approval_workflows','approval_steps',
    'approval_requests','approval_decisions');
select c.relname as tablename, c.relrowsecurity as row_security_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('approval_workflows','approval_steps',
    'approval_requests','approval_decisions');
-- Ekspektasi: 4 baris, semuanya row_security_enabled = true.
-- (Pakai pg_class.relrowsecurity — pg_tables TIDAK punya kolom
--  row_security_enabled; pelajaran Phase 3.)

-- Setelah 0013: 16 policy.
select count(*) from pg_policies
where schemaname = 'public'
  and tablename in ('approval_workflows','approval_steps',
    'approval_requests','approval_decisions');
-- Ekspektasi: 16.

-- Setelah 0014: 6 RPC publik + 2 helper internal TIDAK di-grant.
select proname from pg_proc where proname in
  ('get_or_create_default_workflow','create_approval_request',
   'decide_approval_request','submit_content_for_client_review',
   'create_client_comment','approval_critical_fields',
   'flag_request_reapproval');
-- Ekspektasi: 7 baris. Lalu cek grant (harus TIDAK ada baris untuk
-- approval_critical_fields / flag_request_reapproval ke authenticated):
select p.proname, r.rolname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles r on has_function_privilege(r.oid, p.oid, 'execute')
where n.nspname = 'public'
  and p.proname in ('approval_critical_fields','flag_request_reapproval')
  and r.rolname = 'authenticated';
-- Ekspektasi: 0 baris.

-- Setelah 0014: guard ada di definisi transisi.
select pg_get_functiondef(oid) like '%APPROVAL_REQUIRED%'
from pg_proc where proname = 'transition_content_item_status';
-- Ekspektasi: true.
```

### Langkah 2 — Jalankan pgTAP 04 live

File `supabase/tests/04_rls_phase4.sql` (plan(64)). Ikuti petunjuk
header file (ganti `\set user_a/user_b` dengan UUID auth nyata —
`094e8752-eef4-4f0e-b6ae-2d5813445018` / `aabb1dab-77c1-4659-af0e-
c703c9de279c`; JANGAN pakai placeholder 1111.../2222...; aktifkan
ekstensi pgtap bila belum).

**PELAJARAN KERAS (Phase 3, 14:20 WIB): tiap Run SQL Editor adalah
sesi terpisah — file yang mencakup satu transaksi (begin…rollback)
HARUS ditempel UTUH dan di-Run SEKALI; part-by-part me-rollback part 1
dan merusak referensi FK.** Normalisasi: hapus baris `\set`, substitusi
UUID A/B (termasuk pola `format($f$...%L...$f$,:'user_b')` di T10d —
jangan ganti `%L` dengan `%s`).

**Ekspektasi: 64/64 PASS.** Bila ada yang gagal: JANGAN longgarkan
RLS/policy — laporkan kegagalannya ke koordinator build.

### Langkah 3 — Jalankan e2e Phase 4 live

```bash
E2E_TEST_EMAIL='mative-e2e@example.com' E2E_TEST_PASSWORD='<dari handoff — JANGAN tulis di file/log/chat>'
npx playwright test --project=chromium e2e/approval.spec.ts
```

**Ekspektasi: 1 penerimaan + 1 smoke lolos; 1 tes dua-peran SKIP**
(kecuali `E2E_APPROVER_EMAIL`/`E2E_APPROVER_PASSWORD` diisi — akun
approver kedua harus sudah dibuat sebelumnya). Juga jalankan ulang
`e2e/planning.spec.ts` (ekspektasi 4/4) dan `e2e/production.spec.ts`
(ekspektasi 3/3) sebagai regresi — guard baru di
`transition_content_item_status` hanya menolak transisi
internal_review → approved tanpa request approved; spek lama tidak
pernah melakukan transisi itu (planning.spec.ts hanya Ide → Brief),
jadi regresi diharapkan tetap lolos.

### Langkah 4 — Setelah lolos

- Perbarui `docs/apply-migrations.md` (tandai 0013–0014 diterapkan +
  tanggal) dan isi §12 laporan ini (deklarasi).
- Perbarui buku rencana (`Rencana-MaTive-Lengkap-v2.md`: 6/11 = 55%),
  `MEMORY.md`, dan catat `completions.jsonl` (satu baris, agent
  "Braderz Plan Management").
- Bersihkan data uji di live (§8.1) — data e2e tidak merusak apa pun,
  hanya residu.

### 8.1 Data uji yang tertinggal di live + cara membersihkan

Semua baris di bawah adalah residu tes (bukan data seed — seed JANGAN
dihapus: org slug `contoh-studio-sample`, workspace slug
`workspace-contoh-sample`).

Pola slug residu e2e Phase 4 (pola dari `e2e/approval.spec.ts`):

- Organisasi: `org-p4-*` (penerimaan satu-akun) dan `org-p4-2r-*`
  (dua-peran).
- Workspace: `ws-p4-*` / `ws-p4-2r-*`.
- Brand: `brand-p4-*` / `brand-p4-2r-*`.
- Konten: judul `Konten P4 *` / `Konten P4 2r *`.
- pgTAP 04 tidak meninggalkan residu (transaksi rollback).

**Aturan pembersihan yang tahan lama (Phase 3, 16:52 WIB): unset
`is_default=false` pada brief template default SEBELUM menghapus
workspace/organisasi yang memilikinya** — bila tidak, hapus akan gagal
P0001 karena CASCADE ke brief_templates memicu guard
`trg_prevent_default_template_delete`. Pola SQL (sesuaikan slug):

```sql
-- 1. Unset default template di workspace yang akan dihapus.
update public.brief_templates set is_default = false
where workspace_id in (
  select id from public.workspaces where slug like 'ws-p4-%'
);
-- 2. Hapus organisasi (CASCADE membersihkan workspace + isinya).
delete from public.organizations where slug like 'org-p4-%';
-- Ekspektasi: hanya seed yang tersisa (1 org, 1 workspace).
```

**Koordinator TIDAK menghapus residu sendiri** (sesuai brief) — parent
yang membersihkan setelah deklarasi.

## 9. File yang diserahkan (P4-01 s.d. P4-14)

| File                                                                   | Isi                                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `docs/decisions/ADR-0010-approval-model.md`                            | Model approval yang dikunci + default sub-keputusan + batas jujur |
| `supabase/migrations/0013_approval_core.sql`                           | 4 tabel + 16 policy + 4 helper + CHECK notifications              |
| `supabase/migrations/0014_approval_transactions.sql`                   | 6 RPC + 5 trigger critical-change + guard transisi                |
| `supabase/tests/04_rls_phase4.sql`                                     | pgTAP plan(64) — belum terbukti live                              |
| `supabase/tests/rls_verify_phase4.py`                                  | Verifier statis — 51/51 PASS                                      |
| `features/approval/` (14 file)                                         | types, constants, transitions, queries, actions + 9 komponen      |
| `app/(app)/persetujuan/page.tsx`                                       | Approval Center                                                   |
| `app/api/v1/approvals/` (4 file)                                       | GET antrean, GET detail, POST keputusan, helpers                  |
| `app/(app)/konten/[id]/page.tsx`                                       | Tab "approval" (9 tab)                                            |
| `app/portal/[shareId]/page.tsx`                                        | ClientReviewPanel                                                 |
| `components/layout/AppSidebar.tsx`, `MobileBottomNav.tsx`              | `/persetujuan` available: true                                    |
| `features/production/constants.ts`                                     | EDITOR_TABS + EDITOR_TAB_LABELS (+approval)                       |
| `lib/validation/schemas.ts`                                            | 6 skema approval + 3 konstanta                                    |
| `tests/approval.test.ts`                                               | 20 tes unit logika approval                                       |
| `tests/migrations.test.ts`                                             | Diperbarui: 14 migrasi + 3 tes Phase 4                            |
| `e2e/approval.spec.ts`                                                 | 3 tes (penerimaan + dua-peran + smoke) — belum terbukti live      |
| `e2e/visual.spec.ts`                                                   | +1 tes visual /persetujuan × 3 viewport                           |
| `e2e/smoke.spec.ts`                                                    | Perbaikan tes "tombol modul fase berikut" (§6.4)                  |
| `docs/visual-qa/persetujuan-{desktop-1440,tablet-1024,mobile-390}.png` | Screenshot shell Approval Center                                  |
| `docs/phase-4-report.md`                                               | Laporan ini                                                       |
| `docs/apply-migrations.md`, `CHANGELOG.md`, `README.md`                | Diperbarui (Phase 4, v0.4.0 DRAF)                                 |

## 10. Sub-keputusan terbuka yang diputuskan sendiri (default paling aman)

| Sub-keputusan                     | Default yang dikunci                                                                                  | Alasan                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| ASUMSI-4.6 daftar critical change | `["script","caption","cta","asset","channel","format","scheduled_time"]`                              | Daftar Dok 07 §4; channel = placement baru, format/caption/scheduled_time = payload berubah          |
| ASUMSI-4.7 kuorum + urutan step   | Kuorum 1 per step; sequential = step_order naik; parallel = semua step di order yang sama harus lolos | Paling sederhana yang masih menguji logika multi-step (pgTAP T13/T13b)                               |
| Client review default             | OPT-IN per workspace, default MATI                                                                    | Workflow default 1 langkah internal; gerbang klien hanya bermakna bila ada klien eksternal           |
| Komentar klien default            | TIDAK BOLEH (default false)                                                                           | Keputusan #12 eksplisit                                                                              |
| Separation of duties              | TIDAK di-enforce di DB                                                                                | Otorisasi 7 poin + penugasan step sudah cukup untuk MVP; SoD keras = pekerjaan lanjutan (§7 butir 5) |
| DELETE approval_decisions         | Tidak diblokir trigger (RLS `using (false)` saja)                                                     | Agar cleanup CASCADE workspace/request tidak macet (pelajaran Phase 3 P0001)                         |

Masih terbuka (di luar Phase 4): retry/backoff/lease (ASUMSI-6.3,
Phase 6), timezone source of truth item vs placement (ASUMSI-6.6,
Phase 6), threshold evaluasi AI (Phase 8 step 8.9), threshold performa
(Phase 9 step 9.5).

## 11. Deklarasi — LULUS (dinyatakan parent 2026-11-19 20:24 WIB)

**Phase 4 LULUS.** Tiga gerbang live lolos, dan parent memverifikasi
langsung dari disk + perintah (bukan hanya dari laporan koordinator):

| Gerbang | Bukti |
| ------- | ----- |
| Migrasi 0001–0015 live | 0013 diterapkan 17:40 WIB, 0014 17:54 WIB, 0015 18:32–18:35 WIB — semua terverifikasi live (4 tabel + RLS ×4 + 16 policy; 7 fungsi, 0 grant helper ke authenticated; guard APPROVAL_REQUIRED; CHECK notifikasi kini mencakup 'placement'; definisi `validate_notification_scope()` memuat cabang placement) |
| pgTAP 04 v1.4 (commit `65ce724`) | **64/64 PASS live** 18:36–18:42 WIB, `finish()` 0 baris, nol "not ok", residu 0 |
| e2e live (akun uji segar UID `ef1c74e3-…`, kredensial diverifikasi HTTP 200 ke endpoint Auth dulu) | `approval.spec.ts` **2 passed + 1 skipped** (dua-peran SKIP — diharapkan, butuh akun approver kedua); `planning.spec.ts` **4/4**; `production.spec.ts` **3/3** |

### Saga pgTAP 04 (semua gagal sebelum v1.4 adalah cacat file tes, kecuali satu)

- v1.0 gagal 18:01 WIB — 23514 di SETUP (CHECK `social_channels` menolak 'disconnected') → perbaikan v1.1 (`e928c1b`).
- v1.1 gagal 18:08 WIB — 42703 di SETUP (kolom `resource_shares.created_by` tidak ada; kolom 0005 adalah `shared_by` NOT NULL) → v1.2 (`28a8f4c`).
- v1.2 gagal 18:13 WIB — 42883 di T5 (`is(bigint, integer)` tanpa overload; 5 assert count tanpa cast `::int`) → v1.3 (`4f4262e`).
- v1.3 gagal 18:16–18:20 WIB — 42501 di T5 (authenticated TIDAK PUNYA grant UPDATE/DELETE pada `approval_decisions` — 0013:208/212 revoke all + grant select saja, sesuai desain append-only; cek privilege Postgres mendahului RLS, jadi 0-baris yang diharapkan tidak pernah terjadi) → v1.4 (`65ce724`, T5/T5b ditulis ulang sebagai `throws_ok` 42501 — bukti DENY yang lebih kuat; TIDAK ada grant yang ditambah).
- v1.4 run pertama gagal 18:27–18:30 WIB — P0001 di **T16 SETUP** (bukan T2 seperti ditebak browser task): **CACAT PRODUK NYATA** — `create_approval_request` untuk placement selalu crash saat menulis notifikasi 'approval_requested', karena trigger `validate_notification_scope()` (0009) tidak punya cabang 'placement' (v_ws NULL → raise) DAN CHECK `notifications_target_type_check` tidak mencakup 'placement' (akan gagal 23514 berikutnya). Ketiga penulis notifikasi 0014 (create:254, decide:489, reapproval:653) memakai target_type request — jadi SELURUH alur approval placement di produksi rusak; e2e lokal tidak menangkapnya (hanya alur content_item). Perbaikan = **migrasi 0015** (commit `e307ed0`): CHECK diperluas + cabang placement di trigger (workspace lewat content_placements → content_items). Diterapkan + terverifikasi live 18:35 WIB; residu 0/0.
- v1.4 run ulang **64/64 PASS** 18:36–18:42 WIB. Migrasi TIDAK PERNAH dilonggarkan demi tes lolos.

### Saga e2e (run 1 gagal di kredensial, run 2 lolos penuh)

- Run 1 (18:46 WIB): penerimaan gagal di sign-in ("Email atau kata sandi salah"); smoke lolos; dua-peran SKIP. Diagnosis terverifikasi: kata sandi lama tidak cocok di endpoint Auth (HTTP 400 `invalid_credentials`) — bukan cacat aplikasi. Akun dibuat ulang 18:49 WIB dengan kata sandi baru dari parent (huruf+angka saja), UID baru `ef1c74e3-4a55-4e56-8799-db8f9a194f09`, Auto Confirm ON.
- Run 2 (20:21 WIB): kredensial diverifikasi HTTP 200 dulu, lalu **semua lolos** (tabel di atas). Regresi production sempat gagal 1× di run pertama ("Template Brief Standar" menampilkan "Template (0)" padahal template default SUDAH ada di DB sejak 20:15 WIB, terverifikasi via REST) — lolos 3/3 di run ulang. Dugaan (BELUM terbukti): koneksi VM→Supabase sempat putus dan `runQuery` menelan galat list menjadi daftar kosong. Tindak lanjut hardening (di luar Phase 4): tampilkan galat query, bukan daftar kosong.

### Cacat aplikasi yang ditemukan & diperbaiki selama e2e (11 commit, semua diverifikasi parent dari disk)

1. `3c83a08` — Workflow default dibuat LAZY oleh RPC 0014 (baru ada saat submit pertama), sehingga form penugasan step TIDAK PERNAH muncul sebelum submit pertama — padahal penugasan harus bisa dilakukan SEBELUM submit (R4.3). ApprovalTab kini memanggil RPC idempotent `get_or_create_default_workflow` saat tab dibuka (owner/admin/manager), lalu baca ulang; galat RPC diabaikan (balapan aman via indeks unik satu-default). Tanpa migrasi.
2. `09d4d6f` — Revalidasi `/konten/baru` sesudah mutasi planning.
3. `3c19f67` — Paksa `no-store` pada fetch klien Supabase server (hardening; komentar jujur di kode: ini BUKAN perbaikan "daftar brand basi" — penyebabnya wait spek yang false-positive).
4. `a869027` — Tiga form `useActionState` (SubmitForApproval, Decision, SubmitClientReview) di-unmount tepat saat aksinya berhasil sehingga pesan sukses hilang sebelum dibaca (pola yang sama dengan 2 cacat Phase 3). Kini ketiga form tetap mounted; yang sudah diputuskan dirender disabled; key per versi/request.
5. `d20c163` — Form keputusan dirender di dalam panel request aktif; request yang sudah diputuskan bukan lagi "aktif", jadi panel + form + pesan "Keputusan tercatat: …" ikut hilang dari DOM. Form kini di luar panel, mengikuti request terbaru (aktif atau yang baru diputuskan).
6. Perbaikan spek (bukan pelonggaran): `f490889` wait toast brand, `969bc0a` pindah stage ke Editing sebelum submit, `b229b3d` isi ringkasan perubahan saat buat v2, `c8c3e43` susun ulang alur penerimaan (lihat bawah), `354123d` assert approve v3 lewat riwayat + status produksi (bukan pesan form yang transien), `5bb35c4` antrean "Menunggu saya" berisi request v2 (bukan kosong). Spek regresi DIPERKETAT: `exact: true` pada wait "Brand dibuat." / "Task dibuat." — tanpa exact, wait cocok dengan hint statis ("…setelah brand dibuat.") dan lolos instan sebelum insert selesai.
7. Commit parent: `4f54560` (uji statis migrasi diperbarui ke 15 migrasi + uji khusus 0015 — 3 tes sempat gagal karena ekspektasi basi 0001–0014, BUKAN regresi; Vitest kini 132/132), `eeb436c` (Prettier `production.spec.ts`, kosmetik saja).

**Restrukturisasi alur stale — DIKONFIRMASI parent:** alur lama (submit v1 → buat v2 → approve v1 ditolak basi → minta revisi v1) tidak mungkin — `decide_approval_request` (0014) menolak SEMUA keputusan atas versi basi, bukan hanya approve. R4.1/A4.5 + pgTAP 04 (T4, T6) hanya menetapkan approve-basi ditolak dan minta-revisi atas versi terbaru berhasil — jadi RPC benar, spek yang salah. Alur baru mengikuti RPC: submit v1 → minta revisi v1 selagi terbaru → buat v2 → submit v2 → buat v3 → approve v2 ditolak basi (R4.1) → submit v3 → setujui v3 → Disetujui. Bila suatu hari minta-revisi atas versi basi diinginkan, itu perubahan desain yang butuh migrasi 0016 + ubah pgTAP — tidak dilakukan di sini.

### Verifikasi first-hand parent (20:22–20:24 WIB, HEAD `eeb436c`, 50 commit, tree bersih)

- `git log` + `git diff e307ed0..HEAD` dibaca commit per commit (11 commit koordinator e2e — laporan akhirnya hanya menyebut 4; 7 lainnya ditemukan parent dari disk dan ikut diverifikasi).
- Lint 0 error, typecheck 0 error, **Vitest 132/132**, build lolos.
- File probe koordinator (`probe-brand*.mjs`) tidak tersisa di repo; residu e2e hanya di database live (dibersihkan §8.1, lihat bawah).

### Batas jujur — yang BELUM terbukti (tetap berlaku)

1. Approval dua-peran TIDAK terbukti live (butuh akun approver kedua — tes SKIP seperti dirancang).
2. Separation of duties TIDAK di-enforce di DB (sesuai desain; §10).
3. QA visual tampilan `/persetujuan` di browser sungguhan belum dilakukan (tidak ada screenshot login).
4. Kegagalan transien "Template (0)" 1× — hipotesis koneksi putus BELUM terbukti; hardening "tampilkan galat query" dicatat untuk Phase 9.
5. Request basi tidak pernah tertutup otomatis: request v2 yang ditolak basi tetap `in_review` selamanya dan tampil di antrean "Menunggu saya". Itu perilaku desain RPC saat ini — keputusan penutupan otomatis ditunda ke fase berikut.
6. Visual QA login + dua-peran tetap menunggu akun/cek yang sama seperti di §7.

### Pembersihan residu (§8.1) — SELESAI, terverifikasi seed-only

- 20:25–20:27 WIB: unset `is_default=false` (workspace `ws-p4-%` + `ws-probe-%`), lalu hapus org `org-p4-%` + `org-probe-%` — residu Phase 4 hilang (terverifikasi dari daftar slug). Namun hitungan akhir menunjukkan orgs 8 (ekspektasi 1): 7 organisasi kosong dari run lama masih ada — `org-e2e-mwnkoxot`, `org-e2e-mwnkufr1`, `org-p3-p3-mwnkp146`, `org-p3-p3-mwnks871`, `org-probe2-probe2-mwniec15`, `org-probe3-probe3-mwnig0ga`, `org-probe4-probe4-mwnihd82` — semuanya tanpa workspace maupun isi apa pun (workspaces 1, semua tabel konten 0).
- 20:27–20:29 WIB: ketujuh org kosong itu dihapus dengan slug PERSIS (tanpa LIKE). Verifikasi akhir: **orgs 1, workspaces 1, org_members 1, ws_members 2, brands 0, content_items 0, approval_requests 0, brief_templates 0, notifications 0 — seed-only tercapai sepenuhnya.** Seed (`contoh-studio-sample`) dan pengguna Auth tidak disentuh.

**Dampak deklarasi:** buku rencana 6/11 = 55% (`Rencana-MaTive-Lengkap-v2.md`); `MEMORY.md` diperbarui; satu baris `completions.jsonl` (agent "Braderz Plan Management"); pesan milestone ke user; lalu spawn koordinator Phase 5 (Campaign & Visual Planning).
