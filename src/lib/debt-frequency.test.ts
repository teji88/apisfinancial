import { describe, expect, it } from "vitest";
import {
  DEBT_PERIODS_PER_YEAR,
  monthlyEquivalentPayment,
  type DebtPaymentFrequency,
} from "./profile";
import { comparePayoffVsInvest } from "./retirement/optimization/DebtComparator";

describe("monthlyEquivalentPayment", () => {
  it("maps each frequency to the right monthly factor", () => {
    const cases: Array<[DebtPaymentFrequency, number]> = [
      ["weekly", 52 / 12],
      ["accelerated-weekly", 52 / 12],
      ["biweekly", 26 / 12],
      ["accelerated-biweekly", 26 / 12],
      ["semi-monthly", 2],
      ["monthly", 1],
    ];
    for (const [freq, factor] of cases) {
      expect(monthlyEquivalentPayment(1200, freq)).toBeCloseTo(1200 * factor, 8);
    }
  });

  it("defaults to monthly when frequency is unset (backward compatible)", () => {
    expect(monthlyEquivalentPayment(500)).toBe(500);
    expect(monthlyEquivalentPayment(500, undefined)).toBe(500);
  });

  it("clamps negatives to zero", () => {
    expect(monthlyEquivalentPayment(-100, "weekly")).toBe(0);
  });

  it("reproduces the reported weekly-mortgage case", () => {
    // $707.77 weekly ≈ $3,066.99/mo — covers $1,560.25/mo interest.
    expect(monthlyEquivalentPayment(707.77, "weekly")).toBeCloseTo(3066.99, 1);
  });

  it("periods-per-year table is consistent with the normalizer", () => {
    const freqs: DebtPaymentFrequency[] = [
      "weekly",
      "accelerated-weekly",
      "biweekly",
      "accelerated-biweekly",
      "semi-monthly",
      "monthly",
    ];
    for (const f of freqs) {
      expect(monthlyEquivalentPayment(1200, f)).toBeCloseTo(
        1200 * (DEBT_PERIODS_PER_YEAR[f] / 12),
        10,
      );
    }
  });
});

describe("comparator with frequency-normalized payments", () => {
  it("weekly payment covering interest yields a valid comparison (not never-amortizes)", () => {
    const monthly = monthlyEquivalentPayment(707.77, "weekly");
    const r = comparePayoffVsInvest({
      balance: 395_000,
      annualRate: 0.0474,
      monthlyPayment: monthly,
      extraMonthly: 200,
      expectedReturn: 0.06,
      marginalRate: 0.3,
      interestDeductible: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.acceleratedMonths).toBeLessThan(r.baseMonths!);
    }
  });

  it("the same amount treated as monthly still (correctly) never amortizes", () => {
    const r = comparePayoffVsInvest({
      balance: 395_000,
      annualRate: 0.0474,
      monthlyPayment: 707.77, // the old misreading
      extraMonthly: 200,
      expectedReturn: 0.06,
      marginalRate: 0.3,
      interestDeductible: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("never-amortizes");
  });

  it("missing-payment gate still fires when payment is zero regardless of frequency", () => {
    const r = comparePayoffVsInvest({
      balance: 395_000,
      annualRate: 0.0474,
      monthlyPayment: monthlyEquivalentPayment(0, "weekly"),
      extraMonthly: 200,
      expectedReturn: 0.06,
      marginalRate: 0.3,
      interestDeductible: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-payment");
  });
});
