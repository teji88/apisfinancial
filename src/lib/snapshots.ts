/**
 * Phase 2 anchor caching: completed months are valued once and stored as
 * month-end snapshots. Only the months after the last valid snapshot (usually
 * just the current month) are calculated live, so the page only needs recent
 * price history instead of the whole 10–25 year curve.
 */
import type { HistoryPoint } from "./history.server";
import type { Holding, Transaction } from "./finance";
import { xirr } from "./finance";
import {
  closeOn,
  contributionFlows,
  fxOn,
  portfolioValueSeries,
  stepFlowSeries,
  windowGrid,
  type BenchmarkChoice,
  type BenchmarkResult,
  type ComparisonResult,
  type SeriesMap,
} from "./benchmark";

export type Snapshot = {
  month_end: string;
  ledger_hash: string;
  portfolio_value: number;
  benchmarks: Record<string, { units: number; value: number }>;
};

/** Last calendar day of every month from `start` up to the month before today. */
export function completedMonthEnds(start: string, today: string): string[] {
  const out: string[] = [];
  const [ys, ms] = start.split("-").map(Number) as [number, number];
  const [yt, mt] = today.split("-").map(Number) as [number, number];
  let y = ys;
  let m = ms;
  while (y < yt || (y === yt && m < mt)) {
    out.push(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function fnv(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Cumulative fingerprint of everything that affects the value on each
 * month-end: every transaction on or before it, the symbol it points at, and
 * which accounts keep a cash balance. Editing an old trade changes the hash
 * from that month onward, so those snapshots are recalculated.
 */
export function monthEndHashes(
  monthEnds: string[],
  transactions: Transaction[],
  holdings: Holding[],
  cashAccounts: Set<string> | undefined,
  scope: string,
): string[] {
  const sym = new Map(holdings.map((h) => [h.id, h.symbol.toUpperCase()]));
  const txns = transactions
    .slice()
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || a.id.localeCompare(b.id));
  let h = fnv(2166136261, `v1|${scope}|${cashAccounts ? [...cashAccounts].sort().join(",") : "*"}`);
  let i = 0;
  return monthEnds.map((me) => {
    while (i < txns.length && txns[i]!.transaction_date <= me) {
      const t = txns[i]!;
      h = fnv(
        h,
        [t.id, t.transaction_date, t.transaction_type, t.account_id, t.holding_id ? sym.get(t.holding_id) : "",
          t.units, t.price_per_unit, t.amount, t.fx_rate, t.fee].join("|"),
      );
      i++;
    }
    return h.toString(36);
  });
}

/** Longest run of stored months, from the first, that still matches the ledger and benchmarks. */
export function validPrefix(
  monthEnds: string[],
  hashes: string[],
  stored: Snapshot[],
  symbols: string[],
): Snapshot[] {
  const byDate = new Map(stored.map((s) => [s.month_end, s]));
  const out: Snapshot[] = [];
  for (let i = 0; i < monthEnds.length; i++) {
    const s = byDate.get(monthEnds[i]!);
    if (!s || s.ledger_hash !== hashes[i]) break;
    if (!symbols.every((sy) => s.benchmarks?.[sy] != null)) break;
    out.push(s);
  }
  return out;
}

/** Earliest date the live calculation needs price history from. */
export function historyStartFor(anchor: Snapshot | undefined, start: string): string {
  if (!anchor) return start;
  const d = new Date(`${anchor.month_end}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 10);
  return d.toISOString().slice(0, 10);
}

export function buildAnchoredComparison(args: {
  transactions: Transaction[];
  holdings: Holding[];
  history: SeriesMap;
  fx: HistoryPoint[];
  fxNow: number;
  portfolioEndValue: number;
  selection: BenchmarkChoice[];
  cashAccounts?: Set<string>;
  windowStart: string;
  anchors: Snapshot[];
  monthEnds: string[];
  hashes: string[];
}): { comparison: ComparisonResult | null; fresh: Snapshot[] } {
  const { transactions, holdings, history, fx, fxNow, portfolioEndValue, selection, cashAccounts, anchors } = args;
  if (transactions.length === 0) return { comparison: null, fresh: [] };
  const flows = contributionFlows(transactions, cashAccounts);
  const start = transactions.map((t) => t.transaction_date).sort()[0]!;
  const end = new Date().toISOString().slice(0, 10);
  const anchor = anchors[anchors.length - 1];
  const tailStart = anchor?.month_end ?? start;

  const pendingMonths = args.monthEnds.filter((m) => m > tailStart || (!anchor && m >= start));
  const fine = windowGrid(tailStart, end, args.windowStart > tailStart ? args.windowStart : tailStart);
  const tailSet = new Set([...fine, ...pendingMonths]);
  if (anchor) tailSet.delete(anchor.month_end);
  const tailGrid = [...tailSet].filter((d) => d >= start).sort();

  const tailPortfolio = portfolioValueSeries(tailGrid, transactions, holdings, history, fx, fxNow, cashAccounts);

  const tailFlows = anchor ? flows.filter((f) => f.date > anchor.month_end) : flows;
  const benchTails = selection.map((b) => {
    const hist = history.get(b.symbol.toUpperCase());
    if (!hist || hist.points.length === 0) return null;
    const priceCad = (date: string) => {
      const c = closeOn(hist.points, date);
      if (c == null) return null;
      return c * (hist.currency === "USD" ? fxOn(fx, date, fxNow) : 1);
    };
    let units = anchor?.benchmarks[b.symbol]?.units ?? 0;
    let lastDate: string | null = anchor?.month_end ?? null;
    let idx = 0;
    const values: number[] = [];
    const unitsAt: number[] = [];
    for (const date of tailGrid) {
      if (lastDate && b.annualYield > 0) {
        const days = Math.max(0, (Date.parse(date) - Date.parse(lastDate)) / 86_400_000);
        units *= Math.exp((b.annualYield * days) / 365);
      }
      lastDate = date;
      while (idx < tailFlows.length && tailFlows[idx]!.date <= date) {
        const p = priceCad(tailFlows[idx]!.date);
        if (p && p > 0) units += tailFlows[idx]!.amount / p;
        idx++;
      }
      const p = priceCad(date);
      values.push(p != null ? units * p : 0);
      unitsAt.push(units);
    }
    return { values, unitsAt };
  });

  // Snapshots to save for every completed month computed live.
  const hashOf = new Map(args.monthEnds.map((m, i) => [m, args.hashes[i]!]));
  const fresh: Snapshot[] = [];
  tailGrid.forEach((d, i) => {
    const hash = hashOf.get(d);
    if (!hash) return;
    const benchmarks: Snapshot["benchmarks"] = {};
    selection.forEach((b, j) => {
      const t = benchTails[j];
      if (t) benchmarks[b.symbol] = { units: t.unitsAt[i]!, value: t.values[i]! };
    });
    fresh.push({ month_end: d, ledger_hash: hash, portfolio_value: tailPortfolio[i]!, benchmarks });
  });

  const grid = [...anchors.map((a) => a.month_end), ...tailGrid];
  const portfolio = [...anchors.map((a) => Number(a.portfolio_value)), ...tailPortfolio];
  if (portfolio.length > 0) portfolio[portfolio.length - 1] = portfolioEndValue;

  const invested = flows.reduce((s, f) => s + f.amount, 0);
  const xirrFlows = flows.map((f) => ({ date: new Date(f.date), amount: -f.amount }));
  const mw = (v: number) => (flows.length > 0 ? xirr([...xirrFlows, { date: new Date(end), amount: v }]) : null);

  const benchmarks: BenchmarkResult[] = selection.map((b, j) => {
    const t = benchTails[j];
    if (!t) return { ...b, values: grid.map(() => 0), endValue: 0, mwrr: null, available: false };
    const values = [...anchors.map((a) => Number(a.benchmarks[b.symbol]?.value ?? 0)), ...t.values];
    const endValue = values[values.length - 1] ?? 0;
    return { ...b, values, endValue, mwrr: mw(endValue), available: true };
  });

  return {
    comparison: {
      grid,
      portfolio,
      portfolioEnd: portfolioEndValue,
      portfolioMwrr: mw(portfolioEndValue),
      invested,
      stepFlows: stepFlowSeries(grid, flows),
      benchmarks,
    },
    fresh,
  };
}
