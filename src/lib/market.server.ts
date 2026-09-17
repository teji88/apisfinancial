/**
 * Market data provider abstraction.
 * The default provider is Yahoo Finance (free, EOD/delayed). A paid provider
 * can be swapped in later by adding an implementation and setting
 * MARKET_PROVIDER in the environment.
 */

export type ProviderQuote = {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  currency: string | null;
  name: string | null;
};

export interface MarketProvider {
  name: string;
  fetchQuotes(symbols: string[]): Promise<ProviderQuote[]>;
}

const yahooProvider: MarketProvider = {
  name: "yahoo",
  async fetchQuotes(symbols) {
    const results = await Promise.all(
      symbols.map(async (symbol): Promise<ProviderQuote> => {
        const empty: ProviderQuote = {
          symbol,
          price: null,
          previousClose: null,
          currency: null,
          name: null,
        };
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
            symbol,
          )}?interval=1d&range=5d`;
          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
              Accept: "application/json",
            },
          });
          if (!res.ok) return empty;
          const json = (await res.json()) as {
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
              }>;
            };
          };
          const meta = json.chart?.result?.[0]?.meta;
          if (!meta) return empty;
          return {
            symbol,
            price: meta.regularMarketPrice ?? null,
            previousClose: meta.previousClose ?? meta.chartPreviousClose ?? null,
            currency: meta.currency ?? null,
            name: meta.longName ?? meta.shortName ?? null,
          };
        } catch {
          return empty;
        }
      }),
    );
    return results;
  },
};

export function getMarketProvider(): MarketProvider {
  // Future providers (Polygon, FMP, Alpha Vantage) register here.
  return yahooProvider;
}

export const FX_SYMBOL = "USDCAD=X";
