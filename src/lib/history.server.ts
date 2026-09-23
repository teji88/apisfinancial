/**
 * Historical daily closes for benchmarking.
 *
 * Prices are served from our own shared library in the database. Anything we
 * have never fetched (or any gap at either end of the window) is pulled once
 * from the upstream source, stored, and reused by every user from then on.
 *
 * Upstream sources: US-listed symbols from Nasdaq (10 years max), TSX (.TO)
 * symbols from TMX (25+ years), and USD/CAD from the ECB via Frankfurter.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type HistoryPoint = { date: string; close: number };
export type SymbolHistory = { symbol: string; currency: string; points: HistoryPoint[] };

const memory = new Map<string, { at: number; value: SymbolHistory | null }>();
const fxMemory = new Map<string, { at: number; value: HistoryPoint[] }>();
const MEM_TTL = 30 * 60 * 1000;

/** A stored series is considered current if its last close is within this many days. */
const FRESH_DAYS = 4;
/** How far back we try to build the library on the first fetch of a symbol. */
const TSX_YEARS = 25;
const US_YEARS = 10;

const today = () => new Date().toISOString().slice(0, 10);

function shiftDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function num(raw: string): number | null {
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isoFromUs(value: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

/** Run tasks with a bounded number in flight so we don't burst upstream APIs. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchRetry(input: string, init?: RequestInit): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.ok) return res;
    } catch {
      /* retry once */
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

// ---------------------------------------------------------------- upstream

/**
 * Broker exports often prefix a ticker with its exchange (NASD:PUBM, CVE:DE,
 * TSX:BCE). The price feeds only understand the plain ticker, with `.TO` for
 * Canadian listings, so the prefix is translated away before any lookup.
 */
export function feedSymbol(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  const m = /^([A-Z]{2,6}):(.+)$/.exec(s);
  if (!m) return s;
  const exchange = m[1]!;
  const ticker = m[2]!;
  if (exchange === "TSX" || exchange === "TSE" || exchange === "TOR") return `${ticker}.TO`;
  if (exchange === "CVE" || exchange === "TSXV") return `${ticker}.V`;
  return ticker; // NASD, NASDAQ, NYSE, AMEX, ARCA, BATS…
}

async function fetchTmx(symbol: string, start: string, end: string): Promise<SymbolHistory | null> {
  // TMX writes trust units as BEP.UN, while exports often use BEP-UN.
  const base = symbol
    .replace(/\.TO$/i, "")
    .toUpperCase()
    .replace(/-(UN|U)$/, ".$1");

  const res = await fetchRetry("https://app-money.tmx.com/graphql", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json", locale: "en" },
    body: JSON.stringify({
      operationName: "getTimeSeriesData",
      variables: { symbol: `${base}:CA`, freq: "day", interval: 1, start, end },
      query:
        "query getTimeSeriesData($symbol: String!, $freq: String, $interval: Int, $start: String, $end: String) { getTimeSeriesData(symbol: $symbol, freq: $freq, interval: $interval, start: $start, end: $end) { dateTime close } }",
    }),
  });
  if (!res) return null;
  try {
    const json = (await res.json()) as {
      data?: { getTimeSeriesData?: Array<{ dateTime: string; close: number }> | null };
    };
    const rows = json.data?.getTimeSeriesData ?? [];
    const points: HistoryPoint[] = [];
    for (const row of rows) {
      const date = String(row.dateTime ?? "").slice(0, 10);
      const close = Number(row.close);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0) {
        points.push({ date, close });
      }
    }
    if (points.length === 0) return null;
    points.sort((a, b) => a.date.localeCompare(b.date));
    return { symbol: symbol.toUpperCase(), currency: "CAD", points };
  } catch {
    return null;
  }
}

