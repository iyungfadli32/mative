/**
 * Harness evaluasi AI — features/ai/eval.ts (P8-08/8.9, ADR-0014 §9).
 * Menilai harness + fixture + lapisan validasi/keamanan secara
 * deterministik — TANPA model. Ambang (ASUMSI-8F, ditetapkan SEBELUM
 * pengujian): validitas output terstruktur 100%, grounding analytics
 * 100%, 0 kasus prompt-injection lolos. Edit rate, latency, dan cost
 * TIDAK punya ambang lolos — hanya baseline sesudah provider ada.
 * Skor di sini BUKAN skor kualitas model: evaluasi terhadap MODEL LIVE
 * tidak dapat dijalankan tanpa provider.
 */
import { validateAiOutput } from "./schemas";
import { scanUntrustedContent } from "./safety";
import { verifyGroundingNumbers } from "./grounding";
import {
  EVAL_FIXTURES,
  GROUNDING_CITED_MATCHING,
  GROUNDING_CITED_MISMATCH,
  GROUNDING_PAYLOAD,
  INJECTION_SAMPLES,
} from "./eval-fixtures";

export type EvalCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

export type EvalReport = {
  /** Ambang lolos (ASUMSI-8F). */
  thresholds: {
    structuredValidity: string;
    grounding: string;
    injectionPass: string;
  };
  checks: EvalCheck[];
  passed: number;
  failed: number;
  /** Lolos bila SEMUA cek lolos. */
  allPassed: boolean;
};

/** Jalankan seluruh set evaluasi (deterministik, tanpa model). */
export function runAiEval(): EvalReport {
  const checks: EvalCheck[] = [];
  // 1. Validitas output terstruktur: valid lolos, tidak valid ditolak.
  for (const f of EVAL_FIXTURES) {
    const valid = validateAiOutput(f.feature, f.validOutput);
    checks.push({
      name: `${f.feature}: output valid lolos validasi`,
      passed: valid.ok,
      detail: valid.ok ? "lolos" : `ditolak: ${(valid as { issues: string[] }).issues.join("; ")}`,
    });
    const invalid = validateAiOutput(f.feature, f.invalidOutput);
    checks.push({
      name: `${f.feature}: output tidak valid ditolak`,
      passed: !invalid.ok,
      detail: invalid.ok ? "SEHARUSNYA ditolak tetapi lolos" : "ditolak",
    });
  }
  // 2. Grounding: angka cocok lolos, angka salah ditolak.
  const match = verifyGroundingNumbers(GROUNDING_PAYLOAD, GROUNDING_CITED_MATCHING);
  checks.push({
    name: "grounding: angka yang dikutip cocok 100%",
    passed: match.ok,
    detail: match.ok ? "semua cocok" : match.mismatches.join("; "),
  });
  const mismatch = verifyGroundingNumbers(GROUNDING_PAYLOAD, GROUNDING_CITED_MISMATCH);
  checks.push({
    name: "grounding: angka yang salah terdeteksi",
    passed: !mismatch.ok && mismatch.mismatches.length === 1,
    detail: mismatch.mismatches.join("; ") || "tidak terdeteksi",
  });
  // 3. Prompt-injection: 0 lolos.
  for (const s of INJECTION_SAMPLES) {
    const scan = scanUntrustedContent(s.text);
    checks.push({
      name: `injection: sampel ${s.label} diblokir`,
      passed: scan.blocked,
      detail: scan.blocked ? `cocok: ${scan.matches.join(", ")}` : "LOLOS (gagal)",
    });
  }
  const passed = checks.filter((c) => c.passed).length;
  return {
    thresholds: {
      structuredValidity: "100% (gagal validasi = gagal aksi)",
      grounding: "100% (angka + periode cocok dengan DB)",
      injectionPass: "0 kasus lolos dalam set uji",
    },
    checks,
    passed,
    failed: checks.length - passed,
    allPassed: passed === checks.length,
  };
}
