import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({ symbols: z.array(z.string()).max(120) });

export type QuoteResult = {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  currency: string | null;
  name: string | null;
};

export type QuotesResponse = {
  quotes: QuoteResult[];
  fxUsdCad: number;
  fetchedAt: string;
};

/** Quotes are cached for this long before hitting the upstream provider again. */
const CACHE_MS = 60 * 60 * 1000;

export const getQuotes = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<QuotesResponse> => {
    const { getMarketProvider, FX_SYMBOL } = await import("./market.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const wanted = Array.from(
      new Set([...data.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean), FX_SYMBOL]),
    );
    if (wanted.length === 0) {
      return { quotes: [], fxUsdCad: 1, fetchedAt: new Date().toISOString() };
    }

    const { data: cached } = await supabaseAdmin
      .from("price_cache")
      .select("*")
      .in("symbol", wanted);

    const now = Date.now();
    const fresh = new Map<string, QuoteResult>();
    const stale: string[] = [];

    for (const symbol of wanted) {
      const row = cached?.find((c) => c.symbol === symbol);
      if (row && now - new Date(row.updated_at).getTime() < CACHE_MS && row.price != null) {
        fresh.set(symbol, {
          symbol,
          price: Number(row.price),
          previousClose: row.previous_close == null ? null : Number(row.previous_close),
          currency: row.currency,
          name: row.name,
        });
      } else {
        stale.push(symbol);
      }
    }

    if (stale.length > 0) {
      const provider = getMarketProvider();
      const fetched = await provider.fetchQuotes(stale);
      const rows = fetched
        .filter((q) => q.price != null)
        .map((q) => ({
          symbol: q.symbol.toUpperCase(),
          price: q.price,
          previous_close: q.previousClose,
          currency: q.currency,
          name: q.name,
          updated_at: new Date().toISOString(),
        }));
      if (rows.length > 0) {
        await supabaseAdmin.from("price_cache").upsert(rows, { onConflict: "symbol" });
      }
      for (const q of fetched) {
        if (q.price != null) fresh.set(q.symbol.toUpperCase(), { ...q, symbol: q.symbol.toUpperCase() });
      }
      // Fall back to any stale cached value we still have
      for (const symbol of stale) {
        if (fresh.has(symbol)) continue;
        const row = cached?.find((c) => c.symbol === symbol);
        if (row?.price != null) {
          fresh.set(symbol, {
            symbol,
            price: Number(row.price),
            previousClose: row.previous_close == null ? null : Number(row.previous_close),
            currency: row.currency,
            name: row.name,
          });
        }
      }
    }

    const fx = fresh.get(FX_SYMBOL)?.price ?? 1.37;

    return {
      quotes: Array.from(fresh.values()).filter((q) => q.symbol !== FX_SYMBOL),
      fxUsdCad: fx,
      fetchedAt: new Date().toISOString(),
    };
  });

const LookupInput = z.object({ symbol: z.string().min(1) });

export const lookupSymbol = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => LookupInput.parse(data))
  .handler(async ({ data }): Promise<QuoteResult | null> => {
    const { getMarketProvider } = await import("./market.server");
    const [quote] = await getMarketProvider().fetchQuotes([data.symbol.trim().toUpperCase()]);
    return quote ?? null;
  });
