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
    expect(mid.credits - high.credits).toBeCloseTo(227.22, 2);
  });

  it("applies provincial basic personal credits outside Alberta", () => {
    const bc = calculateTaxFromIncome({ rrspRrif: 50_000 }, "BC", 65);
    const on = calculateTaxFromIncome({ rrspRrif: 50_000 }, "ON", 65);
    expect(bc.provincialTax).toBeCloseTo(2_059.90, 2);
    expect(on.provincialTax).toBeCloseTo(1_869.06, 2);
  });

  it("applies the 2026 federal and Alberta basic personal credits", () => {
    const result = calculateTaxFromIncome({ rrspRrif: 50_000 }, "AB", 65);
    // Federal tax includes the age credit: $8,790 - ($50,000 - $46,576) × 15% = $8,276.40 × 14% = $1,158.70
    expect(result.federalTax).toBeCloseTo(3_538.02, 2);
    expect(result.provincialTax).toBeCloseTo(2_178.48, 2);
    expect(result.totalTax).toBeCloseTo(5_716.50, 2);
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

  it("keeps growing recovery at 15% past the old 'upper threshold' until OAS is fully recovered (ITA s.180.2)", () => {
    // s.180.2 has no intermediate upper-income cap: recovery = min(OAS received,
    // 15% × excess). The published "upper thresholds" are just where 15% of the
    // excess catches up to a FULL pension — not an operative cap.
    const lower = calculateTaxFromIncome({ oas: 10_000, rrspRrif: 145_108 }, "AB", 65);
    const higher = calculateTaxFromIncome({ oas: 10_000, rrspRrif: 150_000 }, "AB", 65);
    // 0.15 × (155,108 − 95,323) = 8,967.75 vs 0.15 × (160,000 − 95,323) = 9,701.55
    expect(lower.oasRecovery).toBeCloseTo(8_967.75, 2);
    expect(higher.oasRecovery).toBeCloseTo(9_701.55, 2);
  });

  it("does not cap recovery of a deferred (boosted) OAS pension at the full-pension amount", () => {
    // Deferred to 70 (+36%): $9,023.64 × 1.36 ≈ $12,272 received.
    // s.180.2(a) is benefits RECEIVED, so recovery can exceed 15% × (upper − threshold).
    const result = calculateTaxFromIncome({ oas: 12_272, rrspRrif: 147_728 }, "AB", 70);
    // 0.15 × (160,000 − 95,323) = 9,701.55 < 12,272 → recovery = 9,701.55
    // (the old intermediate cap would have wrongly given 8,967.90)
    expect(result.oasRecovery).toBeCloseTo(9_701.55, 2);
  });

  it("indexes OAS recovery threshold to the tax year", () => {
    // 2026 threshold $95,323; in 2036 at 2% inflation ≈ $116,100
    const income2026 = 100_000;
    const result2026 = calculateTaxFromIncome({ oas: 10_000, rrspRrif: income2026 }, "AB", 65, 2026, 2);
    const result2036 = calculateTaxFromIncome({ oas: 10_000, rrspRrif: income2026 }, "AB", 65, 2036, 2);
    // Same nominal income, but higher threshold in 2036 → less recovery
    expect(result2036.oasRecovery).toBeLessThan(result2026.oasRecovery);
  });

  it("indexes tax brackets to the tax year", () => {
    // $60,000 income in 2026 vs 2046: brackets should inflate, lowering the rate
    const result2026 = calculateTaxFromIncome({ rrspRrif: 60_000 }, "AB", 65, 2026, 2);
    const result2046 = calculateTaxFromIncome({ rrspRrif: 60_000 }, "AB", 65, 2046, 2);
    expect(result2046.totalTax).toBeLessThan(result2026.totalTax);
  });

  it("applies the federal age credit at 65+", () => {
    const at64 = calculateTaxFromIncome({ rrspRrif: 50_000 }, "AB", 64, 2026, 2);
    const at65 = calculateTaxFromIncome({ rrspRrif: 50_000 }, "AB", 65, 2026, 2);
    // Age credit at $50K: ($8,790 - ($50,000 - $46,576) × 15%) × 14% = $1,158.70
    expect(at64.totalTax - at65.totalTax).toBeCloseTo(1158.70, 0);
  });

  it("reduces the age credit above the income threshold", () => {
    const lowIncome = calculateTaxFromIncome({ rrspRrif: 40_000 }, "AB", 65, 2026, 2);
    const highIncome = calculateTaxFromIncome({ rrspRrif: 100_000 }, "AB", 65, 2026, 2);
    // High income partially phases out the age credit, so the tax difference
    // should exceed just the bracket difference
    expect(highIncome.totalTax - lowIncome.totalTax).toBeGreaterThan(0);
  });

  it("keeps pension income available for a future pension-income credit", () => {
    const result = buildTaxIncome({ pension: 24_000 });
    expect(result.totalIncome).toBe(24_000);
    expect(result.netIncome).toBe(24_000);
    expect(result.taxableIncome).toBe(24_000);
  });
});
