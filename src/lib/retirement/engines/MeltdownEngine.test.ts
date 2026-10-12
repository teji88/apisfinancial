import { describe, expect, it } from "vitest";
import {
  projectRetirement,
  type PersonSpec,
  type PlannerInputs,
} from "../adapter/oldApiAdapter";
import {
  projectFutureClawbackBreach,
  clawbackIncomeOf,
} from "./MeltdownEngine";

const CEILING = 95_323; // OAS clawback threshold (2026, today's $) — the melt fill target

const meltPerson = (overrides: Partial<PersonSpec> = {}): PersonSpec => ({
  label: "You",
  age: 60,
  retirementAge: 60,
  cppStartAge: 65,
  cppAt65: 10_000,
  oasStartAge: 65,
  oasFraction: 1,
  otherIncome: 0,
  balances: { tfsa: 0, rrsp: 1_500_000, lira: 0, nonreg: 0 },
  nonregGainRatio: 0,
  ...overrides,
});

const meltBase = (overrides: Partial<PlannerInputs> = {}): PlannerInputs => ({
  retirementAge: 60,
  lifeExpectancy: 95,
  province: "AB",
  inflation: 2,
  workingGrowth: 6,
  retirementGrowth: 6,
  desiredIncome: 55_000,
  annualSavings: 0,
  savingsSplit: { tfsa: 0, rrsp: 0, nonreg: 0 },
  withdrawalPolicy: "TAX_TARGETED",
  self: meltPerson(),
  spouse: null,
  ...overrides,
});

describe("projectFutureClawbackBreach (meltdown gate)", () => {
  it("projects a breach for a large RRSP", () => {
    expect(
      projectFutureClawbackBreach({
        currentAge: 60,
        registeredBalance: 1_500_000,
        realReturn: 0.04,
        fixedIncomeAt72: 19_000,
        threshold: CEILING,
        planningAge: 95,
      }),
    ).toBe(true);
  });

  it("projects no breach for a small RRSP", () => {
    expect(
      projectFutureClawbackBreach({
        currentAge: 60,
        registeredBalance: 150_000,
        realReturn: 0.04,
        fixedIncomeAt72: 19_000,
        threshold: CEILING,
        planningAge: 95,
      }),
    ).toBe(false);
  });

  it("returns false with no registered balance", () => {
    expect(
      projectFutureClawbackBreach({
        currentAge: 60,
        registeredBalance: 0,
        realReturn: 0.04,
        fixedIncomeAt72: 19_000,
        threshold: CEILING,
        planningAge: 95,
      }),
    ).toBe(false);
  });
});

describe("clawbackIncomeOf", () => {
  it("sums income components with 50% capital-gains inclusion", () => {
    expect(
      clawbackIncomeOf({ rrspRrif: 50_000, cpp: 10_000, capitalGains: 20_000, age: 60 }),
    ).toBe(70_000);
  });
});

