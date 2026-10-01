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

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function splitCsvLine(line: string): string[] {
  return parseDelimited(line, ",")[0] ?? [];
}

function detectDelimiter(text: string): string {
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestScore = -1;
  for (const delimiter of candidates) {
    // Sniff the preamble and headers without repeatedly parsing a large history export.
    const rows = parseDelimited(text.slice(0, 128_000), delimiter).slice(0, 30);
    const widths = rows.map((row) => row.length).filter((width) => width > 1);
    if (widths.length === 0) continue;
    const commonWidth = widths.sort(
      (a, b) =>
        widths.filter((width) => width === b).length - widths.filter((width) => width === a).length,
    )[0]!;
    const consistency = widths.filter((width) => width === commonWidth).length / widths.length;
    const score = consistency * commonWidth + Math.min(widths.length, 10) / 100;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.endsWith("-");
  let s = trimmed
    .replace(/[()]/g, "")
    .replace(/\s|\u00a0|\u202f/g, "")
    .replace(/[A-Za-z$€£¥]/g, "");
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    // The rightmost punctuation is the decimal separator (1,234.56 or 1.234,56).
    s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (comma >= 0) {
    const digitsAfter = s.length - comma - 1;
    s = digitsAfter > 0 && digitsAfter <= 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  s = s.replace(/-/g, "");
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
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
  const s = raw.trim().replace(/[']/g, "").replace(/"/g, "").split(/[ T]/)[0] ?? "";
  let year: number;
  let month: number;
  let day: number;
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s))) {
    // Day-first when the first field cannot be a month; otherwise use common North American order.
    const a = Number(m[1]);
    const b = Number(m[2]);
    [day, month] = a > 12 ? [a, b] : [b, a];
    year = Number(m[3]);
  } else if ((m = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2,4})$/.exec(s))) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (!mo) return null;
    month = Number(mo);
    day = Number(m[1]);
    year = Number(m[3]!.length === 2 ? `20${m[3]}` : m[3]);
  } else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
  const key = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (TYPE_MAP[key]) return TYPE_MAP[key]!;
  for (const [k, v] of Object.entries(TYPE_MAP)) {
    if (key.startsWith(k)) return v;
  }
  if (/\b(buy|bought|purchase|purchased)\b/.test(key)) return "BUY";
  if (/\b(sell|sold|sale)\b/.test(key)) return "SELL";
  if (/\b(reinvest|reinvestment|drip)\b/.test(key)) return "DRIP";
  if (/\b(dividend|distribution|interest)\b/.test(key)) return "DIVIDEND";
  if (/\b(deposit|contribution|transfer in)\b/.test(key)) return "DEPOSIT";
  if (/\b(withdrawal|withdraw|transfer out)\b/.test(key)) return "WITHDRAWAL";
  if (/\b(fee|commission|service charge)\b/.test(key)) return "FEE";
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
  date: /^(trade|transaction|settlement|activity|process|posting|payment|execution)?\s*date(?:\s*\/\s*time)?$|^date$/i,
  type: /^(transaction\s*)?(type|action|activity|description|details|transaction description|transaction type|action type)$/i,
  symbol:
    /^(symbol|ticker|holding|instrument|security|stock|investment|security symbol|ticker symbol)$/i,
  quantity: /^(quantity|qty|shares|units|no\.? of shares|share quantity|quantity of shares)$/i,
  price: /^(price|unit price|price per (unit|share)|avg(erage)? price|trade price|share price)$/i,
  amount:
    /^(amount|net amount|gross amount|value|total|proceeds|net|cash amount|transaction amount)(\s+(cad|usd|currency))?$/i,
  debit: /^(debit|debit amount|withdrawal amount)$/i,
  credit: /^(credit|credit amount|deposit amount)$/i,
  fee: /^(fee|fees|commission|commissions|commission and fees|transaction fee)$/i,
  currency: /^(currency|ccy|cur|currency code)$/i,
  account: /^(account|portfolio|account name|account type|account number|account nickname)$/i,
  fx: /^(fx|fx rate|exchange rate|conversion rate|rate)$/i,
};

function normaliseHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_#]/g, " ")
    .replace(/[()[\].]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchHeader(cols: string[]): Record<string, number> | null {
  const map: Record<string, number> = {};
  cols.forEach((raw, i) => {
    const col = normaliseHeader(raw);
    for (const [field, re] of Object.entries(FIELDS)) {
      if (map[field] === undefined && re.test(col)) map[field] = i;
    }
  });
  if (map["date"] === undefined) return null;
  if (
    map["type"] === undefined &&
    map["amount"] === undefined &&
    map["debit"] === undefined &&
    map["credit"] === undefined
  )
    return null;
  return map;
}

function parseGeneric(text: string, fileName: string): CsvParseResult {
  const delimiter = detectDelimiter(text);
  const records = parseDelimited(text, delimiter);
  let header: Record<string, number> | null = null;
  let start = 0;
  for (let i = 0; i < Math.min(records.length, 40); i += 1) {
    const found = matchHeader(records[i]!);
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
  for (let i = start; i < records.length; i += 1) {
    const cols = records[i]!;
    const date = normaliseDate(at(cols, "date") ?? "");
    if (!date) {
      skipped += 1;
      continue;
    }
    const rawType = at(cols, "type") ?? "";
    const qty = toNumber(at(cols, "quantity"));
    const price = toNumber(at(cols, "price"));
    const debit = toNumber(at(cols, "debit"));
    const credit = toNumber(at(cols, "credit"));
    const amount =
      toNumber(at(cols, "amount")) ??
      (credit != null ? Math.abs(credit) : debit != null ? -Math.abs(debit) : null);
    const symbol = cleanSymbol(at(cols, "symbol"));
    const explicitType = normaliseType(rawType);
    // Use clear signed cash-flow columns only when the row has no action label.
    const type =
      explicitType ??
      (symbol && qty != null && amount != null
        ? amount < 0
          ? "BUY"
          : "SELL"
        : !symbol && amount != null
          ? amount < 0
            ? "WITHDRAWAL"
            : "DEPOSIT"
          : null);
    if (!type) {
      skipped += 1;
      continue;
    }
    const fx = toNumber(at(cols, "fx")) ?? 1;
    const currencyRaw = (at(cols, "currency") || (fx !== 1 ? "USD" : "CAD")).trim().toUpperCase();
    const currency = /^(USD|US\$|\$US|US DOLLAR)/.test(currencyRaw) ? "USD" : "CAD";
    const portfolio = (at(cols, "account") || "Imported").trim() || "Imported";
    const unitType = type === "BUY" || type === "SELL" || type === "DRIP" || type === "SPLIT";

    trades.push({
      portfolio,
      date,
      type,
      symbol,
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
  const cleanText = text.replace(/^\uFEFF/, "");
  if (/^\s*\[TRADES\]/m.test(cleanText)) return parsePortfolioTracker(cleanText);
  return parseGeneric(cleanText, fileName);
}
