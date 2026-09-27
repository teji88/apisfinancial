import { describe, expect, it } from "vitest";
import { createDefaultRetirementScenario } from "../scenario/defaults";
import { optimizeRetirementPlan } from "./RetirementOptimizer";

describe("RetirementOptimizer", () => {
  it("evaluates a bounded deterministic candidate set", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));

    const result = optimizeRetirementPlan({
      scenario,
      startingPortfolio: 1_000_000,
      startYear: 2026,
    });

    expect(result.candidates.length).toBe(72);
    expect(result.feasiblePlans.length).toBeGreaterThan(0);
    expect(result.selectedCandidate).toBeDefined();
    expect(result.selectedPlan).toBeDefined();
    expect(result.paretoCandidates.length).toBeGreaterThan(0);
    expect(result.selectedCandidate?.objectiveValue).toBeTypeOf("number");
  });

  it("honours explicit constraints before selecting a plan", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));

    const result = optimizeRetirementPlan({
      scenario,
      startingPortfolio: 1_000_000,
      startYear: 2026,
      constraints: { maximumShortfall: 0 },
      objective: "MIN_TAX",
    });

    expect(result.feasiblePlans.every((plan) => plan.goals.annualSpending > 0)).toBe(true);
    if (result.selectedCandidate) {
      expect(result.feasiblePlans).toContain(result.selectedCandidate.scenario);
      expect(result.selectedCandidate.violations).toEqual([]);
    }
  });
});
