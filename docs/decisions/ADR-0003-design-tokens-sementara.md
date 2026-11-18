# ADR-0003 — Design tokens sementara (13 token + Inter)

- **Status:** Diterima SEMENTARA (Keputusan #14). **Tanggal:** 2026-11-19.
- **Konteks:** Dok 03 §3, P1-04.
- **Keputusan:** 13 token Dok 03 §3 dipakai sebagai proposal awal yang dikunci
  sementara (bukan final): `--mt-navy-950 #08232D`, `--mt-navy-900 #0D303B`,
  `--mt-teal-700 #087F76`, `--mt-teal-600 #0B9B8C`, `--mt-mint-100 #DDF7F0`,
  `--mt-indigo-600 #6659E8`, `--mt-amber-500 #F2A12B`, `--mt-rose-500 #E8798D`,
  `--mt-surface #FFFFFF`, `--mt-canvas #F4F7F9`, `--mt-border #E4EAEF`,
  `--mt-text #17232C`, `--mt-text-muted #65737D`. Typeface Inter.
- **Aturan:** semua warna sebagai CSS variables (`app/globals.css` + `@theme inline`
  Tailwind); komponen DILARANG hardcode hex. Status SELALU teks + ikon, bukan
  warna saja (pemetaan status → warna belum lengkap).
- **Konsekuensi:** logo/token final diputuskan Tuan sebelum Phase 1 ditutup atau
  paling lambat sebelum Phase 2; penggantian token final nanti tidak merombak
  komponen karena semua lewat variables.
