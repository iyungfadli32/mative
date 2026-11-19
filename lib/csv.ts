/**
 * Parser + serializer CSV — lib/csv.ts (P5-07, ADR-0011 §8).
 * RFC 4180, tulis sendiri (tanpa dependensi baru): koma, kutip ganda
 * ("..."" = kutip di dalam), baris baru di dalam field berkuote, dan
 * CRLF/LF. Parser TIDAK menebak header — pemanggil yang memetakan kolom.
 */
export type CsvParseResult = {
  /** Baris data (tanpa baris header); tiap baris = nilai per kolom. */
  rows: string[][];
  /** Nomor baris file (1-based, baris header = 1) untuk tiap baris data. */
  rowNumbers: number[];
};

/** Parse teks CSV menjadi baris-baris string. Baris pertama = header. */
export function parseCsv(text: string): {
  headers: string[];
  rows: string[][];
  rowNumbers: number[];
} {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  let lineNumber = 1;
  const rowNumbers: number[] = [];

  const pushField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    rowNumbers.push(lineNumber);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field === "" && !fieldStarted) {
        inQuotes = true;
        fieldStarted = true;
      } else {
        // Kutip di tengah field tanpa kuote — anggap karakter biasa.
        field += ch;
        fieldStarted = true;
      }
      continue;
    }
    if (ch === ",") {
      pushField();
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
      lineNumber++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      lineNumber++;
      continue;
    }
    field += ch;
    fieldStarted = true;
  }
  // Baris terakhir tanpa baris baru di akhir file.
  if (field !== "" || fieldStarted || row.length > 0) {
    pushRow();
  }
  // Buang baris kosong di akhir (mis. baris baru penutup file).
  while (rows.length > 0 && rows[rows.length - 1].every((v) => v.trim() === "")) {
    rows.pop();
    rowNumbers.pop();
  }
  const headers = rows.length > 0 ? rows[0].map((h) => h.trim()) : [];
  return { headers, rows: rows.slice(1), rowNumbers: rowNumbers.slice(1) };
}

/** Serializer: satu baris CSV (kuote bila perlu). */
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function serializeCsvRow(values: string[]): string {
  return values.map(csvEscape).join(",");
}
