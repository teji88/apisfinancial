/**
 * Market data provider abstraction.
 *
 * Primary source: CNBC's public quote service. It batches symbols in a single
 * request and covers both US listings (FNDX, SPY) and TSX listings (XIC.TO).
 * Yahoo's chart endpoint is kept as a per-symbol fallback, but it rate-limits
 * (HTTP 429) server-side traffic, so it is never relied on alone.
 * FX uses Frankfurter (ECB reference rates) with open.er-api.com as backup.
 *
 * A paid provider (FMP, Polygon, Alpha Vantage) can be dropped in by adding an
 * implementation below and returning it from getMarketProvider().
 */

export type ProviderQuote = {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  currency: string | null;
  name: string | null;
  /** Forward annual dividend per share, in the listing currency. */
  dividendRate?: number | null;
  /** Trailing/forward dividend yield in percent. */
  dividendYield?: number | null;
  /** Most recent or upcoming ex-dividend date (ISO). */
  exDivDate?: string | null;
  /** Per-share amount of that ex-dividend event. */
  exDivAmount?: number | null;
};

export interface MarketProvider {
  name: string;
  fetchQuotes(symbols: string[]): Promise<ProviderQuote[]>;
}

export const FX_SYMBOL = "USDCAD=X";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

function emptyQuote(symbol: string): ProviderQuote {
  return { symbol, price: null, previousClose: null, currency: null, name: null };
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type CnbcQuote = {
  symbol?: string;
  name?: string;
  last?: string;
  previous_day_closing?: string;
  currencyCode?: string;
  dividend?: string;
  dividendyield?: string;
  EventData?: { div_ex_date?: string; div_amount?: string };
};

/** CNBC returns MM/DD/YYYY; store ISO. */
function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

/** Batched quotes from CNBC (max ~50 symbols per call). */
async function cnbcQuotes(symbols: string[]): Promise<Map<string, ProviderQuote>> {
  const found = new Map<string, ProviderQuote>();
  if (symbols.length === 0) return found;
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(
    symbols.join("|"),
  )}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) {
      console.warn(`[market] cnbc -> HTTP ${res.status}`);
      return found;
    }
    const json = (await res.json()) as {
      FormattedQuoteResult?: { FormattedQuote?: CnbcQuote | CnbcQuote[] };
    };
    const raw = json.FormattedQuoteResult?.FormattedQuote;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const q of list) {
      const symbol = (q.symbol ?? "").toUpperCase();
      const price = num(q.last);
      if (!symbol || price == null) continue;
      found.set(symbol, {
        symbol,
        price,
        previousClose: num(q.previous_day_closing),
        currency: q.currencyCode ?? null,
        name: q.name ?? null,
        dividendRate: num(q.dividend),
        dividendYield: num(q.dividendyield),
        exDivDate: isoDate(q.EventData?.div_ex_date),
        exDivAmount: num(q.EventData?.div_amount),
      });
    }
  } catch (err) {
    console.warn(`[market] cnbc -> ${String(err)}`);
  }
  return found;
}

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        currency?: string;
        longName?: string;
        shortName?: string;
      };
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

/** Fallback: one symbol from Yahoo, trying both hosts. */
async function yahooQuote(symbol: string): Promise<ProviderQuote> {
  for (const host of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    try {
      const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=10d`;
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!res.ok) {
        console.warn(`[market] yahoo ${symbol} via ${host} -> HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as YahooChart;
      const result = json.chart?.result?.[0];
      const meta = result?.meta;
      if (!meta) continue;
      const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter(
        (c): c is number => typeof c === "number",
      );
      const price = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
      if (price == null) continue;
      return {
        symbol,
        price,
        previousClose:
          meta.previousClose ?? meta.chartPreviousClose ?? closes[closes.length - 2] ?? null,
        currency: meta.currency ?? null,
        name: meta.longName ?? meta.shortName ?? null,
      };
    } catch (err) {
      console.warn(`[market] yahoo ${symbol} via ${host} -> ${String(err)}`);
    }
  }
  return emptyQuote(symbol);
}

