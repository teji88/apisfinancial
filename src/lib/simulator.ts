/**
 * Client-safe configuration for the public "Did I beat XEQT?" simulator.
 *
 * The simulator is the only part of Apis Financial that works without an
 * account. It runs on the same shared market-history library the app uses, so
 * every symbol someone tries is saved for everyone who comes later.
 */

export type SimBenchmark = {
  symbol: string;
  label: string;
  note: string;
  /** Indicative annual distribution yield, reinvested in total-return mode. */
  annualYield: number;
  color: string;
};

export const SIM_BENCHMARKS: SimBenchmark[] = [
  {
    symbol: "XEQT.TO",
    label: "XEQT",
    note: "iShares All-Equity ETF Portfolio (CAD)",
    annualYield: 0.019,
    color: "hsl(41 96% 45%)",
  },
  {
    symbol: "ZEQT.TO",
    label: "ZEQT",
    note: "BMO All-Equity ETF (CAD)",
    annualYield: 0.019,
    color: "hsl(24 88% 50%)",
  },
  {
    symbol: "VCN.TO",
    label: "VCN",
    note: "Vanguard FTSE Canada All Cap (CAD)",
    annualYield: 0.028,
    color: "hsl(160 55% 38%)",
  },
  {
    symbol: "SPY",
    label: "SPY",
    note: "SPDR S&P 500 ETF Trust (USD)",
    annualYield: 0.013,
    color: "hsl(210 70% 48%)",
  },
];

export const SIM_PERIODS = [
  { id: "1Y", label: "1 year", years: 1 },
  { id: "3Y", label: "3 years", years: 3 },
  { id: "5Y", label: "5 years", years: 5 },
  { id: "10Y", label: "10 years", years: 10 },
  { id: "MAX", label: "As far back as we have", years: 25 },
] as const;

export type SimPeriod = (typeof SIM_PERIODS)[number]["id"];

export const SIM_START_AMOUNT = 10000;
export const SIM_MAX_HOLDINGS = 5;

export type WeightInput = { symbol: string; weight: string };

/**
 * Resolves benchmark-simulator holding weights from the form rows.
 *
 * Weight inputs are percentage strings. A blank input means "split evenly"
 * (per the UI copy); an explicit 0 — or anything non-positive — means
 * "exclude this holding". Blank rows share the unallocated remainder of a
 * 100% allocation evenly; when nothing is explicit they split 100% evenly;
 * when the explicit weights already cover 100%+, blanks resolve to nothing
 * and are dropped. Non-numeric input is treated as blank.
 */
export function resolveHoldingWeights(rows: WeightInput[]): Array<{ symbol: string; weight: number }> {
  const parsed = rows
    .map((r) => {
      const symbol = r.symbol.trim().toUpperCase();
      const raw = r.weight.trim();
      const num = raw === "" ? null : Number(raw);
      return { symbol, weight: num == null || Number.isNaN(num) ? null : num };
    })
    .filter((r) => r.symbol.length > 0 && (r.weight == null || r.weight > 0));
  const explicit = parsed.filter(
    (r): r is { symbol: string; weight: number } => r.weight != null,
  );
  const blanks = parsed.filter((r) => r.weight == null);
  const explicitSum = explicit.reduce((s, r) => s + r.weight, 0);
  let blankWeight = 0;
  if (blanks.length > 0) {
    blankWeight =
      explicit.length === 0 ? 100 / blanks.length : Math.max(0, (100 - explicitSum) / blanks.length);
  }
  return [
    ...explicit,
    ...blanks.map((r) => ({ symbol: r.symbol, weight: blankWeight })),
  ].filter((r) => r.weight > 0);
}

/**
 * Benchmarks whose history starts within this many days AFTER the comparison
 * window begins are still usable — a fund that launched a day or two into the
 * window shouldn't vanish from "MAX". Anything later is dropped rather than
 * shortening everyone else's comparison.
 */
export const BENCHMARK_START_GRACE_DAYS = 7;

/** True when a benchmark's first history point covers the window start. */
export function benchmarkCoversStart(
  firstPointDate: string,
  windowStart: string,
  graceDays = BENCHMARK_START_GRACE_DAYS,
): boolean {
  if (firstPointDate <= windowStart) return true;
  return (Date.parse(firstPointDate) - Date.parse(windowStart)) / 86_400_000 <= graceDays;
}

/**
 * Total-return gross-up factor for a price series.
 *
 * The market-history library stores UNADJUSTED official closes (TMX/Nasdaq),
 * so a distribution yield is grossed up with (1+y)^t. If a series ever arrives
 * already dividend-adjusted, the gross-up must be skipped — otherwise
 * dividends are counted twice.
 */
export function totalReturnFactor(
  annualYield: number,
  years: number,
  priceSeriesAdjusted: boolean,
): number {
  if (priceSeriesAdjusted || !(annualYield > 0) || !(years > 0)) return 1;
  return Math.pow(1 + annualYield, years);
}

export type SimLine = {
  key: string;
  label: string;
  note: string;
  color: string;
  /** Value of the starting amount over time, price change only. */
  price: number[];
  /** Same, with distributions reinvested. */
  total: number[];
};

export type SimResult = {
  start: string;
  end: string;
  dates: string[];
  amount: number;
  you: SimLine;
  benchmarks: SimLine[];
  /** Symbols we could not price, echoed back so the page can say so. */
  missing: string[];
  /** Symbols that priced fine but had no distribution data. */
  noDividendData: string[];
};
