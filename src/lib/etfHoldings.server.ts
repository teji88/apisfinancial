/**
 * ETF holdings: fetch the issuer's own published holdings file, parse it,
 * and store it in the shared `etf_holdings` library (like price_history:
 * fetched once, reused by every user).
 *
 * Source today: iShares' holdings CSV, one adapter for every iShares ETF;
 * Schwab's paginated holdings HTML (FNDX); and Vanguard US's holdings
 * JSON API (VGK as a proxy for the Canadian VE.TO, whose own issuer
 * publishes no full holdings file). Each file is fetched server-side
 * with a browser user agent; if the issuer answers with a web page
 * instead of the file (bot gating), the fetch reports `unavailable`
 * and the old rows stay — never replaced with a bad parse. Other
 * issuers (SPDR, Franklin) get their own adapter in this module
 * when their file shape is verified.
 *
 * Symbols are stored in app form: TSX listings carry the `.TO` suffix
 * (XEQT.TO, RY.TO), US listings are bare (AAPL, ITOT), so stored
 * underlying symbols merge with the user's own positions.
 */
import { normaliseDate, parseCsvTable, toNumber } from "./csv-parse";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Holdings are refreshed when the stored as-of is older than this. */
export const ETF_HOLDINGS_STALE_DAYS = 90;

export type EtfHoldingInput = {
  symbol: string;
  name: string;
  /** Fraction of the ETF's net assets, 0..1. */
  weight: number;
};

export type EtfFetchResult =
  | { status: "ok"; asOf: string; rows: EtfHoldingInput[]; source: string }
  | { status: "unsupported" | "unavailable"; reason: string };

type ISharesFund = {
  /** "ca/en" for TSX-listed funds, "us" for US-listed funds. */
  locale: string;
  /** Product id from the fund's page URL, when known. */
  productId?: string;
  /** URL slug derived from the fund's official name. */
  slug: string;
};

/**
 * iShares funds the adapter knows. Product ids are only known for the
 * funds already looked up; the rest use the slug-only holdings URL.
 * Add a product id here when it is looked up from the fund's page.
 */
export const ISHARES_FUNDS: Record<string, ISharesFund> = {
  XEQT: { locale: "ca/en", productId: "308188", slug: "ishares-core-equity-etf-portfolio" },
  XIC: {
    locale: "ca/en",
    productId: "239837",
    slug: "ishares-core-sp-tsx-capped-composite-index-etf",
  },
  XEF: { locale: "ca/en", slug: "ishares-core-msci-eafe-imi-index-etf" },
  XEC: { locale: "ca/en", slug: "ishares-core-msci-emerging-markets-imi-index-etf" },
  XTOT: { locale: "ca/en", slug: "ishares-core-sp-total-us-stock-market-index-etf" },
  ITOT: { locale: "us", slug: "ishares-core-sp-total-us-stock-market-etf" },
  IWR: { locale: "us", slug: "ishares-russell-midcap-etf" },
  IVV: { locale: "us", productId: "239726", slug: "ishares-core-sp-500-etf" },
};

/** Strip a broker-style exchange prefix (TSX:RY, NASD:AAPL) to a plain ticker. */
function stripExchangePrefix(raw: string): string {
  const s = raw.trim().toUpperCase();
  const m = /^([A-Z]{2,6}):(.+)$/.exec(s);
  if (!m) return s;
  const exchange = m[1]!;
  const ticker = m[2]!;
  if (exchange === "TSX" || exchange === "TSE" || exchange === "TOR") return `${ticker}.TO`;
  if (exchange === "CVE" || exchange === "TSXV") return `${ticker}.V`;
  return ticker;
}

/**
 * Normalise an underlying holding's ticker to app form. Canadian listings
 * (Location Canada or a Toronto exchange) take the `.TO` suffix so they
 * merge with the user's own TSX positions; everything else stays bare.
 */
export function normalizeUnderlyingSymbol(
  ticker: string,
  location: string,
  exchange: string,
): string {
  const s = stripExchangePrefix(ticker);
  if (/\.TO$|\.V$|\.NE$/.test(s)) return s;
  const loc = location.trim().toLowerCase();
  const exch = exchange.trim().toLowerCase();
  if (loc === "canada" || exch.includes("toronto")) return `${s}.TO`;
  return s;
}

