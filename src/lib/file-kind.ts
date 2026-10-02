/**
 * Content-based file classification for the import page.
 *
 * Routing used to trust the file extension, which sent .txt CSV exports to
 * paid AI and misrouted renamed files. Classification now reads the file's
 * first bytes: magic signatures for PDF/PNG/JPEG, a text sniff for anything
 * spreadsheet-like, and extension/MIME only as weak hints for edge cases
 * (e.g. an empty file). Pure module — no framework imports.
 */

export type FileKind = "csv-text" | "pdf" | "image" | "unknown";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

/** Text sniff: no NUL bytes and almost no control characters. */
function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    if (b === 0x00) return false;
    // Allow tab, LF, CR and ESC; other C0 controls count against the file.
    // Bytes >= 0x80 are fine (UTF-8 sequences, BOM).
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x1b) suspicious += 1;
  }
  return suspicious / bytes.length < 0.02;
}

export function classifyFile(header: Uint8Array, fileName: string, mimeType: string): FileKind {
  // Magic bytes win over names — a PDF renamed .csv is still a PDF.
  if (startsWith(header, PDF_MAGIC)) return "pdf";
  if (startsWith(header, PNG_MAGIC) || startsWith(header, JPEG_MAGIC)) return "image";
  if (looksLikeText(header)) return "csv-text";

  // Weak hints, only when the bytes say nothing (empty or very short files).
  const name = fileName.toLowerCase();
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mimeType.startsWith("image/") || /\.(png|jpe?g)$/.test(name)) return "image";
  if (mimeType.startsWith("text/") || /\.(csv|tsv|txt)$/.test(name)) return "csv-text";
  return "unknown";
}
