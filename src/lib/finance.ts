/**
 * MapleWealth core financial math engine.
 * All portfolio-level values are expressed in CAD.
 */

export const ACCOUNT_TYPES = [
  "TFSA",
  "RRSP",
  "Spousal RRSP",
  "LIRA",
  "LRSP",
  "RESP",
  "RDSP",
  "FHSA",
  "Non-Registered",
  "Corporate",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const REGISTERED_TYPES: string[] = [
  "TFSA",
  "RRSP",
  "Spousal RRSP",
  "LIRA",
  "LRSP",
  "RESP",
  "RDSP",
  "FHSA",
];

export const TRANSACTION_TYPES = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "DRIP",
  "DEPOSIT",
  "WITHDRAWAL",
  "FEE",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export type Account = {
  id: string;
  account_type: string;
  account_name: string;
  currency: string;
  institution: string | null;
  /**
   * When true the account keeps its own cash balance: deposits add cash, buys
   * spend it. When false (the default) a purchase is treated as money brought
   * in from outside, so the account value is just the market value of what is held.
   */
  track_cash?: boolean;
};

/** Ids of the accounts that keep an internal cash balance. */
export function cashTrackingIds(accounts: Account[]): Set<string> {
  return new Set(accounts.filter((a) => a.track_cash).map((a) => a.id));
}

function tracksCash(t: Transaction, cashAccounts?: Set<string>): boolean {
  return !cashAccounts || cashAccounts.has(t.account_id);
}


export type Holding = {
  id: string;
  account_id: string;
  symbol: string;
  name: string | null;
  asset_type: string;
  currency: string;
};

export type Transaction = {
  id: string;
  account_id: string;
  holding_id: string | null;
  transaction_type: string;
  units: number;
  price_per_unit: number;
  amount: number | null;
  currency: string;
  fx_rate: number;
  fee: number;
  transaction_date: string;
};

export type Quote = {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  currency: string | null;
  name?: string | null;
  dividendRate?: number | null;
  dividendYield?: number | null;
  exDivDate?: string | null;
  exDivAmount?: number | null;
};

/** CAD gross value of a transaction line (excluding fees). */
function grossCad(t: Transaction): number {
  const fx = t.fx_rate || 1;
  if (t.amount != null && t.amount !== 0) return t.amount * fx;
  return (t.units || 0) * (t.price_per_unit || 0) * fx;
}

function feeCad(t: Transaction): number {
  return (t.fee || 0) * (t.fx_rate || 1);
}

export type HoldingPosition = {
  holdingId: string;
  accountId: string;
  symbol: string;
  name: string | null;
  currency: string;
  assetType: string;
  units: number;
  /** Adjusted cost base in CAD for the remaining units. */
  acb: number;
  acbPerUnit: number;
  realizedGain: number;
  dividendsReceived: number;
  price: number | null;
  previousClose: number | null;
  marketValue: number;
  dayChange: number;
  unrealizedGain: number;
  totalReturn: number;
  totalReturnPct: number;
};

/**
 * Adjusted Cost Base, Canadian weighted-average-cost rules.
 * BUY / DRIP increase ACB by the full CAD cost including commission.
 * SELL removes a proportional slice of ACB and books the capital gain.
 */
export function computePositions(
  holdings: Holding[],
  transactions: Transaction[],
  quotes: Record<string, Quote>,
  fxUsdCad: number,
): HoldingPosition[] {
  const byHolding = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.holding_id) continue;
    const list = byHolding.get(t.holding_id) ?? [];
    list.push(t);
    byHolding.set(t.holding_id, list);
  }

  return holdings.map((h) => {
    const txns = (byHolding.get(h.id) ?? []).slice().sort(sortByDate);
    let units = 0;
    let acb = 0;
    let realized = 0;
    let dividends = 0;

    for (const t of txns) {
      const type = t.transaction_type;
      if (type === "BUY" || type === "DRIP") {
        units += t.units || 0;
        acb += grossCad(t) + feeCad(t);
      } else if (type === "SELL") {
        const sold = Math.min(t.units || 0, units);
        const acbSold = units > 0 ? (acb * sold) / units : 0;
        const proceeds = grossCad(t) - feeCad(t);
        realized += proceeds - acbSold;
        acb -= acbSold;
        units -= sold;
        if (units <= 1e-9) {
          units = 0;
          acb = 0;
        }
      } else if (type === "DIVIDEND") {
        dividends += grossCad(t);
      } else if (type === "FEE") {
        acb += feeCad(t) + grossCad(t);
      }
    }

    const quote = quotes[h.symbol.toUpperCase()];
    const fx = h.currency === "USD" ? fxUsdCad : 1;
    const price = quote?.price ?? null;
    const prev = quote?.previousClose ?? null;
    const marketValue = price != null ? units * price * fx : 0;
    const dayChange = price != null && prev != null ? units * (price - prev) * fx : 0;
    const unrealized = price != null ? marketValue - acb : 0;
    const totalReturn = unrealized + realized + dividends;

    return {
      holdingId: h.id,
      accountId: h.account_id,
      symbol: h.symbol,
      name: h.name,
      currency: h.currency,
      assetType: h.asset_type,
      units,
      acb,
      acbPerUnit: units > 0 ? acb / units : 0,
      realizedGain: realized,
      dividendsReceived: dividends,
      price,
      previousClose: prev,
      marketValue,
      dayChange,
      unrealizedGain: unrealized,
      totalReturn,
      totalReturnPct: acb > 0 ? (totalReturn / acb) * 100 : 0,
    };
  });
}

