import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  dateKeyInTimezone,
  daysInMonth,
  findCollision,
  groupPlacementsByDate,
  monthLabel,
  shiftDateKey,
  timeInTimezone,
  unscheduledPlacements,
  wallTimeToUtcIso,
} from "@/features/planning/calendar";

describe("Kalender + timezone — UTC disimpan, Asia/Jakarta dirender", () => {
  it("dateKeyInTimezone: 00:00 UTC = 07:00 WIB di hari yang sama", () => {
    expect(dateKeyInTimezone("2026-11-19T00:00:00.000Z", "Asia/Jakarta")).toBe("2026-11-19");
    // 18 Nov 20:00 UTC = 19 Nov 03:00 WIB → kunci tanggal BERGESER.
    expect(dateKeyInTimezone("2026-11-18T20:00:00.000Z", "Asia/Jakarta")).toBe("2026-11-19");
    expect(dateKeyInTimezone("2026-11-18T20:00:00.000Z", "UTC")).toBe("2026-11-18");
  });

  it("wallTimeToUtcIso: 09:00 WIB = 02:00 UTC", () => {
    expect(wallTimeToUtcIso("2026-11-19", "09:00", "Asia/Jakarta")).toBe(
      "2026-11-19T02:00:00.000Z",
    );
  });

  it("wallTime round-trip: UTC → WIB → UTC kembali sama", () => {
    const iso = "2026-11-19T02:00:00.000Z";
    const key = dateKeyInTimezone(iso, "Asia/Jakarta");
    const time = timeInTimezone(iso, "Asia/Jakarta");
    expect(key).toBe("2026-11-19");
    expect(wallTimeToUtcIso(key, time, "Asia/Jakarta")).toBe(iso);
  });

  it("zona waktu lain dihormati (New York, musim dingin UTC-5)", () => {
    // 2026-11-19 02:00 UTC = 18 Nov 21:00 di New York.
    expect(dateKeyInTimezone("2026-11-19T02:00:00.000Z", "America/New_York")).toBe("2026-11-18");
    expect(wallTimeToUtcIso("2026-11-18", "21:00", "America/New_York")).toBe(
      "2026-11-19T02:00:00.000Z",
    );
  });

  it("tanggal tidak valid tidak melempar", () => {
    expect(dateKeyInTimezone("bukan-tanggal")).toBe("");
    expect(timeInTimezone("bukan-tanggal")).toBe("");
  });

  it("shiftDateKey menggeser tanggal kalender (lewat batas bulan)", () => {
    expect(shiftDateKey("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDateKey("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDateKey("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("Grid kalender bulanan", () => {
  it("November 2026: 1 Nov = Minggu → 5 minggu, 30 hari in-month", () => {
    expect(daysInMonth(2026, 11)).toBe(30);
    const weeks = buildMonthGrid(2026, 11);
    expect(weeks).toHaveLength(5);
    expect(weeks[0]?.[0]).toEqual({ dateKey: "2026-11-01", inMonth: true, day: 1 });
    expect(weeks[4]?.[6]).toEqual({ dateKey: "2026-12-05", inMonth: false, day: 5 });
    const inMonth = weeks.flat().filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(30);
  });

  it("Februari 2026 (28 hari, mulai Minggu) = 4 minggu penuh", () => {
    const weeks = buildMonthGrid(2026, 2);
    expect(weeks).toHaveLength(4);
    expect(weeks.flat()).toHaveLength(28);
  });

  it("label bulan Bahasa Indonesia", () => {
    expect(monthLabel(2026, 11)).toContain("November");
    expect(monthLabel(2026, 11)).toContain("2026");
  });
});

describe("Collision + backlog (P2-A5)", () => {
  const placements = [
    {
      id: "p1",
      social_channel_id: "ch1",
      scheduled_at: "2026-11-19T02:00:00.000Z",
      content_item_id: "c1",
    },
    {
      id: "p2",
      social_channel_id: "ch1",
      scheduled_at: "2026-11-19T03:00:00.000Z",
      content_item_id: "c2",
    },
    {
      id: "p3",
      social_channel_id: "ch2",
      scheduled_at: "2026-11-19T02:00:00.000Z",
      content_item_id: "c3",
    },
    { id: "p4", social_channel_id: "ch1", scheduled_at: null, content_item_id: "c4" },
  ];

  it("collision = channel sama + waktu sama persis", () => {
    expect(findCollision(placements, "ch1", "2026-11-19T02:00:00.000Z")?.id).toBe("p1");
    // Channel lain di waktu yang sama: BUKAN collision.
    expect(findCollision(placements, "ch2", "2026-11-19T02:00:00.000Z")?.id).toBe("p3");
    // Waktu berbeda 1 jam: bukan collision.
    expect(findCollision(placements, "ch1", "2026-11-19T02:30:00.000Z")).toBeNull();
    // Placement yang sedang dipindah dikecualikan.
    expect(findCollision(placements, "ch1", "2026-11-19T02:00:00.000Z", "p1")).toBeNull();
  });

  it("groupPlacementsByDate memakai timezone workspace", () => {
    const grouped = groupPlacementsByDate(placements, "Asia/Jakarta");
    expect(grouped.get("2026-11-19")).toHaveLength(3);
    expect(grouped.has("2026-11-18")).toBe(false);
  });

  it("backlog = placement tanpa scheduled_at", () => {
    expect(unscheduledPlacements(placements).map((p) => p.id)).toEqual(["p4"]);
  });
});
