/**
 * Institution profile registry — deterministic CSV layouts, matched before the
 * generic heuristic parser runs.
 *
 * Each profile declares how to recognise its institution's export and how to
 * map its columns onto the canonical CsvTransaction shape. Profiles are pure:
 * no AI, no network. Unrecognized action words map to a null type (flagged
 * incomplete in review) — never guessed.
 *
 * Provenance: the Wealthsimple column set is Wealthsimple's own export layout
 * as documented by community export tooling; the Questrade column set matches
 * Questrade's account-activity CSV download. If an institution changes its
 * export, only its profile needs updating.
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

export interface InstitutionProfile {
  id: string;
  name: string;
  /** Match sectioned / non-header formats against the raw text. */
  detectText?: (text: string) => boolean;
  /** Match header-style formats against normalized (lowercase) headers. */
  detectHeaders?: (headers: string[]) => boolean;
  /** Build the result from the tokenized table (header row included). */
  parse: (table: string[][], fileName: string, text: string) => CsvParseResult;
}

/** Normalize a header cell for matching: lowercase, underscores to spaces. */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/^#\s*/, "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

/* ------------------------- Portfolio Tracker ----------------------------- */
/* Sectioned [TRADES] export. Kept from the original native importer.        */

function parsePortfolioTracker(text: string): CsvParseResult {
  const lines = text.split("\n");
  let section = "";
  const trades: CsvTransaction[] = [];
  const currencyByPortfolio = new Map<string, string>();
  const orderedPortfolios: string[] = [];
  let skipped = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("[")) {
      section = line.toUpperCase();
      continue;
    }
    if (line.startsWith("#")) continue;
    // Sectioned format: reuse the table parser per line for quoted fields.
    const cols = splitLine(line);

    if (section === "[PORTFOLIOS]") {
      const name = cols[0];
      if (name) currencyByPortfolio.set(name, (cols[1] || "CAD").toUpperCase());
      continue;
    }
    if (section !== "[TRADES]") continue;

    const [portfolio, holding, dateRaw, typeRaw, qtyRaw, priceRaw, commRaw, fxRaw] = cols;
    if (!portfolio || !dateRaw || !typeRaw) continue;
    const date = normaliseDate(dateRaw);
    const type = normaliseType(typeRaw);
    if (!date || !type) {
      skipped += 1;
      continue;
    }
    const qty = toNumber(qtyRaw) ?? 0;
    const price = toNumber(priceRaw) ?? 0;
    const fee = toNumber(commRaw);
    const fx = toNumber(fxRaw) ?? 1;
    const symbol = cleanSymbol(holding);
    // Portfolio Tracker records USD lines with a trade-date FX rate; CAD lines sit at 1.
    const currency = fx !== 1 ? "USD" : (currencyByPortfolio.get(portfolio) ?? "CAD");
    if (!orderedPortfolios.includes(portfolio)) orderedPortfolios.push(portfolio);

    const split = applyUnitCashSplit({ type, quantity: qty, price, amount: null });
    const base: CsvTransaction = {
      portfolio,
      date,
      type,
      symbol,
      quantity: split.quantity,
      price: split.price,
      amount: split.amount,
      currency,
      fee,
      fx,
      note: null,
      confidence: 1,
    };

    if (type === "DIVIDEND") {
      // Quantity is the share count held, price the per-share payout.
      trades.push({ ...base, amount: Math.abs(qty * price), note: "Cash dividend" });
    } else if (type === "SPLIT") {
      // Ratio = new shares per old share, stored in units.
      const ratio = price !== 0 ? qty / price : qty;
      trades.push({ ...base, quantity: ratio, price: 0, fee: 0, note: `Split ${qty}:${price}` });
    } else {
      trades.push(base);
    }
  }

  const counts = new Map<string, number>();
  for (const t of trades) counts.set(t.portfolio, (counts.get(t.portfolio) ?? 0) + 1);

  return {
    broker: "Portfolio Tracker export",
    transactions: trades,
    skipped,
    portfolios: orderedPortfolios
      .filter((n) => (counts.get(n) ?? 0) > 0)
      .map((name) => ({
        name,
        currency: currencyByPortfolio.get(name) ?? "CAD",
        count: counts.get(name) ?? 0,
        suggestedType: guessAccountTypeLocal(name),
      })),
  };
}

