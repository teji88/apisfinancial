import { describe, expect, it } from "vitest";
import {
  comparePayoffVsInvest,
  MISSING_PAYMENT_PROMPT,
  PAYOFF_DISCLAIMER,
  type PayoffVsInvestSuccess,
} from "./DebtComparator";

function expectSuccess(r: ReturnType<typeof comparePayoffVsInvest>): asserts r is PayoffVsInvestSuccess {
  expect(r.ok).toBe(true);
}

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
    expectSuccess(r);
    expect(r.monthsSaved).toBeGreaterThan(0);
    expect(r.interestSavedAfterTax).toBeGreaterThan(0);
    expect(r.acceleratedMonths).toBeLessThan(r.baseMonths!);
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
    expectSuccess(nonDed);
    expectSuccess(ded);
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
    expectSuccess(r);
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
    expectSuccess(r);
    expect(r.netAdvantageInvesting).toBeLessThan(0);
  });

  it("blocks with missing-payment when the regular payment is zero (not zeros)", () => {
    // Gurteg's case: $395k mortgage, $200/mo extra, payment never entered.
    const r = comparePayoffVsInvest({
      balance: 395_000,
      annualRate: 0.05,
      monthlyPayment: 0,
      extraMonthly: 200,
      expectedReturn: 0.06,
      marginalRate: 0.3,
      interestDeductible: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("missing-payment");
      expect(r.monthlyInterest).toBeCloseTo(395_000 * 0.05 / 12, 2);
      expect(r.disclaimer).toBe(PAYOFF_DISCLAIMER);
    }
    expect(MISSING_PAYMENT_PROMPT).toContain("Debts tab");
  });

  it("blocks with missing-payment for negative payments too", () => {
    const r = comparePayoffVsInvest({
      balance: 10_000, annualRate: 0.05, monthlyPayment: -50, extraMonthly: 100,
      expectedReturn: 0.06, marginalRate: 0.3, interestDeductible: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-payment");
  });

  it("blocks with never-amortizes and explicit figures when payment + extra can't cover interest", () => {
    const r = comparePayoffVsInvest({
      balance: 100_000,
      annualRate: 0.12,
      monthlyPayment: 500, // interest alone is $1000/mo
      extraMonthly: 100,
      expectedReturn: 0.06,
      marginalRate: 0.3,
      interestDeductible: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("never-amortizes");
      expect(r.monthlyPayment).toBe(500);
      expect(r.fullPayment).toBe(600);
      expect(r.monthlyInterest).toBeCloseTo(1000, 2);
    }
  });

  it("treats a genuine interest-only payment (extra = 0) as never-amortizes", () => {
    const r = comparePayoffVsInvest({
      balance: 100_000,
      annualRate: 0.12,
      monthlyPayment: 1000, // exactly the monthly interest
      extraMonthly: 0,
      expectedReturn: 0.06,
      marginalRate: 0.3,
      interestDeductible: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("never-amortizes");
  });

  it("still compares when the extra rescues an underpaying base (baseMonths null + warning)", () => {
    const r = comparePayoffVsInvest({
      balance: 100_000,
      annualRate: 0.12,
      monthlyPayment: 500,
      extraMonthly: 600, // 1100 > 1000 interest: accelerated amortizes
      expectedReturn: 0.06,
      marginalRate: 0.3,
      interestDeductible: false,
    });
    expectSuccess(r);
    expect(r.baseMonths).toBeNull();
    expect(r.monthsSaved).toBeNull();
    expect(r.acceleratedMonths).toBeGreaterThan(0);
    expect(r.warnings.length).toBeGreaterThan(0);
    // Degenerate horizon (base never pays off): no wealth comparison is
    // meaningful, so the advantage is 0 — not the accelerated interest, as
    // the old double-counted formula produced.
    expect(r.netAdvantageInvesting).toBe(0);
  });

  it("does not double-count interest when the debt rate equals the expected return", () => {
    // Same rate on both sides: the two paths spend identical total cash, so
    // terminal wealth is nearly identical — the old formula understated the
    // investing advantage by the full interest saved (~$77k here).
    const r = comparePayoffVsInvest({
      balance: 100_000,
      annualRate: 0.06,
      monthlyPayment: 600,
      extraMonthly: 400,
      expectedReturn: 0.06,
      marginalRate: 0.3,
      interestDeductible: false,
    });
    expectSuccess(r);
    expect(r.interestSavedAfterTax).toBeGreaterThan(50_000);
    expect(Math.abs(r.netAdvantageInvesting)).toBeLessThan(r.interestSavedAfterTax * 0.05);
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
