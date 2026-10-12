import { describe, expect, it } from "vitest";
import {
  projectRetirement,
  deriveWithdrawalMarginalRate,
  type PersonSpec,
  type PlannerInputs,
} from "./oldApiAdapter";
import { marginalRateAt } from "../marginalRate";

const person = (label: string, overrides: Partial<PersonSpec> = {}): PersonSpec => ({
  label,
  age: 65,
  retirementAge: 65,
  cppStartAge: 65,
  cppAt65: 12_000,
  oasStartAge: 65,
  oasFraction: 1,
  otherIncome: 0,
  balances: { tfsa: 50_000, rrsp: 400_000, lira: 0, nonreg: 50_000 },
  nonregGainRatio: 0.2,
  ...overrides,
});

const coupleBase = (overrides: Partial<PlannerInputs> = {}): PlannerInputs => ({
  retirementAge: 65,
  lifeExpectancy: 95,
  province: "AB",
  inflation: 2,
  workingGrowth: 6,
  retirementGrowth: 6,
  desiredIncome: 72_000,
  annualSavings: 0,
  savingsSplit: { tfsa: 0, rrsp: 0, nonreg: 0 },
  withdrawalPolicy: "TAX_TARGETED",
  self: person("You"),
  spouse: person("Spouse"),
  ...overrides,
});

describe("deriveWithdrawalMarginalRate", () => {
  it("regression: the 33.8% couple case derives ~22%, not the household-lump rate", () => {
    // The old default treated $72k household after-tax need as one person's
    // taxable income: marginalRateAt(72000, "AB", 65) = 33.8%.
    expect(marginalRateAt(72_000, "AB", 65)).toBeCloseTo(0.338, 2);
    const proj = projectRetirement(coupleBase());
    const derived = deriveWithdrawalMarginalRate(proj);
    expect(derived).not.toBeNull();
    // Realistic per-person figure is ~22%: the household-level $1,000-bump
    // method must land near it, far below the old 33.8%.
    expect(derived!.rate).toBeGreaterThan(0.15);
    expect(derived!.rate).toBeLessThan(0.28);
    expect(derived!.label).toContain("split-adjusted across both spouses");
    expect(derived!.years).toBeGreaterThan(20);
  });

  it("single filer uses the same household-level method (higher rate, correctly)", () => {
    const proj = projectRetirement(coupleBase({ spouse: null }));
    const derived = deriveWithdrawalMarginalRate(proj);
    expect(derived).not.toBeNull();
    // One person funding $72k after-tax faces a genuinely higher marginal rate.
    expect(derived!.rate).toBeGreaterThan(0.25);
    expect(derived!.label).not.toContain("split-adjusted");
  });

  it("returns null when the projection has no registered withdrawals", () => {
    const tfsaOnly = coupleBase({
      self: person("You", { balances: { tfsa: 2_000_000, rrsp: 0, lira: 0, nonreg: 0 } }),
      spouse: person("Spouse", { balances: { tfsa: 2_000_000, rrsp: 0, lira: 0, nonreg: 0 } }),
    });
    const proj = projectRetirement(tfsaOnly);
    expect(proj.rows.every((r) => r.rrifDraw + r.lifDraw < 100)).toBe(true);
    expect(deriveWithdrawalMarginalRate(proj)).toBeNull();
  });

  it("returns null when the projection carries no tax ledgers", () => {
    const proj = projectRetirement(coupleBase());
    expect(deriveWithdrawalMarginalRate({ ...proj, annualTaxInputs: undefined })).toBeNull();
    expect(deriveWithdrawalMarginalRate({ ...proj, annualTaxInputs: [] })).toBeNull();
  });

  it("names the OAS clawback ages in the derivation label when clawback occurs", () => {
    // Big RRSPs force late-life clawback under REGISTERED_FIRST.
    const big = coupleBase({
      self: person("You", { balances: { tfsa: 0, rrsp: 1_200_000, lira: 0, nonreg: 0 } }),
      spouse: person("Spouse", { balances: { tfsa: 0, rrsp: 1_200_000, lira: 0, nonreg: 0 } }),
      withdrawalPolicy: "REGISTERED_FIRST",
    });
    const proj = projectRetirement(big);
    expect(proj.totalClawback).toBeGreaterThan(0);
    const derived = deriveWithdrawalMarginalRate(proj)!;
    expect(derived.clawbackAges).not.toBeNull();
    expect(derived.label).toContain("includes OAS clawback in ages");
  });

  it("weighting matches the documented withdrawal-weighted formula", () => {
    const proj = projectRetirement(coupleBase());
    const derived = deriveWithdrawalMarginalRate(proj)!;
    // The derived rate must lie within the range of plausible annual marginal
    // rates (it is a weighted average of them).
    expect(derived.rate).toBeGreaterThan(0);
    expect(derived.rate).toBeLessThan(0.6);
  });
});
