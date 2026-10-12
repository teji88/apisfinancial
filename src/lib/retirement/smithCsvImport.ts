/**
 * HELOC tracker: CSV import inference for past Smith manoeuvre activity.
 *
 * Reconstructs proposed tranches from a brokerage/investment-account CSV.
 * Every output is a PROPOSAL — nothing becomes a financial record until the
 * user reviews and confirms each item in the UI.
 *
 * Inference rules (user-approved heuristics):
 * - Buy / stock purchase (no cash records) -> proposed tranche (draw) dated
 *   that day, amount = purchase amount.
 * - Cash in / deposit / contribution -> proposed tranche (draw) for investment.
 * - Cash out / withdrawal -> proposed OUTFLOW flagged for review. Never
 *   auto-assumed as a mortgage prepayment (CRA direct-use test risk).
 * - Sell -> proposed OUTFLOW flagged for review (proceeds destination unknown).
 * - Dividends / interest / distributions -> skipped (tracked separately as
 *   distributions, not draws).
 * - Anything unrecognized or missing an amount -> skipped, never invented.
 *
 * Reuses the deterministic CSV primitives from src/lib/csv-parse.ts.
 */
import {
  normaliseDate,
  parseCsvTable,
  toNumber,
} from "../csv-parse";
import {
  loadLearnedProfiles,
  matchLearnedProfile,
  type LearnedProfile,
} from "../csv-learn";

export type SmithCsvRow = {
  date: string; // YYYY-MM-DD
  rawType: string;
  symbol: string | null;
  quantity: number | null;
  price: number | null;
  /** Always present — parseSmithCsv skips rows without a usable amount. */
  amount: number;
};

export type ProposedTranche = {
  kind: "tranche";
  /** Stable key for the review UI (row index based). */
  key: string;
  date: string;
  amount: number;
  symbol: string | null;
  note: string;
  /** Raw transaction type, for kind filtering/sorting in the review UI. */
  rawType: string;
};

export type OutflowClassification =
  | "heloc_repayment"
  | "mortgage_prepayment"
  | "personal"
  | "moved_elsewhere";

export type ProposedOutflow = {
  kind: "outflow";
  key: string;
  date: string;
  amount: number;
  symbol: string | null;
  note: string;
  /** Raw transaction type, for kind filtering/sorting in the review UI. */
  rawType: string;
  /** Chosen by the user at review time; null until classified. */
  classification: OutflowClassification | null;
};

export type ProposedItem = ProposedTranche | ProposedOutflow;

export type SmithCsvParseResult = {
  rows: SmithCsvRow[];
  /** Rows skipped because they were unparseable or out of scope. */
  skipped: number;
  warnings: string[];
};

/* ------------------------------- headers -------------------------------- */

const HEADER_ALIASES: Record<keyof Omit<SmithCsvRow, "rawType"> | "type", string[]> = {
  date: ["date", "trade date", "transaction date", "settlement date"],
  type: ["type", "action", "transaction", "transaction type", "description"],
  symbol: ["symbol", "ticker"],
  quantity: ["quantity", "qty", "shares", "units"],
  price: ["price", "unit price"],
  amount: ["amount", "total", "net amount", "value", "net"],
};

type HeaderMap = {
  date?: number;
  type?: number;
  symbol?: number;
  quantity?: number;
  price?: number;
  amount?: number;
};

function mapHeaders(header: string[]): HeaderMap {
  const lower = header.map((h) => h.trim().toLowerCase());
  const idx: HeaderMap = {};
  const fields = Object.keys(HEADER_ALIASES) as Array<keyof HeaderMap>;
  for (const field of fields) {
    for (const alias of HEADER_ALIASES[field]) {
      const i = lower.findIndex((h) => h === alias || h.includes(alias));
      if (i >= 0) {
        idx[field] = i;
        break;
      }
    }
  }
  return idx;
}