describe("TAX_TARGETED true fill-to-ceiling meltdown (live engine)", () => {
  it("withdraws beyond need in a low-income year when a future breach is projected", () => {
    const tt = projectRetirement(meltBase());
    const rf = projectRetirement(meltBase({ withdrawalPolicy: "REGISTERED_FIRST" }));
    const y60tt = tt.rows.find((r) => r.age === 60)!;
    const y60rf = rf.rows.find((r) => r.age === 60)!;
    expect(y60tt.meltdownFlag).toBe(true);
    expect(y60rf.meltdownFlag).toBe(false);
    // Beyond need: TAX_TARGETED fills to the ceiling, REGISTERED_FIRST stops at need.
    expect(y60tt.rrifDraw).toBeGreaterThan(y60rf.rrifDraw + 20_000);
    expect(y60tt.rrifDraw).toBeCloseTo(CEILING, -3);
    expect(y60tt.effectiveCeiling).toBeCloseTo(CEILING, -3);
  });

  it("parks the after-tax surplus in non-registered with no embedded gain", () => {
    const tt = projectRetirement(meltBase());
    const rf = projectRetirement(meltBase({ withdrawalPolicy: "REGISTERED_FIRST" }));
    const y60tt = tt.rows.find((r) => r.age === 60)!;
    const y60rf = rf.rows.find((r) => r.age === 60)!;
    const meltExtra = y60tt.rrifDraw - y60rf.rrifDraw;
    const extraTax = y60tt.taxes - y60rf.taxes;
    const afterTaxSurplus = meltExtra - extraTax;
    expect(afterTaxSurplus).toBeGreaterThan(15_000);
    // The surplus lands in non-registered (RF has none).
    expect(y60tt.balances.nonreg).toBeGreaterThan(10_000);
    expect(y60rf.balances.nonreg).toBeLessThan(0.01);
    // Conservation: non-reg balance ≈ after-tax surplus (grown one year at the
    // real return; the melt happens in December so growth is ~1 month — allow tolerance).
    expect(y60tt.balances.nonreg).toBeGreaterThan(afterTaxSurplus * 0.9);
    expect(y60tt.balances.nonreg).toBeLessThan(afterTaxSurplus * 1.1);
  });

  it("does not melt when already at or over the ceiling", () => {
    const highIncome = meltBase({
      self: meltPerson({ otherIncome: 100_000 }),
    });
    const tt = projectRetirement(highIncome);
    const rf = projectRetirement({ ...highIncome, withdrawalPolicy: "REGISTERED_FIRST" });
    const y60tt = tt.rows.find((r) => r.age === 60)!;
    const y60rf = rf.rows.find((r) => r.age === 60)!;
    expect(y60tt.meltdownFlag).toBe(false);
    // Headroom is zero/negative: both policies draw the same for need.
    expect(Math.abs(y60tt.rrifDraw - y60rf.rrifDraw)).toBeLessThan(1);
  });

  it("leaves REGISTERED_FIRST unchanged — it never withdraws beyond need", () => {
    const rf = projectRetirement(meltBase({ withdrawalPolicy: "REGISTERED_FIRST" }));
    for (const row of rf.rows.filter((r) => r.age >= 60 && r.age < 70)) {
      expect(row.meltdownFlag).toBe(false);
      // No surplus is ever created, so nothing is parked in non-registered.
      expect(row.balances.nonreg).toBeLessThan(0.01);
    }
  });

  it("does not melt when the lookahead shows no future breach", () => {
    const small = meltBase({
      self: meltPerson({ balances: { tfsa: 0, rrsp: 150_000, lira: 0, nonreg: 0 } }),
    });
    const tt = projectRetirement(small);
    const rf = projectRetirement({ ...small, withdrawalPolicy: "REGISTERED_FIRST" });
    expect(tt.rows.every((r) => !r.meltdownFlag)).toBe(true);
    // With no breach projected, TAX_TARGETED behaves like REGISTERED_FIRST.
    const y60tt = tt.rows.find((r) => r.age === 60)!;
    const y60rf = rf.rows.find((r) => r.age === 60)!;
    expect(Math.abs(y60tt.rrifDraw - y60rf.rrifDraw)).toBeLessThan(1);
  });

  it("respects the ceiling — and the clawback tolerance sets the fill target", () => {
    const tt = projectRetirement(meltBase());
    const y60 = tt.rows.find((r) => r.age === 60)!;
    // rrifDraw is the meltdown; taxable income ≈ ceiling (today's $).
    expect(y60.rrifDraw).toBeLessThanOrEqual(CEILING + 500);

    const tol = projectRetirement(meltBase({ clawbackTolerance: 5_000 }));
    const tol60 = tol.rows.find((r) => r.age === 60)!;
    expect(tol60.rrifDraw).toBeGreaterThan(CEILING);
    expect(tol60.rrifDraw).toBeLessThanOrEqual(CEILING + 5_000 + 500);
  });

  it("still meets the spending need every year", () => {
    const tt = projectRetirement(meltBase());
    expect(tt.success).toBe(true);
    expect(tt.depletionAge).toBeNull();
    for (const row of tt.rows) expect(row.shortfall).toBeLessThanOrEqual(500);
  });

  it("lowers lifetime tax and eliminates OAS clawback versus REGISTERED_FIRST", () => {
    const tt = projectRetirement(meltBase());
    const rf = projectRetirement(meltBase({ withdrawalPolicy: "REGISTERED_FIRST" }));
    expect(tt.totalTaxes).toBeLessThan(rf.totalTaxes);
    expect(tt.totalClawback).toBeLessThan(rf.totalClawback);
    expect(tt.totalClawback).toBe(0);
  });

  it("stops melting by itself once the lookahead clears", () => {
    const tt = projectRetirement(meltBase());
    const rf = projectRetirement(meltBase({ withdrawalPolicy: "REGISTERED_FIRST" }));
    // By age 70 the earlier melting has shrunk registered balances enough
    // that no future breach is projected — flag off, draws identical.
    const age70tt = tt.rows.find((r) => r.age === 70)!;
    const age70rf = rf.rows.find((r) => r.age === 70)!;
    expect(age70tt.meltdownFlag).toBe(false);
    expect(Math.abs(age70tt.rrifDraw - age70rf.rrifDraw)).toBeLessThan(1);
  });

  it("keeps both financial ledgers reconciled while melting", () => {
    const tt = projectRetirement(meltBase());
    // The simulation's monthly snapshots carry reconciliation diagnostics;
    // projectRetirement doesn't expose them, so we verify the economic
    // invariant directly: portfolio + lifetime tax is conserved vs RF.
    const rf = projectRetirement(meltBase({ withdrawalPolicy: "REGISTERED_FIRST" }));
    // Melting converts registered → non-reg (after tax); total ending wealth
    // should exceed RF's by roughly the tax saved (not leak value).
    expect(tt.endingBalance + tt.totalTaxes).toBeGreaterThan(
      rf.endingBalance + rf.totalTaxes - 1,
    );
  });
});
