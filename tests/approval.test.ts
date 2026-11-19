/**
 * Uji unit logika approval — tests/approval.test.ts (P4-04).
 * Berjalan TANPA database live: menguji cermin aplikasi dari aturan
 * migrasi 0013/0014 + ADR-0010 (features/approval/transitions.ts).
 * Bila logika ini berbeda dari database, yang DI DATABASE yang menang.
 */
import { describe, expect, it } from "vitest";
import {
  criticalFieldsChanged,
  isActiveRequestStatus,
  isCurrentVersionRequest,
  isStepQuorumMet,
  isWorkflowComplete,
  needsReapproval,
  nextStepOrder,
  openStepsAtOrder,
} from "../features/approval/transitions";
import type { ApprovalDecision, ApprovalStep } from "../features/approval/types";

const step = (over: Partial<ApprovalStep>): ApprovalStep => ({
  id: "step-1",
  workflow_id: "wf-1",
  step_order: 1,
  step_type: "sequential",
  assignee_role: "approver",
  assignee_user_id: null,
  required_count: 1,
  ...over,
});

const decision = (over: Partial<ApprovalDecision>): ApprovalDecision => ({
  id: "dec-1",
  approval_request_id: "req-1",
  step_id: "step-1",
  approver_user_id: "user-b",
  decision: "approved",
  comment: null,
  created_at: "2026-11-19T00:00:00Z",
  ...over,
});

describe("status request aktif", () => {
  it("submitted/in_review/reapproval_required aktif; approved/changes_requested/rejected tidak", () => {
    expect(isActiveRequestStatus("submitted")).toBe(true);
    expect(isActiveRequestStatus("in_review")).toBe(true);
    expect(isActiveRequestStatus("reapproval_required")).toBe(true);
    expect(isActiveRequestStatus("approved")).toBe(false);
    expect(isActiveRequestStatus("changes_requested")).toBe(false);
    expect(isActiveRequestStatus("rejected")).toBe(false);
  });
});

describe("versi basi (stale)", () => {
  it("request versi terbaru = tidak basi", () => {
    expect(
      isCurrentVersionRequest(
        { content_version_id: "v2", placement_version_id: "pv1" },
        "v2",
        "pv1",
      ),
    ).toBe(true);
  });
  it("content version lama = basi", () => {
    expect(
      isCurrentVersionRequest({ content_version_id: "v1", placement_version_id: null }, "v2", null),
    ).toBe(false);
  });
  it("placement version lama = basi", () => {
    expect(
      isCurrentVersionRequest(
        { content_version_id: "v2", placement_version_id: "pv1" },
        "v2",
        "pv2",
      ),
    ).toBe(false);
  });
  it("placement null di request = tidak basi bila content terbaru", () => {
    expect(
      isCurrentVersionRequest(
        { content_version_id: "v2", placement_version_id: null },
        "v2",
        "pv2",
      ),
    ).toBe(true);
  });
});

describe("kuorum step", () => {
  it("kuorum 1 terpenuhi oleh 1 persetujuan", () => {
    expect(isStepQuorumMet(step({ required_count: 1 }), [decision({})])).toBe(true);
  });
  it("kuorum 1 tidak terpenuhi tanpa persetujuan", () => {
    expect(isStepQuorumMet(step({ required_count: 1 }), [])).toBe(false);
  });
  it("kuorum 2 butuh 2 approver BERBEDA (1 orang 2x tidak cukup)", () => {
    const s = step({ required_count: 2 });
    expect(isStepQuorumMet(s, [decision({})])).toBe(false);
    expect(
      isStepQuorumMet(s, [decision({}), decision({ id: "dec-2", approver_user_id: "user-b" })]),
    ).toBe(false);
    expect(
      isStepQuorumMet(s, [decision({}), decision({ id: "dec-2", approver_user_id: "user-a" })]),
    ).toBe(true);
  });
  it("minta revisi / tolak tidak menghitung kuorum", () => {
    expect(
      isStepQuorumMet(step({ required_count: 1 }), [decision({ decision: "changes_requested" })]),
    ).toBe(false);
  });
  it("step paralel: semua step di order harus kuorum", () => {
    const steps = [step({ id: "s1" }), step({ id: "s2", step_order: 1 })];
    expect(openStepsAtOrder(steps, [decision({ step_id: "s1" })], 1)).toHaveLength(1);
    expect(
      openStepsAtOrder(
        steps,
        [decision({ step_id: "s1" }), decision({ id: "d2", step_id: "s2" })],
        1,
      ),
    ).toHaveLength(0);
  });
  it("workflow selesai bila semua step kuorum", () => {
    const steps = [step({ id: "s1" }), step({ id: "s2", step_order: 2 })];
    expect(isWorkflowComplete(steps, [decision({ step_id: "s1" })])).toBe(false);
    expect(
      isWorkflowComplete(steps, [
        decision({ step_id: "s1" }),
        decision({ id: "d2", step_id: "s2" }),
      ]),
    ).toBe(true);
  });
  it("nextStepOrder: order berikut atau null bila sudah akhir", () => {
    const steps = [step({ step_order: 1 }), step({ step_order: 2 })];
    expect(nextStepOrder(steps, 1)).toBe(2);
    expect(nextStepOrder(steps, 2)).toBe(null);
  });
});

describe("critical change (ASUMSI-4.6)", () => {
  const v1 = { script: "S1", caption: "C1", cta: "CTA1" };
  it("tidak ada perubahan = tidak butuh reapproval", () => {
    expect(needsReapproval(v1, { ...v1 }, null, null, 1, 1)).toBe(false);
  });
  it("caption berubah = butuh reapproval", () => {
    expect(criticalFieldsChanged(v1, { ...v1, caption: "C2" }, null, null, 1, 1)).toEqual([
      "caption",
    ]);
  });
  it("script + cta berubah = dua field", () => {
    expect(
      criticalFieldsChanged(v1, { script: "S2", caption: "C1", cta: "CTA2" }, null, null, 1, 1),
    ).toEqual(["script", "cta"]);
  });
  it("format placement berubah = butuh reapproval", () => {
    expect(
      criticalFieldsChanged(
        v1,
        { ...v1 },
        { platform_format: "reel", platform_caption: "P1", scheduled_at: null },
        { platform_format: "feed", platform_caption: "P1", scheduled_at: null },
        1,
        1,
      ),
    ).toEqual(["format"]);
  });
  it("caption placement berubah = field caption (bukan channel)", () => {
    expect(
      criticalFieldsChanged(
        v1,
        { ...v1 },
        { platform_format: "reel", platform_caption: "P1", scheduled_at: null },
        { platform_format: "reel", platform_caption: "P2", scheduled_at: null },
        1,
        1,
      ),
    ).toEqual(["caption"]);
  });
  it("jumlah aset berubah = field asset", () => {
    expect(criticalFieldsChanged(v1, { ...v1 }, null, null, 1, 2)).toEqual(["asset"]);
  });
  it("placement baru ditambahkan = field channel", () => {
    expect(criticalFieldsChanged(v1, { ...v1 }, null, null, 1, 1, true)).toEqual(["channel"]);
  });
  it("field di luar daftar kritis diabaikan", () => {
    expect(
      criticalFieldsChanged(v1, { ...v1, caption: "C2" }, null, null, 1, 1, false, ["script"]),
    ).toEqual([]);
  });
});