async function fetchNasdaq(
  symbol: string,
  start: string,
  end: string,
): Promise<SymbolHistory | null> {
  for (const assetclass of ["etf", "stocks"]) {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(
      symbol.toUpperCase(),
    )}/historical?assetclass=${assetclass}&fromdate=${start}&todate=${end}&limit=99999`;
    const res = await fetchRetry(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res) continue;
    try {
      const json = (await res.json()) as {
        data?: { tradesTable?: { rows?: Array<{ date: string; close: string }> | null } | null };
      };
      const rows = json.data?.tradesTable?.rows ?? [];
      const points: HistoryPoint[] = [];
      for (const row of rows) {
        const date = isoFromUs(String(row.date ?? ""));
        const close = num(String(row.close ?? ""));
        if (date && close != null && close > 0) points.push({ date, close });
      }
      if (points.length === 0) continue;
      points.sort((a, b) => a.date.localeCompare(b.date));
      return { symbol: symbol.toUpperCase(), currency: "USD", points };
    } catch {
      /* try next asset class */
    }
  }
  return null;
}

const isTsx = (symbol: string) => /\.TO$/i.test(symbol);

async function fetchUpstream(
  symbol: string,
  start: string,
  end: string,
): Promise<SymbolHistory | null> {
  return isTsx(symbol) ? fetchTmx(symbol, start, end) : fetchNasdaq(symbol, start, end);
}

// ------------------------------------------------------------ shared store

type Coverage = {
  symbol: string;
  currency: string;
  first_date: string | null;
  last_date: string | null;
  unavailable: boolean;
  checked_at: string;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function readCoverage(symbol: string): Promise<Coverage | null> {
  const db = await admin();
  const { data } = await db
    .from("price_history_coverage")
    .select("symbol, currency, first_date, last_date, unavailable, checked_at")
    .eq("symbol", symbol)
    .maybeSingle();
  return (data as Coverage | null) ?? null;
}


async function storePoints(symbol: string, currency: string, points: HistoryPoint[]) {
  if (points.length === 0) return;
  const db = await admin();
  const chunk = 800;
  for (let i = 0; i < points.length; i += chunk) {
    const rows = points.slice(i, i + chunk).map((p) => ({
      symbol,
      date: p.date,
      close: p.close,
      currency,
    }));
    const { error } = await db.from("price_history").upsert(rows, { onConflict: "symbol,date" });
    if (error) console.error(`[history] store ${symbol}: ${error.message}`);
  }
}

async function writeCoverage(
  symbol: string,
  currency: string,
  first: string | null,
  last: string | null,
  unavailable: boolean,
) {
  const db = await admin();
  const existing = await readCoverage(symbol);
  const firstDate =
    existing?.first_date && first ? (existing.first_date < first ? existing.first_date : first) : (first ?? existing?.first_date ?? null);
  const lastDate =
    existing?.last_date && last ? (existing.last_date > last ? existing.last_date : last) : (last ?? existing?.last_date ?? null);
  const { error } = await db.from("price_history_coverage").upsert(
    {
      symbol,
      currency,
      first_date: firstDate,
      last_date: lastDate,
      unavailable,
      checked_at: new Date().toISOString(),
    },
    { onConflict: "symbol" },
  );
  if (error) console.error(`[history] coverage ${symbol}: ${error.message}`);
}

/** All coverage rows for a set of symbols in one round-trip. */
async function readCoverageMany(symbols: string[]): Promise<Map<string, Coverage>> {
  const out = new Map<string, Coverage>();
  if (symbols.length === 0) return out;
  const db = await admin();
  const chunk = 200;
  for (let i = 0; i < symbols.length; i += chunk) {
    const { data } = await db
      .from("price_history_coverage")
      .select("symbol, currency, first_date, last_date, unavailable, checked_at")
      .in("symbol", symbols.slice(i, i + chunk));
    for (const row of (data ?? []) as Coverage[]) out.set(String(row.symbol).toUpperCase(), row);
  }
  return out;
}

/** Every stored close for a set of symbols over a window, in one paged query. */
async function readStoredMany(
  symbols: string[],
  start: string,
  end: string,
): Promise<Map<string, HistoryPoint[]>> {
  const out = new Map<string, HistoryPoint[]>();
  if (symbols.length === 0) return out;
  const db = await admin();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("price_history")
      .select("symbol, date, close")
      .in("symbol", symbols)
      .gte("date", start)
      .lte("date", end)
      .order("symbol", { ascending: true })
      .order("date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      const close = Number(row.close);
      if (!Number.isFinite(close) || close <= 0) continue;
      const key = String(row.symbol).toUpperCase();
      const list = out.get(key) ?? [];
      list.push({ date: String(row.date), close });
      out.set(key, list);
    }
    if (data.length < pageSize) break;
  }
  return out;
}

type Need = { needsBack: boolean; needsForward: boolean; recentlyChecked: boolean; giveUp: boolean };

function assess(coverage: Coverage | null, start: string): Need {
  const now = today();
  const needsBack = !coverage?.first_date || coverage.first_date > start;
  const needsForward = !coverage?.last_date || coverage.last_date < shiftDays(now, -FRESH_DAYS);
  const recentlyChecked =
    coverage != null && Date.now() - new Date(coverage.checked_at).getTime() < 6 * 60 * 60 * 1000;
  return { needsBack, needsForward, recentlyChecked, giveUp: coverage?.unavailable === true && recentlyChecked };
}

/** Pull the missing part of a series from upstream and add it to the library. */
async function topUp(
  feed: string,
  coverage: Coverage | null,
  start: string,
): Promise<SymbolHistory | null> {
  const now = today();
  const currency = coverage?.currency ?? (isTsx(feed) ? "CAD" : "USD");
  const need = assess(coverage, start);
  const floor = isTsx(feed) ? yearsAgo(TSX_YEARS) : yearsAgo(US_YEARS);
  const from = need.needsBack ? minDate(start, floor) : shiftDays(coverage!.last_date!, -5);
  const fetched = await fetchUpstream(feed, from, now);
  if (fetched) {
    await storePoints(feed, fetched.currency, fetched.points);
    await writeCoverage(
      feed,
      fetched.currency,
      fetched.points[0]!.date,
      fetched.points[fetched.points.length - 1]!.date,
      false,
    );
  } else if (!coverage?.last_date) {
    await writeCoverage(feed, currency, null, null, true);
  } else {
    await writeCoverage(feed, currency, coverage.first_date, coverage.last_date, false);
  }
  return fetched;
}

/**
 * Daily closes for many symbols at once. Coverage and stored prices are read
 * in single batched queries instead of one round-trip per symbol, and only the
 * symbols we are actually missing are pulled from upstream.
 */
export async function fetchSymbolHistories(
  symbolsRaw: string[],
  start: string,
  end: string,
): Promise<(SymbolHistory | null)[]> {
  const requested = symbolsRaw.map((s) => s.trim().toUpperCase());
  const feeds = requested.map((s) => feedSymbol(s));

  const fresh = new Map<string, SymbolHistory | null>();
  const pending: string[] = [];
  for (const feed of new Set(feeds.filter(Boolean))) {
    const hit = memory.get(`${feed}|${start}|${end}`);
    if (hit && Date.now() - hit.at < MEM_TTL) fresh.set(feed, hit.value);
    else pending.push(feed);
  }

  const coverages = await readCoverageMany(pending);
  const toFetch = pending.filter((feed) => {
    const need = assess(coverages.get(feed) ?? null, start);
    return !need.giveUp && (need.needsBack || (need.needsForward && !need.recentlyChecked));
  });

  const fetched = new Map<string, SymbolHistory | null>();
  await mapLimit(toFetch, 6, async (feed) => {
    fetched.set(feed, await topUp(feed, coverages.get(feed) ?? null, start));
  });

  const stored = await readStoredMany(pending, start, end);

  for (const feed of pending) {
    const coverage = coverages.get(feed) ?? null;
    const got = fetched.get(feed) ?? null;
    const points = stored.get(feed) ?? [];
    const currency = got?.currency ?? coverage?.currency ?? (isTsx(feed) ? "CAD" : "USD");
    const value: SymbolHistory | null =
      points.length > 0
        ? { symbol: feed, currency, points }
        : got
          ? { ...got, points: got.points.filter((p) => p.date >= start && p.date <= end) }
          : null;
    const final = value && value.points.length > 0 ? value : null;
    memory.set(`${feed}|${start}|${end}`, { at: Date.now(), value: final });
    fresh.set(feed, final);
  }

  return requested.map((symbol, i) => {
    const value = fresh.get(feeds[i]!) ?? null;
    // Keep the caller's own ticker on the result so their holdings still match.
    return value ? { ...value, symbol } : null;
  });
}

/**
 * Daily closes for a symbol over a window, served from the shared library and
 * topped up from upstream only for the parts we are missing.
 */
export async function fetchSymbolHistory(
  symbolRaw: string,
  start: string,
  end: string,
): Promise<SymbolHistory | null> {
  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol) return null;
  const [value] = await fetchSymbolHistories([symbol], start, end);
  return value ?? null;
}



function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * The official close for a symbol on a date, falling back to the most recent
 * trading day before it (weekends, holidays). Reads the shared library, which
 * is only ever written from TMX (Canada) and Nasdaq (US).
 */
export async function fetchQuoteOnDate(
  symbolRaw: string,
  date: string,
): Promise<{ symbol: string; currency: string; date: string; close: number } | null> {
  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol) return null;
  const history = await fetchSymbolHistory(symbol, shiftDays(date, -14), date);
  const last = history?.points[history.points.length - 1];
  if (!history || !last) return null;
  return { symbol, currency: history.currency, date: last.date, close: last.close };
}

// --------------------------------------------------------------------- FX

async function readStoredFx(start: string, end: string): Promise<HistoryPoint[]> {
  const db = await admin();
  const points: HistoryPoint[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("fx_history")
      .select("date, usd_cad")
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      const rate = Number(row.usd_cad);
      if (Number.isFinite(rate) && rate > 0) points.push({ date: String(row.date), close: rate });
    }
    if (data.length < pageSize) break;
  }
  return points;
}

async function fetchUpstreamFx(start: string, end: string): Promise<HistoryPoint[]> {
  const res = await fetchRetry(`https://api.frankfurter.app/${start}..${end}?from=USD&to=CAD`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res) return [];
  try {
    const json = (await res.json()) as { rates?: Record<string, { CAD?: number }> };
    const points: HistoryPoint[] = [];
    for (const [date, row] of Object.entries(json.rates ?? {})) {
      const rate = row?.CAD;
      if (typeof rate === "number" && rate > 0) points.push({ date, close: rate });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    return points;
  } catch {
    return [];
  }
}

async function storeFx(points: HistoryPoint[]) {
  if (points.length === 0) return;
  const db = await admin();
  const chunk = 800;
  for (let i = 0; i < points.length; i += chunk) {
    const rows = points.slice(i, i + chunk).map((p) => ({ date: p.date, usd_cad: p.close }));
    const { error } = await db.from("fx_history").upsert(rows, { onConflict: "date" });
    if (error) console.error(`[history] store fx: ${error.message}`);
  }
}

/** Daily USD→CAD rates, served from the shared library. */
export async function fetchFxHistory(start: string, end: string): Promise<HistoryPoint[]> {
  const key = `${start}|${end}`;
  const hit = fxMemory.get(key);
  if (hit && Date.now() - hit.at < MEM_TTL) return hit.value;

  let stored = await readStoredFx(start, end);
  const now = today();
  const covered =
    stored.length > 0 &&
    stored[0]!.date <= shiftDays(start, 7) &&
    stored[stored.length - 1]!.date >= shiftDays(minDate(end, now), -FRESH_DAYS);

  if (!covered) {
    const fresh = await fetchUpstreamFx(start, minDate(end, now));
    if (fresh.length > 0) {
      await storeFx(fresh);
      stored = await readStoredFx(start, end);
      if (stored.length === 0) stored = fresh;
    }
  }

  fxMemory.set(key, { at: Date.now(), value: stored });
  return stored;
}

const fxDayCache = new Map<string, { at: number; value: number | null }>();

/**
 * USD→CAD rate on a specific date (the most recent published rate at or
 * before that date). Reads the shared library first.
 */
export async function fetchFxRateOn(date: string): Promise<number | null> {
  const hit = fxDayCache.get(date);
  if (hit && Date.now() - hit.at < MEM_TTL) return hit.value;

  const stored = await readStoredFx(shiftDays(date, -10), date);
  let value = stored.length > 0 ? stored[stored.length - 1]!.close : null;

  if (value == null) {
    const res = await fetchRetry(`https://api.frankfurter.app/${date}?from=USD&to=CAD`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (res) {
      try {
        const json = (await res.json()) as { date?: string; rates?: { CAD?: number } };
        const rate = json.rates?.CAD;
        if (typeof rate === "number" && rate > 0) {
          value = rate;
          await storeFx([{ date: String(json.date ?? date), close: rate }]);
        }
      } catch {
        /* leave null */
      }
    }
  }

  fxDayCache.set(date, { at: Date.now(), value });
  return value;
}

/**
 * Nightly maintenance: append the latest closes for every symbol already in
 * the library plus any new holding symbols, and extend the FX series.
 */
export async function backfillLibrary(extraSymbols: string[] = []): Promise<{
  symbols: number;
  updated: number;
  failed: string[];
}> {
  const db = await admin();
  const { data } = await db.from("price_history_coverage").select("symbol").eq("unavailable", false);
  const known = (data ?? []).map((r) => String(r.symbol).toUpperCase());
  const symbols = Array.from(
    new Set([...known, ...extraSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean)]),
  );

  const now = today();
  const start = yearsAgo(1);
  const failed: string[] = [];
  let updated = 0;

  await mapLimit(symbols, 4, async (symbol) => {
    memory.clear();
    const res = await fetchSymbolHistory(symbol, start, now);
    if (res) updated++;
    else failed.push(symbol);
  });

  await fetchFxHistory(yearsAgo(1), now);
  return { symbols: symbols.length, updated, failed };
}

/**
 * Slow seed of the shared library from the common Canadian/US ticker universe.
 * Each run takes only a small batch of symbols we have never fetched, so the
 * library fills in over many nights instead of hammering the data sources.
 * The coverage table is the progress marker, so a re-run never redoes work.
 */
export async function seedLibrary(batchSize = 12): Promise<{
  remaining: number;
  attempted: string[];
  seeded: number;
  failed: string[];
}> {
  const { TICKER_UNIVERSE } = await import("./ticker-universe");
  const db = await admin();
  const { data } = await db.from("price_history_coverage").select("symbol");
  const known = new Set((data ?? []).map((r) => String(r.symbol).toUpperCase()));
  const pending = TICKER_UNIVERSE.filter((s) => !known.has(s));

  const attempted = pending.slice(0, Math.max(0, batchSize));
  const failed: string[] = [];
  let seeded = 0;
  const now = today();

  // Deliberately gentle: three at a time with a short pause between symbols.
  await mapLimit(attempted, 3, async (symbol) => {
    const from = isTsx(symbol) ? yearsAgo(TSX_YEARS) : yearsAgo(US_YEARS);
    const res = await fetchSymbolHistory(symbol, from, now);
    if (res && res.points.length > 0) seeded++;
    else failed.push(symbol);
    await new Promise((r) => setTimeout(r, 400));
  });

  return { remaining: pending.length - attempted.length, attempted, seeded, failed };
}
