import { describe, expect, it } from "vitest";
import { buildTaxIncome, calculateTaxFromIncome } from "./TaxEngine";

describe("TaxEngine pension income", () => {
  it("limits pension splitting to 50% of eligible pension income", () => {
    const ledgers = buildTaxIncome({
      pension: 40_000,
      eligiblePensionIncome: 40_000,
      pensionSplitPercent: 75,
      age: 70,
    });
    expect(ledgers.pensionSplit).toBe(20_000);
    expect(ledgers.totalIncome).toBe(40_000);
    expect(ledgers.netIncome).toBe(20_000);
  });

  it("does not allow pension splitting before age 65 in the simplified V1 model", () => {
    const ledgers = buildTaxIncome({
      pension: 40_000,
      eligiblePensionIncome: 40_000,
      pensionSplitPercent: 50,
      age: 64,
    });
    expect(ledgers.pensionSplit).toBe(0);
    expect(ledgers.netIncome).toBe(40_000);
  });

  it("calculates the pension-income credit base up to $2,000", () => {
    const ledgers = buildTaxIncome({
      eligiblePensionIncome: 8_000,
      pensionSplitPercent: 50,
      age: 70,
    });
    expect(ledgers.pensionIncomeCreditBase).toBe(2_000);
  });

  it("does not treat CPP or OAS as eligible pension income", () => {
    const ledgers = buildTaxIncome({
      cpp: 12_000,
      oas: 9_000,
      age: 70,
    });
    expect(ledgers.pensionSplit).toBe(0);
    expect(ledgers.pensionIncomeCreditBase).toBe(0);
  });

  it("exposes pension split in the tax calculation without changing total household income", () => {
    const unsplit = calculateTaxFromIncome({
      pension: 60_000,
      eligiblePensionIncome: 60_000,
      age: 70,
    }, "AB", 70);
    const split = calculateTaxFromIncome({
      pension: 60_000,
      eligiblePensionIncome: 60_000,
      pensionSplitPercent: 50,
      age: 70,
    }, "AB", 70);
    expect(split.totalIncome).toBe(unsplit.totalIncome);
    expect(split.netIncome).toBeLessThan(unsplit.netIncome);
  });
});
