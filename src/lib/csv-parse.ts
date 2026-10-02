/**
 * Deterministic CSV toolkit — no AI, no guessing.
 *
 * Tokenizer: RFC-4180-ish parsing with delimiter detection (comma, semicolon,
 * tab, pipe), BOM stripping, CRLF normalisation, quoted fields with embedded
 * delimiters/newlines and "" escapes.
 *
 * Primitives: number/date/type/symbol/account normalisation shared by every
 * CSV import path. Anything a file does not show stays null — the caller's
 * "derivable → compute, unknowable → leave blank" rule lives here.
 */

export type CsvTransaction = {
  /** Portfolio / account label exactly as it appears in the file. */
  portfolio: string;
  date: string;
  /** Null when the file's action column is missing or unrecognized. */
  type: string | null;
  symbol: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  /** Null when the file does not show a currency — never assumed. */
  currency: string | null;
  /** Null when the file does not show a fee — never defaulted to 0 here. */
  fee: number | null;
  fx: number;
  note: string | null;
  /** 1 for a matched institution profile, lower for heuristic mapping. */
  confidence: number;
};

export type CsvPortfolio = {
  name: string;
  currency: string | null;
  count: number;
  /** Account type guessed from the portfolio name. */
  suggestedType: string;
};

export type CsvParseResult = {
  broker: string;
  portfolios: CsvPortfolio[];
  transactions: CsvTransaction[];
  skipped: number;
};

/* --------------------------------- text ---------------------------------- */

/** Strip BOM; normalise CRLF and lone CR to LF. */
export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function countOutsideQuotes(line: string, delim: string): number {
  let n = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (ch === delim && !quoted) {
      n += 1;
    }
  }
  return n;
}

/**
 * Pick the delimiter whose occurrences are most numerous and most consistent
 * across the sampled lines. Defaults to comma (e.g. single-column files).
 */
export function detectDelimiter(sampleLines: string[]): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const counts = sampleLines.map((l) => countOutsideQuotes(l, d));
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    const mode = Math.max(...freq.values());
    const score = total * 1000 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * Parse CSV text into rows of cells. Handles quoted fields containing the
 * delimiter, embedded newlines, and "" escapes. Unquoted cells are trimmed;
 * blank lines are dropped.
 */
export function parseCsvTable(text: string): string[][] {
  const src = normalizeText(text);
  const sample = src.split("\n").filter((l) => l.trim() !== "").slice(0, 10);
  if (sample.length === 0) return [];
  const delim = detectDelimiter(sample);

  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  let i = 0;
  const pushCell = () => {
    row.push(cur.trim());
    cur = "";
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        cur += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
    } else if (ch === "\n") {
      pushCell();
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      i += 1;
    } else if (ch === delim) {
      pushCell();
      i += 1;
    } else {
      cur += ch;
      i += 1;
    }
  }
  pushCell();
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

/* ------------------------------- primitives ------------------------------ */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-") return null;
  const negative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const s = trimmed.replace(/[$\s,]/g, "").replace(/[()]/g, "");
  if (!s || s === "-") return null;
  const n = Number(negative ? `-${s.replace(/^-/, "")}` : s);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/** Normalises the common brokerage date spellings to YYYY-MM-DD. */
