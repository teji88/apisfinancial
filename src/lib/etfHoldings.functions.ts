import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { EtfHoldingInput } from "./etfHoldings.server";

const Input = z.object({
  symbols: z.array(z.string()).max(50),
});

export type EtfHoldingsResponse = {
  byEtf: Record<string, { asOf: string | null; rows: EtfHoldingInput[] }>;
  refreshed: Array<{
    symbol: string;
    status: string;
    asOf: string | null;
    count: number;
    reason?: string;
  }>;
};

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/**
 * Stored ETF holdings for the given symbols (app form, e.g. XEQT.TO).
 * Anything stale (as-of older than the quarterly window) or missing is
 * refreshed from the issuer first, so the first look-through view seeds
 * the library instead of showing empty. Sub-ETFs discovered in the
 * stored rows (funds of funds) are refreshed the same way.
 */
export const getEtfHoldings = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<EtfHoldingsResponse> => {
    const { ETF_HOLDINGS_STALE_DAYS, readEtfHoldingsMap, refreshEtfHoldings } =
      await import("./etfHoldings.server");
    const symbols = Array.from(
      new Set(data.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
    );
    const today = new Date().toISOString().slice(0, 10);
    const before = await readEtfHoldingsMap(symbols);
    const stale = Object.entries(before)
      .filter(([, entry]) => {
        if (entry.rows.length === 0 || !entry.asOf) return true;
        return daysBetween(entry.asOf, today) > ETF_HOLDINGS_STALE_DAYS;
      })
      .map(([symbol]) => symbol);
    const refreshed = stale.length > 0 ? await refreshEtfHoldings(stale) : [];
    const byEtf = await readEtfHoldingsMap(symbols);
    return {
      byEtf,
      refreshed: refreshed.map((r) => ({
        symbol: r.symbol,
        status: r.status,
        asOf: r.asOf,
        count: r.count,
        reason: r.reason,
      })),
    };
  });
