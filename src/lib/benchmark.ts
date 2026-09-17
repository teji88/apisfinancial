/**
 * Cash-flow-matched benchmarking.
 *
 * Every deposit and withdrawal in the ledger is replayed against a benchmark
 * ETF on the same date and for the same CAD amount, so the comparison shows
 * true alpha rather than a static index overlay.
 */

import type { HistoryPoint } from "./history.server";
import type { Holding, Transaction } from "./finance";
import { xirr } from "./finance";

export const BENCHMARKS = [
  { id: "sp500", label: "S&P 500", symbol: "IVV", note: "iShares Core S&P 500 (USD)" },
  { id: "tsx", label: "S&P/TSX Composite", symbol: "XIC.TO", note: "iShares Core S&P/TSX Capped (CAD)" },
  { id: "global", label: "All-Equity Global", symbol: "XEQT.TO", note: "iShares All-Equity ETF Portfolio (CAD)" },
] as const;

export type BenchmarkId = (typeof BENCHMARKS)[number]["id"];

export type SeriesMap = Map<string, { currency: string; points: HistoryPoint[] }>;

/** Most recent close at or before `date`. */
export function closeOn(points: HistoryPoint[], date: string): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = points[mid]!;
    if (p.date <= date) {
      best = p.close;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best ?? (points[0]?.close ?? null);
}

export function fxOn(fx: HistoryPoint[], date: string, fallback: number): number {
  if (fx.length === 0) return fallback;
  return closeOn(fx, date) ?? fallback;
}