/** App-form symbol for a bare ETF ticker (TSX-listed funds take `.TO`). */
export function appFormEtfSymbol(bareSymbol: string, locale: string): string {
  const s = stripExchangePrefix(bareSymbol);
  if (locale.startsWith("ca/")) return s.endsWith(".TO") ? s : `${s}.TO`;
  return s;
}

/** Bare adapter symbol for an app-form ETF ticker (XEQT.TO -> XEQT). */
export function bareEtfSymbol(appSymbol: string): string {
  return stripExchangePrefix(appSymbol).replace(/\.TO$/i, "");
}

function holdingsUrl(fund: ISharesFund, bareSymbol: string): string {
  const base = `https://www.ishares.com/${fund.locale}/products`;
  if (fund.productId) {
    return `${base}/${fund.productId}/${fund.slug}/1467271812596.ajax?fileType=csv&fileName=${bareSymbol}_holdings&dataType=fund`;
  }
  return `${base}/${fund.slug}/1467271812596.ajax?fileType=csv&dataType=fund`;
}

const CASH_TICKERS = new Set(["CAD", "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "NZD"]);

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

function parseAsOf(rows: string[][]): string | null {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const joined = row.join(" ");
    if (!/fund holdings as of/i.test(joined)) continue;
    // The date may sit in the same row or the next one, month-first
    // ("Nov 12, 2026") or day-first ("12 Nov 2026").
    const text = `${joined} ${(rows[i + 1] ?? []).join(" ")}`;
    const monthFirst = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
    if (monthFirst) {
      const mo = MONTHS[monthFirst[1]!.toLowerCase().slice(0, 3)];
      if (mo) return `${monthFirst[3]}-${mo}-${monthFirst[2]!.padStart(2, "0")}`;
    }
    const dayFirst = /(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/.exec(text);
    if (dayFirst) return normaliseDate(dayFirst[0]);
  }
  return null;
}

/**
 * Parse an iShares holdings CSV (preamble + header row + holdings rows).
 * Keeps equity rows only; cash and bonds are left out so they surface as
 * the unmapped remainder instead of fake "stocks". Returns null when the
 * text is not a holdings file at all.
 */
export function parseISharesHoldingsCsv(
  csvText: string,
): { asOf: string; rows: EtfHoldingInput[] } | null {
  const table = parseCsvTable(csvText);
  if (table.length === 0) return null;
  const headerIdx = table.findIndex((r) => {
    const first = (r[0] ?? "").trim().toLowerCase();
    return first === "ticker" || first === "symbol";
  });
  if (headerIdx < 0) return null;
  const header = table[headerIdx]!.map((h) => h.trim().toLowerCase());
  const col = (names: string[]): number => header.findIndex((h) => names.includes(h));
  const tickerCol = col(["ticker", "symbol"]);
  const weightCol = col(["weight (%)", "% net assets"]);
  if (tickerCol < 0 || weightCol < 0) return null;
  const nameCol = col(["name", "security name"]);
  const assetCol = col(["asset class"]);
  const locationCol = col(["location"]);
  const exchangeCol = col(["exchange"]);

  const asOf = parseAsOf(table.slice(0, headerIdx));
  if (!asOf) return null;

  const rows: EtfHoldingInput[] = [];
  for (let i = headerIdx + 1; i < table.length; i += 1) {
    const cells = table[i]!;
    const ticker = (cells[tickerCol] ?? "").trim();
    if (!ticker) continue;
    const weightPct = toNumber(cells[weightCol]);
    if (weightPct == null || weightPct <= 0 || weightPct > 100) continue;
    const assetClass = assetCol >= 0 ? (cells[assetCol] ?? "").trim().toLowerCase() : "";
    if (assetClass && assetClass !== "equity") continue;
    if (!assetClass && CASH_TICKERS.has(ticker.toUpperCase())) continue;
    const location = locationCol >= 0 ? (cells[locationCol] ?? "") : "";
    const exchange = exchangeCol >= 0 ? (cells[exchangeCol] ?? "") : "";
    rows.push({
      symbol: normalizeUnderlyingSymbol(ticker, location, exchange),
      name: nameCol >= 0 ? (cells[nameCol] ?? "").trim() : "",
      // Round to 6dp so 4.10% stores as exactly 0.041, not float dust.
      weight: Math.round((weightPct / 100) * 1e6) / 1e6,
    });
  }
  if (rows.length === 0) return null;
  return { asOf, rows };
}

async function fetchText(
  url: string,
  accept: string,
): Promise<{ text: string; contentType: string } | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept } });
      if (!res.ok) continue;
      const text = await res.text();
      return { text, contentType: res.headers.get("content-type") ?? "" };
    } catch {
      /* retry once */
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

/** Equity rows should cover most of a pure-equity fund's net assets. */
const MAPPED_WEIGHT_MIN = 0.8;
const MAPPED_WEIGHT_MAX = 1.02;

async function fetchISharesHoldings(bareSymbol: string): Promise<EtfFetchResult> {
  const fund = ISHARES_FUNDS[bareSymbol];
  if (!fund) return { status: "unsupported", reason: `no iShares adapter entry for ${bareSymbol}` };
  const fetched = await fetchText(holdingsUrl(fund, bareSymbol), "text/csv");
  if (!fetched) return { status: "unavailable", reason: "holdings file request failed" };
  const { text, contentType } = fetched;
  if (
    /text\/html/i.test(contentType) ||
    /^\s*<!doctype html/i.test(text) ||
    /^\s*<html/i.test(text)
  ) {
    return {
      status: "unavailable",
      reason: "issuer returned a web page instead of the holdings file",
    };
  }
  const parsed = parseISharesHoldingsCsv(text);
  if (!parsed) return { status: "unavailable", reason: "holdings file could not be parsed" };
  const mapped = parsed.rows.reduce((s, r) => s + r.weight, 0);
  if (mapped < MAPPED_WEIGHT_MIN || mapped > MAPPED_WEIGHT_MAX) {
    return {
      status: "unavailable",
      reason: `parsed equity weights sum to ${(mapped * 100).toFixed(1)}%, outside the sane band`,
    };
  }
  return { status: "ok", asOf: parsed.asOf, rows: parsed.rows, source: "ishares" };
}

// ------------------------------------------------------------ Schwab (HTML)

/**
 * Schwab funds the adapter knows, by bare ticker. Schwab publishes no
 * holdings file — the list is paginated HTML tables at
 * schwabassetmanagement.com/allholdings/<TICKER>?page=N (0-based,
 * 100 rows a page). Verified for FNDX 2026-11-14: 8 pages, 732 rows,
 * columns Fund Name / CUSIP / Symbol / Quantity / % of Assets /
 * Market Value, as-of line "As of 11/12/26".
 */
export const SCHWAB_FUNDS = new Set(["FNDX"]);

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function parseSchwabAsOf(html: string): string | null {
  const m = /As of\s+(\d{1,2})\/(\d{1,2})\/(\d{2})\b/.exec(html);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = 2000 + Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse one Schwab holdings page (HTML table). Keeps equity rows only;
 * the cash row (USD) and the futures row (e.g. S&P500 EMINI) are left
 * out so they surface as the unmapped remainder. Returns null when the
 * text holds no holdings table at all. The table is found by its header
 * row, not by tag attributes — the browser view never exposed those.
 */
export function parseSchwabHoldingsHtml(
  html: string,
): { asOf: string; rows: EtfHoldingInput[] } | null {
  const asOf = parseSchwabAsOf(html);
  if (!asOf) return null;
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const table of tables) {
    const body = table[1]!;
    const rowHtml = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => r[1]!);
    const headerIdx = rowHtml.findIndex((r) => {
      const cells = [...r.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((c) =>
        stripTags(c[1]!).toLowerCase(),
      );
      return cells.includes("symbol") && cells.some((c) => c.includes("% of assets"));
    });
    if (headerIdx < 0) continue;
    const headerCells = [
      ...rowHtml[headerIdx]!.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi),
    ].map((c) => stripTags(c[1]!).toLowerCase());
    const symbolCol = headerCells.indexOf("symbol");
    const weightCol = headerCells.findIndex((c) => c.includes("% of assets"));
    const nameCol = headerCells.indexOf("fund name");
    if (symbolCol < 0 || weightCol < 0) continue;
    const rows: EtfHoldingInput[] = [];
    for (let i = headerIdx + 1; i < rowHtml.length; i += 1) {
      const cells = [...rowHtml[i]!.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(
        (c) => stripTags(c[1]!),
      );
      const symbol = (cells[symbolCol] ?? "").trim().toUpperCase();
      if (!symbol) continue;
      if (CASH_TICKERS.has(symbol)) continue;
      const name = nameCol >= 0 ? (cells[nameCol] ?? "").trim() : "";
      if (/emini|future/i.test(name)) continue;
      const weightPct = toNumber((cells[weightCol] ?? "").replace("%", ""));
      if (weightPct == null || weightPct <= 0 || weightPct > 100) continue;
      rows.push({
        symbol,
        name,
        weight: Math.round((weightPct / 100) * 1e6) / 1e6,
      });
    }
    if (rows.length > 0) return { asOf, rows };
  }
  return null;
}

const SCHWAB_PAGE_SIZE = 100;
const SCHWAB_MAX_PAGES = 20;

async function fetchSchwabHoldings(bareSymbol: string): Promise<EtfFetchResult> {
  if (!SCHWAB_FUNDS.has(bareSymbol)) {
    return { status: "unsupported", reason: `no Schwab adapter entry for ${bareSymbol}` };
  }
  const rows: EtfHoldingInput[] = [];
  const seen = new Set<string>();
  let asOf: string | null = null;
  for (let page = 0; page < SCHWAB_MAX_PAGES; page += 1) {
    const fetched = await fetchText(
      `https://www.schwabassetmanagement.com/allholdings/${bareSymbol}?page=${page}`,
      "text/html",
    );
    if (!fetched) return { status: "unavailable", reason: "holdings page request failed" };
    const parsed = parseSchwabHoldingsHtml(fetched.text);
    if (!parsed) {
      return { status: "unavailable", reason: "holdings page could not be parsed" };
    }
    if (!asOf) asOf = parsed.asOf;
    for (const row of parsed.rows) {
      if (seen.has(row.symbol)) continue;
      seen.add(row.symbol);
      rows.push(row);
    }
    // The last page is short; a full page means there may be more.
    if (parsed.rows.length < SCHWAB_PAGE_SIZE) break;
  }
  if (!asOf || rows.length === 0) {
    return { status: "unavailable", reason: "holdings pages could not be parsed" };
  }
  const mapped = rows.reduce((s, r) => s + r.weight, 0);
  if (mapped < MAPPED_WEIGHT_MIN || mapped > MAPPED_WEIGHT_MAX) {
    return {
      status: "unavailable",
      reason: `parsed equity weights sum to ${(mapped * 100).toFixed(1)}%, outside the sane band`,
    };
  }
  return { status: "ok", asOf, rows, source: "schwab" };
}

// ------------------------------------------------------------ Vanguard (JSON)

/**
 * Canadian ETFs whose holdings come from a US twin tracking the same
 * index, by bare ticker. Vanguard Canada publishes no full holdings
 * file for VE.TO (top 10 only); the US twin VGK tracks the same FTSE
 * Developed Europe All Cap index, and its weights match VE.TO's at the
 * top almost exactly — close proxy, not exact. Approved by Gurteg
 * 2026-11-14; the stored source names the proxy so it is never
 * mistaken for VE.TO's own file.
 */
export const VANGUARD_PROXY_FUNDS: Record<string, string> = {
  VE: "VGK",
};

/**
 * Parse a Vanguard US holdings JSON payload (fund.entity[]). Weights are
 * computed from marketValue (exact) rather than the rounded
 * percentWeight. Tickers are exchange-scoped and NOT unique: the same
 * bare ticker can be two companies (SAN = Santander ES0113900J37 and
 * Sanofi FR0000120578), so a repeat ticker in one fund is suffixed with
 * its ISIN country code (SAN, SAN-FR); a row with no ticker at all is
 * keyed by its ISIN. Returns null when the payload is not holdings JSON.
 */
export function parseVanguardHoldingsJson(
  jsonText: string,
): { asOf: string; rows: EtfHoldingInput[] } | null {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const root = data as Record<string, unknown>;
  const asOfRaw = typeof root["asOfDate"] === "string" ? root["asOfDate"] : null;
  if (!asOfRaw) return null;
  const asOf = asOfRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  const fund = root["fund"] as Record<string, unknown> | undefined;
  const entities = Array.isArray(fund?.["entity"]) ? (fund["entity"] as unknown[]) : [];
  if (entities.length === 0) return null;
  const seenTickers = new Map<string, number>();
  const valued: Array<{ symbol: string; name: string; marketValue: number }> = [];
  let percentSum = 0;
  for (const e of entities) {
    if (typeof e !== "object" || e === null) continue;
    const row = e as Record<string, unknown>;
    const marketValue = typeof row["marketValue"] === "number" ? row["marketValue"] : NaN;
    if (!Number.isFinite(marketValue) || marketValue <= 0) continue;
    const percent =
      typeof row["percentWeight"] === "string" ? toNumber(row["percentWeight"]) : null;
    if (percent != null) percentSum += percent / 100;
    const isin = typeof row["isin"] === "string" ? row["isin"].trim().toUpperCase() : "";
    const rawTicker = typeof row["ticker"] === "string" ? row["ticker"].trim().toUpperCase() : "";
    const name = String(row["longName"] ?? row["shortName"] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    let symbol: string;
    if (!rawTicker) {
      if (!isin) continue;
      symbol = isin;
    } else {
      const count = (seenTickers.get(rawTicker) ?? 0) + 1;
      seenTickers.set(rawTicker, count);
      symbol = count === 1 ? rawTicker : `${rawTicker}-${isin.slice(0, 2) || "XX"}`;
    }
    valued.push({ symbol, name, marketValue });
  }
  if (valued.length === 0) return null;
  if (percentSum < MAPPED_WEIGHT_MIN || percentSum > MAPPED_WEIGHT_MAX) return null;
  const total = valued.reduce((s, r) => s + r.marketValue, 0);
  if (total <= 0) return null;
  return {
    asOf,
    rows: valued.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      weight: Math.round((r.marketValue / total) * 1e6) / 1e6,
    })),
  };
}

