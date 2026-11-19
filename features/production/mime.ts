/**
 * Validasi file aset dari ISI file — features/production/mime.ts (Phase 3)
 * Sumber: ADR-0009 §4. Ekstensi nama file TIDAK PERNAH dipercaya: MIME
 * ditentukan dari magic bytes; ukuran dibatasi 10 MB; dimensi dibaca
 * server-side hanya untuk PNG/JPEG (WebP/video/PDF = null).
 *
 * Tanpa pemindaian virus di MVP (known limitation) — jangan pernah klaim
 * file aman dari malware.
 */
import { createHash } from "node:crypto";
import { ALLOWED_ASSET_MIME_TYPES, MAX_ASSET_BYTES } from "./constants";

export type DetectedFile = {
  mimeType: (typeof ALLOWED_ASSET_MIME_TYPES)[number];
  width: number | null;
  height: number | null;
  sha256: string;
};

/** Magic bytes per tipe yang diizinkan (ADR-0009 §4). */
const MAGIC: Array<{ mime: (typeof ALLOWED_ASSET_MIME_TYPES)[number]; bytes: number[] }> = [
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" + "WEBP" di offset 8
  { mime: "video/mp4", bytes: [0x66, 0x74, 0x79, 0x70] }, // "ftyp" di offset 4
  { mime: "video/webm", bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // "%PDF"
];

function matchesMagic(buffer: Buffer, magic: number[], offset = 0): boolean {
  if (buffer.length < offset + magic.length) return false;
  return magic.every((b, i) => buffer[offset + i] === b);
}

/** Tentukan MIME dari magic bytes; null bila tidak dikenal / tidak diizinkan. */
export function detectMimeType(buffer: Buffer): DetectedFile["mimeType"] | null {
  for (const entry of MAGIC) {
    if (entry.mime === "image/webp") {
      if (
        matchesMagic(buffer, entry.bytes, 0) &&
        buffer.length >= 12 &&
        buffer.toString("ascii", 8, 12) === "WEBP"
      ) {
        return "image/webp";
      }
      continue;
    }
    if (entry.mime === "video/mp4") {
      if (matchesMagic(buffer, entry.bytes, 4)) return "video/mp4";
      continue;
    }
    if (matchesMagic(buffer, entry.bytes, 0)) return entry.mime;
  }
  return null;
}

/** Baca dimensi PNG (IHDR) atau JPEG (SOF0/SOF2). null bila tidak bisa dibaca. */
export function parseImageDimensions(
  buffer: Buffer,
  mimeType: string,
): { width: number | null; height: number | null } {
  if (mimeType === "image/png") {
    // IHDR: lebar 4 byte di offset 16, tinggi 4 byte di offset 20 (big-endian).
    if (buffer.length >= 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }
    return { width: null, height: null };
  }
  if (mimeType === "image/jpeg") {
    // Pindai marker JPEG sampai SOF0 (0xC0) / SOF2 (0xC2): tinggi 2 byte
    // lalu lebar 2 byte setelah 1 byte presisi.
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) return { width, height };
        return { width: null, height: null };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
    return { width: null, height: null };
  }
  return { width: null, height: null };
}

/** SHA-256 isi file (hex) — disimpan di assets.checksum. */
export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Validasi satu file upload: ukuran, MIME dari isi, dimensi (bila gambar).
 * Mengembalikan { ok, detected } atau { ok: false, message }.
 */
export function validateAssetFile(
  buffer: Buffer,
): { ok: true; detected: DetectedFile } | { ok: false; message: string } {
  if (buffer.length === 0) return { ok: false, message: "File kosong." };
  if (buffer.length > MAX_ASSET_BYTES) {
    return { ok: false, message: "File melebihi batas 10 MB." };
  }
  const mimeType = detectMimeType(buffer);
  if (!mimeType) {
    return {
      ok: false,
      message:
        "Jenis file tidak diizinkan. Yang diterima: PNG, JPEG, WebP, MP4, WebM, PDF (dicek dari isi file).",
    };
  }
  const { width, height } = parseImageDimensions(buffer, mimeType);
  return { ok: true, detected: { mimeType, width, height, sha256: sha256Hex(buffer) } };
}

/**
 * Amankan nama file untuk object_key Storage: buang karakter yang tidak
 * aman (termasuk '/' dan '\' — nama file TIDAK BOLEH membuat subfolder),
 * ganti spasi beruntun, batasi 100 karakter.
 */
export function sanitizeFileName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-+(?=\.)/g, "")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
  return base || "file";
}