/* -------------------------------- parsing ------------------------------- */

/** Build a HeaderMap from a learned profile's exact header texts. */
function headerMapFromLearned(header: string[], columns: LearnedProfile["columns"]): HeaderMap {
  const idx: HeaderMap = {};
  const fields: Array<keyof HeaderMap> = ["date", "type", "symbol", "quantity", "price", "amount"];
  for (const field of fields) {
    const want = columns[field];
    if (!want) continue;
    const i = header.findIndex((h) => h.trim() === want.trim());
    if (i >= 0) idx[field] = i;
  }
  return idx;
}

/** Canonical AI-learned types -> words the inference regexes understand. */
const CANONICAL_WORD: Record<string, string> = {
  BUY: "Buy",
  SELL: "Sell",
  DIVIDEND: "Dividend",
  DRIP: "Dividend",
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdrawal",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
};
/** Fees and splits are neither draws nor outflows — skip silently. */
const SKIP_CANONICAL = new Set(["FEE", "SPLIT"]);

function applyTypeMap(
  rawType: string,
  typeMap: Record<string, string> | undefined,
): { word: string; skip: boolean } {
  if (!typeMap) return { word: rawType, skip: false };
  const canonical = typeMap[rawType.trim().toLowerCase()];
  if (!canonical) return { word: rawType, skip: false };
  if (SKIP_CANONICAL.has(canonical)) return { word: "", skip: true };
  return { word: CANONICAL_WORD[canonical] ?? rawType, skip: false };
}

/**
 * Parse a CSV export into normalized rows. Tolerant of column order and
 * naming; strict about dates and amounts (unparseable -> skipped).
 *
 * Column mapping order: AI-learned profile for this exact header layout
 * (when one was saved) -> built-in header aliases. A learned typeMap also
 * translates cryptic action words into canonical types.
 */
