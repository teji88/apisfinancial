import { describe, expect, it } from "vitest";
import { computeNetWorth, splitDebtsByOwner } from "./NetWorth";

describe("computeNetWorth", () => {
  it("splits liquid vs illiquid and subtracts debts", () => {
    const r = computeNetWorth({
      homeValue: 600_000,
      otherPropertyValue: 0,
      cash: 20_000,
      investments: 250_000,
      debts: [{ balance: 400_000 }, { balance: 15_000 }],
    });
    expect(r.liquidAssets).toBe(270_000);
    expect(r.illiquidAssets).toBe(600_000);
    expect(r.totalAssets).toBe(870_000);
    expect(r.totalDebts).toBe(415_000);
    expect(r.netWorth).toBe(455_000);
  });

  it("handles no debts and no property", () => {
    const r = computeNetWorth({
      homeValue: 0,
      otherPropertyValue: 0,
      cash: 10_000,
      investments: 50_000,
      debts: [],
    });
    expect(r.netWorth).toBe(60_000);
    expect(r.totalDebts).toBe(0);
  });

  it("clamps negative inputs to zero", () => {
    const r = computeNetWorth({
      homeValue: -100,
      otherPropertyValue: 0,
      cash: 5_000,
      investments: 0,
      debts: [{ balance: -50 }],
    });
    expect(r.illiquidAssets).toBe(0);
    expect(r.totalDebts).toBe(0);
    expect(r.netWorth).toBe(5_000);
  });
});

describe("splitDebtsByOwner", () => {
  it("defaults untagged debts to self", () => {
    const r = splitDebtsByOwner([{ balance: 10_000 }, { balance: 5_000, owner: "self" }]);
    expect(r.selfDebts).toBe(15_000);
    expect(r.partnerDebts).toBe(0);
    expect(r.totalDebts).toBe(15_000);
  });

  it("splits joint debts 50/50 and counts them once in the total", () => {
    const r = splitDebtsByOwner([
      { balance: 400_000, owner: "joint" },
      { balance: 20_000, owner: "partner" },
      { balance: 10_000 }, // untagged -> self
    ]);
    expect(r.selfDebts).toBe(210_000);
    expect(r.partnerDebts).toBe(220_000);
    expect(r.totalDebts).toBe(430_000);
  });

  it("clamps negative balances and handles empty input", () => {
    const r = splitDebtsByOwner([{ balance: -100, owner: "joint" }]);
    expect(r.selfDebts).toBe(0);
    expect(r.partnerDebts).toBe(0);
    expect(r.totalDebts).toBe(0);
    const empty = splitDebtsByOwner([]);
    expect(empty.totalDebts).toBe(0);
  });
});
