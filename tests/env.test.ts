import { describe, expect, it, vi } from "vitest";

describe("env — kunci publik Supabase (publishable diutamakan)", () => {
  it("memakai publishable key bila tersedia, fallback ke anon key", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://contoh.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_contoh";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-jwt-contoh";
    const { getSupabasePublicKey, envStatus } = await import("@/lib/env");
    expect(getSupabasePublicKey()).toBe("sb_publishable_contoh");
    expect(envStatus.supabaseConfigured).toBe(true);
    expect(envStatus.usesPublishableKey).toBe(true);
  });

  it("fallback ke anon key bila publishable key tidak ada", async () => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://contoh.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-jwt-contoh";
    const { getSupabasePublicKey, envStatus } = await import("@/lib/env");
    expect(getSupabasePublicKey()).toBe("anon-jwt-contoh");
    expect(envStatus.supabaseConfigured).toBe(true);
    expect(envStatus.usesPublishableKey).toBe(false);
  });

  it("tidak terkonfigurasi bila URL/kunci kosong", async () => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { envStatus } = await import("@/lib/env");
    expect(envStatus.supabaseConfigured).toBe(false);
    expect(envStatus.missing.length).toBeGreaterThan(0);
  });
});
