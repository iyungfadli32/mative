import { describe, expect, it } from "vitest";
import {
  audienceSchema,
  brandSchema,
  campaignSchema,
  channelSchema,
  contentItemSchema,
  ideaSchema,
  pillarSchema,
  placementSchema,
  reschedulePlacementSchema,
  tagSchema,
  transitionContentSchema,
} from "@/lib/validation/schemas";

describe("Skema Zod Planning Core — P2-04 s.d. P2-11", () => {
  it("brand: slug huruf kecil + unik-per-workspace (validasi format di sini)", () => {
    const base = { workspaceId: "11111111-1111-4111-8111-111111111111", name: "OSL", slug: "osl" };
    expect(brandSchema.safeParse(base).success).toBe(true);
    expect(brandSchema.safeParse({ ...base, slug: "OSL Besar" }).success).toBe(false);
    expect(brandSchema.safeParse({ ...base, slug: "a" }).success).toBe(false);
    expect(brandSchema.safeParse({ ...base, name: "x" }).success).toBe(false);
  });

  it("channel: connection_status HANYA not_connected/manual — 'connected' DITOLAK", () => {
    const base = {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      brandId: "22222222-2222-4222-8222-222222222222",
      platform: "instagram",
    };
    expect(channelSchema.safeParse(base).success).toBe(true);
    expect(channelSchema.safeParse({ ...base, connectionStatus: "connected" }).success).toBe(false);
    expect(channelSchema.safeParse({ ...base, platform: "myspace" }).success).toBe(false);
  });

  it("pilar: brand boleh kosong (berlaku seluruh workspace)", () => {
    const base = {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      name: "Edukasi",
    };
    const parsed = pillarSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.brandId ?? null).toBeNull();
  });

  it("audiens: attributes hanya kunci yang dikenal (kunci lain diabaikan aplikasi)", () => {
    const parsed = audienceSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      name: "Ibu muda",
      attributes: { age_range: "25-35", interests: ["skincare"], pain_points: ["jerawat"] },
    });
    expect(parsed.success).toBe(true);
  });

  it("campaign: target_metrics bentuk minimal 3 field (ASUMSI-5.3, ADR-0011 §3)", () => {
    const base = {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      name: "Launch",
      targetMetrics: { target_deliverables: 10, target_date: "2026-12-31", notes: "Q4" },
    };
    expect(campaignSchema.safeParse(base).success).toBe(true);
    // Bentuk lama (peta metrik bebas) DITOLAK sejak Phase 5.
    expect(campaignSchema.safeParse({ ...base, targetMetrics: { reach: 10000 } }).success).toBe(
      false,
    );
    expect(
      campaignSchema.safeParse({ ...base, targetMetrics: { target_deliverables: -1 } }).success,
    ).toBe(false);
    expect(
      campaignSchema.safeParse({ ...base, targetMetrics: { target_date: "31-12-2026" } }).success,
    ).toBe(false);
    expect(
      campaignSchema.safeParse({
        ...base,
        targetMetrics: { notes: "x".repeat(501) },
      }).success,
    ).toBe(false);
    expect(campaignSchema.safeParse({ ...base, status: "live" }).success).toBe(false);
  });

  it("ide: status + source_type terkunci; tag dibatasi 10", () => {
    const base = {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      title: "Ide bagus",
    };
    expect(ideaSchema.safeParse(base).success).toBe(true);
    expect(ideaSchema.safeParse({ ...base, status: "archived" }).success).toBe(false);
    expect(ideaSchema.safeParse({ ...base, sourceType: "telepati" }).success).toBe(false);
    expect(
      ideaSchema.safeParse({ ...base, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })
        .success,
    ).toBe(false);
  });

  it("konten: change_summary WAJIB; priority + funnel terkunci", () => {
    const base = {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      brandId: "22222222-2222-4222-8222-222222222222",
      title: "Konten A",
      changeSummary: "Versi awal (v1)",
    };
    expect(contentItemSchema.safeParse(base).success).toBe(true);
    expect(contentItemSchema.safeParse({ ...base, changeSummary: "" }).success).toBe(false);
    expect(contentItemSchema.safeParse({ ...base, priority: "critical" }).success).toBe(false);
    expect(contentItemSchema.safeParse({ ...base, funnelStage: "viral" }).success).toBe(false);
    expect(contentItemSchema.safeParse({ ...base, dueAt: "bukan-tanggal" }).success).toBe(false);
  });

  it("placement: TIDAK ADA field remote_post_id/published_url di skema", () => {
    const parsed = placementSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      contentItemId: "33333333-3333-4333-8333-333333333333",
      socialChannelId: "44444444-4444-4444-8444-444444444444",
      remote_post_id: "123",
      published_url: "https://example.com/x",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("remote_post_id" in parsed.data).toBe(false);
      expect("published_url" in parsed.data).toBe(false);
    }
  });

  it("reschedule: force default false; tanggal wajib valid", () => {
    const base = {
      placementId: "44444444-4444-4444-8444-444444444444",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      scheduledAt: "2026-11-20T02:00:00.000Z",
    };
    const parsed = reschedulePlacementSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.force).toBe(false);
    expect(reschedulePlacementSchema.safeParse({ ...base, scheduledAt: "kemarin" }).success).toBe(
      false,
    );
  });

  it("transisi: client_review ditolak sebagai tujuan", () => {
    expect(
      transitionContentSchema.safeParse({
        contentItemId: "33333333-3333-4333-8333-333333333333",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        toStatus: "client_review",
      }).success,
    ).toBe(false);
  });

  it("tag: slug divalidasi seperti slug brand", () => {
    expect(
      tagSchema.safeParse({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        name: "Promo",
        slug: "promo",
      }).success,
    ).toBe(true);
    expect(
      tagSchema.safeParse({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        name: "Promo",
        slug: "Promo Besar",
      }).success,
    ).toBe(false);
  });
});
