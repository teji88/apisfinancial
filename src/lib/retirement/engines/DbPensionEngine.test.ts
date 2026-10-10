import { describe, expect, it } from "vitest";
import { dbPensionMonthlyAt, dbSurvivorMonthlyAt } from "./DbPensionEngine";
import type { DbPension } from "../domain/types";

function makePension(overrides: Partial<DbPension> = {}): DbPension {
  return {
    id: "db1",
    owner: "MAIN_USER",
    monthlyAmountAtNRA: 5000,
    normalRetirementAge: 65,
    startAge: 65,
    indexing: "none",
    ...overrides,
  };
}

describe("dbPensionMonthlyAt", () => {
  it("pays the NRA amount from the start age (no indexing, no inflation)", () => {
    const p = makePension();
    expect(dbPensionMonthlyAt(p, 64, 2026, 0, 1961)).toBe(0);
    expect(dbPensionMonthlyAt(p, 65, 2026, 0, 1961)).toBe(5000);
    expect(dbPensionMonthlyAt(p, 80, 2041, 0, 1961)).toBe(5000);
  });

  it("applies the early-reduction formula", () => {
    // $5,000 at 65, 3%/yr early, start at 55 → $5,000 × 0.70 = $3,500.
    const p = makePension({ startAge: 55, earlyReductionPerYear: 0.03 });
    expect(dbPensionMonthlyAt(p, 55, 2026, 0, 1971)).toBeCloseTo(3500, 6);
    expect(dbPensionMonthlyAt(p, 70, 2041, 0, 1971)).toBeCloseTo(3500, 6);
  });

  it("prefers an explicit start-age table over the formula", () => {
    const p = makePension({
      startAge: 55,
      earlyReductionPerYear: 0.03,
      startAgeTable: { 55: 2500, 60: 3800, 65: 5000 },
    });
    expect(dbPensionMonthlyAt(p, 55, 2026, 0, 1971)).toBe(2500);
  });

  it("pays the bridge only before the bridge end age", () => {
    const p = makePension({
      startAge: 55,
      bridgeMonthly: 1000,
      bridgeEndAge: 65,
    });
    expect(dbPensionMonthlyAt(p, 60, 2031, 0, 1971)).toBe(6000);
    expect(dbPensionMonthlyAt(p, 65, 2036, 0, 1971)).toBe(5000);
    expect(dbPensionMonthlyAt(p, 70, 2041, 0, 1971)).toBe(5000);
  });

  it("indexes the base pension after commencement", () => {
    const full = makePension({ startAge: 65, indexing: "full" });
    // 10 years at 2% → ×1.02^10 ≈ 1.219.
    expect(dbPensionMonthlyAt(full, 75, 2036, 2, 1961)).toBeCloseTo(5000 * 1.219, 0);

    const partial = makePension({ startAge: 65, indexing: "partial", indexingFraction: 0.5 });
    // 10 years at 1% → ×1.01^10 ≈ 1.1046.
    expect(dbPensionMonthlyAt(partial, 75, 2036, 2, 1961)).toBeCloseTo(5000 * 1.1046, 0);

    const none = makePension({ startAge: 65, indexing: "none" });
    expect(dbPensionMonthlyAt(none, 75, 2036, 2, 1961)).toBe(5000);
  });

  it("converts today's dollars to nominal at commencement", () => {
    // Start in 2031 (5 years out) at 2% inflation → ×1.02^5.
    const p = makePension({ startAge: 60 });
    expect(dbPensionMonthlyAt(p, 60, 2031, 2, 1971)).toBeCloseTo(5000 * 1.1041, 0);
  });
});

describe("dbSurvivorMonthlyAt", () => {
  it("pays the survivor percent of the indexed pension at death, bridge excluded", () => {
    const p = makePension({
      startAge: 55,
      indexing: "full",
      bridgeMonthly: 1000,
      bridgeEndAge: 65,
      survivorPercent: 60,
    });
    // Member dies at 70 in 2041. Pension at death: 5000 × 1.02^15 (indexed
    // from 2026 start) — bridge already ended at 65.
    const atDeath = 5000 * Math.pow(1.02, 15);
    const survivor = dbSurvivorMonthlyAt(p, 2041, 2, 1971, 70, 2041);
    expect(survivor).toBeCloseTo(atDeath * 0.6, 0);
    // Five years later the survivor's pension kept indexing.
    const later = dbSurvivorMonthlyAt(p, 2046, 2, 1971, 70, 2041);
    expect(later).toBeCloseTo(atDeath * 0.6 * Math.pow(1.02, 5), 0);
  });

  it("returns 0 without a survivor percent or for pre-commencement death", () => {
    const p = makePension({ startAge: 65 });
    expect(dbSurvivorMonthlyAt(p, 2041, 0, 1961, 70, 2031)).toBe(0);
    const withPct = makePension({ startAge: 65, survivorPercent: 60 });
    expect(dbSurvivorMonthlyAt(withPct, 2021, 0, 1961, 60, 2021)).toBe(0);
  });
});

describe("DB pension coordinator integration", () => {
  it("flows DB pension through the simulation as pension income", async () => {
    const { runRetirementSimulation } = await import("./SimulationCoordinator");
    const base = {
      id: "db-test", name: "DB test",
      household: { province: "AB" as const, stage: "BOTH_ALIVE" as const, people: [{ role: "MAIN_USER" as const, birthYear: 1960, birthMonth: 1, retirementAge: 65, cppAt65: 1000, cppStartAge: 65 as const, oasStartAge: 65 as const, oasResidenceYears: 40 }] },
      goals: { retirementAge: 65, annualSpending: 60000, spendingBasis: "TODAYS_DOLLARS" as const, planningAge: 90 },
      accounts: [],
      assumptions: { inflationRate: 2, investmentReturn: 5, investmentFeeRate: .5, futureRulesMode: "CURRENT_LAW_PLUS_INDEXING" as const },
      strategy: { withdrawalPolicy: "TFSA_FIRST" as const, objective: "MAX_SUSTAINABLE_SPENDING" as const },
      metadata: { createdAt: "2026-01-01", engineVersion: "test", rulesVersion: "test" },
    };
    const without = runRetirementSimulation(base, 100000, 2026);
    const withDb = runRetirementSimulation({
      ...base,
      dbPensions: [{
        id: "db1", owner: "MAIN_USER" as const,
        monthlyAmountAtNRA: 3000, normalRetirementAge: 65, startAge: 65,
        indexing: "full" as const, survivorPercent: 60,
      }],
    }, 100000, 2026);
    expect(without.status).toBe("COMPLETE");
    expect(withDb.status).toBe("COMPLETE");
    // $36k/yr DB pension funds spending: more lifetime after-tax cash,
    // and the pension is taxed (lifetime tax rises).
    expect(withDb.metrics.lifetimeAfterTaxCash).toBeGreaterThan(without.metrics.lifetimeAfterTaxCash);
    expect(withDb.metrics.lifetimeTax).toBeGreaterThan(without.metrics.lifetimeTax);
  });
});
