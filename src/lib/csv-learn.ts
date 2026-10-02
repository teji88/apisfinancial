/**
 * Learned institution profiles — CSV layouts the AI mapped once, saved for
 * deterministic reuse.
 *
 * The flow: an unknown CSV fails the built-in profiles and the generic
 * heuristic parser. A Pro user can ask the AI to map its columns (one paid
 * call). The resulting mapping is saved here — in the browser's localStorage,
 * so the layout never leaves the device — and every future import of the same
 * format parses deterministically with zero AI cost.
 *
 * Matching is strict on purpose: a learned profile only applies when the
 * file's header row normalizes to exactly the recorded fingerprint. If the
 * institution adds or renames a column, the user re-learns rather than
 * silently mis-mapping money. The unknowable stays blank: columns the AI did
 * not map are simply absent, and action words outside the learned type map
 * fall back to the standard normaliser (null when unrecognized, never
 * guessed).
 */

import {
  applyUnitCashSplit,
  cleanSymbol,
  normaliseCurrency,
  normaliseDate,
  normaliseType,
  toNumber,
  type CsvParseResult,
  type CsvTransaction,
} from "./csv-parse";
import { finish, normalizeHeader } from "./institution-profiles";

export type LearnedColumnField =
  | "date"
  | "type"
  | "symbol"
  | "quantity"
  | "price"
  | "amount"
  | "fee"
  | "currency"
  | "account"
  | "description"
  | "fx";

export interface LearnedProfile {
  id: string;
  /** Institution or format name, from the AI or edited by the user. */
  name: string;
  createdAt: string;
  source: "ai";
  /** Normalized headers (sorted) identifying this exact layout. */
  headerFingerprint: string[];
  /** Canonical field -> exact header text as it appears in the file. */
  columns: Partial<Record<LearnedColumnField, string>>;
  /** Raw action word (lowercased, trimmed) -> canonical transaction type. */
  typeMap?: Record<string, string> | undefined;
}

export const LEARNED_PROFILES_KEY = "apis.learnedCsvProfiles";

/** Normalize headers into a canonical fingerprint for exact-match lookup. */
export function fingerprintHeaders(headers: string[]): string[] {
  return headers.map(normalizeHeader).filter(Boolean).sort();
}

/**
 * Find the learned profile whose fingerprint exactly matches these headers.
 * Returns null when nothing matches — never a partial guess.
 */
export function matchLearnedProfile(
  headers: string[],
  profiles: LearnedProfile[],
): LearnedProfile | null {
  const fp = fingerprintHeaders(headers).join("\u0001");
  for (const p of profiles) {
    if (p.headerFingerprint.join("\u0001") === fp) return p;
  }
  return null;
}

/** Locate the header row: first of the first 25 rows matching the fingerprint. */
function findHeaderRow(table: string[][], profile: LearnedProfile): number {
  const fp = profile.headerFingerprint.join("\u0001");
  const limit = Math.min(table.length, 25);
  for (let i = 0; i < limit; i += 1) {
    if (fingerprintHeaders(table[i]!).join("\u0001") === fp) return i;
  }
  return -1;
}

function resolveType(raw: string | undefined, profile: LearnedProfile): string | null {
  const key = (raw ?? "").trim().toLowerCase();
  if (key && profile.typeMap && profile.typeMap[key]) return profile.typeMap[key]!;
  return normaliseType(raw ?? "");
}

