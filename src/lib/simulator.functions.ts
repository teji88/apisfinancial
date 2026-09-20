import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  SIM_BENCHMARKS,
  SIM_MAX_HOLDINGS,
  SIM_PERIODS,
  SIM_START_AMOUNT,
  type SimLine,
  type SimResult,
} from "./simulator";

const Input = z.object({
  holdings: z
    .array(
      z.object({
        symbol: z.string().trim().min(1).max(16).regex(/^[A-Za-z0-9.\-]+$/),
        weight: z.number().min(0).max(100),
      }),
    )
    .min(1)
    .max(SIM_MAX_HOLDINGS),
  period: z.enum(["1Y", "3Y", "5Y", "10Y", "MAX"]),
});

type Series = { currency: string; points: Array<{ date: string; close: number }> };

function shiftYears(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/** Value of a series on every grid date, carrying the last close forward. */
function align(points: Array<{ date: string; close: number }>, grid: string[]): Array<number | null> {
  const out: Array<number | null> = [];
  let i = 0;
  let last: number | null = null;
  for (const date of grid) {
    while (i < points.length && points[i]!.date <= date) {
      last = points[i]!.close;
      i++;
    }
    out.push(last);
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/**
 * Public benchmark simulator: no account needed.
 *
 * Everything runs off the shared price library, so a symbol somebody tries
 * here is stored once and served from our own database for every later
 * visitor — the library grows as people use the tool.
 */
export const simulateBenchmark = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<SimResult | { error: string }> => {
    const { fetchSymbolHistory, fetchFxHistory, mapLimit } = await import("./history.server");

    const holdings = data.holdings
      .map((h) => ({ symbol: h.symbol.trim().toUpperCase(), weight: h.weight }))
      .filter((h) => h.symbol.length > 0);
    const weightTotal = holdings.reduce((s, h) => s + h.weight, 0);
    if (weightTotal <= 0) return { error: "Give at least one holding a weight above zero." };

    const years = SIM_PERIODS.find((p) => p.id === data.period)?.years ?? 5;
    const end = new Date().toISOString().slice(0, 10);
    const requestedStart = shiftYears(end, years);

    const benchSymbols = SIM_BENCHMARKS.map((b) => b.symbol);
    const allSymbols = Array.from(new Set([...holdings.map((h) => h.symbol), ...benchSymbols]));

    const [histories, fxPoints] = await Promise.all([
      mapLimit(allSymbols, 4, (s) => fetchSymbolHistory(s, requestedStart, end)),
      fetchFxHistory(requestedStart, end),
    ]);

    const series = new Map<string, Series>();
    const missing: string[] = [];
    histories.forEach((h, i) => {
      const symbol = allSymbols[i]!;
      if (h && h.points.length > 1) series.set(symbol, { currency: h.currency, points: h.points });
      else missing.push(symbol);
    });

    const usable = holdings.filter((h) => series.has(h.symbol));
    if (usable.length === 0) {
      return {
        error:
          "We could not find market history for those symbols. Canadian listings end in .TO (for example ENB.TO); US listings are plain (for example AAPL).",
      };
    }

    // Distribution yields: benchmarks use published figures, user symbols come
    // from our quote cache (topped up from the provider when we've never seen
    // the symbol, which also saves it for the next person).
    const yields = new Map<string, number>();
    for (const b of SIM_BENCHMARKS) yields.set(b.symbol, b.annualYield);
    const noDividendData: string[] = [];
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const userSymbols = usable.map((h) => h.symbol).filter((s) => !yields.has(s));
      if (userSymbols.length > 0) {
        const { data: rows } = await supabaseAdmin
          .from("price_cache")
          .select("symbol, dividend_yield, updated_at")
          .in("symbol", userSymbols);
        const known = new Set((rows ?? []).map((r) => String(r.symbol)));
        const unknown = userSymbols.filter((s) => !known.has(s));
        if (unknown.length > 0) {
          const { refreshPrices } = await import("./market.server");
          const { quotes } = await refreshPrices(unknown);
          for (const q of quotes) {
            if (q.dividendYield != null) yields.set(q.symbol.toUpperCase(), q.dividendYield / 100);
          }
        }
        for (const row of rows ?? []) {
          const pct = row.dividend_yield == null ? null : Number(row.dividend_yield);
          if (pct != null && Number.isFinite(pct)) yields.set(String(row.symbol), pct / 100);
        }
      }
    } catch (err) {
      console.warn(`[simulator] dividend lookup: ${String(err)}`);
    }
    for (const h of usable) if (!yields.has(h.symbol)) noDividendData.push(h.symbol);

    // The window is set by the user's own picks. A benchmark that did not
    // exist that far back (ZEQT only launched in 2022) is dropped rather than
    // shortening everyone else's comparison.
    const pickSymbols = usable.map((h) => h.symbol);
    const start = pickSymbols
      .map((s) => series.get(s)!.points[0]!.date)
      .reduce((a, b) => (a > b ? a : b), requestedStart);
    const lastOf = (s: string) => series.get(s)!.points[series.get(s)!.points.length - 1]!.date;
    const usableBenchmarks = benchSymbols.filter(
      (s) => series.has(s) && series.get(s)!.points[0]!.date <= start,
    );
    const included = [...pickSymbols, ...usableBenchmarks];
    const lastDate = included.map(lastOf).reduce((a, b) => (a < b ? a : b), end);


    const gridSet = new Set<string>();
    for (const s of included) {
      for (const p of series.get(s)!.points) {
        if (p.date >= start && p.date <= lastDate) gridSet.add(p.date);
      }
    }
    const grid = Array.from(gridSet).sort();
    if (grid.length < 2) return { error: "Not enough shared price history for that window." };

    const fx = align(fxPoints, grid);
    const fxFallback = fxPoints[fxPoints.length - 1]?.close ?? 1.37;
    const rate = (i: number) => fx[i] ?? fxFallback;

    /** Grid values in CAD for one symbol, price-only and total-return. */
    function cadSeries(symbol: string): { price: Array<number | null>; total: Array<number | null> } {
      const s = series.get(symbol)!;
      const raw = align(s.points, grid);
      const usd = (s.currency ?? "USD").toUpperCase() === "USD";
      const y = yields.get(symbol) ?? 0;
      const price = raw.map((v, i) => (v == null ? null : usd ? v * rate(i) : v));
      const total = price.map((v, i) => {
        if (v == null) return null;
        const t = daysBetween(grid[0]!, grid[i]!) / 365;
        return v * Math.pow(1 + y, t);
      });
      return { price, total };
    }

    function buildLine(
      key: string,
      label: string,
      note: string,
      color: string,
      parts: Array<{ symbol: string; weight: number }>,
    ): SimLine | null {
      const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
      if (totalWeight <= 0) return null;
      const price = new Array<number>(grid.length).fill(0);
      const total = new Array<number>(grid.length).fill(0);
      for (const part of parts) {
        const cad = cadSeries(part.symbol);
        const startPrice = cad.price[0];
        if (startPrice == null || startPrice <= 0) return null;
        const cash = (SIM_START_AMOUNT * part.weight) / totalWeight;
        const units = cash / startPrice;
        const startTotal = cad.total[0]!;
        const unitsTotal = cash / startTotal;
        for (let i = 0; i < grid.length; i++) {
          price[i]! += units * (cad.price[i] ?? startPrice);
          total[i]! += unitsTotal * (cad.total[i] ?? startTotal);
        }
      }
      return { key, label, note, color, price, total };
    }

    const you = buildLine(
      "you",
      "Your picks",
      usable.map((h) => `${h.symbol} ${Math.round((h.weight / weightTotal) * 100)}%`).join(" · "),
      "hsl(var(--primary))",
      usable,
    );
    if (!you) return { error: "We could not price your picks over that window." };

    const benchmarks = SIM_BENCHMARKS.filter((b) => series.has(b.symbol))
      .map((b) => buildLine(b.symbol, b.label, b.note, b.color, [{ symbol: b.symbol, weight: 1 }]))
      .filter((l): l is SimLine => l !== null);

    return {
      start: grid[0]!,
      end: grid[grid.length - 1]!,
      dates: grid,
      amount: SIM_START_AMOUNT,
      you,
      benchmarks,
      missing: missing.filter((s) => !benchSymbols.includes(s)),
      noDividendData,
    };
  });
