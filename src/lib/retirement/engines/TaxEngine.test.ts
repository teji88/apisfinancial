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


  it("caps OAS recovery at the OAS actually received", () => {
    const result = calculateTaxFromIncome({ oas: 5_000, rrspRrif: 200_000 }, "AB", 65);
    expect(result.oasRecovery).toBe(5_000);
    expect(result.totalTax).toBeGreaterThanOrEqual(result.oasRecovery);
  });

  it("uses the 2026 tax-year OAS recovery upper threshold", () => {
    const belowUpper = calculateTaxFromIncome({ oas: 10_000, rrspRrif: 145_108 }, "AB", 65);
    const aboveUpper = calculateTaxFromIncome({ oas: 10_000, rrspRrif: 145_110 }, "AB", 65);
    expect(aboveUpper.oasRecovery - belowUpper.oasRecovery).toBeCloseTo(0.30, 2);
  });

  it("keeps pension income available for a future pension-income credit", () => {
    const result = buildTaxIncome({ pension: 24_000 });
    expect(result.totalIncome).toBe(24_000);
    expect(result.netIncome).toBe(24_000);
    expect(result.taxableIncome).toBe(24_000);
  });
});
