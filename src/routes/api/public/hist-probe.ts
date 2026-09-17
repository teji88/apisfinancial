import { createFileRoute } from "@tanstack/react-router";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function probe(name: string, url: string) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" } });
    const text = await res.text();
    return { name, url, status: res.status, len: text.length, head: text.slice(0, 400) };
  } catch (e) {
    return { name, url, error: String(e) };
  }
}

export const Route = createFileRoute("/api/public/hist-probe")({
  server: {
    handlers: {
      GET: async () => {
        const results = await Promise.all([
          probe(
            "cnbc-chart-spy",
            "https://ts-api.cnbc.com/harmonizer/document/chart/symbol/SPY/?events=&intervalType=DAY&intervalSize=1&timeRange=5Y&requestMethod=extended",
          ),
          probe(
            "cnbc-chart2",
            "https://ts-api.cnbc.com/harmonizer/document/chart/SPY?timeRange=1Y&intervalType=DAY&intervalSize=1",
          ),
          probe("stooq-spy", "https://stooq.com/q/d/l/?s=spy.us&i=d"),
          probe(
            "yahoo-chart",
            "https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=2y&interval=1d",
          ),
          probe(
            "frankfurter-hist",
            "https://api.frankfurter.app/2025-01-02..2025-01-10?from=USD&to=CAD",
          ),
          probe(
            "tiingo-noauth",
            "https://www.wsj.com/market-data/quotes/etf/SPY/historical-prices/download?MOD=mw_quote&startDate=01/01/2025&endDate=09/17/2026",
          ),
        ]);
        return Response.json(results);
      },
    },
  },
});
