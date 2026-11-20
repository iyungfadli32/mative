/**
 * Uji harness evaluasi AI — tests/ai-eval.test.ts (P8-08/8.9).
 * Ambang ASUMSI-8F (ditetapkan SEBELUM pengujian): validitas output
 * terstruktur 100%, grounding 100%, 0 kasus prompt-injection lolos.
 * Yang diuji: harness + fixture + lapisan validasi/keamanan — BUKAN
 * model. Evaluasi terhadap MODEL LIVE tidak dapat dijalankan tanpa
 * provider (batas jujur — lihat laporan fase §9).
 */
import { describe, expect, it } from "vitest";
import { runAiEval } from "@/features/ai/eval";

describe("AI Assistant — harness evaluasi (deterministik, tanpa model)", () => {
  it("semua 22 cek lolos: 14 validitas + 2 grounding + 6 injeksi", () => {
    const report = runAiEval();
    // 7 fitur x (valid lolos + invalid ditolak) = 14; grounding 2;
    // injeksi 6 sampel.
    expect(report.checks).toHaveLength(22);
    expect(report.passed).toBe(22);
    expect(report.failed).toBe(0);
    expect(report.allPassed).toBe(true);
    for (const c of report.checks) {
      expect(c.passed, `${c.name}: ${c.detail}`).toBe(true);
    }
  });

  it("ambang tercatat sesuai ASUMSI-8F", () => {
    const report = runAiEval();
    expect(report.thresholds.structuredValidity).toContain("100%");
    expect(report.thresholds.grounding).toContain("100%");
    expect(report.thresholds.injectionPass).toContain("0");
  });
});
