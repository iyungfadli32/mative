/**
 * Unit test utilitas murni Publishing Foundation (P6-03).
 * Menangkap perilaku yang menentukan A6.3/A6.4/A6.6 + pola anti-regresi
 * Phase 3/4/5 (zona waktu eksplisit — BUKAN zona server UTC).
 */
import { describe, expect, it } from "vitest";
import {
  backoffMinutes,
  buildIdempotencyKey,
  canCancelJob,
  canConfirmJob,
  canRetryJob,
  isJobDueSoon,
  isJobOverdue,
  isValidPublishUrl,
  openPlatformUrl,
  publishingStatusLabel,
  resolvePublishingTimezone,
  utcIsoToZonedWallClock,
  zonedWallClockToUtcIso,
} from "@/features/publishing/utils";

describe("zonedWallClockToUtcIso", () => {
  it("15:30 WIB = 08:30 UTC (zona placement eksplisit, bukan zona server UTC)", () => {
    expect(zonedWallClockToUtcIso("2026-11-20T15:30", "Asia/Jakarta")).toBe(
      "2026-11-20T08:30:00.000Z",
    );
  });

  it("15:30 di zona lain memakai offset zona itu (New York EST = +5)", () => {
    expect(zonedWallClockToUtcIso("2026-11-20T15:30", "America/New_York")).toBe(
      "2026-11-20T20:30:00.000Z",
    );
  });

  it("round-trip dengan utcIsoToZonedWallClock stabil (tanpa geser)", () => {
    const utc = zonedWallClockToUtcIso("2026-11-20T15:30", "Asia/Jakarta");
    expect(utcIsoToZonedWallClock(utc, "Asia/Jakarta")).toBe("2026-11-20T15:30");
  });

  it("menolak format salah dan zona tidak valid", () => {
    expect(zonedWallClockToUtcIso("2026-11-20 15:30", "Asia/Jakarta")).toBeNull();
    expect(zonedWallClockToUtcIso("2026-11-20T15:30", "Zona/TidakAda")).toBeNull();
    expect(zonedWallClockToUtcIso("2026-13-20T15:30", "Asia/Jakarta")).toBeNull();
  });

  it("utcIsoToZonedWallClock mengembalikan string kosong untuk input kosong/tidak valid", () => {
    expect(utcIsoToZonedWallClock(null, "Asia/Jakarta")).toBe("");
    expect(utcIsoToZonedWallClock("bukan-iso", "Asia/Jakarta")).toBe("");
  });
});

describe("buildIdempotencyKey", () => {
  it("format pub:<placement>:<UTC detik> (ASUMSI-6.2 — sama dengan RPC 0020)", () => {
    expect(
      buildIdempotencyKey("11111111-1111-1111-1111-111111111111", "2026-11-20T08:30:00.000Z"),
    ).toBe("pub:11111111-1111-1111-1111-111111111111:2026-11-20T08:30:00Z");
  });

  it("tanpa jadwal memakai 'immediate'", () => {
    expect(buildIdempotencyKey("abc", null)).toBe("pub:abc:immediate");
  });
});

describe("backoffMinutes (ASUMSI-6.3)", () => {
  it("1 → 1 menit, 2 → 5 menit, 3+ → 15 menit", () => {
    expect(backoffMinutes(1)).toBe(1);
    expect(backoffMinutes(2)).toBe(5);
    expect(backoffMinutes(3)).toBe(15);
    expect(backoffMinutes(9)).toBe(15);
  });
});

describe("isValidPublishUrl", () => {
  it("menerima http/https tanpa spasi, menolak sisanya", () => {
    expect(isValidPublishUrl("https://www.instagram.com/p/abc123/")).toBe(true);
    expect(isValidPublishUrl("http://x.com/post/1")).toBe(true);
    expect(isValidPublishUrl("ftp://example.com/x")).toBe(false);
    expect(isValidPublishUrl("https://example.com/a b")).toBe(false);
    expect(isValidPublishUrl("")).toBe(false);
    expect(isValidPublishUrl("https://".concat("a".repeat(2045)))).toBe(false);
  });
});

describe("resolvePublishingTimezone (ASUMSI-6.6)", () => {
  it("placement menang atas item — selalu", () => {
    expect(resolvePublishingTimezone("Asia/Jakarta", "America/New_York")).toBe(
      "America/New_York",
    );
    expect(resolvePublishingTimezone("Asia/Jakarta", null)).toBe("Asia/Jakarta");
    expect(resolvePublishingTimezone(null, "")).toBe("Asia/Jakarta");
  });
});

describe("publishingStatusLabel", () => {
  it("9 label Dok 08 §6 harfiah", () => {
    expect(publishingStatusLabel("scheduled_locally")).toBe("Scheduled locally");
    expect(publishingStatusLabel("needs_manual_action")).toBe("Needs manual action");
    expect(publishingStatusLabel("uploaded_or_draft_created")).toBe(
      "Uploaded / Draft created",
    );
  });
});

describe("openPlatformUrl (ASUMSI-6.5)", () => {
  it("URL resmi untuk platform dikenal, null untuk yang tidak dikenal", () => {
    expect(openPlatformUrl("instagram")).toBe("https://www.instagram.com");
    expect(openPlatformUrl("youtube")).toBe("https://studio.youtube.com");
    expect(openPlatformUrl("other")).toBeNull();
    expect(openPlatformUrl(null)).toBeNull();
  });
});

describe("guard transisi job", () => {
  it("retry hanya failed + TRANSIENT_ERROR + < 3 percobaan (A6.4)", () => {
    expect(canRetryJob("failed", "TRANSIENT_ERROR", 1)).toBe(true);
    expect(canRetryJob("failed", "TRANSIENT_ERROR", 3)).toBe(false);
    expect(canRetryJob("failed", "PREFLIGHT_FAILED", 1)).toBe(false);
    expect(canRetryJob("needs_manual_action", "TRANSIENT_ERROR", 1)).toBe(false);
  });

  it("cancel ditolak dari published/cancelled dan sending ber-lease aktif", () => {
    expect(canCancelJob("ready", null)).toBe(true);
    expect(canCancelJob("published", null)).toBe(false);
    expect(canCancelJob("cancelled", null)).toBe(false);
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(canCancelJob("sending", future)).toBe(false);
    expect(canCancelJob("sending", past)).toBe(true);
  });

  it("confirm ditolak dari published/cancelled/failed", () => {
    expect(canConfirmJob("ready", null)).toBe(true);
    expect(canConfirmJob("needs_manual_action", null)).toBe(true);
    expect(canConfirmJob("published", null)).toBe(false);
    expect(canConfirmJob("failed", null)).toBe(false);
  });
});

describe("pengingat Queue", () => {
  it("overdue = ready/scheduled_locally yang jadwalnya sudah lewat", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isJobOverdue({ status: "ready", scheduled_at: past })).toBe(true);
    expect(isJobOverdue({ status: "ready", scheduled_at: future })).toBe(false);
    expect(isJobOverdue({ status: "published", scheduled_at: past })).toBe(false);
  });

  it("due soon = jadwal dalam 24 jam ke depan", () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    expect(isJobDueSoon({ status: "scheduled_locally", scheduled_at: soon })).toBe(true);
    expect(isJobDueSoon({ status: "scheduled_locally", scheduled_at: later })).toBe(false);
  });
});