/** Weekly grid of ISO dates from start to end (inclusive of both ends). */
export function dateGrid(start: string, end: string, maxPoints = 160): string[] {
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  if (!isFinite(s) || !isFinite(e) || e <= s) return [start, end].filter((v, i, a) => a.indexOf(v) === i);
  const day = 86_400_000;
  const span = (e - s) / day;
  const step = Math.max(1, Math.ceil(span / maxPoints));
  const out: string[] = [];
  for (let t = s; t <= e; t += step * day) out.push(new Date(t).toISOString().slice(0, 10));
  const last = end;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export type FlowPoint = { date: string; amount: number };

/** Deposits (+) and withdrawals (−) in CAD, the money the investor put in. */
export function contributionFlows(transactions: Transaction[]): FlowPoint[] {
  const flows: FlowPoint[] = [];
  for (const t of transactions) {
    const fx = t.fx_rate || 1;
    const gross = (t.amount != null && t.amount !== 0 ? t.amount : (t.units || 0) * (t.price_per_unit || 0)) * fx;
    if (t.transaction_type === "DEPOSIT") flows.push({ date: t.transaction_date, amount: gross });
    else if (t.transaction_type === "WITHDRAWAL")
      flows.push({ date: t.transaction_date, amount: -gross });
  }
  return flows.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Actual portfolio value on each grid date, valued with historical closes for
 * every holding (falling back to the last traded price in the ledger).
 */
export function portfolioValueSeries(
  grid: string[],
  transactions: Transaction[],
  holdings: Holding[],
  history: SeriesMap,
  fx: HistoryPoint[],
  fxNow: number,
): number[] {
  const holdingById = new Map(holdings.map((h) => [h.id, h]));
  const txns = transactions.slice().sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
  let idx = 0;
  const units = new Map<string, number>();
  const ledgerPrice = new Map<string, number>();
  let cash = 0;

  return grid.map((date) => {
    while (idx < txns.length && txns[idx]!.transaction_date <= date) {
      const t = txns[idx]!;
      const rate = t.fx_rate || 1;
      const gross =
        (t.amount != null && t.amount !== 0 ? t.amount : (t.units || 0) * (t.price_per_unit || 0)) * rate;
      const fee = (t.fee || 0) * rate;
      switch (t.transaction_type) {
        case "DEPOSIT":
          cash += gross;
          break;
        case "WITHDRAWAL":
          cash -= gross;
          break;
        case "BUY":
          cash -= gross + fee;
          break;
        case "SELL":
          cash += gross - fee;
          break;
        case "DIVIDEND":
          cash += gross;
          break;
        case "FEE":
          cash -= gross + fee;
          break;
      }
      if (t.holding_id && (t.transaction_type === "BUY" || t.transaction_type === "DRIP")) {
        units.set(t.holding_id, (units.get(t.holding_id) ?? 0) + (t.units || 0));
      }
      if (t.holding_id && t.transaction_type === "SELL") {
        units.set(t.holding_id, (units.get(t.holding_id) ?? 0) - (t.units || 0));
      }
      if (t.holding_id && t.price_per_unit) ledgerPrice.set(t.holding_id, t.price_per_unit);
      idx++;
    }

    let value = cash;
    for (const [hid, u] of units) {
      if (Math.abs(u) < 1e-9) continue;
      const h = holdingById.get(hid);
      if (!h) continue;
      const hist = history.get(h.symbol.toUpperCase());
      const close = hist ? closeOn(hist.points, date) : null;
      const price = close ?? ledgerPrice.get(hid) ?? 0;
      const currency = hist?.currency ?? h.currency;
      const rate = currency === "USD" ? fxOn(fx, date, fxNow) : 1;
      value += u * price * rate;
    }
    return value;
  });
}

/** Units of the benchmark ETF bought/sold with the same cash flows. */
export function benchmarkValueSeries(
  grid: string[],
  flows: FlowPoint[],
  bench: { currency: string; points: HistoryPoint[] },
  fx: HistoryPoint[],
  fxNow: number,
): number[] {
  const sorted = flows.slice().sort((a, b) => a.date.localeCompare(b.date));
  let idx = 0;
  let units = 0;

  const priceCad = (date: string): number | null => {
    const close = closeOn(bench.points, date);
    if (close == null) return null;
    const rate = bench.currency === "USD" ? fxOn(fx, date, fxNow) : 1;
    return close * rate;
  };

  return grid.map((date) => {
    while (idx < sorted.length && sorted[idx]!.date <= date) {
      const flow = sorted[idx]!;
      const p = priceCad(flow.date);
      if (p && p > 0) units += flow.amount / p;
      idx++;
    }
    const p = priceCad(date);
    return p != null ? units * p : 0;
  });
}

export type BenchmarkResult = {
  id: string;
  label: string;
  symbol: string;
  note: string;
  values: number[];
  endValue: number;
  mwrr: number | null;
  available: boolean;
};

export type ComparisonResult = {
  grid: string[];
  portfolio: number[];
  portfolioEnd: number;
  portfolioMwrr: number | null;
  invested: number;
  benchmarks: BenchmarkResult[];
};

export function buildComparison(
  transactions: Transaction[],
  holdings: Holding[],
  history: SeriesMap,
  fx: HistoryPoint[],
  fxNow: number,
  portfolioEndValue: number,
): ComparisonResult | null {
  const flows = contributionFlows(transactions);
  if (transactions.length === 0) return null;
  const start = transactions
    .map((t) => t.transaction_date)
    .sort()[0]!;
  const end = new Date().toISOString().slice(0, 10);
  const grid = dateGrid(start, end);

  const portfolio = portfolioValueSeries(grid, transactions, holdings, history, fx, fxNow);
  if (portfolio.length > 0) portfolio[portfolio.length - 1] = portfolioEndValue;

  const invested = flows.reduce((s, f) => s + f.amount, 0);
  const xirrFlows = flows.map((f) => ({ date: new Date(f.date), amount: -f.amount }));
  const portfolioMwrr =
    flows.length > 0 ? xirr([...xirrFlows, { date: new Date(end), amount: portfolioEndValue }]) : null;

  const benchmarks: BenchmarkResult[] = BENCHMARKS.map((b) => {
    const hist = history.get(b.symbol.toUpperCase());
    if (!hist || hist.points.length === 0) {
      return { ...b, values: grid.map(() => 0), endValue: 0, mwrr: null, available: false };
    }
    const values = benchmarkValueSeries(grid, flows, hist, fx, fxNow);
    const endValue = values[values.length - 1] ?? 0;
    const mwrr =
      flows.length > 0 ? xirr([...xirrFlows, { date: new Date(end), amount: endValue }]) : null;
    return { ...b, values, endValue, mwrr, available: true };
  });

  return { grid, portfolio, portfolioEnd: portfolioEndValue, portfolioMwrr, invested, benchmarks };
}
