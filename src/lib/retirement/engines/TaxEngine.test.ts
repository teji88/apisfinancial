import { describe, expect, it } from "vitest";
import { buildTaxIncome, calculateTaxFromIncome } from "./TaxEngine";

describe("TaxEngine Canadian retirement ledgers", () => {
  it("keeps total income, net income, and taxable income distinct for capital gains", () => {
    const result = buildTaxIncome({ capitalGains: 20_000 });
    expect(result.totalIncome).toBe(20_000);
    expect(result.capitalGainInclusion).toBe(10_000);
    expect(result.netIncome).toBe(10_000);
    expect(result.taxableIncome).toBe(10_000);
  });

  it("applies the 2026 federal and Alberta basic personal credits", () => {
    const result = calculateTaxFromIncome({ rrspRrif: 50_000 }, "AB", 65);
    expect(result.federalTax).toBeCloseTo(4_696.72, 2);
    expect(result.provincialTax).toBeCloseTo(2_178.48, 2);
    expect(result.totalTax).toBeCloseTo(6_875.20, 2);
  });

  it("does not create tax from a zero-income return", () => {
    const result = calculateTaxFromIncome({}, "AB", 65);
    expect(result.totalIncome).toBe(0);
    expect(result.netIncome).toBe(0);
    expect(result.taxableIncome).toBe(0);
    expect(result.totalTax).toBe(0);
  });

  it("keeps pension income available for a future pension-income credit", () => {
    const result = buildTaxIncome({ pension: 24_000 });
    expect(result.totalIncome).toBe(24_000);
    expect(result.netIncome).toBe(24_000);
    expect(result.taxableIncome).toBe(24_000);
  });
});
