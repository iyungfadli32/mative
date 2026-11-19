/**
 * Unit test Production Operations — tests/production.test.ts (Phase 3)
 * Murni (tanpa DB): magic bytes + dimensi gambar, mesin status task,
 * skema Zod, sanitasi nama file.
 */
import { describe, expect, it } from "vitest";
import {
  detectMimeType,
  parseImageDimensions,
  sanitizeFileName,
  validateAssetFile,
} from "@/features/production/mime";
import {
  isTerminalTaskStatus,
  isValidTaskTransition,
  validTaskTargets,
} from "@/features/production/transitions";
import {
  briefSnapshotSchema,
  briefTemplateSchemaJson,
  commentSchema,
  taskSchema,
} from "@/lib/validation/schemas";

function pngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  // IHDR chunk: panjang 13 (offset 8), "IHDR" (12), lebar (16), tinggi (20).
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function jpegBuffer(width: number, height: number): Buffer {
  // SOI + APP0 (FFE0, panjang 16) + SOF0 (FFC0, panjang 17, presisi 8).
  const app0 = Buffer.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x10, // APP0, panjang 16
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
  ]);
  const sof0 = Buffer.alloc(19);
  sof0[0] = 0xff;
  sof0[1] = 0xc0;
  sof0.writeUInt16BE(17, 2);
  sof0[4] = 8; // presisi
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3; // jumlah komponen
  return Buffer.concat([app0, sof0]);
}

describe("mime — deteksi dari isi file (bukan ekstensi)", () => {
  it("mengenali PNG dari magic bytes", () => {
    expect(detectMimeType(pngBuffer(800, 600))).toBe("image/png");
  });

  it("mengenali JPEG dari magic bytes", () => {
    expect(detectMimeType(jpegBuffer(640, 480))).toBe("image/jpeg");
  });

  it("mengenali PDF dari magic bytes", () => {
    expect(detectMimeType(Buffer.from("%PDF-1.7...."))).toBe("application/pdf");
  });

  it("menolak file yang isinya tidak dikenal (mis. teks biasa)", () => {
    expect(detectMimeType(Buffer.from("halo ini teks biasa, bukan gambar"))).toBeNull();
  });

  it("menolak file PNG palsu (ekstensi .png tapi isi teks)", () => {
    expect(validateAssetFile(Buffer.from("bukan gambar sama sekali")).ok).toBe(false);
  });

  it("membaca dimensi PNG dari IHDR", () => {
    expect(parseImageDimensions(pngBuffer(800, 600), "image/png")).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("membaca dimensi JPEG dari SOF0", () => {
    expect(parseImageDimensions(jpegBuffer(640, 480), "image/jpeg")).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("dimensi WebP/PDF null (tidak ada parser)", () => {
    expect(parseImageDimensions(Buffer.alloc(20), "image/webp")).toEqual({
      width: null,
      height: null,
    });
  });

  it("validateAssetFile menolak file kosong dan di atas 10 MB", () => {
    expect(validateAssetFile(Buffer.alloc(0)).ok).toBe(false);
    expect(validateAssetFile(Buffer.alloc(10 * 1024 * 1024 + 1)).ok).toBe(false);
  });

  it("validateAssetFile menerima PNG kecil + sha256 terisi", () => {
    const result = validateAssetFile(pngBuffer(10, 10));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detected.mimeType).toBe("image/png");
      expect(result.detected.width).toBe(10);
      expect(result.detected.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("sanitizeFileName membuang slash dan karakter tidak aman", () => {
    expect(sanitizeFileName("../../etc/passwd")).not.toContain("/");
    expect(sanitizeFileName("foto saya (1).PNG")).toBe("foto-saya-1.PNG");
    expect(sanitizeFileName("")).toBe("file");
  });
});

describe("transisi status task (cermin RPC 0010)", () => {
  it("jalur maju yang sah", () => {
    expect(isValidTaskTransition("todo", "in_progress")).toBe(true);
    expect(isValidTaskTransition("in_progress", "in_review")).toBe(true);
    expect(isValidTaskTransition("in_review", "done")).toBe(true);
    expect(isValidTaskTransition("blocked", "todo")).toBe(true);
    expect(isValidTaskTransition("cancelled", "todo")).toBe(true);
  });

  it("lompatan dan keluar dari done ditolak", () => {
    expect(isValidTaskTransition("todo", "done")).toBe(false);
    expect(isValidTaskTransition("todo", "in_review")).toBe(false);
    expect(isValidTaskTransition("done", "todo")).toBe(false);
    expect(isValidTaskTransition("done", "cancelled")).toBe(false);
    expect(isValidTaskTransition("todo", "todo")).toBe(false);
  });

  it("validTaskTargets(todo) = in_progress, blocked, cancelled", () => {
    expect(validTaskTargets("todo")).toEqual(["in_progress", "blocked", "cancelled"]);
  });

  it("done terminal; yang lain bukan", () => {
    expect(isTerminalTaskStatus("done")).toBe(true);
    expect(isTerminalTaskStatus("in_review")).toBe(false);
  });
});

describe("skema Zod Phase 3", () => {
  it("taskSchema menerima task valid + default priority medium", () => {
    const parsed = taskSchema.safeParse({
      workspaceId: "a1111111-1111-4111-8111-111111111111",
      parentType: "content_item",
      parentId: "b2222222-2222-4222-8222-222222222222",
      title: "Tulis draf",
      checklist: ["Riset", "Draf"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.priority).toBe("medium");
      expect(parsed.data.checklist).toEqual(["Riset", "Draf"]);
    }
  });

  it("taskSchema menolak parentType di luar enum + judul kosong", () => {
    expect(
      taskSchema.safeParse({
        workspaceId: "a1111111-1111-4111-8111-111111111111",
        parentType: "idea",
        parentId: "b2222222-2222-4222-8222-222222222222",
        title: "X",
      }).success,
    ).toBe(false);
    expect(
      taskSchema.safeParse({
        workspaceId: "a1111111-1111-4111-8111-111111111111",
        parentType: "content_item",
        parentId: "b2222222-2222-4222-8222-222222222222",
        title: " ",
      }).success,
    ).toBe(false);
  });

  it("briefSnapshotSchema memberi default kosong", () => {
    const parsed = briefSnapshotSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.keyMessages).toEqual([]);
      expect(parsed.data.objective).toBe("");
    }
  });

  it("briefTemplateSchemaJson menolak 0 field dan > 12 field", () => {
    expect(briefTemplateSchemaJson.safeParse({ fields: [] }).success).toBe(false);
    expect(
      briefTemplateSchemaJson.safeParse({
        fields: Array.from({ length: 13 }, (_, i) => ({
          key: `f${i}`,
          label: `Field ${i}`,
          type: "text",
          required: false,
        })),
      }).success,
    ).toBe(false);
    expect(
      briefTemplateSchemaJson.safeParse({
        fields: [{ key: "objective", label: "Tujuan", type: "text", required: true }],
      }).success,
    ).toBe(true);
  });

  it("commentSchema menolak target di luar enum", () => {
    expect(
      commentSchema.safeParse({
        workspaceId: "a1111111-1111-4111-8111-111111111111",
        targetType: "brand",
        targetId: "b2222222-2222-4222-8222-222222222222",
        body: "halo",
      }).success,
    ).toBe(false);
  });
});
