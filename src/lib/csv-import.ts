/**
 * Native CSV import — no AI, no token limits, no credits.
 *
 * Handles Portfolio Tracker exports (sectioned `[TRADES]` files) plus a generic
 * column matcher that copes with Questrade, Wealthsimple, TD Direct Investing,
 * RBC Direct Investing, Interactive Brokers, BMO InvestorLine, Scotia iTRADE
 * and hand-rolled spreadsheets.
 */

export type CsvTransaction = {
  /** Portfolio / account label exactly as it appears in the file. */
  portfolio: string;
  date: string;
  type: string;
  symbol: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  currency: string;
  fee: number;
  fx: number;
  note: string | null;
};

export type CsvPortfolio = {
  name: string;
  currency: string;
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

/* ------------------------------- primitives -------------------------------- */

function splitCsvLine(line: string): string[] {
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
    } else if (ch === "," || ch === ";" || ch === "\t") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.replace(/[$\s,]/g, "").replace(/[()]/g, (m) => (m === "(" ? "-" : ""));
  if (raw.trim().startsWith("(") && raw.trim().endsWith(")")) s = `-${s.replace("-", "")}`;
  if (!s || s === "-") return null;
  const n = Number(s);
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

export function normaliseType(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (TYPE_MAP[key]) return TYPE_MAP[key]!;
  for (const [k, v] of Object.entries(TYPE_MAP)) {
    if (key.startsWith(k)) return v;
  }
  return null;
}

function cleanSymbol(raw: string | undefined): string | null {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s || s === "_CASH_" || s === "CASH" || s === "-") return null;
  return s;
}

/* --------------------------- Portfolio Tracker ----------------------------- */

function parsePortfolioTracker(text: string): CsvParseResult {
  const lines = text.split(/\r?\n/);
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
    const cols = splitCsvLine(line);

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
    const fee = toNumber(commRaw) ?? 0;
    const fx = toNumber(fxRaw) ?? 1;
    const symbol = cleanSymbol(holding);
    // Portfolio Tracker records USD lines with a trade-date FX rate; CAD lines sit at 1.
    const currency = fx !== 1 ? "USD" : (currencyByPortfolio.get(portfolio) ?? "CAD");
    if (!orderedPortfolios.includes(portfolio)) orderedPortfolios.push(portfolio);

    const base: CsvTransaction = {
      portfolio,
      date,
      type,
      symbol,
      quantity: null,
      price: null,
      amount: null,
      currency,
      fee,
      fx,
      note: null,
    };

    if (type === "BUY" || type === "SELL" || type === "DRIP") {
      trades.push({ ...base, quantity: Math.abs(qty), price });
    } else if (type === "DIVIDEND") {
      // Quantity is the share count held, price the per-share payout.
      trades.push({ ...base, amount: Math.abs(qty * price), note: "Cash dividend" });
    } else if (type === "SPLIT") {
      // Ratio = new shares per old share, stored in units.
      const ratio = price !== 0 ? qty / price : qty;
      trades.push({ ...base, quantity: ratio, price: 0, fee: 0, note: `Split ${qty}:${price}` });
    } else if (type === "DEPOSIT" || type === "WITHDRAWAL" || type === "FEE") {
      trades.push({ ...base, symbol: null, amount: Math.abs(price !== 0 ? qty * price : qty) });
    } else {
      skipped += 1;
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
        suggestedType: guessAccountType(name),
      })),
  };
}

/* ----------------------------- Generic matcher ----------------------------- */

const FIELDS: Record<string, RegExp> = {
  date: /^(trade|transaction|settlement|activity|process)?\s*date$|^date$/i,
  type: /^(transaction\s*)?(type|action|activity|description)$/i,
  symbol: /^(symbol|ticker|holding|instrument|security|stock)$/i,
  quantity: /^(quantity|qty|shares|units|no\.? of shares)$/i,
  price: /^(price|unit price|price per (unit|share)|avg(erage)? price)$/i,
  amount: /^(amount|net amount|gross amount|value|total|proceeds)$/i,
  fee: /^(fee|fees|commission|commissions)$/i,
  currency: /^(currency|ccy|cur)$/i,
  account: /^(account|portfolio|account name|account type)$/i,
  fx: /^(fx|fx rate|exchange rate|rate)$/i,
};

