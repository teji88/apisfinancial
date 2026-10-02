/**
 * Native CSV import — no AI, no token limits, no credits.
 *
 * Layered pipeline:
 *   1. Tokenize the file with the RFC-4180-ish parser (delimiter detection,
 *      quoted fields, BOM/CRLF handling).
 *   2. Try the institution profile registry (Portfolio Tracker, Wealthsimple,
 *      Questrade, …). A matched profile maps columns with full confidence.
 *   3. Fall back to the hardened generic mapper: scored header matching with
 *      value-shape validation. Heuristic rows get confidence 0.7 so review
 *      highlights them.
 *
 * The unknowable stays blank everywhere: unknown actions map to a null type
 * (never an assumed BUY), missing currencies stay null (never CAD), missing
 * fees stay null (never 0). The only computations allowed are the two
 * derivable ones — amount = quantity × price and price = amount ÷ quantity.
 */

import {
  applyUnitCashSplit,
  cleanSymbol,
  guessAccountType,
  isUnitType,
  normaliseCurrency,
  normaliseDate,
  normaliseType,
  normaliseTypeFromText,
  parseCsvTable,
  toNumber,
  type CsvParseResult,
  type CsvTransaction,
} from "./csv-parse";
import { PROFILES, finish, normalizeHeader } from "./institution-profiles";

// Re-exported for compatibility; importers should prefer ./csv-parse.
export {
  normaliseDate,
  normaliseType,
  guessAccountType,
  type CsvParseResult,
  type CsvPortfolio,
  type CsvTransaction,
} from "./csv-parse";

/* ----------------------------- Generic matcher ----------------------------- */

type Field = "date" | "type" | "symbol" | "quantity" | "price" | "amount" | "fee" | "currency" | "account" | "description" | "fx";

/**
 * Column-name patterns in priority order. The first pattern with a match wins,
 * so "trade date" beats "settlement date" and "net amount" beats "gross amount".
 */
const FIELD_PATTERNS: Record<Field, RegExp[]> = {
  date: [
    /^(trade|transaction|process|posting)[_\s-]*date$/,
    /^date$/,
    /^(settlement|activity|value)[_\s-]*date$/,
  ],
  type: [/^(transaction[_\s-]*)?(type|action|activity)$/],
  symbol: [/^(symbol|ticker|holding|instrument|security|stock)$/],
  quantity: [/^(quantity|qty|shares|units|no\.?[_\s-]*of[_\s-]*shares)$/],
  price: [/^(unit[_\s-]*price|price[_\s-]*per[_\s-]*(unit|share))$/, /^price$/, /^average[_\s-]*price$/],
  amount: [/^net[_\s-]*amount$/, /^amount$/, /^gross[_\s-]*amount$/, /^(value|total|proceeds)$/],
  fee: [/^(fee|fees|commission|commissions)$/],
  currency: [/^(currency|ccy|cur)$/],
  account: [/^(account|portfolio|account[_\s-]*(name|id|type))$/],
  description: [/^(description|details|memo|notes?)$/],
  fx: [/^(fx|fx[_\s-]*rate|exchange[_\s-]*rate)$/],
};

function matchFields(headers: string[]): { map: Partial<Record<Field, number>>; score: number } {
  const map: Partial<Record<Field, number>> = {};
  let score = 0;
  for (const [field, patterns] of Object.entries(FIELD_PATTERNS) as Array<[Field, RegExp[]]>) {
    for (const re of patterns) {
      const i = headers.findIndex((h) => re.test(h));
      if (i !== -1) {
        map[field] = i;
        score += 1;
        break;
      }
    }
  }
  return { map, score };
}

/** A header candidate is usable when it names a date column plus something to record. */
function headerUsable(map: Partial<Record<Field, number>>): boolean {
  if (map.date === undefined) return false;
  return (
    map.type !== undefined ||
    map.amount !== undefined ||
    map.quantity !== undefined
  );
}

/**
 * Validate a candidate header against the data: the date column must parse in
 * a reasonable share of non-empty cells, and numeric columns must look numeric.
 */
