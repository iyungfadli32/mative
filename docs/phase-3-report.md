# Laporan Fase 3 — Production Operations, P3-01 s.d. P3-12 (MaTive DRAF)

> Status: **kode aplikasi + migrasi SELESAI, gate lokal LOLOS; gate live MENUNGGU
> koordinator** (migrasi 0009 + 0010 + 0011 belum diterapkan ke live, pgTAP 03
> dan spek e2e Phase 3 belum bisa lolos live sebelum itu).
> Tanggal: 2026-11-19. Rencana kanonis: `Rencana-MaTive-Lengkap-v2.md` + detail
> Phase 3 (`Rencana-Detail-Phase-1-2-3-MaTive.md` §3) + Dok 05 §3/§5/§6,
> Dok 06 §8, Dok 12 Phase 3, prompts/04. Keputusan desain: ADR-0009.

## 0. Langkah 0 — Defect PlacementForm warisan Phase 2 (SEBELUM P3-01)

**Terduga:** select Channel di-`disabled` saat edit placement (`initial`),
sementara `updatePlacementAction` mewajibkan `socialChannelId` UUID — pola yang
sama dengan defect kritis ContentForm (#5, sudah diperbaiki dengan hidden input,
commit `4cb24a0`).

**Pembuktian (probe `e2e/probe-placement-edit.spec.ts`, sudah dihapus):** login
sebagai `mative-e2e@example.com` → buat brand + channel + konten + placement →
edit placement (ubah caption) → hasil: form edit menampilkan select Channel
disabled + `alert: Data tidak valid.` dan caption tetap "Caption IG Probe0"
(tidak berubah). **Defect TERBUKTI.** Dua kegagalan probe sebelum pembuktian
bukan defect aplikasi: (1) user e2e belum punya workspace setelah pembersihan
live — probe diperbaiki dengan membuat org+workspace dulu (pola
`e2e/auth.spec.ts`); (2) pesan sukses tambah placement tidak muncul karena form
unmount saat `freeChannels` kosong setelah placement pertama (pola yang sudah
didokumentasikan di `planning.spec.ts`) — probe diperbaiki dengan membuat
2 channel (IG + TikTok).

