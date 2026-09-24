import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  symbols: z.array(z.string()).max(500),
  force: z.boolean().optional(),
});

export type QuoteResult = {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  currency: string | null;
  name: string | null;
  asOf: string | null;
  dividendRate: number | null;
  dividendYield: number | null;
  exDivDate: string | null;
  exDivAmount: number | null;
};

export type QuotesResponse = {
  quotes: QuoteResult[];
  fxUsdCad: number;
  fxAsOf: string | null;
  pricesAsOf: string | null;
  fetchedAt: string;
};

/**
 * Prices are end-of-day values refreshed once per day by the scheduled job
 * (see /api/public/refresh-prices). The app only reaches out to the provider
 * when a symbol has never been priced, its stored price is older than this
 * window, or the user presses Refresh.
 */
const CACHE_MS = 20 * 60 * 60 * 1000;

export const getQuotes = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<QuotesResponse> => {
    const { FX_SYMBOL, refreshPrices } = await import("./market.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const wanted = Array.from(
      new Set([...data.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean), FX_SYMBOL]),
    );

    const { data: cached, error: cacheError } = await supabaseAdmin
      .from("price_cache")
      .select("*")
      .in("symbol", wanted);
    if (cacheError) console.error(`[market] price_cache read failed: ${cacheError.message}`);

    const now = Date.now();
    const quotes = new Map<string, QuoteResult>();
    const stale: string[] = [];

    for (const symbol of wanted) {
      const row = cached?.find((c) => c.symbol === symbol);
      const fresh =
        !data.force && row?.price != null && now - new Date(row.updated_at).getTime() < CACHE_MS;
      if (row?.price != null) {
        quotes.set(symbol, {
          symbol,
          price: Number(row.price),
          previousClose: row.previous_close == null ? null : Number(row.previous_close),
          currency: row.currency,
          name: row.name,
          asOf: row.as_of ?? row.updated_at.slice(0, 10),
          dividendRate: row.dividend_rate == null ? null : Number(row.dividend_rate),
          dividendYield: row.dividend_yield == null ? null : Number(row.dividend_yield),
          exDivDate: row.div_ex_date ?? null,
          exDivAmount: row.div_amount == null ? null : Number(row.div_amount),
        });
      }
      if (!fresh) stale.push(symbol);
    }

    if (stale.length > 0) {
      const { quotes: fetched, asOf } = await refreshPrices(stale.filter((s) => s !== FX_SYMBOL));
      for (const q of fetched) {
        if (q.price == null) continue;
        quotes.set(q.symbol.toUpperCase(), {
          symbol: q.symbol.toUpperCase(),
          price: q.price,
          previousClose: q.previousClose,
          currency: q.currency,
          name: q.name,
          asOf,
          dividendRate: q.dividendRate ?? null,
          dividendYield: q.dividendYield ?? null,
          exDivDate: q.exDivDate ?? null,
          exDivAmount: q.exDivAmount ?? null,
        });
      }
    }

    const fxQuote = quotes.get(FX_SYMBOL);
    const tickers = Array.from(quotes.values()).filter((q) => q.symbol !== FX_SYMBOL);
    const pricesAsOf = tickers
      .map((q) => q.asOf)
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop();

    return {
      quotes: tickers,
      fxUsdCad: fxQuote?.price ?? 1.37,
      fxAsOf: fxQuote?.asOf ?? null,
      pricesAsOf: pricesAsOf ?? fxQuote?.asOf ?? null,
      fetchedAt: new Date().toISOString(),
    };
  });

const LookupInput = z.object({ symbol: z.string().min(1) });

export const lookupSymbol = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => LookupInput.parse(data))
  .handler(async ({ data }) => {
    const { getMarketProvider } = await import("./market.server");
    const [quote] = await getMarketProvider().fetchQuotes([data.symbol.trim().toUpperCase()]);
    return quote ?? null;
  });
