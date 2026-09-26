import { describe, expect, it } from "vitest";
import { runRetirementSimulation } from "./SimulationCoordinator";
import type { RetirementScenario } from "../domain/types";

const base = {
  id: "simulation-test", name: "Simulation test",
  household: { province: "AB" as const, stage: "BOTH_ALIVE" as const, people: [{ role: "MAIN_USER" as const, birthYear: 1960, birthMonth: 1, retirementAge: 65, cppAt65: 1000, cppStartAge: 65 as const, oasStartAge: 65 as const, oasResidenceYears: 40 }] },
  goals: { retirementAge: 65, annualSpending: 60000, spendingBasis: "TODAYS_DOLLARS" as const, planningAge: 90 },
  accounts: [],
  assumptions: { inflationRate: 2, investmentReturn: 5, investmentFeeRate: .5, futureRulesMode: "CURRENT_LAW_PLUS_INDEXING" as const },
  strategy: { withdrawalPolicy: "TFSA_FIRST" as const, objective: "MAX_SUSTAINABLE_SPENDING" as const },
  metadata: { createdAt: "2026-01-01", engineVersion: "test", rulesVersion: "test" },
} satisfies RetirementScenario;

describe("retirement simulation validation boundary", () => {
  it("does not simulate an invalid scenario", () => {
    const result = runRetirementSimulation({ ...base, goals: { ...base.goals, annualSpending: -1 } }, 100000, 2026);
    expect(result.status).toBe("INVALID");
    expect(result.monthly).toHaveLength(0);
    expect(result.metrics.feasible).toBe(false);
    expect(result.warnings.some(x => x.includes("negative-spending"))).toBe(true);
  });

  it("simulates a valid scenario", () => {
    const result = runRetirementSimulation(base, 100000, 2026);
    expect(result.status).toBe("COMPLETE");
    expect(result.monthly.length).toBeGreaterThan(0);
    expect(result.scenarioHash).toMatch(/^[0-9a-f]+$/);
  });
});
