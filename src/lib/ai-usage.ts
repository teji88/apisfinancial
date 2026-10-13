/**
 * AI fair-use quota — pure helpers shared by client and server.
 *
 * Principle: AI features (statement reading, pre-sort, layout learning) are the
 * one thing that costs money to run, so Pro includes a monthly fair-use cap.
 * Everything deterministic (CSV import, ledger, tracker) is unlimited.
 */

/** AI pages included per Pro user per calendar month. */
export const AI_PAGES_PER_MONTH = 50;

/** "YYYY-MM" key for the month containing `d` (defaults to now). */
export function currentMonthKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

/** Human label for when the quota resets, e.g. "November 1". */
export function nextResetLabel(d: Date = new Date()): string {
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return next.toLocaleDateString("en-CA", { month: "long", day: "numeric" });
}

/**
 * Rough page count for a base64 PDF data URL, via the /Type /Page object
 * heuristic. Falls back to 1 when the count cannot be determined (images,
 * encrypted PDFs, unexpected bytes) — quota accounting must never throw.
 */
export function countPdfPages(dataUrl: string): number {
  try {
    const b64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
    if (typeof Buffer === "undefined") return 1;
    const text = Buffer.from(b64, "base64").toString("latin1");
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    const n = matches ? matches.length : 0;
    return n > 0 ? Math.min(n, 500) : 1;
  } catch {
    return 1;
  }
}

/** Friendly message shown when the monthly AI quota is exhausted. */
export function quotaExhaustedMessage(resetLabel: string): string {
  return (
    `You've used all ${AI_PAGES_PER_MONTH} AI pages for this month — ` +
    `resets ${resetLabel}. CSV import is always unlimited.`
  );
}
