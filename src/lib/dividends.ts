/**
 * Dividend analytics for MapleWealth.
 * Everything returned here is expressed in CAD unless stated otherwise.
 */

import type { Holding, HoldingPosition, Quote, Transaction } from "./finance";

export type DividendRow = {
  holdingId: string;
  accountId: string;
  symbol: string;
  name: string | null;
  currency: string;
  units: number;
  price: number | null;
  marketValue: number;
  acb: number;
  /** Forward annual dividend per share in the listing currency. */
  ratePerShare: number | null;
  /** Forward annual income in CAD. */
  forwardIncome: number;
  /** Current yield on market value, percent. */
  yieldPct: number | null;
  /** Forward income divided by adjusted cost base, percent. */
  yieldOnCostPct: number | null;
  /** Dividends actually received in the last 12 months, CAD. */
  received12m: number;
  exDivDate: string | null;
  exDivAmount: number | null;
};

function fxFor(currency: string, fxUsdCad: number): number {
  return currency === "USD" ? fxUsdCad : 1;
}

function cadAmount(t: Transaction): number {
  const fx = t.fx_rate || 1;
  if (t.amount != null && t.amount !== 0) return t.amount * fx;
  return (t.units || 0) * (t.price_per_unit || 0) * fx;
}

export function isDividendType(type: string): boolean {
  return type === "DIVIDEND" || type === "DRIP";
}

/** Sum of dividend + DRIP income in CAD over the trailing 12 months. */
export function receivedInWindow(
  transactions: Transaction[],
  fromIso: string,
  toIso: string,
): number {
  return transactions
    .filter(
      (t) =>
        isDividendType(t.transaction_type) &&
        t.transaction_date >= fromIso &&
        t.transaction_date <= toIso,
    )
    .reduce((sum, t) => sum + cadAmount(t), 0);
}

export function buildDividendRows(
  positions: HoldingPosition[],
  quotes: Record<string, Quote>,
  transactions: Transaction[],
  fxUsdCad: number,
  today = new Date(),
): DividendRow[] {
  const from = new Date(today.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);

  const byHolding = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.holding_id) continue;
    const list = byHolding.get(t.holding_id) ?? [];
    list.push(t);
    byHolding.set(t.holding_id, list);
  }

  return positions
    .filter((p) => p.units > 0)
    .map((p) => {
      const quote = quotes[p.symbol.toUpperCase()];
      const fx = fxFor(p.currency, fxUsdCad);
      const rate = quote?.dividendRate ?? null;
      const forwardIncome = rate != null ? rate * p.units * fx : 0;
      const received12m = receivedInWindow(byHolding.get(p.holdingId) ?? [], from, to);
      return {
        holdingId: p.holdingId,
        accountId: p.accountId,
        symbol: p.symbol,
        name: p.name,
        currency: p.currency,
        units: p.units,
        price: p.price,
        marketValue: p.marketValue,
        acb: p.acb,
        ratePerShare: rate,
        forwardIncome,
        yieldPct:
          quote?.dividendYield ??
          (rate != null && p.price ? (rate / p.price) * 100 : null),
        yieldOnCostPct: p.acb > 0 && forwardIncome > 0 ? (forwardIncome / p.acb) * 100 : null,
        received12m,
        exDivDate: quote?.exDivDate ?? null,
        exDivAmount: quote?.exDivAmount ?? null,
      };
    })
    .sort((a, b) => b.forwardIncome - a.forwardIncome);
}

export type MonthlyIncome = { month: string; label: string; amount: number };

/** Dividend income received per calendar month over the last 12 months. */
export function monthlyIncome(transactions: Transaction[], today = new Date()): MonthlyIncome[] {
  const months: MonthlyIncome[] = [];
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    const month = d.toISOString().slice(0, 7);
    months.push({
      month,
      label: d.toLocaleDateString("en-CA", { month: "short", timeZone: "UTC" }),
      amount: 0,
    });
  }
  const index = new Map(months.map((m, i) => [m.month, i]));
  for (const t of transactions) {
    if (!isDividendType(t.transaction_type)) continue;
    const key = t.transaction_date.slice(0, 7);
    const i = index.get(key);
    if (i == null) continue;
    months[i]!.amount += cadAmount(t);
  }
  return months;
}

export type ProjectionInput = {
  startingValue: number;
  startingIncome: number;
  dividendGrowthPct: number;
  priceGrowthPct: number;
  monthlyContribution: number;
  drip: boolean;
};

export type ProjectionYear = {
  year: number;
  portfolioValue: number;
  annualIncome: number;
  cumulativeIncome: number;
};

/**
 * Ten-year compounder projection. Contributions and (when DRIP is on)
 * dividends are reinvested at the portfolio's current yield.
 */
export function projectIncome(input: ProjectionInput, years = 10): ProjectionYear[] {
  const baseYield = input.startingValue > 0 ? input.startingIncome / input.startingValue : 0;
  let value = input.startingValue;
  let yieldOnValue = baseYield;
  let cumulative = 0;
  const out: ProjectionYear[] = [];

  for (let year = 1; year <= years; year++) {
    const contributions = input.monthlyContribution * 12;
    const income = value * yieldOnValue;
    cumulative += income;
    // Price appreciation, then new money, then reinvested dividends.
    value = value * (1 + input.priceGrowthPct / 100) + contributions + (input.drip ? income : 0);
    // Payouts per share grow faster than price in a compounder, so the
    // yield on the original cost rises; yield on market value drifts with
    // the gap between dividend growth and price growth.
    yieldOnValue =
      yieldOnValue *
      ((1 + input.dividendGrowthPct / 100) / (1 + input.priceGrowthPct / 100));
    out.push({
      year,
      portfolioValue: value,
      annualIncome: value * yieldOnValue,
      cumulativeIncome: cumulative,
    });
  }
  return out;
}

/** True when a dividend for this holding on this date is already in the ledger. */
export function alreadyRecorded(
  transactions: Transaction[],
  holdingId: string,
  date: string,
): boolean {
  return transactions.some(
    (t) =>
      t.holding_id === holdingId &&
      isDividendType(t.transaction_type) &&
      t.transaction_date === date,
  );
}

export type PendingDividend = {
  holdingId: string;
  accountId: string;
  symbol: string;
  currency: string;
  units: number;
  perShare: number;
  amount: number;
  exDivDate: string;
};

/**
 * Ex-dividend events reported by the market data feed that are not yet in the
 * ledger, with the cash amount this portfolio would have received.
 */
export function pendingDividends(
  rows: DividendRow[],
  transactions: Transaction[],
  holdings: Holding[],
): PendingDividend[] {
  const holdingById = new Map(holdings.map((h) => [h.id, h]));
  const out: PendingDividend[] = [];
  for (const row of rows) {
    if (!row.exDivDate || !row.exDivAmount || row.units <= 0) continue;
    if (alreadyRecorded(transactions, row.holdingId, row.exDivDate)) continue;
    const holding = holdingById.get(row.holdingId);
    out.push({
      holdingId: row.holdingId,
      accountId: row.accountId,
      symbol: row.symbol,
      currency: holding?.currency ?? row.currency,
      units: row.units,
      perShare: row.exDivAmount,
      amount: row.units * row.exDivAmount,
      exDivDate: row.exDivDate,
    });
  }
  return out.sort((a, b) => b.exDivDate.localeCompare(a.exDivDate));
}