export function parseSmithCsv(text: string): SmithCsvParseResult {
  const warnings: string[] = [];
  const table = parseCsvTable(text);
  if (table.length < 2) {
    return { rows: [], skipped: 0, warnings: ["The file has no data rows."] };
  }
  const header = table[0]!;
  const learned = matchLearnedProfile(header, loadLearnedProfiles());
  const idx = learned ? headerMapFromLearned(header, learned.columns) : mapHeaders(header);
  const typeMap = learned?.typeMap;
  if (learned && idx.date == null) {
    return { rows: [], skipped: table.length - 1, warnings: ["The saved layout for this file no longer matches its date column."] };
  }
  if (idx.date == null) {
    return { rows: [], skipped: table.length - 1, warnings: ["No date column found — nothing could be dated."] };
  }
  if (idx.amount == null && idx.quantity == null) {
    return {
      rows: [],
      skipped: table.length - 1,
      warnings: ["No amount or quantity column found — nothing could be valued."],
    };
  }

  const rows: SmithCsvRow[] = [];
  let skipped = 0;
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    if (cells.every((c) => c.trim() === "")) continue; // blank line
    const date = normaliseDate(cells[idx.date] ?? "");
    if (!date) {
      skipped++;
      continue;
    }
    const { word: rawType, skip } = applyTypeMap(
      idx.type != null ? (cells[idx.type] ?? "") : "",
      typeMap,
    );
    if (skip) {
      skipped++;
      continue;
    }
    const quantity = idx.quantity != null ? toNumber(cells[idx.quantity]) : null;
    const price = idx.price != null ? toNumber(cells[idx.price]) : null;
    let amount = idx.amount != null ? toNumber(cells[idx.amount]) : null;
    if (amount == null && quantity != null && price != null) {
      amount = Math.abs(quantity * price);
    }
    if (amount == null || amount <= 0) {
      skipped++;
      continue;
    }
    const symbolRaw = idx.symbol != null ? (cells[idx.symbol] ?? "").trim().toUpperCase() : "";
    rows.push({
      date,
      rawType,
      symbol: symbolRaw && symbolRaw !== "CASH" && symbolRaw !== "-" ? symbolRaw : null,
      quantity,
      price,
      amount: Math.abs(amount),
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (skipped > 0) {
    warnings.push(`${skipped} row(s) skipped: missing date or amount.`);
  }
  return { rows, skipped, warnings };
}

/* ------------------------------- inference ------------------------------ */

const BUY_RE = /\b(buy|bought|purchase|purchased)\b/i;
const CASH_IN_RE = /\b(deposit|contribution|transfer in|cash in|eft|funded|bill payment received)\b/i;
const CASH_OUT_RE = /\b(withdraw|withdrawal|cash out|transfer out|eft out|bill payment)\b/i;
const SELL_RE = /\b(sell|sold|sale)\b/i;
const DIST_RE = /\b(dividend|distribution|interest|coupon)\b/i;

/**
 * Apply the inference rules to parsed rows. Returns proposals only —
 * the caller must get user confirmation before creating any records.
 */
export function inferProposals(rows: SmithCsvRow[]): ProposedItem[] {
  const items: ProposedItem[] = [];
  rows.forEach((row, i) => {
    const t = row.rawType;
    const key = `csv-${i}`;
    if (BUY_RE.test(t)) {
      items.push({
        kind: "tranche",
        key,
        date: row.date,
        amount: row.amount,
        symbol: row.symbol,
        note: row.symbol
          ? `Buy ${row.symbol} — inferred draw from HELOC`
          : "Security purchase — inferred draw from HELOC",
        rawType: t,
      });
    } else if (CASH_IN_RE.test(t) && !row.symbol) {
      items.push({
        kind: "tranche",
        key,
        date: row.date,
        amount: row.amount,
        symbol: null,
        note: "Cash in — assumed HELOC money for investment",
        rawType: t,
      });
    } else if (SELL_RE.test(t)) {
      items.push({
        kind: "outflow",
        key,
        date: row.date,
        amount: row.amount,
        symbol: row.symbol,
        note: "Sale proceeds — confirm where the money went",
        rawType: t,
        classification: null,
      });
    } else if (CASH_OUT_RE.test(t)) {
      items.push({
        kind: "outflow",
        key,
        date: row.date,
        amount: row.amount,
        symbol: null,
        note: "Cash out — classify before recording (do not assume mortgage prepayment)",
        rawType: t,
        classification: null,
      });
    } else if (DIST_RE.test(t)) {
      // Distributions are tracked separately — not draws. Silently skip.
    } else {
      // Unknown type: never guess. The UI reports these as skipped.
      items.push({
        kind: "outflow",
        key,
        date: row.date,
        amount: row.amount,
        symbol: row.symbol,
        note: `Unrecognized activity ("${t || "no type"}") — classify manually or ignore`,
        rawType: t,
        classification: null,
      });
    }
  });
  return items;
}

/** Bucket a proposal's raw transaction type for filtering in the review UI. */
export type ProposalCategory = "Buy" | "Sell" | "Deposit" | "Withdrawal" | "Distribution" | "Other";

export function proposalCategory(rawType: string): ProposalCategory {
  const t = rawType ?? "";
  if (BUY_RE.test(t)) return "Buy";
  if (SELL_RE.test(t)) return "Sell";
  if (CASH_IN_RE.test(t)) return "Deposit";
  if (CASH_OUT_RE.test(t)) return "Withdrawal";
  if (DIST_RE.test(t)) return "Distribution";
  return "Other";
}

/**
 * Build a SmithTranche-compatible record from a confirmed proposed tranche.
 * Marks the source so imported tranches stay visually distinct.
 */
export function proposedTrancheNote(
  item: ProposedTranche,
  confirmedDate: string,
  sourceLabel = "brokerage CSV",
): string {
  return `Import — inferred from ${sourceLabel}, confirmed ${confirmedDate}. ${item.note}`;
}
