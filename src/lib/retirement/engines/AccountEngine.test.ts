import { describe, expect, it } from "vitest";
import { createAccountState, estimateNonRegisteredMonthlyIncome, mandatoryRegisteredWithdrawal, rrifMinimumFactor, withdrawNonRegistered } from "./AccountEngine";

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

describe("RRIF/LIF minimum factors", () => {
  it("uses 1/(90-age) before 71 (CRA prescribed factor)", () => {
    expect(rrifMinimumFactor(65)).toBeCloseTo(0.04, 10);
    expect(rrifMinimumFactor(60)).toBeCloseTo(1 / 30, 10);
    expect(rrifMinimumFactor(70)).toBeCloseTo(0.05, 10);
  });

  it("uses the prescribed table at 71+", () => {
    expect(rrifMinimumFactor(71)).toBeCloseTo(0.0528, 10);
    expect(rrifMinimumFactor(80)).toBeCloseTo(0.0682, 10);
  });

  it("requires monthly minimum withdrawals from an early-converted RRIF", () => {
    // $100,000 at 65: 4% annual = $4,000/yr = $333.33/mo
    expect(mandatoryRegisteredWithdrawal("RRIF", 65, 100_000)).toBeCloseTo(100_000 * 0.04 / 12, 6);
    expect(mandatoryRegisteredWithdrawal("LIF", 70, 100_000)).toBeCloseTo(100_000 * 0.05 / 12, 6);
    expect(mandatoryRegisteredWithdrawal("RRSP", 65, 100_000)).toBe(0);
  });
});
