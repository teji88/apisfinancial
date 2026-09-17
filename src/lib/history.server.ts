/**
 * Historical daily closes for benchmarking.
 * US-listed symbols come from Nasdaq, TSX (.TO) symbols from TMX,
 * and USD/CAD history from the ECB via Frankfurter.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type HistoryPoint = { date: string; close: number };
export type SymbolHistory = { symbol: string; currency: string; points: HistoryPoint[] };

const cache = new Map<string, { at: number; value: SymbolHistory }>();
const fxCache = new Map<string, { at: number; value: HistoryPoint[] }>();
const TTL = 6 * 60 * 60 * 1000;

function num(raw: string): number | null {
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isoFromUs(value: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

async function fetchTmx(symbol: string, start: string, end: string): Promise<SymbolHistory | null> {
  const base = symbol.replace(/\.TO$/i, "").toUpperCase();
  try {
    const res = await fetch("https://app-money.tmx.com/graphql", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json", locale: "en" },
      body: JSON.stringify({
        operationName: "getTimeSeriesData",
        variables: { symbol: `${base}:CA`, freq: "day", interval: 1, start, end },
        query:
          "query getTimeSeriesData($symbol: String!, $freq: String, $interval: Int, $start: String, $end: String) { getTimeSeriesData(symbol: $symbol, freq: $freq, interval: $interval, start: $start, end: $end) { dateTime close } }",
      }),
    });
    if (!res.ok) return null;
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
    try {
      const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(
        symbol.toUpperCase(),
      )}/historical?assetclass=${assetclass}&fromdate=${start}&todate=${end}&limit=9999`;
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!res.ok) continue;
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

export async function fetchSymbolHistory(
  symbol: string,
  start: string,
  end: string,
): Promise<SymbolHistory | null> {
  const key = `${symbol.toUpperCase()}|${start}|${end}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const value = /\.TO$/i.test(symbol)
    ? await fetchTmx(symbol, start, end)
    : await fetchNasdaq(symbol, start, end);
  if (value) cache.set(key, { at: Date.now(), value });
  return value;
}

/** Daily USD→CAD rates from the ECB reference feed. */
export async function fetchFxHistory(start: string, end: string): Promise<HistoryPoint[]> {
  const key = `${start}|${end}`;
  const hit = fxCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  try {
    const res = await fetch(
      `https://api.frankfurter.app/${start}..${end}?from=USD&to=CAD`,
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { rates?: Record<string, { CAD?: number }> };
    const points: HistoryPoint[] = [];
    for (const [date, row] of Object.entries(json.rates ?? {})) {
      const rate = row?.CAD;
      if (typeof rate === "number" && rate > 0) points.push({ date, close: rate });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    fxCache.set(key, { at: Date.now(), value: points });
    return points;
  } catch {
    return [];
  }
}