function headerValid(
  map: Partial<Record<Field, number>>,
  dataRows: string[][],
): boolean {
  const sample = dataRows.slice(0, 50);
  const dateIdx = map.date!;
  let dateOk = 0;
  let dateSeen = 0;
  for (const row of sample) {
    const cell = (row[dateIdx] ?? "").trim();
    if (!cell) continue;
    dateSeen += 1;
    if (normaliseDate(cell)) dateOk += 1;
  }
  if (dateSeen > 0 && dateOk / dateSeen < 0.4) return false;
  for (const f of ["quantity", "price", "amount", "fee"] as const) {
    const idx = map[f];
    if (idx === undefined) continue;
    let ok = 0;
    let seen = 0;
    for (const row of sample) {
      const cell = (row[idx] ?? "").trim();
      if (!cell) continue;
      seen += 1;
      if (toNumber(cell) !== null) ok += 1;
    }
    if (seen > 0 && ok / seen < 0.4) return false;
  }
  return true;
}

const FOOTER_TYPE = /^(total|subtotal|balance|grand total)s?$/i;

function parseGeneric(table: string[][], fileName: string): CsvParseResult {
  // Find the best header row among the first 25 non-empty rows.
  let best: { map: Partial<Record<Field, number>>; start: number; score: number } | null = null;
  const limit = Math.min(table.length, 25);
  for (let i = 0; i < limit; i += 1) {
    const headers = table[i]!.map(normalizeHeader);
    const { map, score } = matchFields(headers);
    if (!headerUsable(map)) continue;
    if (best && score <= best.score) continue;
    if (!headerValid(map, table.slice(i + 1))) continue;
    best = { map, start: i + 1, score };
  }
  if (!best) {
    throw new Error(
      "We could not find a header row in that CSV. It needs at least a date column plus a type or amount column.",
    );
  }
  const header = best.map;
  const at = (row: string[], field: Field): string | undefined => {
    const i = header[field];
    return i === undefined ? undefined : row[i];
  };

  const trades: CsvTransaction[] = [];
  let skipped = 0;
  for (let i = best.start; i < table.length; i += 1) {
    const row = table[i]!;
    if (row.every((c) => c === "")) continue;
    const date = normaliseDate(at(row, "date") ?? "");
    if (!date) {
      skipped += 1;
      continue;
    }
    // Footer / subtotal lines are not transactions.
    if (FOOTER_TYPE.test((at(row, "type") ?? "").trim())) {
      skipped += 1;
      continue;
    }
    // Unknown or missing actions stay blank for the user to confirm — never
    // assumed. A description column doubles as a type hint ("AAPL dividend")
    // while remaining the row's note.
    const description = at(row, "description")?.trim() || null;
    const type =
      normaliseType(at(row, "type") ?? "") || normaliseTypeFromText(description) || null;
    const split = applyUnitCashSplit({
      type,
      quantity: toNumber(at(row, "quantity")),
      price: toNumber(at(row, "price")),
      amount: toNumber(at(row, "amount")),
    });
    const portfolio = (at(row, "account") || "Imported").trim() || "Imported";
    trades.push({
      portfolio,
      date,
      type,
      symbol: cleanSymbol(at(row, "symbol")),
      quantity: split.quantity,
      price: split.price,
      amount: split.amount,
      currency: normaliseCurrency(at(row, "currency")),
      fee: toNumber(at(row, "fee")),
      fx: toNumber(at(row, "fx")) ?? 1,
      note: description,
      confidence: 0.7,
    });
  }

  return finish(fileName.replace(/\.[^.]+$/, ""), trades, skipped);
}

/* ---------------------------------- entry ---------------------------------- */

export function parseCsvText(text: string, fileName: string): CsvParseResult {
  // Text-shape profiles first (sectioned exports have no header row).
  for (const profile of PROFILES) {
    if (profile.detectText?.(text)) {
      return profile.parse([], fileName, text);
    }
  }
  const table = parseCsvTable(text);
  if (table.length === 0) {
    throw new Error("That file does not appear to contain any rows.");
  }
  // Header-shape profiles, in registry order.
  const headers = table[0]!.map(normalizeHeader);
  for (const profile of PROFILES) {
    if (profile.detectHeaders?.(headers)) {
      return profile.parse(table, fileName, text);
    }
  }
  return parseGeneric(table, fileName);
}

// Keep isUnitType reachable for any importer that needs the trade/cash split.
export { isUnitType };