function matchHeader(cols: string[]): Record<string, number> | null {
  const map: Record<string, number> = {};
  cols.forEach((raw, i) => {
    const col = raw.replace(/^#\s*/, "").trim();
    for (const [field, re] of Object.entries(FIELDS)) {
      if (map[field] === undefined && re.test(col)) map[field] = i;
    }
  });
  if (map["date"] === undefined) return null;
  if (map["type"] === undefined && map["amount"] === undefined) return null;
  return map;
}

function parseGeneric(text: string, fileName: string): CsvParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  let header: Record<string, number> | null = null;
  let start = 0;
  for (let i = 0; i < Math.min(lines.length, 25); i += 1) {
    const found = matchHeader(splitCsvLine(lines[i]!));
    if (found) {
      header = found;
      start = i + 1;
      break;
    }
  }
  if (!header) {
    throw new Error(
      "We could not find a header row in that CSV. It needs at least a date column plus a type or amount column.",
    );
  }

  const at = (cols: string[], field: string): string | undefined => {
    const i = header![field];
    return i === undefined ? undefined : cols[i];
  };

  const trades: CsvTransaction[] = [];
  let skipped = 0;
  for (let i = start; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]!);
    const date = normaliseDate(at(cols, "date") ?? "");
    if (!date) {
      skipped += 1;
      continue;
    }
    const rawType = at(cols, "type") ?? "";
    const type = normaliseType(rawType) ?? (toNumber(at(cols, "quantity")) ? "BUY" : null);
    if (!type) {
      skipped += 1;
      continue;
    }
    const qty = toNumber(at(cols, "quantity"));
    const price = toNumber(at(cols, "price"));
    const amount = toNumber(at(cols, "amount"));
    const fx = toNumber(at(cols, "fx")) ?? 1;
    const currency = (at(cols, "currency") || (fx !== 1 ? "USD" : "CAD")).toUpperCase().slice(0, 3);
    const portfolio = (at(cols, "account") || "Imported").trim() || "Imported";
    const unitType = type === "BUY" || type === "SELL" || type === "DRIP" || type === "SPLIT";

    trades.push({
      portfolio,
      date,
      type,
      symbol: cleanSymbol(at(cols, "symbol")),
      quantity: unitType ? Math.abs(qty ?? 0) : null,
      price: unitType ? (price ?? (qty && amount ? Math.abs(amount / qty) : 0)) : null,
      amount: unitType ? null : Math.abs(amount ?? (qty ?? 0) * (price ?? 1)),
      currency: currency === "USD" ? "USD" : "CAD",
      fee: toNumber(at(cols, "fee")) ?? 0,
      fx,
      note: null,
    });
  }

  const counts = new Map<string, { count: number; currency: string }>();
  for (const t of trades) {
    const cur = counts.get(t.portfolio);
    counts.set(t.portfolio, {
      count: (cur?.count ?? 0) + 1,
      currency: cur?.currency ?? t.currency,
    });
  }

  return {
    broker: fileName.replace(/\.[^.]+$/, ""),
    transactions: trades,
    skipped,
    portfolios: Array.from(counts.entries()).map(([name, v]) => ({
      name,
      currency: v.currency,
      count: v.count,
      suggestedType: guessAccountType(name),
    })),
  };
}

/* ---------------------------------- entry ---------------------------------- */

export function parseCsvText(text: string, fileName: string): CsvParseResult {
  if (/^\s*\[TRADES\]/m.test(text)) return parsePortfolioTracker(text);
  return parseGeneric(text, fileName);
}
