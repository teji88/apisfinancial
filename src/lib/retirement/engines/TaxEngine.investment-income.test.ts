import { describe, expect, it } from "vitest";
import { calculateTaxFromIncome, buildTaxIncome } from "./TaxEngine";

describe("Canadian investment income taxation", () => {
  it("grosses up eligible dividends at 138%", () => {
    const ledgers = buildTaxIncome({ eligibleCanadianDividends: 10_000 });
    expect(ledgers.taxableCanadianDividends).toBe(13_800);
    expect(ledgers.eligibleDividendGrossUp).toBe(3_800);
  });

  it("grosses up non-eligible dividends at 115%", () => {
    const ledgers = buildTaxIncome({ nonEligibleCanadianDividends: 10_000 });
    expect(ledgers.taxableCanadianDividends).toBe(11_500);
    expect(ledgers.nonEligibleDividendGrossUp).toBe(1_500);
  });

  it("does not apply the Canadian dividend credit to foreign income", () => {
    const result = calculateTaxFromIncome({ foreignIncome: 10_000, foreignTaxPaid: 0 }, "AB", 65);
    expect(result.dividendTaxCredit).toBe(0);
  });

  it("caps foreign tax credit at foreign tax paid", () => {
    const result = calculateTaxFromIncome({ foreignIncome: 20_000, foreignTaxPaid: 2_000 }, "AB", 65);
    expect(result.foreignTaxCredit).toBeLessThanOrEqual(2_000);
  });

  it("reduces tax when eligible Canadian dividends receive a dividend credit", () => {
    const withDividend = calculateTaxFromIncome({ eligibleCanadianDividends: 20_000 }, "AB", 65);
    const withoutDividendCreditInput = calculateTaxFromIncome({ rrspRrif: 27_600 }, "AB", 65);
    expect(withDividend.dividendTaxCredit).toBeGreaterThan(0);
    expect(withDividend.totalTax).toBeLessThan(withoutDividendCreditInput.totalTax);
  });
});
