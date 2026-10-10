import { describe, expect, it } from "vitest";
import { comparePayoffVsInvest, PAYOFF_DISCLAIMER } from "./DebtComparator";

describe("comparePayoffVsInvest", () => {
  it("extra payments save interest and time", () => {
    const r = comparePayoffVsInvest({
      balance: 20_000,
      annualRate: 0.06,
      monthlyPayment: 400,
      extraMonthly: 200,
      expectedReturn: 0.07,
      marginalRate: 0.35,
      interestDeductible: false,
    });
    expect(r.monthsSaved).toBeGreaterThan(0);
    expect(r.interestSavedAfterTax).toBeGreaterThan(0);
    expect(r.acceleratedMonths).toBeLessThan(r.baseMonths);
  });

  it("deductible interest is compared after-tax", () => {
    const nonDed = comparePayoffVsInvest({
      balance: 50_000, annualRate: 0.05, monthlyPayment: 800, extraMonthly: 300,
      expectedReturn: 0.06, marginalRate: 0.4, interestDeductible: false,
    });
    const ded = comparePayoffVsInvest({
      balance: 50_000, annualRate: 0.05, monthlyPayment: 800, extraMonthly: 300,
      expectedReturn: 0.06, marginalRate: 0.4, interestDeductible: true,
    });
    // Deductible interest costs less after tax, so the payoff saving is smaller.
    expect(ded.interestSavedAfterTax).toBeLessThan(nonDed.interestSavedAfterTax);
    expect(ded.interestSavedAfterTax).toBeCloseTo(nonDed.interestSavedAfterTax * 0.6, 0);
  });

  it("investing wins on expected value when returns clearly beat the rate", () => {
    const r = comparePayoffVsInvest({
      balance: 10_000,
      annualRate: 0.03,
      monthlyPayment: 300,
      extraMonthly: 500,
      expectedReturn: 0.08,
      marginalRate: 0.3,
      interestDeductible: false,
    });
    expect(r.netAdvantageInvesting).toBeGreaterThan(0);
  });

  it("payoff wins when the debt rate clearly beats expected returns", () => {
    const r = comparePayoffVsInvest({
      balance: 10_000,
      annualRate: 0.19,
      monthlyPayment: 300,
      extraMonthly: 200,
      expectedReturn: 0.05,
      marginalRate: 0.3,
      interestDeductible: false,
    });
    expect(r.netAdvantageInvesting).toBeLessThan(0);
  });

  it("warns when the payment does not cover interest", () => {
    const r = comparePayoffVsInvest({
      balance: 100_000,
      annualRate: 0.12,
      monthlyPayment: 500, // interest alone is $1000/mo
      extraMonthly: 100,
      expectedReturn: 0.06,
      marginalRate: 0.3,
      interestDeductible: false,
    });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.baseMonths).toBe(-1);
  });

  it("is informational only", () => {
    const r = comparePayoffVsInvest({
      balance: 10_000, annualRate: 0.05, monthlyPayment: 300, extraMonthly: 100,
      expectedReturn: 0.06, marginalRate: 0.3, interestDeductible: false,
    });
    expect(r.disclaimer).toBe(PAYOFF_DISCLAIMER);
    expect(r.disclaimer.toLowerCase()).toContain("not financial advice");
  });
});