/** Minimal quoted-field line splitter for the sectioned format. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function guessAccountTypeLocal(name: string): string {
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

/* ------------------------------ Wealthsimple ---------------------------- */
/* transaction_date, settlement_date, account_id, account_type, activity_type,
   activity_sub_type, description, direction, symbol, name, currency, quantity,
   unit_price, commission, net_cash_amount                                   */

function wealthsimpleType(activityType: string, activitySubType: string, direction: string): string | null {
  const s = `${activityType} ${activitySubType} ${direction}`
    .toLowerCase()
    .replace(/_/g, " ");
  if (/\b(drip|reinvest|dividend reinvestment)\b/.test(s)) return "DRIP";
  if (/\b(dividend|div|interest|distribution)\b/.test(s)) return "DIVIDEND";
  if (/\b(buy|bought|purchase)\b/.test(s)) return "BUY";
  if (/\b(sell|sold)\b/.test(s)) return "SELL";
  if (/\b(contribution|deposit|transfer in|transferin)\b/.test(s)) return "DEPOSIT";
  if (/\b(withdrawal|transfer out|transferout)\b/.test(s)) return "WITHDRAWAL";
  if (/\b(fee|commission)\b/.test(s)) return "FEE";
  return normaliseType(s);
}

const wealthsimpleProfile: InstitutionProfile = {
  id: "wealthsimple",
  name: "Wealthsimple",
  detectHeaders: (headers) =>
    headers.includes("transaction date") && headers.includes("net cash amount"),
  parse: (table, _fileName) => {
    const headers = table[0]!.map(normalizeHeader);
    const idx = (name: string) => {
      const i = headers.indexOf(name);
      return i === -1 ? undefined : i;
    };
    const col = {
      date: idx("transaction date"),
      activityType: idx("activity type"),
      activitySubType: idx("activity sub type"),
      description: idx("description"),
      direction: idx("direction"),
      symbol: idx("symbol"),
      name: idx("name"),
      currency: idx("currency"),
      quantity: idx("quantity"),
      unitPrice: idx("unit price"),
      commission: idx("commission"),
      netCash: idx("net cash amount"),
      accountId: idx("account id"),
      accountType: idx("account type"),
    };
    const at = (row: string[], i: number | undefined) =>
      i === undefined ? undefined : row[i];

    const trades: CsvTransaction[] = [];
    let skipped = 0;
    for (let r = 1; r < table.length; r += 1) {
      const row = table[r]!;
      const date = normaliseDate(at(row, col.date) ?? "");
      if (!date) {
        skipped += 1;
        continue;
      }
      const type = wealthsimpleType(
        at(row, col.activityType) ?? "",
        at(row, col.activitySubType) ?? "",
        at(row, col.direction) ?? "",
      );
      const split = applyUnitCashSplit({
        type,
        quantity: toNumber(at(row, col.quantity)),
        price: toNumber(at(row, col.unitPrice)),
        amount: toNumber(at(row, col.netCash)),
      });
      const portfolio =
        (at(row, col.accountId) || at(row, col.accountType) || "Wealthsimple").trim() ||
        "Wealthsimple";
      trades.push({
        portfolio,
        date,
        type,
        symbol: cleanSymbol(at(row, col.symbol)),
        quantity: split.quantity,
        price: split.price,
        amount: split.amount,
        currency: normaliseCurrency(at(row, col.currency)),
        fee: toNumber(at(row, col.commission)),
        fx: 1,
        note: at(row, col.description)?.trim() || null,
        confidence: 1,
      });
    }
    return finish("Wealthsimple", trades, skipped);
  },
};