export function normaliseDate(raw: string): string | null {
  const s = raw.trim().replace(/['"]/g, "").split(/[ T]/)[0] ?? "";
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  // Dotted dates are day.month.year.
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (m) {
    // Day-first when the first field cannot be a month.
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [dd, mm] = a > 12 ? [a, b] : [b, a];
    return `${m[3]}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2,4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    const yr = m[3]!.length === 2 ? `20${m[3]}` : m[3];
    if (mo) return `${yr}-${mo}-${m[1]!.padStart(2, "0")}`;
  }
  return null;
}

/** Best-guess Apis account type for a portfolio label from another app. */
export function guessAccountType(name: string): string {
  const n = name.toLowerCase();
  if (/spous/.test(n)) return "Spousal RRSP";
  if (/\brrsp\b|retirement savings|rrif/.test(n)) return "RRSP";
  if (/\btfsa\b|tax.?free/.test(n)) return "TFSA";
  if (/\blira\b|locked.?in/.test(n)) return "LIRA";
  if (/\blrsp\b/.test(n)) return "LRSP";
  if (/\bresp\b|education/.test(n)) return "RESP";
  if (/\brdsp\b|disabilit/.test(n)) return "RDSP";
  if (/\bfhsa\b|first home/.test(n)) return "FHSA";
  if (/\bcorp|inc\.|holdco/.test(n)) return "Corporate";
  return "Non-Registered";
}

const TYPE_MAP: Record<string, string> = {
  buy: "BUY",
  bought: "BUY",
  purchase: "BUY",
  "buy to open": "BUY",
  sell: "SELL",
  sold: "SELL",
  "sell to close": "SELL",
  div: "DIVIDEND",
  dividend: "DIVIDEND",
  "cash dividend": "DIVIDEND",
  distribution: "DIVIDEND",
  interest: "DIVIDEND",
  reinv: "DRIP",
  drip: "DRIP",
  "dividend reinvestment": "DRIP",
  reinvest: "DRIP",
  split: "SPLIT",
  "stock split": "SPLIT",
  deposit: "DEPOSIT",
  contribution: "DEPOSIT",
  "cash deposit": "DEPOSIT",
  transferin: "DEPOSIT",
  withdrawl: "WITHDRAWAL",
  withdrawal: "WITHDRAWAL",
  "cash withdrawal": "WITHDRAWAL",
  fee: "FEE",
  commission: "FEE",
  "management fee": "FEE",
};

/** Maps an action word to a canonical type, or null when unrecognized. */
export function normaliseType(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (TYPE_MAP[key]) return TYPE_MAP[key]!;
  for (const [k, v] of Object.entries(TYPE_MAP)) {
    if (key.startsWith(k)) return v;
  }
  return null;
}

/**
 * Heuristic type hint from free text (e.g. a description column). Scans for
 * whole-word action phrases, longest first, so "cash dividend" beats "div".
 * Null when nothing matches — a hint, never a verdict.
 */
export function normaliseTypeFromText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = ` ${raw.trim().toLowerCase()} `;
  const entries = Object.entries(TYPE_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [k, v] of entries) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}s?\\b`).test(s)) return v;
  }
  return null;
}

export function cleanSymbol(raw: string | undefined): string | null {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s || s === "_CASH_" || s === "CASH" || s === "-") return null;
  return s;
}

/** True for the trade-like types that carry units and a price per unit. */
export function isUnitType(type: string | null): boolean {
  return type === "BUY" || type === "SELL" || type === "DRIP" || type === "SPLIT";
}

/**
 * Split raw quantity/price/amount into the canonical layout: unit types keep
 * quantity and price (deriving price = amount ÷ quantity when it is the only
 * missing piece), cash types keep the amount (deriving quantity × price when
 * the amount is missing). Signs are normalised to positive — the type carries
 * the direction. Nothing is invented: unparseable pieces stay null.
 */
export function applyUnitCashSplit(args: {
  type: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
}): { quantity: number | null; price: number | null; amount: number | null } {
  const { type, quantity, price, amount } = args;
  if (isUnitType(type)) {
    return {
      quantity: quantity == null ? null : Math.abs(quantity),
      price:
        price ??
        (quantity && amount ? round2(Math.abs(amount / quantity)) : null),
      amount: null,
    };
  }
  return {
    quantity: null,
    price: null,
    amount:
      amount == null
        ? quantity != null && price != null
          ? round2(Math.abs(quantity * price))
          : null
        : Math.abs(amount),
  };
}

/**
 * Normalise a currency cell to a 3-letter code, or null when the file does
 * not show one. Anything that is not a plain code is left blank.
 */
export function normaliseCurrency(raw: string | undefined): string | null {
  const s = (raw ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  return /^[A-Z]{3}$/.test(s) ? s : null;
}