export function parseWithLearnedProfile(
  table: string[][],
  fileName: string,
  profile: LearnedProfile,
): CsvParseResult {
  if (!profile.columns.date) {
    throw new Error(`The saved "${profile.name}" layout has no date column.`);
  }
  const headerRow = findHeaderRow(table, profile);
  if (headerRow === -1) {
    throw new Error(
      `That file does not match the saved "${profile.name}" layout anymore.`,
    );
  }
  const headers = table[headerRow]!.map(normalizeHeader);
  const colIndex = new Map<string, number>();
  headers.forEach((h, i) => {
    if (!colIndex.has(h)) colIndex.set(h, i);
  });
  const idx = (field: LearnedColumnField): number | undefined => {
    const headerText = profile.columns[field];
    if (!headerText) return undefined;
    return colIndex.get(normalizeHeader(headerText));
  };
  const col = {
    date: idx("date"),
    type: idx("type"),
    symbol: idx("symbol"),
    quantity: idx("quantity"),
    price: idx("price"),
    amount: idx("amount"),
    fee: idx("fee"),
    currency: idx("currency"),
    account: idx("account"),
    description: idx("description"),
    fx: idx("fx"),
  };
  const at = (row: string[], i: number | undefined): string | undefined =>
    i === undefined ? undefined : row[i];

  const trades: CsvTransaction[] = [];
  let skipped = 0;
  for (let r = headerRow + 1; r < table.length; r += 1) {
    const row = table[r]!;
    if (row.every((c) => c === "")) continue;
    const date = normaliseDate(at(row, col.date) ?? "");
    if (!date) {
      skipped += 1;
      continue;
    }
    const description = at(row, col.description)?.trim() || null;
    const type = resolveType(at(row, col.type), profile);
    const split = applyUnitCashSplit({
      type,
      quantity: toNumber(at(row, col.quantity)),
      price: toNumber(at(row, col.price)),
      amount: toNumber(at(row, col.amount)),
    });
    const portfolio =
      (at(row, col.account) || fileName.replace(/\.[^.]+$/, "")).trim() ||
      fileName.replace(/\.[^.]+$/, "");
    trades.push({
      portfolio,
      date,
      type,
      symbol: cleanSymbol(at(row, col.symbol)),
      quantity: split.quantity,
      price: split.price,
      amount: split.amount,
      currency: normaliseCurrency(at(row, col.currency)),
      fee: toNumber(at(row, col.fee)),
      fx: toNumber(at(row, col.fx)) ?? 1,
      note: description,
      // Learned from AI once, then deterministic: more trusted than the
      // 0.7 heuristic, less than a hand-built 1.0 profile.
      confidence: 0.9,
    });
  }

  return finish(profile.name, trades, skipped);
}

/* ------------------------------ persistence ------------------------------ */

function storageAvailable(): boolean {
  return typeof localStorage !== "undefined";
}

function readStored(): LearnedProfile[] {
  if (!storageAvailable()) return [];
  try {
    const raw = localStorage.getItem(LEARNED_PROFILES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is LearnedProfile =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as LearnedProfile).id === "string" &&
        Array.isArray((p as LearnedProfile).headerFingerprint) &&
        typeof (p as LearnedProfile).columns === "object",
    );
  } catch {
    return [];
  }
}

function writeStored(profiles: LearnedProfile[]): void {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(LEARNED_PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // Quota or privacy mode — the in-memory copy still works for this session.
  }
}

export function loadLearnedProfiles(): LearnedProfile[] {
  return readStored();
}

/** Insert or replace by id; newest first. */
export function saveLearnedProfile(profile: LearnedProfile): LearnedProfile[] {
  const next = [profile, ...readStored().filter((p) => p.id !== profile.id)];
  writeStored(next);
  return next;
}

export function deleteLearnedProfile(id: string): LearnedProfile[] {
  const next = readStored().filter((p) => p.id !== id);
  writeStored(next);
  return next;
}

/** Build a profile from an AI-learned mapping, fingerprinting live headers. */
export function buildLearnedProfile(args: {
  name: string;
  headers: string[];
  columns: Partial<Record<LearnedColumnField, string>>;
  typeMap?: Record<string, string> | undefined;
}): LearnedProfile {
  return {
    id: `learned-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: args.name,
    createdAt: new Date().toISOString(),
    source: "ai",
    headerFingerprint: fingerprintHeaders(args.headers),
    columns: args.columns,
    typeMap: args.typeMap,
  };
}
