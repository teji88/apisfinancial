import { describe, expect, it } from "vitest";
import { computeSmithSavings, SMITH_SAVINGS_DISCLAIMER } from "./SmithSavings";

describe("computeSmithSavings", () => {
  const base = {
    mortgageBalance: 300_000,
    mortgageRate: 0.05,
    mortgagePayment: 1_800,
    helocRate: 0.055,
    marginalRate: 0.35,
    interestPaidYtd: 2_000,
    interestClaimedPrior: 5_000,
    deductibleOutstanding: 60_000,
  };

  it("computes realized tax savings from deductible interest", () => {
    const r = computeSmithSavings(base);
    expect(r.taxSavedYtd).toBeCloseTo(700, 0); // 2000 * 0.35
    expect(r.taxSavedAllTime).toBeCloseTo(2_450, 0); // 7000 * 0.35
  });

  it("computes conversion progress", () => {
    const r = computeSmithSavings(base);
    expect(r.conversionPct).toBeCloseTo((60_000 / 360_000) * 100, 1);
  });

  it("shows the after-tax edge on borrowing cost", () => {
    const r = computeSmithSavings(base);
    expect(r.effectiveRate).toBeCloseTo(0.055 * 0.65, 4);
    expect(r.rateEdge).toBeCloseTo(0.055 * 0.35, 4);
  });

  it("projects growing yearly savings until the mortgage is gone", () => {
    const r = computeSmithSavings(base);
    expect(r.yearsToConvert).toBeGreaterThan(0);
    expect(r.yearlyProjection.length).toBe(r.yearsToConvert);
    // Savings grow as more debt converts to deductible.
    const first = r.yearlyProjection[0].taxSaved;
    const last = r.yearlyProjection[r.yearlyProjection.length - 1].taxSaved;
    expect(last).toBeGreaterThan(first);
    expect(r.totalProjected).toBeGreaterThan(0);
    // Total = sum of yearly.
    const sum = r.yearlyProjection.reduce((s, y) => s + y.taxSaved, 0);
    expect(r.totalProjected).toBeCloseTo(sum, 0);
  });

  it("handles no mortgage (fully converted)", () => {
    const r = computeSmithSavings({ ...base, mortgageBalance: 0, mortgagePayment: 0 });
    expect(r.yearlyProjection.length).toBe(0);
    expect(r.totalProjected).toBe(0);
    expect(r.conversionPct).toBe(100);
    expect(r.taxSavedYtd).toBeCloseTo(700, 0);
  });

  it("handles nothing started yet", () => {
    const r = computeSmithSavings({
      ...base,
      interestPaidYtd: 0,
      interestClaimedPrior: 0,
      deductibleOutstanding: 0,
    });
    expect(r.taxSavedAllTime).toBe(0);
    expect(r.conversionPct).toBe(0);
    // But the projection still shows what's possible.
    expect(r.totalProjected).toBeGreaterThan(0);
  });

  it("is informational only", () => {
    const r = computeSmithSavings(base);
    expect(r.disclaimer).toBe(SMITH_SAVINGS_DISCLAIMER);
    expect(r.disclaimer.toLowerCase()).toContain("not tax advice");
  });
});