/** USD -> CAD from the ECB reference feed, with a second key-free backup. */
async function fetchUsdCad(): Promise<ProviderQuote> {
  const sources = [
    "https://api.frankfurter.app/latest?from=USD&to=CAD",
    "https://open.er-api.com/v6/latest/USD",
  ];
  for (const url of sources) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        console.warn(`[market] fx ${url} -> HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { rates?: { CAD?: number } };
      const rate = json.rates?.CAD;
      if (typeof rate === "number") {
        return {
          symbol: FX_SYMBOL,
          price: rate,
          previousClose: null,
          currency: "CAD",
          name: "US Dollar / Canadian Dollar",
        };
      }
    } catch (err) {
      console.warn(`[market] fx ${url} -> ${String(err)}`);
    }
  }
  return emptyQuote(FX_SYMBOL);
}

const defaultProvider: MarketProvider = {
  name: "cnbc+frankfurter",
  async fetchQuotes(symbols) {
    const { feedSymbol } = await import("./history.server");
    const wanted = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
    const tickers = wanted.filter((s) => s !== FX_SYMBOL);
    const out: ProviderQuote[] = [];

    // Broker exports carry exchange prefixes (NASD:PUBM); the quote services
    // only know the plain ticker, so we look that up and answer under the
    // symbol the user actually holds.
    const lookup = new Map(tickers.map((s) => [s, feedSymbol(s)]));
    const feeds = Array.from(new Set(lookup.values()));

    // Batched primary source, in chunks so a long holdings list still works.
    const found = new Map<string, ProviderQuote>();
    for (let i = 0; i < feeds.length; i += 40) {
      const batch = await cnbcQuotes(feeds.slice(i, i + 40));
      batch.forEach((quote, symbol) => found.set(symbol, quote));
    }

    for (const symbol of tickers) {
      const feed = lookup.get(symbol) ?? symbol;
      const hit = found.get(feed) ?? (feed === symbol ? null : found.get(symbol));
      const quote = hit ?? (await yahooQuote(feed));
      out.push({ ...quote, symbol });
    }

    if (wanted.includes(FX_SYMBOL)) {
      const fx = await fetchUsdCad();
      out.push(fx.price != null ? fx : await yahooQuote(FX_SYMBOL));
    }

    return out;
  },
};


export function getMarketProvider(): MarketProvider {
  // Future providers (FMP, Polygon, Alpha Vantage) register here.
  return defaultProvider;
}

/** Shared refresh used by the app and by the daily scheduled job. */
export async function refreshPrices(symbols: string[]): Promise<{
  quotes: ProviderQuote[];
  saved: number;
  asOf: string;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const wanted = Array.from(
    new Set([...symbols.map((s) => s.trim().toUpperCase()).filter(Boolean), FX_SYMBOL]),
  );
  const quotes = await getMarketProvider().fetchQuotes(wanted);
  const asOf = new Date().toISOString().slice(0, 10);
  const rows = quotes
    .filter((q) => q.price != null)
    .map((q) => ({
      symbol: q.symbol.toUpperCase(),
      price: q.price,
      previous_close: q.previousClose,
      currency: q.currency,
      name: q.name,
      dividend_rate: q.dividendRate ?? null,
      dividend_yield: q.dividendYield ?? null,
      div_ex_date: q.exDivDate ?? null,
      div_amount: q.exDivAmount ?? null,
      as_of: asOf,
      updated_at: new Date().toISOString(),
    }));
  if (rows.length > 0) {
    const { error } = await supabaseAdmin
      .from("price_cache")
      .upsert(rows, { onConflict: "symbol" });
    if (error) console.error(`[market] price_cache upsert failed: ${error.message}`);
  }
  return { quotes, saved: rows.length, asOf };
}