async function fetchVanguardHoldings(proxyTicker: string): Promise<EtfFetchResult> {
  const fetched = await fetchText(
    `https://investor.vanguard.com/vmf/api/${proxyTicker}/portfolio-holding/stock.json?start=1&count=20000`,
    "application/json",
  );
  if (!fetched) return { status: "unavailable", reason: "holdings request failed" };
  if (/^\s*</.test(fetched.text)) {
    return {
      status: "unavailable",
      reason: "issuer returned a web page instead of holdings JSON",
    };
  }
  const parsed = parseVanguardHoldingsJson(fetched.text);
  if (!parsed) return { status: "unavailable", reason: "holdings JSON could not be parsed" };
  return {
    status: "ok",
    asOf: parsed.asOf,
    rows: parsed.rows,
    source: `vanguard-us-${proxyTicker.toLowerCase()}-proxy`,
  };
}

/** Fetch one ETF's holdings from its issuer, by app-form symbol. */
export async function fetchEtfHoldings(appSymbol: string): Promise<EtfFetchResult> {
  const bare = bareEtfSymbol(appSymbol);
  if (ISHARES_FUNDS[bare]) return fetchISharesHoldings(bare);
  if (SCHWAB_FUNDS.has(bare)) return fetchSchwabHoldings(bare);
  const proxy = VANGUARD_PROXY_FUNDS[bare];
  if (proxy) return fetchVanguardHoldings(proxy);
  return { status: "unsupported", reason: `no holdings adapter for ${bare} yet` };
}

