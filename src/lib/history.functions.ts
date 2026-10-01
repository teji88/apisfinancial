import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { HistoryPoint } from "./history.server";

const Input = z.object({
  symbols: z.array(z.string()).max(500),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type HistoryResponse = {
  series: Array<{ symbol: string; currency: string; points: HistoryPoint[] }>;
  fx: HistoryPoint[];
  missing: string[];
};

export const getHistory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<HistoryResponse> => {
    const { fetchSymbolHistories, fetchFxHistory } = await import("./history.server");
    const symbols = Array.from(
      new Set(data.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
    );

    const [histories, fx] = await Promise.all([
      fetchSymbolHistories(symbols, data.start, data.end),
      fetchFxHistory(data.start, data.end),
    ]);

    const series: HistoryResponse["series"] = [];
    const missing: string[] = [];
    histories.forEach((h, i) => {
      if (h) series.push(h);
      else missing.push(symbols[i]!);
    });

    return { series, fx, missing };
  });

const FxInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Historical USD→CAD rate for a transaction date. */
export const getFxRateOn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => FxInput.parse(data))
  .handler(async ({ data }): Promise<{ date: string; rate: number | null }> => {
    const { fetchFxRateOn } = await import("./history.server");
    return { date: data.date, rate: await fetchFxRateOn(data.date) };
  });

const QuoteOnDateInput = z.object({
  symbol: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Official market close for a symbol on (or just before) a trade date. */
export const getQuoteOnDate = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => QuoteOnDateInput.parse(data))
  .handler(async ({ data }) => {
    const { fetchQuoteOnDate } = await import("./history.server");
    return fetchQuoteOnDate(data.symbol, data.date);
  });

const DividendHistoryInput = z.object({
  items: z
    .array(
      z.object({
        symbol: z.string().min(1),
        since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .max(400),
});

export type DividendHistoryResponse = {
  bySymbol: Record<
    string,
    Array<{ exDate: string; payDate: string | null; amount: number; currency: string }>
  >;
  missing: string[];
};

/** Historical dividend payments for each symbol since its first purchase. */
export const getDividendHistory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => DividendHistoryInput.parse(data))
  .handler(async ({ data }): Promise<DividendHistoryResponse> => {
    const { fetchDividendHistory, mapLimit } = await import("./history.server");
    const earliest = new Map<string, string>();
    for (const it of data.items) {
      const s = it.symbol.trim().toUpperCase();
      const prev = earliest.get(s);
      if (!prev || it.since < prev) earliest.set(s, it.since);
    }
    const entries = Array.from(earliest.entries());
    const results = await mapLimit(entries, 4, ([s, since]) => fetchDividendHistory(s, since));
    const bySymbol: DividendHistoryResponse["bySymbol"] = {};
    const missing: string[] = [];
    entries.forEach(([s], i) => {
      const r = results[i];
      if (r) bySymbol[s] = r;
      else missing.push(s);
    });
    return { bySymbol, missing };
  });
