import { describe, expect, it } from "vitest";
import { calculateHouseholdTax } from "./TaxEngine";

describe("household pension splitting", () => {
  it("moves eligible pension income from payer to spouse", () => {
    const result = calculateHouseholdTax({
      payer: { pension: 60_000, eligiblePensionIncome: 60_000 },
      spouse: { pension: 10_000, eligiblePensionIncome: 10_000 },
      province: "AB",
      payerAge: 70,
      spouseAge: 70,
      pensionSplitPercent: 50,
    });

    expect(result.pensionSplit).toBe(30_000);
    expect(result.householdTotalIncome).toBe(70_000);
    expect(result.payer.totalIncome).toBe(30_000);
    expect(result.spouse.totalIncome).toBe(40_000);
  });

  it("caps the election at 50%", () => {
    const result = calculateHouseholdTax({
      payer: { pension: 80_000, eligiblePensionIncome: 80_000 },
      spouse: {},
      payerAge: 70,
      spouseAge: 70,
      pensionSplitPercent: 90,
    });
    expect(result.pensionSplit).toBe(40_000);
  });

  it("does not split before payer age 65 in the V1 model", () => {
    const result = calculateHouseholdTax({
      payer: { pension: 60_000, eligiblePensionIncome: 60_000 },
      spouse: {},
      payerAge: 64,
      spouseAge: 70,
      pensionSplitPercent: 50,
    });
    expect(result.pensionSplit).toBe(0);
    expect(result.householdTotalIncome).toBe(60_000);
  });

  it("keeps CPP and OAS outside the split", () => {
    const result = calculateHouseholdTax({
      payer: { cpp: 18_000, oas: 10_000 },
      spouse: {},
      payerAge: 70,
      spouseAge: 70,
      pensionSplitPercent: 50,
    });
    expect(result.pensionSplit).toBe(0);
    expect(result.payer.totalIncome).toBe(28_000);
  });
});
