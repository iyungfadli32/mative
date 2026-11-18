# ADR-0005 — Job provider DITUNDA (tidak dipilih di Phase 1)

- **Status:** Ditunda ke Phase 6. **Tanggal:** 2026-11-19. **Konteks:** P1-02, Dok 04 §7.
- **Keputusan:** Inngest (4.26.2) dan Trigger.dev (SDK 4.8.6) keduanya
  diverifikasi tersedia (versi stable, tier gratis ada), tetapi TIDAK ADA
  yang dipilih di Phase 1 — fase ini tidak memakai background job sama sekali.
- **Alasan:** rencana detail (P1-A1) mensyaratkan pemilihan setelah evaluasi
  biaya/hosting; memilih sekarang tanpa workload nyata berisiko mengunci
  vendor + biaya. Evaluasi + pemilihan dilakukan di Phase 6 saat publishing
  queue membutuhkan job (idempotency, retry berbatas, lease).
- **Konsekuensi:** tidak ada kode job di repo; tidak ada secret job di env.