**Perbaikan (pola yang sama dengan ContentForm #5):** hidden input
`<input type="hidden" name="socialChannelId" value={initial.social_channel_id} />`
saat `initial` ada, di `features/planning/components/PlacementForm.tsx`.

**Verifikasi:** probe re-run **LOLOS 1/1** ("Placement diubah (versi v2)."),
lalu `planning.spec.ts` re-run **4/4 lolos**. Commit terpisah **`3485eb1`**
("Fix: hidden socialChannelId saat edit placement (Langkah 0 Phase 3)").

**Pelajaran probe (dicatat untuk tes e2e berikutnya):**
`expect.configure({ timeout: 30000 })` sebagai statement TIDAK mengubah timeout
default (ia mengembalikan expect baru; default tetap 5 dtk) — pakai timeout
eksplisit `{ timeout: 30000 }` pada tiap expect setelah navigasi lambat.
Workspace switcher default ke workspace PERTAMA berdasarkan `created_at`.
Pesan sukses tambah placement hilang bila `freeChannels` kosong setelah
placement pertama.

## 1. Ringkasan hasil

| Langkah          | Cakupan                                                                           | Status                    | Bukti                                                                                          |
| ---------------- | --------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| Langkah 0        | Defect PlacementForm                                                              | ✅ **SELESAI + TERBUKTI** | Probe 1/1, planning.spec.ts 4/4, commit `3485eb1`                                              |
| P3-01            | Migrasi 0009 (9 tabel + bucket)                                                   | ✅ **SELESAI**            | pglast 177 statement, §2                                                                       |
| P3-02            | Migrasi 0010 (5 RPC) + RLS                                                        | ✅ **SELESAI**            | pglast 20 statement, §3                                                                        |
| P3-03            | pgTAP 03 (34 asersi) + verifikasi statis                                          | ✅ **SELESAI (lokal)**    | plan(34) vs 34 asersi, verifier **50/50**, graf RLS 128 policy 0 siklus — BELUM jalan live, §3 |
| P3-04 s.d. P3-11 | Kode aplikasi (schemas, `features/production/`, halaman, editor bertab)           | ✅ **SELESAI**            | §4; lint 0, typecheck 0, Vitest 107/107, build 26 route                                        |
| P3-12            | Gate lokal                                                                        | ✅ **LOLOS**              | §5                                                                                             |
| Perbaikan 0011   | Trigger scope item tanpa brand (defect laten Phase 2, ditemukan saat e2e Phase 3) | ✅ **SELESAI (lokal)**    | pglast 3 statement, pgTAP T15 (regresi), verifier 50/50 — BELUM diterapkan live, §6.4          |

**Yang TIDAK dibangun** (larangan rencana, ditaati): approval, publishing,
integrasi provider, analytics, AI, billing. Channel tetap metadata saja
("belum terhubung") — tidak ada klaim "terhubung" di mana pun.

## 2. P3-01 — Migrasi 0009 (`supabase/migrations/0009_production_ops.sql`)

1.190 baris, pglast **177 statement**. 9 tabel (tepat sesuai Dok 05 §3,
tanpa tabel fase lain): `brief_templates`, `tasks`, `task_checklist_items`,
`assets`, `asset_versions`, `content_assets`, `comments`, `mentions`,
`notifications` + FK `brands.logo_asset_id → assets(id) ON DELETE SET NULL`
(janji dari 0007) + 23 indeks + 5 trigger validasi scope + 1 trigger proteksi
template default + 1 trigger anti-tamper notifikasi + 9 helper RLS
`SECURITY DEFINER` + 36 policy tabel + bucket privat `mative-assets`
(public=false) + 5 policy storage (1 buckets + 4 objects).

**Penyimpangan terdokumentasi dari pola 0001–0008:** `storage.objects` adalah
tabel sistem bersama — grant-only (aditif) + policy baru, TANPA revoke, agar
tidak merusak grant bawaan Supabase untuk bucket lain.

**Defect saat penulisan (diperbaiki sebelum commit):**

1. `content_assets_select_member_or_shared` memakai subquery skalar
   `(select workspace_id from content_items...)` di dalam policy — melanggar
   aturan tanpa-FROM/JOIN-di-policy; diperbaiki dengan helper
   `is_content_item_member` (0007).
2. `asset_versions_select_member_or_shared` memanggil
   `is_task_member(asset_id)` (tidak masuk akal); diperbaiki dengan menambah
   helper `is_asset_member`.

Keputusan desain (ADR-0009, ringkas — baca file untuk detail):

- Enum terkunci di DB: `tasks.parent_type` {content_item, campaign},
  `comments.target_type` {content_item, campaign, task},
  `notifications.target_type` {content_item, campaign, task, comment},
  `notifications.type` {mention, task_assigned, task_status_change,
  comment_reply}, `content_assets.usage_role` {primary, reference, thumbnail,
  attachment}, `tasks.status` {todo, in_progress, in_review, done, blocked,
  cancelled}, `tasks.priority` {low, medium, high, urgent},
  `assets.processing_status` {uploading, ready, failed}.
- Mesin status task: todo → in_progress → in_review → done;
  todo/in_progress/in_review → blocked; blocked → todo; non-done →
  cancelled; cancelled → todo; done terminal (tidak bisa dibuka lagi).
  Transisi menulis `activity_logs` lewat RPC. Toggle checklist mengisi/
  mengosongkan `completed_by`/`completed_at`.
- Peran "limited" (strategist/creator/editor/approver): INSERT task hanya
  dengan `assignee_user_id` = diri sendiri atau NULL; UPDATE/DELETE hanya
  task yang ditugaskan ke mereka (cermin preseden `items_insert_editors` di
  0007). Peran penuh (owner/admin/manager) boleh menugaskan ke siapa pun.
  `viewer_client` hanya melihat task yang parent-nya dibagikan eksplisit
  (reuse helper `is_resource_shared_with_me` dari 0007).
- Aset: object_key `<workspace_id>/<asset_id>/<nama-file-disarankan>`,
  maks 10 MB (CHECK + validasi server), MIME dari isi file (magic bytes —
  bukan ekstensi), signed URL 1 jam, checksum SHA-256, lebar/tinggi di-parse
  server-side untuk PNG/JPEG saja (WebP/video/PDF = null), `duration_ms` =
  null di fase ini (tanpa parser durasi), **tanpa pemindaian virus di MVP —
  batas jujur, jangan pernah klaim aman-malware**; `asset_versions` v1 saat
  unggah berhasil; unggah gagal meninggalkan baris `processing_status='failed'`;
  hapus aset hanya bila tidak ada referensi `content_assets` (ditolak dengan
  pesan jelas); melepas lampiran tidak pernah menghapus file.
- Komentar/mention: mention adalah pilihan member EKSPLISIT yang dikirim ke
  RPC, BUKAN di-parse dari teks `@nama`. RPC `create_comment_with_mentions`
  (satu transaksi: komentar + mention + notifikasi `mention` + activity log);
  mention hanya member aktif workspace yang sama. Edit mengisi `edited_at`;
  hapus adalah soft-delete (`deleted_at` + `deleted_by`, dirender "Komentar
  ini dihapus"). **Komentar klien (`viewer_client`):** hanya bila (a) target
  dibagikan eksplisit DAN (b) setting workspace `workspace_settings` kunci
  `allow_client_comments` (JSON boolean, default false/tidak ada = TIDAK
  diizinkan), diubah di `/pengaturan` oleh owner/admin saja; ditegakkan di
  RLS lewat helper `is_client_comment_allowed` + `is_comment_target_shared`.
  Notifikasi dasar saja (P3-A6), tanpa email/SMS, hanya ditulis lewat RPC
  `SECURITY DEFINER` (tanpa policy INSERT/UPDATE/DELETE untuk `authenticated`);
  pengguna hanya membaca notifikasinya sendiri + menandai `read_at`.
- Brief: `brief_snapshot` JSONB `{objective, audience, angle, format,
key_messages[], cta, references[]}` disimpan lewat RPC 0008 yang SUDAH ADA
  (`update_content_item_with_version`, parameter `p_brief_snapshot`);
  `change_summary` wajib. `brief_templates.schema_json` =
  `{fields: [{key, label, type: text|list, required}]}`; 1 template default
  per workspace (partial unique index); default tidak bisa dihapus (trigger),
  diganti lewat RPC `set_default_brief_template` (satu UPDATE atomik);
  template default dibuat malas/idempotent (`ensureDefaultBriefTemplate`,
  backstop unique-index).
- Versi: restore = versi BARU yang menyalin snapshot lama (RPC
  `restore_content_version`, `change_summary` "Dipulihkan dari vN");
  bandingkan = berdampingan per-field dengan field yang berubah ditandai
  (bukan diff baris otomatis).
- Content Workspace/Editor: tab lewat `?tab=` (server-rendered), default
  `overview`: overview, brief, script, media, placements, tasks, comments,
  versions. Status simpan terlihat + pemulihan autosave (draf di
  `localStorage` per content item; beri peringatan + pulihkan/buang, jangan
  pernah diam-diam membuang). Ringkasan approval/publishing ditampilkan
  sebagai "belum tersedia di fase ini". Konten master dibedakan dari varian
  placement.
- Ideas Inbox: konversi memakai RPC 0008 yang SUDAH ADA
  (`convert_idea_to_content`, satu transaksi; menolak konversi ulang);
  Phase 3 menambah UI (filter status/brand/owner, detail, tombol konversi
  nonaktif dengan alasan bila sudah dikonversi).

## 3. P3-02/P3-03 — Migrasi 0010 + pgTAP 03 + verifikasi statis

**Migrasi 0010** (`supabase/migrations/0010_production_transactions.sql`,
19.820 byte, pglast **20 statement**): 5 RPC `SECURITY DEFINER` (pola yang
sama dengan 0008 — search_path terkunci, cek membership/peran sendiri,
kembalikan `jsonb {ok, message, ...}`, GRANT EXECUTE hanya ke
`authenticated`): `create_task_with_checklist`,
`transition_task_status`, `create_comment_with_mentions`,
`restore_content_version` (memanggil RPC 0008 di dalamnya dengan snapshot
lama + "Dipulihkan dari vN"), `set_default_brief_template`.

**pgTAP 03** (`supabase/tests/03_rls_phase3.sql`, 25.602 byte + T15,
**plan(34)**): 34 asersi — T1–T1c cross-tenant deny (task/aset/komentar),
T2–T2b allow sendiri, T3–T3b creator hanya boleh edit task yang ditugaskan
ke dirinya, T4 parent_type buruk CHECK 23514, T5 scope lintas-workspace
trigger P0001, T6–T6f viewer_client (task/aset deny → share → allow,
campaign-task deny, template deny), T7–T7c gerbang komentar klien (deny saat
setting mati 42501 → allow saat setting nyala via lives_ok + baris ada),
T8–T8b tanpa hard-delete task/komentar (0 baris), T9–T9b notifikasi tanpa
insert langsung 42501 + hanya penerima yang bisa baca, T10 aset >10 MB CHECK
23514, T11 hapus template default trigger P0001, T12–T12c RPC
create_task_with_checklist (ok=true, 1 task, 2 item checklist), T13–T13b RPC
transisi (todo→done ditolak, todo→in_progress diizinkan), T14 mention tanpa
insert langsung 42501, **T15–T15c regresi migrasi 0011** (konversi ide tanpa
brand ok=true, item hasil brand_id NULL, ide berstatus converted),
T16 anon tidak bisa baca task (GRANT sebagai postgres dulu, pola 02 v1.1).
Mengikuti pelajaran 02 v1.2 (throws_ok 4-arg pesan lengkap, `reset role;`
sebelum GRANT, `:'user_a'`/`:'user_b'` tidak pernah di dalam `$$`/`$f$`,
UUID palsu 1111.../2222... hanya di baris `\set`).

**Verifikasi statis** (`supabase/tests/rls_verify_phase3.py`):
**50/50 LOLOS** — pglast parse 0009 (177 statement) + 0010 (20) + 0011 (3)

- tes 03 (113); plan(34) == 34 asersi; throws_ok 7/7 bentuk 4-arg; tanpa UUID
  uji nyata; 0009 tepat 9 tabel, kolom wajib tasks/assets/comments lengkap, RLS
  aktif ke-9 tabel; tanpa forward-reference; helper terdefinisi; 0 pemindaian
  policy; 36 policy tabel; semua CHECK; guard no-delete/no-insert; FK
  `brands.logo_asset_id`; bucket + 5 policy storage 0 pemindaian; **graf RLS
  efektif 0001–0009: 128 policy efektif, 32 tabel, 0 siklus, 0 self-loop**
  (audit mentah semua file masih menampilkan 4 siklus LAMA dari teks 0001–0005
  yang sudah digantikan 0006 — teks tidak berlaku, sudah didokumentasikan);
  0010: 5 RPC, SECURITY DEFINER, search_path terkunci, 5 grant ke authenticated,
  tanpa tabel baru; 0011: tepat 1 fungsi diganti, guard NULL ada, brand terisi
  tetap wajib satu workspace, tanpa tabel/policy baru, SECURITY DEFINER +
  search_path terkunci + revoke hardening.

Satu defect checker ditemukan dan diperbaiki saat menjalankan: cek "GRANT
EXECUTE hanya ke authenticated" memakai `"to public" not in ...` yang naif
sehingga false-positive pada "insert into public..." — diperbaiki ke regex
`grant execute on function[^;]*to public`.

**Commit DB layer:** `73d14d6` ("Phase 3 (P3-01–P3-03): migrasi 0009/0010 +
pgTAP 03 + verifikasi statis 42/42", 6 file, +2554/−3). Migrasi 0001–0008
terverifikasi tak tersentuh lewat `git diff` (kosong). `tests/migrations.test.ts`
diperbarui (ekspektasi 0001–0011 + tes baru 0009, 0010, 0011).

## 4. P3-04 s.d. P3-11 — Kode aplikasi

**Skema** (`lib/validation/schemas.ts`, bagian Phase 3): `briefSnapshotSchema`,
`briefTemplateFieldSchema`, `briefTemplateSchemaJson`, `briefTemplateSchema`/
`Update`, `setDefaultBriefTemplateSchema`, `updateBriefSchema`,
`TASK_STATUSES`/`TASK_PRIORITIES`/`TASK_PARENT_TYPES`, `taskSchema`
(checklist sebagai baris textarea), `taskStatusSchema`, `taskChecklistSchema`,
`taskChecklistToggleSchema`, `COMMENT_TARGET_TYPES`, `commentSchema`
(mentionedUserIds array), `commentEditSchema`, `commentDeleteSchema`,
`ASSET_USAGE_ROLES`, `assetAttachSchema`, `assetDetachSchema`,
`assetDeleteSchema`, `restoreVersionSchema`, `clientCommentsSettingSchema`,
`markNotificationReadSchema`.

**`features/production/` (baru):**

- `types.ts` (Task, TaskChecklistItem, TaskWithRelations, BriefTemplate,
  Asset, AssetVersion, ContentAsset, Comment, AppNotification).
- `constants.ts` (label status/prioritas task, label usage-role,
  `ASSET_BUCKET="mative-assets"`, `MAX_ASSET_BYTES=10MB`,
  `ASSET_SIGNED_URL_SECONDS=3600`, `ALLOWED_ASSET_MIME_TYPES`,
  `EDITOR_TABS` 8 tab + label, `DEFAULT_BRIEF_TEMPLATE_FIELDS` 6 field).
- `transitions.ts` (mesin status task cermin RPC 0010, `isValidTaskTransition`,
  `validTaskTargets`, `isTerminalTaskStatus`).
- `mime.ts` (deteksi MIME dari magic bytes incl. WebP "RIFF…WEBP" offset 8
  dan MP4 "ftyp" offset 4, parsing dimensi PNG IHDR + JPEG SOF0/SOF2,
  SHA-256, `sanitizeFileName`, `validateAssetFile`).
- `queries.ts` (pola runQuery/isMissingTable dari planning; `listTasks`
  incl. checklist + judul parent + nama member, `listMyTasks`,
  `getTaskDetail`, `listBriefTemplates`, `getDefaultBriefTemplate`,
  `listAssets`, `listContentAssets`, `getAssetSignedUrl`, `listComments`
  incl. mention + nama penulis, `listMyNotifications`,
  `getClientCommentsAllowed`).
- `actions.ts` (39.410 byte): `createTaskAction` (RPC; peran limited hanya
  boleh menugaskan ke diri sendiri), `transitionTaskAction` (cek transisi
  sisi aplikasi dulu, lalu RPC), `addChecklistItemAction`,
  `toggleChecklistItemAction` (isi/kosongkan completed_by/at),
  `ensureDefaultBriefTemplate` (malas, idempotent, backstop 23505),
  `createBriefTemplateAction` / `updateBriefTemplateAction` (schemaJson dari
  input JSON tersembunyi), `deleteBriefTemplateAction` +
  `setDefaultBriefTemplateAction` + `markNotificationReadAction` (ketiganya
  **1-arg `(formData) => Promise<void>`** — plain `<form action>` hanya
  menerima aksi 1-arg; lihat §6.5), `updateBriefAction` +
  `updateScriptAction` (keduanya lewat RPC 0008 dengan field item saat ini +
  versi terbaru; tiap simpan = versi baru), `uploadAssetAction` (baris
  'uploading' dulu → unggah Storage → 'ready' + asset_versions v1; gagal
  Storage → 'failed'; MIME dari isi), `attachAssetAction` (23505 = sudah
  dilampirkan), `detachAssetAction` (tidak pernah menghapus file),
  `deleteAssetAction` (tolak bila ada tautan content_assets; hapus baris
  dulu, hapus Storage best-effort — file yatim tidak terlihat aplikasi),
  `createCommentAction` (viewer_client TIDAK diblokir di muka — RPC 0010
  menegakkan gerbang ganda; peran lain butuh `can(role, "comment")`),
  `updateCommentAction`, `deleteCommentAction` (soft-delete),
  `restoreVersionAction` (RPC), `toggleClientCommentsAction` (owner/admin
  saja — cermin RLS 0003 `ws_settings_write_owner_admin`).

**Komponen** (`features/production/components/`): `TaskForm.tsx` (pilih jenis

- parent; prop `lockedParent` merender hidden input + label),
  `TaskStatusForm.tsx`, `TaskChecklist.tsx`, `CommentThread.tsx` (root + balasan
  bersarang, edit/hapus, pemilih mention di dalam tiap composer — draf awal
  dengan pemilih mention di luar form tidak akan pernah bisa submit; dihapus),
  `AssetUploadForm.tsx`, `AssetCard.tsx` (AssetCard + ContentAssetRow +
  DetachAssetButton), `AttachAssetForm.tsx`, `BriefEditor.tsx` (field template,
  draf localStorage — lihat §6.6), `ScriptEditor.tsx`, `TemplateForm.tsx`
  (baris field dinamis, submit schemaJson), `VersionCompare.tsx` (berdampingan
  per-field, badge "berubah", restore lewat RPC), `ClientCommentsToggle.tsx`.

**Halaman:** `app/(app)/tugas/page.tsx` (tab Tugas Saya / Semua Task lewat
`?tab=`, buat form, form status + checklist per task, notifikasi + tandai
dibaca), `app/(app)/pustaka/page.tsx` (unggah + grid aset dengan signed URL),
`app/(app)/template-brief/page.tsx` (pembuatan default malas, buat/edit/hapus/
jadikan-default), `app/(app)/konten/[id]/page.tsx` **ditulis ulang jadi
editor bertab** (`?tab=` overview/brief/script/media/placements/tasks/
comments/versions; overview mempertahankan ContentForm dengan prefill
`initialVersion={latestVersion}` + TransitionForm + StatusHistory +
catatan "Approval & publishing: belum tersedia di fase ini (Phase 4)";
bagian placements dipindah verbatim; tab versi memakai VersionCompare),
`app/(app)/ide/page.tsx` **diperluas** (form filter GET status/brand/owner
yang mempertahankan workspace, panel detail lewat `?idea=`, tombol konversi,
nama owner), `app/(app)/pengaturan/page.tsx` (ClientCommentsToggle per
workspace, hanya peran owner/admin).

**Sidebar** (`components/layout/AppSidebar.tsx`): `/tugas` dan `/pustaka`
kini `available: true`, plus item baru `/template-brief`; footer versi
`MaTive v0.3.0 — Phase 3 (DRAF)`.

## 5. P3-12 — Gate lokal (perintah + output aktual)

| Gate                    | Perintah                                                                                                     | Hasil                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint                    | `npx eslint .`                                                                                               | ✅ **0 error, 0 warning**                                                                                                                                                                                                                                                  |
| Typecheck               | `npx tsc --noEmit --skipLibCheck`                                                                            | ✅ **0 error**                                                                                                                                                                                                                                                             |
| Unit (Vitest)           | `npx vitest run`                                                                                             | ✅ **107/107 lolos, 11 file** (baseline Phase 2: 84/84; baru: 20 tes `tests/production.test.ts` + 2 tes migrasi 0011 + 1 tes migrasi)                                                                                                                                      |
| Production build        | `npm run build`                                                                                              | ✅ **lolos, 26 route** (23 + 3 baru: /tugas, /pustaka, /template-brief; tab editor adalah query param, bukan route baru)                                                                                                                                                   |
| Playwright (tanpa env)  | `npx playwright test --project=chromium e2e/production.spec.ts e2e/visual.spec.ts`                           | ✅ **29 lolos, 1 skip** (tes live @needs-db di-skip tanpa env)                                                                                                                                                                                                             |
| Playwright smoke        | `npx playwright test --project=chromium e2e/planning.spec.ts e2e/auth.spec.ts`                               | ✅ **3 lolos, 3 skip** (@needs-db)                                                                                                                                                                                                                                         |
| Playwright live         | `E2E_TEST_EMAIL=... E2E_TEST_PASSWORD=... npx playwright test --project=chromium e2e/planning.spec.ts`       | ✅ **4/4 lolos** (editor bertab terverifikasi live)                                                                                                                                                                                                                        |
| Playwright live Phase 3 | `... npx playwright test --project=chromium e2e/production.spec.ts -g "ide → brief"`                         | ❌ **GAGAL di langkah 2 (konversi ide)** — defect laten Phase 2 yang TERBUKTI (§6.4); perbaikan migrasi 0011 menunggu diterapkan live, §8                                                                                                                                  |
| Visual QA               | `e2e/visual.spec.ts` (1440/1024/390)                                                                         | ✅ **9 screenshot baru** (tugas/pustaka/template-brief × 3 viewport) + 18 screenshot lama di-regenerate; diperiksa langsung: sidebar PRODUKSI tampil (Tugas Saya aktif), heading + kartu login rapi di desktop & HP 390 — semua dalam keadaan belum login (batas jujur §7) |
| Prettier                | `npx prettier --check .`                                                                                     | ✅ **bersih** (20 file diformat ulang)                                                                                                                                                                                                                                     |
| Secret scan             | `tests/migrations.test.ts` (tes repo bebas secret) + grep `service_role\|sb_publishable\|eyJ` + `git status` | ✅ **bersih** — `.env.example` tanpa nilai; tidak ada file `.env` di repo (`.env.local` ter-ignore, berisi anon key publik `NEXT_PUBLIC_*` saja); tidak ada kunci di kode baru                                                                                             |
| Migrasi parse           | pglast (venv `~/workspace/.venv-pglast`)                                                                     | ✅ 0009: 177, 0010: 20, 0011: 3, tes 03: 113 statement                                                                                                                                                                                                                     |
| Verifikasi statis       | `~/workspace/.venv-pglast/bin/python supabase/tests/rls_verify_phase3.py`                                    | ✅ **50/50 LOLOS**                                                                                                                                                                                                                                                         |
| Migrasi 0001–0008       | `git diff`                                                                                                   | ✅ **tak tersentuh** (diff kosong)                                                                                                                                                                                                                                         |

## 6. Defect yang ditemukan & diperbaiki (tidak disembunyikan)

1. **Langkah 0 — PlacementForm disabled select** (Phase 2): edit placement
   tidak pernah bisa simpan ("Data tidak valid."). Perbaikan: hidden input
   `socialChannelId` saat edit. Commit `3485eb1`. (§0)
2. **0009 — subquery skalar di policy** (`content_assets_select_member_or_shared`):
   melanggar aturan tanpa-FROM/JOIN-di-policy; diperbaiki dengan helper
   `is_content_item_member` (0007).
3. **0009 — helper salah** (`asset_versions_select_member_or_shared`
   memanggil `is_task_member(asset_id)`): diperbaiki dengan menambah helper
   `is_asset_member`.
4. **Defect laten Phase 2 — konversi ide tanpa brand SELALU gagal
   (ditemukan saat e2e Phase 3, 2026-11-19):**
   `validate_content_item_scope()` (0007) memeriksa `brand_id` tanpa guard
   NULL — `SELECT workspace_id ... WHERE id = new.brand_id` dengan brand
   NULL mengembalikan v_ws NULL → lempar `scope mismatch:
content_items.brand_id belongs to a different workspace`. Padahal kolom
   `content_items.brand_id` NULLABLE menurut skema 0007, `validate_idea_scope()`
   (0007) SUDAH mengizinkan brand NULL, ide BOLEH dibuat tanpa brand
   (IdeaForm: brand opsional), dan RPC `convert_idea_to_content` (0008)
   menyalin brand_id ide apa adanya. Bukti live: alert di halaman `/ide`
   pada run `e2e/production.spec.ts` ("Gagal mengonversi ide: scope
   mismatch: ..."). Trigger jalan di INSERT OR UPDATE, jadi item tanpa brand
   juga tidak bisa di-update (mis. simpan brief) sebelum perbaikan.
   **Perbaikan — migrasi 0011** (`0011_fix_content_item_brand_null.sql`,
   0007 TIDAK diubah): `CREATE OR REPLACE FUNCTION
validate_content_item_scope()` dengan guard `if new.brand_id is not null`
   (pola yang sama dengan `validate_idea_scope` + guard campaign/pillar/
   audience di fungsi yang sama). Brand yang terisi TETAP wajib satu
   workspace — tidak ada pelonggaran keamanan. Bonus hardening (pola
   0006/0007): `revoke all on function ... from public` — fungsi
   `SECURITY DEFINER` tidak bisa dipanggil langsung; 0007 tidak pernah
   me-revoke fungsi `validate_*`. Regresi: pgTAP T15–T15c (konversi ide
   tanpa brand ok=true, item hasil brand_id NULL, ide converted) + 7 cek
   verifier + 1 tes Vitest migrasi. **TIDAK diubah:**
   `validate_content_placement_scope` sengaja MENOLAK placement pada item
   tanpa brand ("Placement HANYA ke channel dengan brand yang SAMA dengan
   item") — itu keputusan desain, bukan defect; item tanpa brand baru bisa
   diberi placement setelah brand diisi lewat edit konten.
5. **3 aksi server 2-arg di plain `<form action>`** (template-brief:
   set-default + hapus template; tugas: tandai notifikasi dibaca): plain
   form menolak aksi `(prev, formData)` — typecheck 3 error. Perbaikan:
   ketiganya jadi 1-arg `(formData) => Promise<void>` (preseden
   `deletePlacementAction`).
6. **BriefEditor lint (2 error + 1 warning, `react-hooks/set-state-in-effect`):**
   effect mount membaca draf localStorage lalu setState. Perbaikan:
   `useSyncExternalStore` (`useBriefDraft`, subscribe event
   `mative-brief-draft` + `storage`; snapshot server null) + penyesuaian
   state saat render (pola docs React) untuk cek draf satu-kali dan sinkron
   `values` saat prop `initial` berubah setelah simpan + revalidasi;
   effect autosave kini hanya menulis ke external store (localStorage +
   dispatch event), tidak pernah setState. Perilaku dipertahankan:
   draf basi (sama dengan nilai tersimpan) dibersihkan diam-diam saat mount.
   Setelah perbaikan: lint 0 error, 0 warning.
7. **Defect tes (bukan aplikasi):**
   - `sanitizeFileName("foto saya (1).PNG")` → "foto-saya-1-.PNG": fungsi
     diperbaiki (hapus `-` sebelum `.`) → "foto-saya-1.PNG".
   - `taskSchema` tes memakai UUID `11111111-...` — ditolak Zod (varian
     UUID harus 8/9/a/b); tes diperbaiki ke UUID v4 valid.
   - `planning.spec.ts` langkah 8: `getByText("v2")` menangkap `<option>`
     tersembunyi "v2 · ..." di dropdown banding; diperbaiki ke lokator
     exact `"v2"` + timeout eksplisit 30 dtk, dan verifikasi stage
     diperkuat ke teks riwayat "Ide → Brief" di overview. (Sekaligus
     mengonfirmasi pelajaran probe: `expect.configure()` sebagai statement
     tidak mengubah timeout default.)
   - `production.spec.ts`: heading `"Ide"` ambigu (4 elemen) → exact;
     lihat juga §6.4 untuk kegagalan konversi (defect aplikasi, bukan tes).

## 7. Batas jujur — yang BELUM terbukti (wajib dibaca koordinator)

1. **Migrasi 0009 + 0010 + 0011 BELUM diterapkan ke live.** Semua bukti DB
   (pgTAP 03, verifier 50/50, graf RLS) adalah verifikasi statis + parse
   lokal — BUKAN bukti live. pgTAP 03 (34 asersi) dan spek e2e Phase 3
   BELUM BISA lolos sebelum migrasi diterapkan (§8).
2. **Spek e2e Phase 3 BELUM TERBUKTI live** — gagal di langkah 2
   (konversi ide tanpa brand) karena 0011 belum live; langkah 3–10
   (brief → task → aset → komentar → versi → reload) belum pernah jalan
   live sama sekali. Spek ini hanya terbukti secara smoke (halaman +
   ajakan masuk tanpa login).
3. **Visual QA keadaan login BELUM ada screenshot-nya.** 9 screenshot baru
   adalah shell belum-login (heading + kartu login). Daftar task, grid
   aset, editor bertab berisi data, dan banding versi hanya terverifikasi
   lewat DOM di e2e (planning 4/4 live) — bukan lewat gambar.
4. **Aset tanpa pemindaian virus** (batas desain ADR-0009) — jangan pernah
   klaim aman-malware. `duration_ms` selalu null (tanpa parser durasi).
   Dimensi hanya untuk PNG/JPEG.
5. **Item tanpa brand tidak bisa diberi placement** (keputusan desain
   `validate_content_placement_scope`, §6.4) — harus isi brand dulu lewat
   edit konten.
6. **Batas warisan Phase 2 (masih berlaku):** dashboard KPI memakai
   workspace PERTAMA pengguna bila punya beberapa; filter kalender/board
   memakai 1 query limit 200 item; `getDashboardKpis` mengembalikan 0 +
   empty state baik saat "tidak ada data" maupun saat query gagal (tidak
   dibedakan). Playwright WebKit tetap BLOCKED (B4 — 3 lib sistem, tidak
   di-retry); visual 390px terbukti lewat viewport Chromium.
7. **Notifikasi hanya di dalam aplikasi** (tanpa email/SMS) — sesuai
   rencana MVP.

## 8. Instruksi penerapan ke live (untuk koordinator/parent)

### Prasyarat

Sama seperti Phase 2 (`docs/apply-migrations.md`): proyek Supabase
"mative" ref `kwyqtlxglhlvtghfrnhr`, dashboard
https://supabase.com/dashboard/project/kwyqtlxglhlvtghfrnhr. JANGAN sentuh
pengguna Auth (khususnya `mative-test-a@` / `mative-test-b@`); JANGAN hapus
data seed; JANGAN ubah pengaturan Auth.

### Langkah 1 — Terapkan migrasi, URUTAN INI (lewat SQL Editor, satu file per run)

1. `supabase/migrations/0009_production_ops.sql` — 9 tabel + bucket
   `mative-assets` + 36 policy tabel + 5 policy storage.
2. `supabase/migrations/0010_production_transactions.sql` — 5 RPC.
3. `supabase/migrations/0011_fix_content_item_brand_null.sql` — perbaikan
   trigger scope + revoke hardening (hanya 1 fungsi diganti; 0007 tidak
   diubah).

Verifikasi setelah tiap langkah (SQL Editor):

```sql
-- Setelah 0009: 9 tabel baru, semuanya RLS aktif.
select tablename from pg_tables
where schemaname = 'public'
  and tablename in ('brief_templates','tasks','task_checklist_items','assets',
    'asset_versions','content_assets','comments','mentions','notifications');
select c.relname as tablename, c.relrowsecurity as row_security_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('brief_templates','tasks','task_checklist_items','assets',
    'asset_versions','content_assets','comments','mentions','notifications');
-- Ekspektasi: 9 baris, semuanya row_security_enabled = true.
-- (Koreksi 2026-11-19: pg_tables TIDAK punya kolom row_security_enabled di
--  database ini — query lama gagal 42703; yang benar pakai
--  pg_class.relrowsecurity, sudah terbukti live saat verifikasi 0009.)
-- Bucket: select id, public from storage.buckets where id = 'mative-assets';
-- Ekspektasi: 1 baris, public = false.

-- Setelah 0010: 6 RPC ada (5 baru + cek).
select proname from pg_proc where proname in
  ('create_task_with_checklist','transition_task_status',
   'create_comment_with_mentions','restore_content_version',
   'set_default_brief_template');
-- Ekspektasi: 5 baris.

-- Setelah 0011: fungsi terganti (cek guard ada di definisi).
select pg_get_functiondef(oid) like '%new.brand_id is not null%'
from pg_proc where proname = 'validate_content_item_scope';
-- Ekspektasi: true.
```

### Langkah 2 — Jalankan pgTAP 03 live

File `supabase/tests/03_rls_phase3.sql` (plan(34)). Ikuti petunjuk header
file (ganti `\set user_a/user_b` dengan UUID auth nyata — JANGAN pakai
placeholder 1111.../2222...; aktifkan ekstensi pgtap bila belum). File
berjalan dalam satu transaksi dan diakhiri `rollback` — data uji ikut
terhapus otomatis.

**Ekspektasi: 34/34 PASS** (termasuk T15–T15c regresi 0011 dan T16 anon
deny). Bila ada yang gagal: JANGAN longgarkan RLS/policy — laporkan
kegagalannya ke koordinator build.

### Langkah 3 — Jalankan e2e Phase 3 live

```bash
E2E_TEST_EMAIL='mative-e2e@example.com' E2E_TEST_PASSWORD='<kata sandi e2e>'
npx playwright test --project=chromium e2e/production.spec.ts
```

**Ekspektasi: 3/3** (1 tes penerimaan live + 2 smoke tanpa login). Alur
penerimaan: ide → konversi jadi konten → brief terstruktur (v2) → task
dibuat + pindah status → aset PNG 1x1 diunggah + dilampirkan → komentar →
bandingkan + pulihkan v1 (v3) → reload (semua persist) → cek /tugas,
/pustaka, /template-brief. Juga jalankan ulang `e2e/planning.spec.ts`
(ekspektasi 4/4) sebagai regresi editor bertab.

### Langkah 4 — Setelah lolos

- Perbarui `docs/apply-migrations.md` (tandai 0009–0011 diterapkan +
  tanggal).
- Bersihkan data uji di live (§8.1) bila diinginkan — data e2e tidak
  merusak apa pun, hanya residu.

### 8.1 Data uji yang tertinggal di live + cara membersihkan

Semua baris di bawah adalah residu tes (bukan data seed — seed JANGAN
dihapus). Hapus lewat SQL Editor, urutan anak-dulu:

```sql
-- (a) Probe Langkah 0 (2026-11-19): 4 set org/workspace/brand/konten
--     slug probe0-mwn4fhxd, probe0-mwn4hktd, probe0-mwn4lj9u, probe0-mwn4o3mj
--     (KOREKSI 2026-11-19 saat deklarasi: tadinya tertulis 3 set; nyatanya 4.
--     social_channels TIDAK punya kolom workspace_id — hapus lewat brand_id,
--     pola yang sama dengan blok (b). Versi lama di sini pernah gagal 42703.)
delete from public.content_placements
 where content_item_id in (select id from public.content_items
  where workspace_id in (select id from public.workspaces where slug like 'ws-probe0-%'));
delete from public.content_versions
 where content_item_id in (select id from public.content_items
  where workspace_id in (select id from public.workspaces where slug like 'ws-probe0-%'));
delete from public.content_status_events
 where content_item_id in (select id from public.content_items
  where workspace_id in (select id from public.workspaces where slug like 'ws-probe0-%'));
delete from public.content_items
 where workspace_id in (select id from public.workspaces where slug like 'ws-probe0-%');
delete from public.social_channels
 where brand_id in (select id from public.brands
  where workspace_id in (select id from public.workspaces where slug like 'ws-probe0-%'));
delete from public.brands
 where workspace_id in (select id from public.workspaces where slug like 'ws-probe0-%');
delete from public.workspace_members
 where workspace_id in (select id from public.workspaces where slug like 'ws-probe0-%');
delete from public.workspaces where slug like 'ws-probe0-%';
delete from public.organization_members
 where organization_id in (select id from public.organizations where slug like 'org-probe0-%');
delete from public.organizations where slug like 'org-probe0-%';

-- (b) Run planning.spec.ts live (2026-11-19): 1 set brand/channel/konten
--     pola slug 'brand-e2e-%' / judul 'Konten E2E e2e-%'.
delete from public.content_placements
 where content_item_id in (select id from public.content_items where title like 'Konten E2E e2e-%');
delete from public.content_versions
 where content_item_id in (select id from public.content_items where title like 'Konten E2E e2e-%');
delete from public.content_status_events
 where content_item_id in (select id from public.content_items where title like 'Konten E2E e2e-%');
delete from public.content_items where title like 'Konten E2E e2e-%';
delete from public.social_channels where brand_id in (select id from public.brands where slug like 'brand-e2e-%');
delete from public.brands where slug like 'brand-e2e-%';

-- (c) Run production.spec.ts live yang gagal (2026-11-19): 1 ide tanpa
--     brand, judul 'Ide P3 p3-mwn69a63' (status 'new', belum terkonversi).
delete from public.ideas where title = 'Ide P3 p3-mwn69a63';
-- Bila run e2e Phase 3 lolos nanti, residu tambahannya berpola sama:
-- judul 'Ide P3 p3-%' / 'Task P3 p3-%' / file 'aset-p3-p3-%.png'
-- (task + aset + komentar + versi ikut terhapus bila kontennya dihapus
--  dengan cascade / hapus manual per tabel seperti pola (b)).
```

**JANGAN dihapus:** data seed (org "Contoh Studio (sample)" + 1 workspace +
2 member), akun uji Auth (User A/B pgTAP + `mative-e2e@example.com` beserta
org/workspace miliknya — dibutuhkan run e2e berikutnya).

## 9. File yang diserahkan (P3-01 s.d. P3-12 + 0011)

- `docs/decisions/ADR-0009-production-operations.md` (baru)
- `supabase/migrations/0009_production_ops.sql` (baru)
- `supabase/migrations/0010_production_transactions.sql` (baru)
- `supabase/migrations/0011_fix_content_item_brand_null.sql` (baru)
- `supabase/tests/03_rls_phase3.sql` (baru, plan(35) — v1.4; v1.0 plan(34))
- `supabase/tests/rls_verify_phase3.py` (baru, 60/60 — v1.1; awalnya 50/50)
- `lib/validation/schemas.ts` (bagian Phase 3)
- `features/production/{types,constants,transitions,mime,queries,actions}.ts` (baru)
- `features/production/components/{TaskForm,TaskStatusForm,TaskChecklist,CommentThread,AssetUploadForm,AssetCard,AttachAssetForm,BriefEditor,ScriptEditor,TemplateForm,VersionCompare,ClientCommentsToggle}.tsx` (baru)
- `app/(app)/{tugas,pustaka,template-brief}/page.tsx` (baru)
- `app/(app)/konten/[id]/page.tsx` (ditulis ulang — editor bertab)
- `app/(app)/ide/page.tsx` (diperluas — filter + detail + konversi)
- `app/(app)/pengaturan/page.tsx` (diperluas — toggle komentar klien)
- `components/layout/AppSidebar.tsx` (item PRODUKSI aktif + versi v0.3.0)
- `tests/production.test.ts` (baru, 20 tes)
- `tests/migrations.test.ts` (ekspektasi 0001–0011 + tes 0009/0010/0011)
- `e2e/production.spec.ts` (baru — penerimaan prompts/04 + 2 smoke)
- `e2e/planning.spec.ts` (diperbarui — tab placements + tab versi)
- `e2e/visual.spec.ts` (diperluas — 9 screenshot Phase 3)
- `docs/visual-qa/{tugas,pustaka,template-brief}-{desktop-1440,tablet-1024,mobile-390}.png` (baru, 9 file)
- `docs/visual-qa/{board,dashboard,kalender,konten}-{desktop-1440,tablet-1024}.png` (di-regenerate oleh run visual)
- `docs/phase-3-report.md` (file ini), `docs/apply-migrations.md`,
  `CHANGELOG.md`, `README.md` (diperbarui)

## 10. Sub-keputusan terbuka yang diputuskan sendiri (default paling aman)

Tidak ada sub-keputusan terbuka dari rencana yang bersentuhan langsung dengan
Phase 3 yang membutuhkan keputusan baru di luar ADR-0009. Dua hal yang
diputuskan saat implementasi (keduanya default paling aman + terdokumentasi
di ADR-0009):

1. **Komentar klien default TIDAK diizinkan** (`allow_client_comments`
   default false/absent) — klien hanya bisa berkomentar bila workspace
   secara eksplisit mengizinkan DAN konten dibagikan eksplisit. Alasan:
   klien adalah pihak luar; akses default-deny sesuai RBAC "limited"
   (Keputusan #9).
2. **Tanpa pemindaian virus pada aset** — batas jujur, bukan pengganti
   diam-diam: tidak ada layanan pemindaian gratis yang terverifikasi
   tersedia di tier ini; klaim keamanan tidak pernah dibuat. Bila nanti
   ada kebutuhan, itu keputusan Phase 8/9 dengan layanan yang jelas.

## 11. Addendum — Kegagalan pgTAP 03 live (T15, 23502) + perbaikan 0012 (2026-11-19)

### 11.1 Yang terjadi live

- Migrasi 0009 (19/19 bagian), 0010 (6/6), 0011 (2/2) diterapkan live dan
  terverifikasi (9 tabel + RLS aktif + bucket privat; 5 RPC; guard NULL di
  definisi fungsi).
- pgTAP 03 v1 dijalankan live sebagai SATU Run (seluruh 477 baris ditempel
  lalu Run sekali — SQL Editor TIDAK mempertahankan transaksi antar-Run;
  run per bagian gagal FK 23503 di BAGIAN 2 karena `begin;` tidak bertahan).
- Run GAGAL di TES 15 dengan error persis: `ERROR: 23502: null value in
column "brand_id" of relation "content_items" violates not-null
constraint` — RPC `convert_idea_to_content` (0008) meng-insert content
  item dengan `brand_id` NULL (ide tanpa brand). Transaksi abort;
  `finish()` tidak jalan; tidak ada hasil 34/34; tidak ada data uji
  tersisa (rollback otomatis).

### 11.2 Diagnosis — premis lama SALAH

T15 v1 mengasumsikan `content_items.brand_id` NULLABLE dengan alasan
"kolom NULLABLE menurut skema 0007". Itu salah baca: yang dibaca adalah
**komentar header 0007 baris 191** ("workspace_id, brand_id, campaign_id
nullable, ..."), bukan DDL-nya. Empat sumber sepakat brand itu WAJIB:

1. **DDL 0007 baris 200:** `brand_id uuid not null references
public.brands (id) on delete restrict`.
2. **Dok 05 §3 (kanonis, Keputusan #7):** `content_items` mencantumkan
   `brand_id` TANPA penanda "nullable" — berbeda dengan `campaign_id` /
   `pillar_id` / `audience_id` / `origin_idea_id` yang eksplisit
   nullable, dan berbeda dengan `ideas` / `content_pillars` yang
   eksplisit "brand_id nullable".
3. **ERD §5:** `BRANDS ||--o{ CONTENT_ITEMS : owns` = tiap item wajib
   tepat satu brand.
4. **Skema aplikasi** (`lib/validation/schemas.ts`): `contentItemSchema`
   `brandId = z.string().uuid()` WAJIB; hanya `ideaSchema` yang
   `brandId: optionalUuid`.

Migrasi 0011 (guard trigger) tidak cukup: constraint NOT NULL pada
kolomnya sendiri yang memblokir INSERT. 0011 tetap dipertahankan apa
adanya sebagai defense-in-depth (tidak pernah terpicu selama kolom
NOT NULL).

### 11.3 Keputusan (dikunci parent 2026-11-19)

`content_items.brand_id` TETAP NOT NULL. Konversi ide tanpa brand harus
bisa memilih brand **saat konversi** (bukan memaksa brand di tangkapan
ide — ide tetap boleh tanpa brand sesuai Dok 05), dan kegagalan tanpa
brand harus berupa pesan bersih, bukan crash database.

### 11.4 Perubahan yang dibuat (commit terpisah)

| #   | Perubahan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Commit    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | Migrasi baru `0012_convert_idea_brand_param.sql`: DROP fungsi lama `(uuid, text)` (agar tak tersisa overload yang crash) + CREATE ulang `(uuid, text, uuid)` — brand efektif `coalesce(p_brand_id, brand ide)`; NULL → `ok:false` "Ide ini belum punya brand. Pilih brand dulu sebelum dikonversi."; `p_brand_id` lintas workspace → `ok:false` "Brand tidak ditemukan di workspace ini."; sisa logika byte-identik 0008; SECURITY DEFINER + `search_path` terkunci + revoke/grant EXECUTE hanya ke `authenticated`. pglast 5 statement OK. | `dfc79b8` |
| 2   | UI: `ConvertIdeaButton` + `page.tsx` (`/ide`, 2 titik pakai) — select "Brand (wajib untuk konversi)" di form konversi, terisi awal brand ide bila ada, `required`; `convertIdeaAction` meneruskan `p_brand_id` ke RPC. Pesan sukses tidak berubah. Lint + typecheck lolos.                                                                                                                                                                                                                                                                  | `a95430f` |
| 3   | pgTAP 03 v1.1 — HANYA file `03_rls_phase3.sql`: T15–T15c → T15–T15d, `plan(34)` → `plan(35)`: T15 = tanpa `p_brand_id` → `ok=false` + pesan persis; T15b = dengan `p_brand_id` Brand A → `ok=true`; T15c = item memakai Brand A; T15d = ide `converted`. Header diperbarui (migrasi 0001–0012, cara run satu kali). Verifier statis diperluas (+10 pemeriksaan 0012): pglast 114 statement OK, 35 asersi == `plan(35)`, verifier 60/60.                                                                                                     | `5e07f3c` |
| 4   | `e2e/production.spec.ts`: buat brand dulu di `/merek` (locator `#brand-name-new` / `#brand-slug-new`, pola `planning.spec.ts`), tangkap ide TANPA brand, pilih brand di form konversi (pola stale-retry: muat ulang bila opsi belum muncul), lalu konversi. Sisa alur tidak berubah. tsc lolos; `playwright --list`: 6 tes.                                                                                                                                                                                                                 | `48b5ed5` |

### 11.5 Batas jujur tambahan (di luar §7)

- Perbaikan 0012 + T15 v1.1 + spek e2e baru **BELUM terbukti live** saat
  addendum ini ditulis: 0012 belum diterapkan live, pgTAP 03 v1.1 belum
  dijalankan ulang, e2e belum dijalankan ulang. Gate live Phase 3 tetap
  MENUNGGU ketiga langkah itu (urutan: terapkan 0012 → pgTAP 03 v1.1
  35/35 → e2e production 3/3 + planning 4/4).
- Komentar lama di 0011 ("Item tanpa brand baru bisa diberi placement
  setelah brand diisi lewat edit konten") TIDAK AKURAT untuk UI saat
  ini: select Brand di edit konten di-`disabled` (defect #5 Phase 2),
  jadi brand item tidak bisa diubah lewat edit. Item tanpa brand tidak
  bisa dibuat lagi (jalur konversi kini wajib brand; jalur buat konten
  memang wajib brand), tetapi item tanpa brand tidak lagi mungkin
  terbentuk — kalimat itu tidak lagi relevan dan tidak dipakai sebagai
  dasar keputusan apa pun.
- Dialog "Potential issue detected" DIHARAPKAN saat menerapkan 0012
  live (karena `drop function ... convert_idea_to_content(uuid, text)`):
  DROP itu langsung diikuti CREATE ulang signatur baru dalam file yang
  sama — fungsi diganti, bukan dihapus.

---

## 12. Deklarasi: Phase 3 LOLOS PENUH — 2026-11-19 16:52 WIB

**Gate yang lolos (semua live, database proyek Supabase "mative"):**

| Gate | Hasil | Waktu |
| --- | --- | --- |
| pgTAP 03 v1.4 (`supabase/tests/03_rls_phase3.sql`) | **35/35** | 16:05 WIB |
| e2e `e2e/production.spec.ts` (chromium, live) | **3/3** (1 acceptance + 2 smoke) | 16:44 WIB |
| e2e `e2e/planning.spec.ts` regresi (chromium, live) | **4/4** (1 acceptance + 3 smoke) | 16:44 WIB |
| Verifikasi parent (tangan pertama) | lint 0 error; Vitest **108/108** (11 file); build sukses | 16:45 WIB |
| Kebersihan database live | hanya seed (orgs 1, workspaces 1, org_members 1, ws_members 2, sisanya 0) | 16:52 WIB |

### 12.1 Penerapan migrasi live (0009–0012)

- **0009** (13:48–14:08 WIB, 19 bagian): cacat forward-reference
  `mentions.notification_id → notifications` (tabel dibuat belakangan di
  bagian yang sama — kelas cacat yang sama dengan migrasi 0001).
  Perbaikan: tukar urutan blok (notifications dulu), commit `08627ea`
  (diff murni reorder 15+/15−); audit forward-reference 0 hard failure
  0 warning (kontrol negatif: audit menangkap cacat asli di file
  sebelum perbaikan). Dialog RLS saat membuat tabel → **"Run without
  RLS"** (migrasi mengaktifkan RLS sendiri; verifikasi akhir
  `pg_class.relrowsecurity`: 9/9 `true` — query §8 lama yang memakai
  `pg_tables.row_security_enabled` SALAH kolom, sudah dikoreksi).
  Dialog destructive (`drop trigger if exists`) → **"Run query"**
  (trigger di-drop lalu langsung dibuat ulang di bagian yang sama).
- **0010** (14:08–14:14 WIB, 6 bagian): header pesan parent untuk bagian 4
  tertulis "119 baris" padahal isi file 75 baris — isi file BENAR, hanya
  typo header. 5/5 RPC terverifikasi ada di `pg_proc`.
- **0011** (14:14–14:16 WIB, 2 bagian): guard `if new.brand_id is not null`
  terverifikasi di definisi fungsi live. Guard ini kemudian terbukti
  MOOT (lihat §12.2) — dipertahankan sebagai defense-in-depth.
- **0012** (15:11–15:22 WIB, 4 bagian, 156 baris): dialog DROP FUNCTION →
  **"Run query"** (overload lama langsung diganti signatur baru dalam
  file yang sama). Verifikasi: signatur 3-arg
  `(p_idea_id, p_title, p_brand_id)` + `coalesce` + pesan brand +
  `count(pg_proc) = 1` (overload lama hilang).

### 12.2 Saga pgTAP 03 (v1.0 → v1.4) — semua kegagalan adalah file tes, bukan kebijakan

- **v1.0 gagal di T15 (23502):** konversi ide tanpa brand menabrak
  `content_items.brand_id NOT NULL`. Diagnosis parent dari disk: premis
  koordinator Phase 3 ("kolom NULLABLE menurut skema 0007") SALAH —
  ia mempercayai komentar header 0007 baris 191, bukan DDL baris 200
  (`brand_id uuid not null`); Dok 05 §3, ERD §5, dan skema Zod
  (`brandId` wajib) semuanya sepakat brand WAJIB di item. Keputusan
  dikunci: brand TETAP NOT NULL; perbaikan = migrasi 0012 + select brand
  saat konversi + T15 ditulis ulang + spek e2e brand-first (§11).
- **Pelajaran 1 (14:20 WIB):** tiap Run SQL Editor = sesi database
  terpisah. File yang membentang satu transaksi (`begin…rollback`,
  mis. tes pgTAP) HARUS ditempel UTUH lalu Run SEKALI; Run per bagian
  me-rollback bagian 1 dan merusak referensi FK bagian 2.
- **v1.1 gagal P0001:** baris cleanup eksplisit
  `delete from public.brief_templates where id = ...` menabrak trigger
  pelindung template default. v1.2 menghapus baris itu →
  **v1.2 gagal P0001 juga**, kali ini CONTEXT-nya cascade:
  `delete from public.workspaces` → cascade menghapus brief_templates →
  trigger. **Pelajaran 3:** audit bagian cleanup untuk jalur FK
  CASCADE, bukan hanya DELETE eksplisit.
- **v1.3** (tambah `update brief_templates set is_default = false`
  sebelum hapus workspace) → **34/35**. Run diagnostik (temp table
  `diag_results`) mengidentifikasi **T4** (asersi no. 8): tertangkap
  P0001 scope-mismatch, diharapkan 23514 CHECK. Penyebab terverifikasi:
  trigger BEFORE `validate_task_scope()` (0009) berjalan SEBELUM CHECK
  dievaluasi; `parent_type='idea'` tak cocok cabang IF mana pun → v_ws
  NULL → P0001. Perilaku produk BENAR (baris tetap ditolak); hanya
  ekspektasi tes yang salah. **Pelajaran 4:** trigger BEFORE berjalan
  sebelum CHECK — bila tes mengharapkan penolakan CHECK, periksa dulu
  apakah trigger BEFORE menolak baris itu duluan.
- **v1.4** (T4 harapkan P0001 + pesan lengkap) → **35/35, 16:05 WIB.**

### 12.3 Saga e2e production (7 run, 16:08–16:44 WIB)

| Run | Hasil | Tindak lanjut |
| --- | --- | --- |
| 1 | Gagal — akun baru tanpa org/workspace → `/merek` empty state | Fix tes `523a93d`: setup buat org+workspace dulu |
| 2 | Gagal — konversi sukses tapi pesan sukses tak pernah muncul → **defect aplikasi nyata**: `ConvertIdeaButton` di-unmount `revalidatePlanning()` begitu aksi sukses | Fix aplikasi `339585d`: tombol tetap mounted; bila sudah dikonversi tampilkan pesan sukses / tautan hasil, bukan form |
| 3 | Gagal — tab Brief: "Belum ada template brief default" → **bukan defect**: template default dibuat LAZY saat `/template-brief` dibuka owner | Fix tes `e1623c1`: kunjungi `/template-brief` dulu (langkah 0b) |
| 4 | Gagal — input pilih file tidak ada di tab Media → **bukan defect**: upload HANYA di `/pustaka`; tab Media hanya melampirkan | Fix tes `e1623c1`: ikuti tautan "Pustaka Aset", unggah di sana, kembali, lampirkan |
| 5 | Gagal — lampiran berhasil (Media (1)) tapi pesan "Aset dilampirkan ke konten." tak muncul → **defect aplikasi nyata, pola sama dengan run 2**: `MediaTab` hanya merender `AttachAssetForm` bila ada aset bebas; begitu lampiran terakhir berhasil + revalidasi, form lenyap | Fix aplikasi `ac85d63`: form selalu dirender saat `canEdit`; bila tak ada aset bebas tampilkan pesan sukses / "Semua aset siap..." |
| 6 | Gagal — `/tugas` tak menampilkan task → **bukan defect**: Task Center default tab "Tugas Saya"; task tes tak ditugaskan ke siapa pun, hanya muncul di "Semua Task" | Fix tes `e1623c1`: buka tab "Semua Task" dulu |
| 7 | **LOLOS 3/3** ✅ | — |

Regresi `planning.spec.ts`: **4/4** ✅ (run yang sama). Login tidak pernah
menggantung; tidak ada kartu persetujuan baru (izin jaringan Supabase
`allow_always` tetap berlaku). Tidak ada pembayaran, bahaya, atau blocker.
Migrasi dan file tes pgTAP TIDAK diubah dalam sesi e2e. RLS tidak
dilonggarkan.

**Pelajaran pola (untuk Phase 4):** jangan sembunyikan form
`useActionState` berdasarkan hasil aksi yang sama — pesan sukses ikut
hilang saat form di-unmount. Dua defect aplikasi sesi ini berasal dari
pola itu.

### 12.4 Pembersihan residu e2e (16:47–16:52 WIB)

- Daftar: 8 organisasi — 1 seed + 7 `org-p3-*` (`mwnc30vb`, `mwncarpv`,
  `mwncfrre`, `mwncm1sb`, `mwncudsa`, `mwncybil` — slug run ke-7 yang
  tidak tercatat di output tes) + 1 `org-e2e-mwnd1sd8` (set planning).
  Semua isi tes menumpuk di workspace pertama `ws-p3-mwnc30vb`
  (resolusi workspace default = workspace tertua — lihat §12.5).
- Delete organisasi pertama **GAGAL P0001** (cascade → template default)
  — pelajaran yang sama dengan §12.2, kali ini di data nyata:
  `org-p3-p3-mwnc30vb` punya 3 template "Template Brief Standar"
  (`is_default=true`, masing-masing satu-satunya template di
  workspace-nya). Pemulihan (disetujui parent setelah verifikasi
  read-only per ID via join ke workspace + organisasi): `update
  brief_templates set is_default = false` untuk ketiga ID itu, lalu
  delete berhasil. **Aturan pembersihan ke depan: unset `is_default`
  dulu sebelum menghapus workspace/organisasi yang punya template
  default.**
- Verifikasi akhir (read-only): orgs 1, workspaces 1, org_members 1,
  ws_members 2, brands 0, channels 0, campaigns 0, items 0, placements
  0, tasks 0, assets 0, comments 0, shares 0, invitations 0. Seed utuh,
  Auth utuh (akun e2e `mative-e2e@example.com` tetap ada untuk run
  Phase 4).
- **Koreksi §8.1 dalam addendum ini:** blok (a) `social_channels`
  kini lewat `brand_id` (bukan `workspace_id` — versi lama gagal
  42703 saat pembersihan 15:10 WIB); "3 set" dikoreksi jadi 4 set
  probe0; catatan "JANGAN dihapus" soal org e2e sudah kedaluwarsa
  (residu sudah dibersihkan 16:52 WIB).

### 12.5 Batas jujur yang tersisa

- Aset tanpa pemindaian virus (batas desain — jangan klaim aman dari
  malware); `duration_ms` selalu null; item tanpa brand tidak bisa
  menerima placement; screenshot visual QA login masih belum ada;
  batas Phase 2 tetap berlaku (KPI dashboard pakai workspace pertama;
  kalender/board limit 200 item; WebKit B4 — jangan retry `apt-get`
  tanpa izin user).
- **Temuan baru (perilaku desain, bukan defect):** resolusi workspace
  default = workspace pertama (tertua). Semua isi tes menumpuk di
  workspace `mwnc30vb`, sementara workspace baru tiap run kosong
  kecuali template. Perlu diingat untuk pengguna multi-workspace.
- Guard 0011 kini dead code efektif (brand_id tak pernah NULL) —
  dipertahankan sebagai defense-in-depth; jangan dihapus, jangan ubah
  0007/0008/0009/0010/0011.
- Komentar lama di 0011 ("brand diisi lewat edit konten") TIDAK AKURAT:
  select Brand di edit konten masih `disabled`.

### 12.6 Status

**Phase 3 LOLOS PENUH.** Phase 4 boleh dimulai. Progres buku
`PLAN-MATIVE-001`: 5/11 = 45%.
