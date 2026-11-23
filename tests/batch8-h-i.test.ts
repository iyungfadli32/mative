import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { badgeToneClasses } from "@/components/ui/Badges";
import { buttonSizeClasses, buttonVariantClasses } from "@/components/ui/Button";
import {
  getFocusableElements,
  trapTabKey,
  type FocusableContainer,
  type FocusableElement,
  type TrapKeyEvent,
} from "@/components/ui/focusTrap";
import { describeQueryError, isMissingTable, wrapQueryOutcome } from "@/lib/query";

/** Util kontras WCAG 2.1 (luminansi relatif). */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync("app/globals.css", "utf8");
const rawVars = new Map<string, string>();
for (const m of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
  if (!rawVars.has(m[1])) rawVars.set(m[1], m[2].trim());
}

function resolveVar(name: string): string {
  const value = rawVars.get(name);
  if (!value) throw new Error(`token --${name} tidak ditemukan di app/globals.css`);
  const ref = value.match(/^var\(--([a-z0-9-]+)\)$/);
  if (ref) return resolveVar(ref[1]);
  if (!/^#[0-9a-fA-F]{3,6}$/.test(value)) {
    throw new Error(`token --${name} bukan warna hex: ${value}`);
  }
  return value;
}

function classToken(cls: string, prefix: "bg" | "text"): string {
  const m = cls.match(new RegExp(`${prefix}-\\[var\\(--([a-z0-9-]+)\\)\\]`));
  if (!m) throw new Error(`kelas tidak memuat token ${prefix}: ${cls}`);
  return m[1];
}

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsx(p));
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

describe("H-2 kontras teks error", () => {
  it("rose-700 pada putih dan rose-100 memenuhi WCAG AA (>= 4.5:1)", () => {
    const rose700 = resolveVar("mt-rose-700");
    expect(contrast(rose700, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", rose700)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rose700, resolveVar("mt-rose-100"))).toBeGreaterThanOrEqual(4.5);
  });

  it("rose-500 lama tidak memenuhi AA sebagai teks (alasan token digelapkan)", () => {
    expect(contrast(resolveVar("mt-rose-500"), "#ffffff")).toBeLessThan(4.5);
  });

  it("token teks danger mengarah ke rose-700", () => {
    expect(resolveVar("mt-danger-text")).toBe(resolveVar("mt-rose-700"));
  });

  it("tidak ada lagi teks rose-500 / amber-500 di sumber app dan components", () => {
    const files = [...walkTsx("app"), ...walkTsx("components")];
    expect(files.length).toBeGreaterThan(0);
    const pelanggar = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return (
        src.includes("text-[var(--mt-rose-500)]") ||
        src.includes("text-[var(--mt-amber-500)]") ||
        /text-rose-\d/.test(src)
      );
    });
    expect(pelanggar).toEqual([]);
  });
});