// ------------------------------------------------------------ shared store

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type EtfRefreshOutcome = {
  symbol: string;
  status: "ok" | "fresh" | "unavailable" | "unsupported";
  asOf: string | null;
  count: number;
  mappedWeight: number;
  reason?: string;
};

const today = () => new Date().toISOString().slice(0, 10);

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

async function readMaxAsOf(symbols: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (symbols.length === 0) return out;
  const db = await admin();
  const { data } = await db
    .from("etf_holdings")
    .select("etf_symbol, as_of")
    .in("etf_symbol", symbols);
  for (const row of (data ?? []) as Array<{ etf_symbol: string; as_of: string }>) {
    const prev = out.get(row.etf_symbol);
    if (!prev || row.as_of > prev) out.set(row.etf_symbol, row.as_of);
  }
  return out;
}

async function storeHoldings(
  appSymbol: string,
  asOf: string,
  source: string,
  rows: EtfHoldingInput[],
): Promise<void> {
  const db = await admin();
  const { error: delError } = await db.from("etf_holdings").delete().eq("etf_symbol", appSymbol);
  if (delError) {
    console.error(`[etf-holdings] clear ${appSymbol}: ${delError.message}`);
    return;
  }
  const chunk = 800;
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk).map((r) => ({
      etf_symbol: appSymbol,
      underlying_symbol: r.symbol,
      underlying_name: r.name,
      weight: r.weight,
      as_of: asOf,
      source,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await db.from("etf_holdings").upsert(batch, {
      onConflict: "etf_symbol,underlying_symbol",
    });
    if (error) console.error(`[etf-holdings] store ${appSymbol}: ${error.message}`);
  }
}

/**
 * Refresh holdings for the given ETF symbols (app form, e.g. XEQT.TO).
 * ETFs whose stored as-of is within the stale window are skipped as
 * fresh. A failed fetch leaves the old rows in place.
 */
export async function refreshEtfHoldings(symbols: string[]): Promise<EtfRefreshOutcome[]> {
  const wanted = Array.from(
    new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ).slice(0, 50);
  const maxAsOf = await readMaxAsOf(wanted);
  const out: EtfRefreshOutcome[] = [];
  const now = today();
  for (const symbol of wanted) {
    const prev = maxAsOf.get(symbol);
    if (prev && daysBetween(prev, now) <= ETF_HOLDINGS_STALE_DAYS) {
      out.push({ symbol, status: "fresh", asOf: prev, count: 0, mappedWeight: 0 });
      continue;
    }
    const fetched = await fetchEtfHoldings(symbol);
    if (fetched.status !== "ok") {
      out.push({
        symbol,
        status: fetched.status,
        asOf: prev ?? null,
        count: 0,
        mappedWeight: 0,
        reason: fetched.reason,
      });
      continue;
    }
    await storeHoldings(symbol, fetched.asOf, fetched.source, fetched.rows);
    out.push({
      symbol,
      status: "ok",
      asOf: fetched.asOf,
      count: fetched.rows.length,
      mappedWeight: fetched.rows.reduce((s, r) => s + r.weight, 0),
    });
  }
  return out;
}

/** True when any adapter knows this ETF (bare ticker), across issuers. */
function isKnownEtf(bareSymbol: string): boolean {
  return Boolean(
    ISHARES_FUNDS[bareSymbol] || SCHWAB_FUNDS.has(bareSymbol) || VANGUARD_PROXY_FUNDS[bareSymbol],
  );
}

export type StoredEtfHoldings = Record<string, { asOf: string | null; rows: EtfHoldingInput[] }>;

/**
 * Read stored holdings for a set of ETFs, expanding the frontier through
 * sub-ETFs (funds of funds) up to three levels. Symbols with no stored
 * rows get an empty entry when they are a known ETF, so the look-through
 * treats them as "no data" rather than as stocks.
 */
export async function readEtfHoldingsMap(symbols: string[]): Promise<StoredEtfHoldings> {
  const map: StoredEtfHoldings = {};
  const wanted = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
  if (wanted.length === 0) return map;
  const db = await admin();
  const seen = new Set<string>();
  let frontier = [...wanted];
  for (let depth = 0; depth < 3 && frontier.length > 0; depth += 1) {
    const batch = frontier.filter((s) => !seen.has(s));
    for (const s of batch) seen.add(s);
    if (batch.length === 0) break;
    const { data } = await db
      .from("etf_holdings")
      .select("etf_symbol, underlying_symbol, underlying_name, weight, as_of")
      .in("etf_symbol", batch);
    const next = new Set<string>();
    for (const row of (data ?? []) as Array<{
      etf_symbol: string;
      underlying_symbol: string;
      underlying_name: string;
      weight: number | string;
      as_of: string;
    }>) {
      const entry = (map[row.etf_symbol] ??= { asOf: null, rows: [] });
      if (!entry.asOf || row.as_of > entry.asOf) entry.asOf = row.as_of;
      entry.rows.push({
        symbol: row.underlying_symbol,
        name: row.underlying_name ?? "",
        weight: Number(row.weight),
      });
      const bare = bareEtfSymbol(row.underlying_symbol);
      if (isKnownEtf(bare) && !seen.has(row.underlying_symbol.toUpperCase())) {
        next.add(row.underlying_symbol.toUpperCase());
      }
    }
    frontier = [...next];
  }
  // Empty entries for known ETFs with no stored rows — including sub-ETFs
  // discovered in another fund's rows — so the look-through treats them
  // as "no data" rather than as stocks.
  for (const symbol of seen) {
    if (!map[symbol] && isKnownEtf(bareEtfSymbol(symbol))) {
      map[symbol] = { asOf: null, rows: [] };
    }
  }
  return map;
}