/* ------------------------------- Questrade ------------------------------ */
/* Transaction Date, Settlement Date, Action, Symbol, Description, Quantity,
   Price, Gross Amount, Commission, Net Amount, Currency, Activity Type       */

const QT_ACTIONS: Record<string, string> = {
  buy: "BUY",
  bought: "BUY",
  sell: "SELL",
  sold: "SELL",
  div: "DIVIDEND",
  dividend: "DIVIDEND",
  int: "DIVIDEND",
  interest: "DIVIDEND",
  con: "DEPOSIT",
  contribution: "DEPOSIT",
  dep: "DEPOSIT",
  deposit: "DEPOSIT",
  wdw: "WITHDRAWAL",
  wdl: "WITHDRAWAL",
  withdrawal: "WITHDRAWAL",
  fee: "FEE",
  commission: "FEE",
};

const questradeProfile: InstitutionProfile = {
  id: "questrade",
  name: "Questrade",
  detectHeaders: (headers) =>
    headers.includes("transaction date") && headers.includes("net amount"),
  parse: (table, _fileName) => {
    const headers = table[0]!.map(normalizeHeader);
    const idx = (name: string) => {
      const i = headers.indexOf(name);
      return i === -1 ? undefined : i;
    };
    const col = {
      date: idx("transaction date"),
      action: idx("action"),
      symbol: idx("symbol"),
      description: idx("description"),
      quantity: idx("quantity"),
      price: idx("price"),
      commission: idx("commission"),
      netAmount: idx("net amount"),
      currency: idx("currency"),
    };
    const at = (row: string[], i: number | undefined) =>
      i === undefined ? undefined : row[i];

    const trades: CsvTransaction[] = [];
    let skipped = 0;
    for (let r = 1; r < table.length; r += 1) {
      const row = table[r]!;
      const date = normaliseDate(at(row, col.date) ?? "");
      if (!date) {
        skipped += 1;
        continue;
      }
      const actionKey = (at(row, col.action) ?? "").trim().toLowerCase();
      const type = QT_ACTIONS[actionKey] ?? normaliseType(actionKey);
      const split = applyUnitCashSplit({
        type,
        quantity: toNumber(at(row, col.quantity)),
        price: toNumber(at(row, col.price)),
        amount: toNumber(at(row, col.netAmount)),
      });
      trades.push({
        portfolio: "Questrade",
        date,
        type,
        symbol: cleanSymbol(at(row, col.symbol)),
        quantity: split.quantity,
        price: split.price,
        amount: split.amount,
        currency: normaliseCurrency(at(row, col.currency)),
        fee: toNumber(at(row, col.commission)),
        fx: 1,
        note: at(row, col.description)?.trim() || null,
        confidence: 1,
      });
    }
    return finish("Questrade", trades, skipped);
  },
};

/* -------------------------------- registry ------------------------------ */

export const PROFILES: InstitutionProfile[] = [
  {
    id: "portfolio-tracker",
    name: "Portfolio Tracker export",
    detectText: (text) => /^\s*\[TRADES\]/m.test(text),
    parse: (_table, _fileName, text) => parsePortfolioTracker(text),
  },
  wealthsimpleProfile,
  questradeProfile,
];

/** Group transactions into portfolios for the account-mapping step. */
export function finish(
  broker: string,
  transactions: CsvTransaction[],
  skipped: number,
): CsvParseResult {
  const counts = new Map<string, { count: number; currency: string | null }>();
  for (const t of transactions) {
    const cur = counts.get(t.portfolio);
    counts.set(t.portfolio, {
      count: (cur?.count ?? 0) + 1,
      currency: cur?.currency ?? t.currency,
    });
  }
  return {
    broker,
    transactions,
    skipped,
    portfolios: Array.from(counts.entries()).map(([name, v]) => ({
      name,
      currency: v.currency,
      count: v.count,
      suggestedType: guessAccountTypeLocal(name),
    })),
  };
}
