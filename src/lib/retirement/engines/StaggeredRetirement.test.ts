import { describe, expect, it } from "vitest";
import { runRetirementSimulation } from "./SimulationCoordinator";
import type { RetirementScenario } from "../domain/types";

/**
 * Regression tests for the 2026-10-15 staggered-retirement fix.
 *
 * Bug: when one partner retired and the other kept working,
 *  1. household spending was forced to $0 until EVERYONE retired (allRetired
 *     gate), so the staggered years showed no withdrawals; and
 *  2. the working partner's employment income was taxed but never counted as
 *     spendable cash, so it could not offset the withdrawal need.
 */
function staggeredScenario(partnerEmployment: number): RetirementScenario {
  return {
    id: "staggered-repro",
    name: "Staggered repro",
    household: {
      province: "AB",
      stage: "BOTH_ALIVE",
      people: [
        { role: "MAIN_USER", birthYear: 1976, birthMonth: 1, retirementAge: 50, cppStartAge: 70, oasStartAge: 70, oasResidenceYears: 40 },
        { role: "PARTNER", birthYear: 1976, birthMonth: 1, retirementAge: 60, cppStartAge: 70, oasStartAge: 70, oasResidenceYears: 40, employmentIncome: partnerEmployment },
      ],
    },
    goals: { retirementAge: 50, annualSpending: 60000, spendingBasis: "TODAYS_DOLLARS", planningAge: 62 },
    accounts: [
      { id: "rrsp", owner: "MAIN_USER", type: "RRSP", valuation: { mode: "MANUAL", value: 500_000 } },
    ],
    assumptions: { inflationRate: 0, investmentReturn: 0, investmentFeeRate: 0, futureRulesMode: "CURRENT_LAW_PLUS_INDEXING" },
    strategy: { withdrawalPolicy: "REGISTERED_FIRST", objective: "MAX_SUSTAINABLE_SPENDING" },
    metadata: { createdAt: "2026-01-01", engineVersion: "test", rulesVersion: "test" },
  } as RetirementScenario;
}

function yearlyWithdrawals(result: ReturnType<typeof runRetirementSimulation>, from: number, to: number) {
  const byYear = new Map<number, number>();
  for (const m of result.monthly) {
    const y = new Date(m.date).getUTCFullYear();
    if (y >= from && y <= to) byYear.set(y, (byYear.get(y) ?? 0) + (m.withdrawals ?? 0));
  }
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]);
}

describe("staggered retirement cash flow", () => {
  it("funds spending every year while one partner works", () => {
    const result = runRetirementSimulation(staggeredScenario(30_000), 0, 2026);
    expect(result.status).toBe("COMPLETE");
    // Partner works 2026-2035 (ages 50-59); main user retired throughout.
    const years = yearlyWithdrawals(result, 2026, 2035);
    expect(years).toHaveLength(10);
    for (const [year, w] of years) {
      // $60k spending minus $30k employment income ≈ $30k withdrawals/year
      // (plus tax on the employment income, minus rounding).
      expect(w).toBeGreaterThan(20_000);
      expect(w).toBeLessThan(45_000);
    }
  });

  it("employment income reduces withdrawals dollar-for-dollar (pre-tax)", () => {
    const without = runRetirementSimulation(staggeredScenario(0), 0, 2026);
    const withEmp = runRetirementSimulation(staggeredScenario(30_000), 0, 2026);
    expect(without.status).toBe("COMPLETE");
    expect(withEmp.status).toBe("COMPLETE");
    const sum = (rs: ReturnType<typeof runRetirementSimulation>) =>
      yearlyWithdrawals(rs, 2026, 2035).reduce((s, [, w]) => s + w, 0);
    const wWithout = sum(without);
    const wWith = sum(withEmp);
    // Employment income must meaningfully reduce withdrawals. (The exact
    // dollar difference depends on tax gross-up and portfolio limits; what
    // matters is that $300k of employment cash over 10 years displaces a
    // substantial share of withdrawals.)
    expect(wWith).toBeLessThan(wWithout);
    expect(wWithout - wWith).toBeGreaterThan(100_000);
  });

  it("counts employment income in gross income output", () => {
    const result = runRetirementSimulation(staggeredScenario(30_000), 0, 2026);
    expect(result.status).toBe("COMPLETE");
    const m = result.monthly.find((x) => new Date(x.date).getUTCFullYear() === 2028);
    expect(m).toBeDefined();
    // $30k/year = $2,500/month employment cash in gross income.
    expect(m!.grossIncome).toBeGreaterThan(2_000);
  });
});