function sortByDate(a: Transaction, b: Transaction): number {
  return a.transaction_date.localeCompare(b.transaction_date);
}

/** Uninvested cash balance (CAD) held inside an account. */
export function cashBalance(transactions: Transaction[]): number {
  let cash = 0;
  for (const t of transactions) {
    switch (t.transaction_type) {
      case "DEPOSIT":
        cash += grossCad(t);
        break;
      case "WITHDRAWAL":
        cash -= grossCad(t);
        break;
      case "BUY":
        cash -= grossCad(t) + feeCad(t);
        break;
      case "SELL":
        cash += grossCad(t) - feeCad(t);
        break;
      case "DIVIDEND":
        cash += grossCad(t);
        break;
      case "DRIP":
        break;
      case "FEE":
        cash -= grossCad(t) + feeCad(t);
        break;
    }
  }
  return cash;
}

export type CashFlow = { date: Date; amount: number };

/** External cash flows only: deposits (-) and withdrawals (+) from the investor's view. */
export function externalFlows(transactions: Transaction[]): CashFlow[] {
  const flows: CashFlow[] = [];
  for (const t of transactions) {
    if (t.transaction_type === "DEPOSIT") {
      flows.push({ date: new Date(t.transaction_date), amount: -grossCad(t) });
    } else if (t.transaction_type === "WITHDRAWAL") {
      flows.push({ date: new Date(t.transaction_date), amount: grossCad(t) });
    }
  }
  return flows.sort((a, b) => a.date.getTime() - b.date.getTime());
}

const DAY = 86_400_000;

/**
 * Money-Weighted Rate of Return (XIRR) via Newton-Raphson with a
 * bisection fallback, using exact daily cash-flow timing.
 * Returns an annualised rate in percent, or null when not solvable.
 */
export function xirr(flows: CashFlow[], guess = 0.1): number | null {
  if (flows.length < 2) return null;
  const sorted = flows.slice().sort((a, b) => a.date.getTime() - b.date.getTime());
  const hasPos = sorted.some((f) => f.amount > 0);
  const hasNeg = sorted.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null;
  const t0 = sorted[0]!.date.getTime();
  const years = sorted.map((f) => (f.date.getTime() - t0) / (365 * DAY));

  const npv = (rate: number) =>
    sorted.reduce((sum, f, i) => sum + f.amount / Math.pow(1 + rate, years[i] ?? 0), 0);
  const dnpv = (rate: number) =>
    sorted.reduce(
      (sum, f, i) => sum - ((years[i] ?? 0) * f.amount) / Math.pow(1 + rate, (years[i] ?? 0) + 1),
      0,
    );

  let rate = guess;
  for (let i = 0; i < 60; i++) {
    const value = npv(rate);
    const slope = dnpv(rate);
    if (!isFinite(value) || !isFinite(slope) || Math.abs(slope) < 1e-12) break;
    const next = rate - value / slope;
    if (!isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - rate) < 1e-9) return next * 100;
    rate = next;
  }

  // Bisection fallback
  let low = -0.9999;
  let high = 10;
  let fLow = npv(low);
  let fHigh = npv(high);
  if (!isFinite(fLow) || !isFinite(fHigh) || fLow * fHigh > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-8) return mid * 100;
    if (fLow * fMid < 0) {
      high = mid;
      fHigh = fMid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return ((low + high) / 2) * 100;
}

export type ValuationPoint = { date: string; value: number; flow: number };

/**
 * Reconstructs a portfolio valuation series from the ledger.
 * Between trades, positions are valued at the most recent price seen in the
 * ledger for that symbol; the final point uses live market prices.
 */