describe("H-3 kontras tone badge", () => {
  it("setiap tone punya latar dan teks dengan kontras >= 4.5:1", () => {
    for (const [tone, cls] of Object.entries(badgeToneClasses)) {
      const bg = resolveVar(classToken(cls, "bg"));
      const fg = resolveVar(classToken(cls, "text"));
      expect(contrast(fg, bg), `tone ${tone}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("latar tiap tone berbeda; warning dan danger bukan lagi mint", () => {
    const latar = Object.values(badgeToneClasses).map((cls) => classToken(cls, "bg"));
    expect(new Set(latar).size).toBe(Object.keys(badgeToneClasses).length);
    expect(classToken(badgeToneClasses.warning, "bg")).not.toBe("mt-mint-100");
    expect(classToken(badgeToneClasses.danger, "bg")).not.toBe("mt-mint-100");
  });
});

describe("H-4 target sentuh 44px", () => {
  it("ukuran sm/md/lg tingginya 44px (h-11)", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const m = buttonSizeClasses[size].match(/h-(\d+)/);
      expect(m, `size ${size}`).not.toBeNull();
      expect(Number(m![1]) * 4).toBeGreaterThanOrEqual(44);
    }
  });

  it("varian danger memakai rose-700, bukan rose-500", () => {
    expect(buttonVariantClasses.danger).toContain("var(--mt-rose-700)");
    expect(buttonVariantClasses.danger).not.toContain("var(--mt-rose-500)");
  });
});

describe("H-1 focus trap dialog", () => {
  const tracker: string[] = [];

  function fakeEl(
    id: string,
    attrs: Record<string, string> = {},
    disabled = false,
  ): FocusableElement {
    return {
      disabled,
      getAttribute: (name: string) => attrs[name] ?? null,
      focus: () => {
        tracker.push(id);
      },
    };
  }

  function keyEvent(
    key: string,
    shiftKey: boolean,
  ): { event: TrapKeyEvent; isPrevented: () => boolean } {
    let prevented = false;
    const event: TrapKeyEvent = {
      key,
      shiftKey,
      preventDefault: () => {
        prevented = true;
      },
    };
    return { event, isPrevented: () => prevented };
  }

  it("getFocusableElements menyaring disabled dan aria-hidden", () => {
    const a = fakeEl("a", {}, true);
    const b = fakeEl("b");
    const c = fakeEl("c", { "aria-hidden": "true" });
    const container: FocusableContainer = { querySelectorAll: () => [a, b, c] };
    expect(getFocusableElements(container)).toEqual([b]);
  });

  it("Tab pada elemen terakhir membungkus ke pertama", () => {
    tracker.length = 0;
    const [first, mid, last] = [fakeEl("first"), fakeEl("mid"), fakeEl("last")];
    const { event, isPrevented } = keyEvent("Tab", false);
    trapTabKey(event, [first, mid, last], last);
    expect(isPrevented()).toBe(true);
    expect(tracker).toEqual(["first"]);
  });

  it("Shift+Tab pada elemen pertama membungkus ke terakhir", () => {
    tracker.length = 0;
    const [first, mid, last] = [fakeEl("first"), fakeEl("mid"), fakeEl("last")];
    const { event, isPrevented } = keyEvent("Tab", true);
    trapTabKey(event, [first, mid, last], first);
    expect(isPrevented()).toBe(true);
    expect(tracker).toEqual(["last"]);
  });

  it("Shift+Tab dari luar dialog membungkus ke terakhir", () => {
    tracker.length = 0;
    const [first, last] = [fakeEl("first"), fakeEl("last")];
    const { event, isPrevented } = keyEvent("Tab", true);
    trapTabKey(event, [first, last], null);
    expect(isPrevented()).toBe(true);
    expect(tracker).toEqual(["last"]);
  });

  it("Tab di tengah tidak dicegat", () => {
    tracker.length = 0;
    const [first, mid, last] = [fakeEl("first"), fakeEl("mid"), fakeEl("last")];
    const { event, isPrevented } = keyEvent("Tab", false);
    trapTabKey(event, [first, mid, last], mid);
    expect(isPrevented()).toBe(false);
    expect(tracker).toEqual([]);
  });

  it("tombol selain Tab diabaikan", () => {
    tracker.length = 0;
    const first = fakeEl("first");
    const { event, isPrevented } = keyEvent("Escape", false);
    trapTabKey(event, [first], first);
    expect(isPrevented()).toBe(false);
    expect(tracker).toEqual([]);
  });

  it("Dialog memakai trap dan mengembalikan fokus; tidak ada lagi <Link><Button>", () => {
    const dialog = readFileSync("components/ui/Dialog.tsx", "utf8");
    expect(dialog).toContain("trapTabKey");
    expect(dialog).toContain("getFocusableElements");
    expect(dialog).toContain("triggerRef");
    for (const f of [
      "components/layout/AppShell.tsx",
      "components/layout/Topbar.tsx",
      "features/planning/components/PlanningShell.tsx",
      "app/(app)/dashboard/page.tsx",
      "app/page.tsx",
      "app/(app)/konten/page.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/<Link[^>]*>\s*<Button/);
    }
    const button = readFileSync("components/ui/Button.tsx", "utf8");
    expect(button).toContain("href?: string");
  });
});

describe("T-1 pemisahan galat query", () => {
  it("isMissingTable mengenali tabel hilang dari kode dan pesan", () => {
    expect(isMissingTable({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isMissingTable({ code: "42P01", message: "x" })).toBe(true);
    expect(isMissingTable({ message: "Could not find the table 't' in the schema cache" })).toBe(
      true,
    );
    expect(isMissingTable({ message: 'relation "t" does not exist' })).toBe(true);
    expect(isMissingTable(new Error("boom"))).toBe(false);
    expect(isMissingTable(null)).toBe(false);
    expect(isMissingTable({})).toBe(false);
  });

  it("wrapQueryOutcome membedakan tabel hilang dari galat lain", async () => {
    await expect(wrapQueryOutcome(async () => 42)).resolves.toEqual({ ok: true, data: 42 });
    const hilang = Object.assign(new Error("Could not find the table"), { code: "PGRST205" });
    await expect(
      wrapQueryOutcome(async () => {
        throw hilang;
      }),
    ).resolves.toEqual({ ok: false, unavailable: true, error: null });
    await expect(
      wrapQueryOutcome(async () => {
        throw new Error("boom");
      }),
    ).resolves.toEqual({ ok: false, unavailable: false, error: "boom" });
  });

  it("describeQueryError memakai pesan galat atau pesan baku", () => {
    expect(describeQueryError(new Error("rusak"))).toBe("rusak");
    expect(describeQueryError({ message: "teks" })).toBe("teks");
    expect(describeQueryError("bukan-objek")).toBe("Gagal memuat data.");
  });

  it("lima file query memakai wrapQueryOutcome, bukan menelan ke unavailable", () => {
    for (const f of ["campaign", "publishing", "ai", "integrations", "analytics"]) {
      const src = readFileSync(`features/${f}/queries.ts`, "utf8");
      expect(src, f).toContain("wrapQueryOutcome");
      expect(src, f).not.toMatch(/\.catch\(\(\) => \(\{\s*ok: false,\s*unavailable: true/);
    }
  });

  it("halaman utama menampilkan banner error merah saat ada galat query", () => {
    const halaman: Array<[string, string]> = [
      ["app/(app)/dashboard/page.tsx", "queryError"],
      ["app/(app)/konten/page.tsx", "queryError"],
      ["app/(app)/board/page.tsx", "queryError"],
      ["app/(app)/kampanye/[id]/page.tsx", "campaignOutcome.error"],
      ["app/(app)/analitik/laporan/page.tsx", "queryError"],
    ];
    for (const [f, galat] of halaman) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("QueryErrorBanner");
      expect(src, f).toContain(galat);
    }
    const banner = readFileSync("components/ui/QueryErrorBanner.tsx", "utf8");
    expect(banner).toContain("Coba lagi");
    expect(banner).toContain("router.refresh()");
  });
});

describe("T-2 Suspense dan loading per rute", () => {
  it("loading.tsx ada untuk rute berat", () => {
    for (const f of [
      "app/(app)/loading.tsx",
      "app/(app)/dashboard/loading.tsx",
      "app/(app)/konten/loading.tsx",
      "app/(app)/konten/[id]/loading.tsx",
      "app/(app)/board/loading.tsx",
    ]) {
      expect(existsSync(f), f).toBe(true);
      expect(readFileSync(f, "utf8")).toContain("LoadingSkeleton");
    }
  });

  it("kedelapan seksi async detail konten dibungkus Suspense", () => {
    const src = readFileSync("app/(app)/konten/[id]/page.tsx", "utf8");
    expect(src).toContain('import { Suspense } from "react"');
    expect(src.match(/<Suspense/g)?.length).toBe(8);
    expect(src.match(/fallback=\{/g)?.length).toBe(8);
    expect(src.match(/LoadingSkeleton lines=\{4\}/g)?.length).toBe(8);
    const cabang = src.match(/\{tab === "/g) ?? [];
    expect(cabang.length).toBe(9); // 8 async + versions (inline, tanpa Suspense)
    const versi = src.slice(src.indexOf('tab === "versions"'));
    const akhirVersi = versi.indexOf(") : null}");
    expect(versi.slice(0, akhirVersi)).not.toContain("Suspense");
  });
});
