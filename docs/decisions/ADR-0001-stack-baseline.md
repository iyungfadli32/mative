# ADR-0001 — Stack baseline Phase 1

- **Status:** Diterima (Keputusan #10: stack baseline, hanya tier gratis).
- **Tanggal:** 2026-11-19. **Konteks:** PLAN-MATIVE-001 Phase 1 (P1-02).
- **Versi stable diverifikasi:** 2026-11-19 via `npm view` (registry npm).

| Lapisan   | Pilihan                                                                     | Versi terkunci                          | Lisensi/biaya                    |
| --------- | --------------------------------------------------------------------------- | --------------------------------------- | -------------------------------- |
| Web app   | Next.js App Router + React + TypeScript                                     | Next 16.4.6, React 19.3.1, TS 5.9.3     | OSS gratis                       |
| UI        | Tailwind CSS v4 (+ primitif aksesibel sendiri, tanpa shadcn/ui di fase ini) | Tailwind 4.3.5                          | OSS gratis                       |
| Validasi  | Zod                                                                         | 4.6.7                                   | OSS gratis                       |
| Form      | React Hook Form                                                             | 7.92.0                                  | OSS gratis                       |
| Database  | PostgreSQL via Supabase                                                     | Supabase (Free, ap-southeast-1)         | Tier gratis                      |
| Auth      | Supabase Auth (SSR, `@supabase/ssr` 0.12.7, `supabase-js` 2.119.1)          | —                                       | Tier gratis                      |
| Storage   | Supabase Storage (disiapkan strukturnya; dipakai Phase 3)                   | —                                       | Tier gratis                      |
| Drag/drop | dnd-kit                                                                     | 6.3.1 (diverifikasi; diinstal Phase 2)  | OSS gratis                       |
| Charts    | Recharts                                                                    | 3.11.0 (diverifikasi; diinstal Phase 2) | OSS gratis                       |
| Test      | Vitest 5.1.1 + Playwright 1.65.1                                            | —                                       | OSS gratis                       |
| CI        | GitHub Actions                                                              | —                                       | Gratis (public repo)             |
| Hosting   | Vercel (preview saja)                                                       | —                                       | Hobby/gratis, tanpa kartu kredit |

## Keputusan

1. **TypeScript 5.9.3, BUKAN 7.0.2.** TS 7.0.2 adalah versi terbaru (native port) tetapi
   major rewrite yang berisiko breaking change dengan Next 16 + tooling saat ini.
   Dipilih 5.9.3 (5.x terbaru, terbukti stabil). Ditinjau ulang bila TS 7 matang.
2. **Tailwind v4** (bukan v3): `@tailwindcss/postcss`, token lewat `@theme inline`
   - CSS variables. shadcn/ui TIDAK diinstal di fase ini — primitif aksesibel
     ditulis sendiri (11 komponen) agar tidak ada dependensi komponen yang belum
     tentu dibutuhkan; shadcn/ui tetap opsi "primitif setara" bila diperlukan nanti.
3. **Job provider (Inngest 4.26.2 / Trigger.dev SDK 4.8.6) BELUM DIPILIH.**
   Keduanya tersedia dan punya tier gratis, tetapi Phase 1 tidak memakai job
   sama sekali. Pemilihan ditunda ke Phase 6 (saat publishing queue butuh job),
   setelah evaluasi biaya/hosting — sesuai rencana detail (P1-A1). Tidak ada
   kode yang bergantung pada nama vendor job.
4. **Supabase Free (Singapore)** sebagai database + auth + storage. Kunci
   publishable (format baru) diutamakan; anon JWT sebagai fallback.

## Konsekuensi

- Lockfile (`package-lock.json`) mengunci semua versi di atas.
- Bila satu pilihan ternyata berbayar/tidak tersedia, langkah itu dihentikan dan
  dilaporkan sebagai blocker (tidak diganti diam-diam) — sesuai P1-02.
