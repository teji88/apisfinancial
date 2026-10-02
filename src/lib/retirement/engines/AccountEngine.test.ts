import { describe, expect, it } from "vitest";
import { createAccountState, estimateNonRegisteredMonthlyIncome, withdrawNonRegistered } from "./AccountEngine";

describe("non-registered account engine", () => {
  it("tracks ACB and realizes proportional capital gains", () => {
    const account = createAccountState({
      id: "nr",
      owner: "MAIN_USER",
      type: "NON_REGISTERED",
      valuation: { mode: "MANUAL", value: 100_000 },
      nonRegisteredAcb: 60_000,
    });
    const result = withdrawNonRegistered(account, 10_000);
    expect(result.taken).toBe(10_000);
    expect(result.returnOfCapital).toBe(6_000);
    expect(result.realizedCapitalGain).toBe(4_000);
    expect(account.nonRegisteredAcb).toBe(54_000);
    expect(account.balance).toBe(90_000);
  });

  it("estimates taxable investment income from configured yields", () => {
    const account = createAccountState({
      id: "nr",
      owner: "MAIN_USER",
      type: "NON_REGISTERED",
      valuation: { mode: "MANUAL", value: 120_000 },
      nonRegisteredAcb: 80_000,
      nonRegisteredEligibleDividendYield: 2,
      nonRegisteredInterestYield: 1,
      nonRegisteredForeignIncomeYield: 1,
      nonRegisteredForeignTaxRate: 15,
    });
    const income = estimateNonRegisteredMonthlyIncome(account);
    expect(income.eligibleCanadianDividends).toBeCloseTo(200, 6);
    expect(income.interest).toBeCloseTo(100, 6);
    expect(income.foreignIncome).toBeCloseTo(100, 6);
    expect(income.foreignTaxPaid).toBeCloseTo(15, 6);
  });

  it("defaults missing ACB to starting market value", () => {
    const account = createAccountState({
      id: "nr",
      owner: "MAIN_USER",
      type: "NON_REGISTERED",
      valuation: { mode: "MANUAL", value: 50_000 },
    });
    const result = withdrawNonRegistered(account, 5_000);
    expect(result.realizedCapitalGain).toBe(0);
    expect(result.returnOfCapital).toBe(5_000);
  });
});
