import { createFileRoute } from "@tanstack/react-router";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function post(name: string, url: string, body: unknown, headers: Record<string, string> = {}) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { name, status: res.status, len: text.length, head: text.slice(0, 500) };
  } catch (e) {
    return { name, error: String(e) };
  }
}

async function get(name: string, url: string) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" } });
    const text = await res.text();
    return { name, status: res.status, len: text.length, head: text.slice(0, 400) };
  } catch (e) {
    return { name, error: String(e) };
  }
}

export const Route = createFileRoute("/api/public/hist-probe")({
  server: {
    handlers: {
      GET: async () => {
        const results = await Promise.all([
          post("tmx-gql", "https://app-money.tmx.com/graphql", {
            operationName: "getTimeSeriesData",
            variables: { symbol: "XIC:CA", freq: "day", interval: 1, start: "2025-01-01", end: "2026-09-17" },
            query:
              "query getTimeSeriesData($symbol: String!, $freq: String, $interval: Int, $start: String, $end: String) { getTimeSeriesData(symbol: $symbol, freq: $freq, interval: $interval, start: $start, end: $end) { dateTime close } }",
          }, { locale: "en" }),
          get("nasdaq-ewc", "https://api.nasdaq.com/api/quote/EWC/historical?assetclass=etf&fromdate=2024-01-01&todate=2026-09-17&limit=9999"),
          get("nasdaq-veu", "https://api.nasdaq.com/api/quote/VT/historical?assetclass=etf&fromdate=2024-01-01&todate=2026-09-17&limit=9999"),
          get("nasdaq-ivv", "https://api.nasdaq.com/api/quote/IVV/historical?assetclass=etf&fromdate=2024-01-01&todate=2026-09-17&limit=9999"),
        ]);
        return Response.json(results);
      },
    },
  },
});
