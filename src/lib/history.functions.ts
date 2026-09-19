import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { HistoryPoint } from "./history.server";

const Input = z.object({
  symbols: z.array(z.string()).max(150),
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
    const { fetchSymbolHistory, fetchFxHistory, mapLimit } = await import("./history.server");
    const symbols = Array.from(
      new Set(data.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
    );

    const [histories, fx] = await Promise.all([
      mapLimit(symbols, 6, (s) => fetchSymbolHistory(s, data.start, data.end)),
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