export function buildValuationSeries(
  transactions: Transaction[],
  holdings: Holding[],
  quotes: Record<string, Quote>,
  fxUsdCad: number,
): ValuationPoint[] {
  const txns = transactions.slice().sort(sortByDate);
  if (txns.length === 0) return [];
  const holdingById = new Map(holdings.map((h) => [h.id, h]));

  const units = new Map<string, number>();
  const lastPrice = new Map<string, number>();
  let cash = 0;

  const points: ValuationPoint[] = [];
  let currentDate = txns[0]!.transaction_date;
  let flowOnDate = 0;

  const valueAt = (): number => {
    let total = cash;
    for (const [hid, u] of units) {
      const h = holdingById.get(hid);
      if (!h || u === 0) continue;
      const p = lastPrice.get(hid) ?? 0;
      const fx = h.currency === "USD" ? fxUsdCad : 1;
      total += u * p * fx;
    }
    return total;
  };

  for (const t of txns) {
    if (t.transaction_date !== currentDate) {
      points.push({ date: currentDate, value: valueAt(), flow: flowOnDate });
      currentDate = t.transaction_date;
      flowOnDate = 0;
    }
    const gross = grossCad(t);
    const fee = feeCad(t);
    switch (t.transaction_type) {
      case "DEPOSIT":
        cash += gross;
        flowOnDate += gross;
        break;
      case "WITHDRAWAL":
        cash -= gross;
        flowOnDate -= gross;
        break;
      case "BUY":
      case "DRIP":
        if (t.transaction_type === "BUY") cash -= gross + fee;
        if (t.holding_id) {
          units.set(t.holding_id, (units.get(t.holding_id) ?? 0) + (t.units || 0));
          if (t.price_per_unit) lastPrice.set(t.holding_id, t.price_per_unit);
        }
        break;
      case "SELL":
        cash += gross - fee;
        if (t.holding_id) {
          units.set(t.holding_id, (units.get(t.holding_id) ?? 0) - (t.units || 0));
          if (t.price_per_unit) lastPrice.set(t.holding_id, t.price_per_unit);
        }
        break;
      case "DIVIDEND":
        cash += gross;
        break;
      case "FEE":
        cash -= gross + fee;
        break;
    }
  }
  points.push({ date: currentDate, value: valueAt(), flow: flowOnDate });

  // Final point at today's live prices
  for (const [hid] of units) {
    const h = holdingById.get(hid);
    if (!h) continue;
    const q = quotes[h.symbol.toUpperCase()];
    if (q?.price != null) lastPrice.set(hid, q.price);
  }
  const today = new Date().toISOString().slice(0, 10);
  points.push({ date: today, value: valueAt(), flow: 0 });

  return points;
}

/**
 * Time-Weighted Return: chain-links sub-period returns between external
 * cash flows so deposit/withdrawal timing does not distort performance.
 * Returns total TWRR in percent.
 */
export function twrr(points: ValuationPoint[]): number | null {
  if (points.length < 2) return null;
  let chain = 1;
  let previousValue = points[0]!.value;
  let counted = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const startValue = previousValue;
    const endBeforeFlow = p.value - p.flow;
    if (startValue > 0) {
      chain *= endBeforeFlow / startValue;
      counted++;
    }
    previousValue = p.value;
  }
  if (counted === 0) return null;
  return (chain - 1) * 100;
}

/** Annualises a total return over the elapsed period of the series. */
export function annualise(totalPct: number, points: ValuationPoint[]): number | null {
  if (points.length < 2) return null;
  const first = new Date(points[0]!.date).getTime();
  const last = new Date(points[points.length - 1]!.date).getTime();
  const years = (last - first) / (365 * DAY);
  if (years <= 0.02) return null;
  return (Math.pow(1 + totalPct / 100, 1 / years) - 1) * 100;
}

export type AccountSummary = {
  account: Account;
  marketValue: number;
  cash: number;
  totalValue: number;
  acb: number;
  unrealizedGain: number;
  realizedGain: number;
  dividends: number;
  dayChange: number;
  netDeposits: number;
  mwrr: number | null;
  twrrTotal: number | null;
};

export function summariseAccount(
  account: Account,
  transactions: Transaction[],
  holdings: Holding[],
  quotes: Record<string, Quote>,
  fxUsdCad: number,
): AccountSummary {
  const positions = computePositions(holdings, transactions, quotes, fxUsdCad);
  const marketValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const cash = cashBalance(transactions);
  const totalValue = marketValue + cash;

  const flows = externalFlows(transactions);
  const netDeposits = flows.reduce((s, f) => s - f.amount, 0);
  const mwrr =
    flows.length > 0 && totalValue !== 0
      ? xirr([...flows, { date: new Date(), amount: totalValue }])
      : null;

  const series = buildValuationSeries(transactions, holdings, quotes, fxUsdCad);

  return {
    account,
    marketValue,
    cash,
    totalValue,
    acb: positions.reduce((s, p) => s + p.acb, 0),
    unrealizedGain: positions.reduce((s, p) => s + p.unrealizedGain, 0),
    realizedGain: positions.reduce((s, p) => s + p.realizedGain, 0),
    dividends: positions.reduce((s, p) => s + p.dividendsReceived, 0),
    dayChange: positions.reduce((s, p) => s + p.dayChange, 0),
    netDeposits,
    mwrr,
    twrrTotal: twrr(series),
  };
}

export function formatCad(value: number, fractionDigits = 2): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value || 0);
}

export function formatPct(value: number | null, digits = 2): string {
  if (value == null || !isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function formatUnits(value: number): string {
  return new Intl.NumberFormat("en-CA", { maximumFractionDigits: 4 }).format(value || 0);
}
