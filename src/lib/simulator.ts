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
