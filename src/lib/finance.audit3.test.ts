import { describe, expect, it } from "vitest";
import {
  annualise,
  buildValuationSeries,
  externalFlows,
  twrr,
  xirr,
  type Holding,
  type Quote,
  type Transaction,
} from "./finance";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function txn(partial: Partial<Transaction> & { transaction_date: string; transaction_type: string }): Transaction {
  return {
    id: `t-${partial.transaction_date}-${partial.transaction_type}`,
    account_id: "a1",
    holding_id: "h1",
    units: 0,
    price_per_unit: 0,
    amount: null,
    currency: "CAD",
    fx_rate: 1,
    fee: 0,
    ...partial,
  };
}

const holding: Holding = {
  id: "h1",
  account_id: "a1",
  symbol: "XYZ",
  name: null,
  asset_type: "stock",
  currency: "CAD",
};

const quotes: Record<string, Quote> = {
  XYZ: { price: 10, previousClose: 10, currency: "CAD" },
};

describe("audit #16 — xirr catastrophic-loss floor", () => {
  it("returns -99.99 instead of null when the investment lost essentially everything", () => {
    // $10,000 in, $0.50 left: true return ≈ -99.995%, below the bisection floor.
    const result = xirr([
      { date: d("2020-01-01"), amount: -10000 },
      { date: d("2021-01-01"), amount: 0.5 },
    ]);
    expect(result).toBe(-99.99);
  });

  it("still solves ordinary cases accurately", () => {
    const result = xirr([
      { date: d("2020-01-01"), amount: -1000 },
      { date: d("2021-01-01"), amount: 1100 },
    ]);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(9);
    expect(result!).toBeLessThan(11);
  });

  it("Newton still solves extreme positive returns (upside was never broken)", () => {
    const result = xirr([
      { date: d("2020-01-01"), amount: -100 },
      { date: d("2021-01-01"), amount: 200000 },
    ]);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(100000);
  });

  it("still returns null with no sign change in flows", () => {
    expect(
      xirr([
        { date: d("2020-01-01"), amount: -100 },
        { date: d("2021-01-01"), amount: -50 },
      ]),
    ).toBeNull();
  });
});

describe("audit #17 — DRIP treated as reinvested distribution", () => {
  // Non-cash-tracking account: pass an explicit set that does NOT contain a1,
  // otherwise tracksCash() defaults to true.
  const noCash = new Set<string>();

  const buy = txn({ transaction_type: "BUY", transaction_date: "2020-01-01", units: 100, price_per_unit: 10 });
  const drip = txn({ transaction_type: "DRIP", transaction_date: "2021-01-01", units: 10, price_per_unit: 10 });

  it("books explicit offsetting DRIP legs in externalFlows (net zero)", () => {
    const flows = externalFlows([buy, drip], noCash);
    expect(flows).toHaveLength(3);
    expect(flows[0]).toMatchObject({ amount: -1000 });
    const dripLegs = flows.slice(1).map((f) => f.amount).sort((a, b) => a - b);
    expect(dripLegs).toEqual([-100, 100]);
    // Net external flow is just the original contribution — the DRIP is not
    // a new contribution.
    expect(flows.reduce((s, f) => s + f.amount, 0)).toBe(-1000);
  });

  it("TWRR counts the DRIP dividend as return", () => {
    const points = buildValuationSeries([buy, drip], [holding], quotes, 1.37, noCash);
    expect(twrr(points)).toBeCloseTo(10, 6);
  });

  it("XIRR agrees with TWRR on the DRIP scenario", () => {
    const flows = externalFlows([buy, drip], noCash);
    const points = buildValuationSeries([buy, drip], [holding], quotes, 1.37, noCash);
    const total = twrr(points)!;
    const endValue = points[points.length - 1]!.value;
    const mwrr = xirr([...flows, { date: new Date(), amount: endValue }]);
    expect(mwrr).not.toBeNull();
    expect(mwrr!).toBeCloseTo(annualise(total, points)!, 0.5);
  });

  it("a DRIP in a cash-tracking account moves no cash and creates no flow", () => {
    const cash = new Set(["a1"]);
    const flows = externalFlows([buy, drip], cash);
    // Only the initial funding shortfall from the buy; the DRIP adds nothing.
    expect(flows).toHaveLength(1);
    expect(flows[0]!.amount).toBe(-1000);
  });
});
