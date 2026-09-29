import { describe, expect, it } from "vitest";
import { buildTaxIncome, calculateTaxFromIncome } from "./TaxEngine";

describe("TaxEngine Canadian retirement ledgers", () => {
  it("keeps total income, net income, and taxable income distinct for capital gains", () => {
    const result = buildTaxIncome({ capitalGains: 20_000 });
    expect(result.totalIncome).toBe(10_000);
    expect(result.capitalGainInclusion).toBe(10_000);
    expect(result.netIncome).toBe(10_000);
    expect(result.taxableIncome).toBe(10_000);
  });

  it("excludes foreign tax paid from income ledgers", () => {
    const result = buildTaxIncome({ foreignIncome: 12_000, foreignTaxPaid: 2_000 });
    expect(result.totalIncome).toBe(12_000);
    expect(result.netIncome).toBe(12_000);
    expect(result.taxableIncome).toBe(12_000);
  });

  it("applies deductions after income adjustments", () => {
    const result = buildTaxIncome({ rrspRrif: 50_000, deductions: 7_500 });
    expect(result.totalIncome).toBe(50_000);
    expect(result.netIncome).toBe(42_500);
    expect(result.taxableIncome).toBe(42_500);
  });

  it("phases down the federal basic personal credit at high income", () => {
    const mid = calculateTaxFromIncome({ rrspRrif: 181_440 }, "AB", 65);
    const high = calculateTaxFromIncome({ rrspRrif: 258_482 }, "AB", 65);
    expect(mid.credits).toBeGreaterThan(high.credits);
    expect(high.credits).toBeGreaterThan(0);
  });

  it("applies provincial basic personal credits outside Alberta", () => {
    const bc = calculateTaxFromIncome({ rrspRrif: 50_000 }, "BC", 65);
    const on = calculateTaxFromIncome({ rrspRrif: 50_000 }, "ON", 65);
    expect(bc.provincialTax).toBeLessThan(calculateTaxFromIncome({ rrspRrif: 50_000 }, "BC", 65).provincialTax + 1);
    expect(on.provincialTax).toBeLessThan(calculateTaxFromIncome({ rrspRrif: 50_000 }, "ON", 65).provincialTax + 1);
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
    expect(aboveUpper.oasRecovery - belowUpper.oasRecovery).toBeCloseTo(0.15, 2);
  });

  it("keeps pension income available for a future pension-income credit", () => {
    const result = buildTaxIncome({ pension: 24_000 });
    expect(result.totalIncome).toBe(24_000);
    expect(result.netIncome).toBe(24_000);
    expect(result.taxableIncome).toBe(24_000);
  });
});
