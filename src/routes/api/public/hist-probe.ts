import { createFileRoute } from "@tanstack/react-router";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function probe(name: string, url: string) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" },
    });
    const text = await res.text();
    return { name, url, status: res.status, len: text.length, head: text.slice(0, 500) };
  } catch (e) {
    return { name, url, error: String(e) };
  }
}

const gqlVars = encodeURIComponent(
  JSON.stringify({ symbol: "SPY", timeRange: "5Y" }),
);
const gqlExt = encodeURIComponent(
  JSON.stringify({ persistedQuery: { version: 1, sha256Hash: "" } }),
);

export const Route = createFileRoute("/api/public/hist-probe")({
  server: {
    handlers: {
      GET: async () => {
        const results = await Promise.all([
          probe(
            "nasdaq-spy",
            "https://api.nasdaq.com/api/quote/SPY/historical?assetclass=etf&fromdate=2024-01-01&todate=2026-09-17&limit=9999",
          ),
          probe(
            "cnbc-gql",
            `https://webql-redesign.cnbcfm.com/graphql?operationName=getQuoteChartData&variables=${gqlVars}&extensions=${gqlExt}`,
          ),
          probe(
            "cnbc-chart-api",
            "https://api.cnbc.com/chart/v1/SPY?interval=1D&range=1Y",
          ),
          probe("stooq-q", "https://stooq.pl/q/d/l/?s=spy.us&i=d"),
          probe(
            "tmx-xic",
            "https://app-money.tmx.com/graphql?operationName=getTimeSeriesData&variables=%7B%22symbol%22%3A%22XIC%22%2C%22freq%22%3A%22day%22%2C%22interval%22%3A1%2C%22start%22%3A%222025-01-01%22%2C%22end%22%3A%222026-09-17%22%7D",
          ),
          probe(
            "alphavantage-demo",
            "https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=SPY&apikey=demo",
          ),
          probe(
            "twelvedata-demo",
            "https://api.twelvedata.com/time_series?symbol=SPY&interval=1day&outputsize=30&apikey=demo",
          ),
          probe(
            "investing-free",
            "https://financialmodelingprep.com/api/v3/historical-price-full/SPY?apikey=demo",
          ),
        ]);
        return Response.json(results);
      },
    },
  },
});
