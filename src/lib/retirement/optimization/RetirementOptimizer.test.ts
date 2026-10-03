import { describe, expect, it } from "vitest";
import { createDefaultRetirementScenario } from "../scenario/defaults";
import { optimizeRetirementPlan } from "./RetirementOptimizer";

describe("RetirementOptimizer", () => {
  // These tests evaluate up to 288 full retirement simulations each.
  // A single simulation takes ~60ms, so the optimizer needs well beyond
  // vitest's 5s default timeout.
  it("evaluates a bounded deterministic candidate set", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));

    const result = optimizeRetirementPlan({
      scenario,
      startingPortfolio: 1_000_000,
      startYear: 2026,
    });

    expect(result.candidates.length).toBe(288); // 3 spending × 4 retirementAge × 3 CPP × 2 OAS × 4 policies
    expect(result.feasiblePlans.length).toBeGreaterThan(0);
    expect(result.selectedCandidate).toBeDefined();
    expect(result.selectedPlan).toBeDefined();
    expect(result.paretoCandidates.length).toBeGreaterThan(0);
    expect(result.selectedCandidate?.objectiveValue).toBeTypeOf("number");
  }, 60_000);

  it("does not select a plan when every candidate violates a hard constraint", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
    const result = optimizeRetirementPlan({
      scenario,
      startingPortfolio: 0,
      startYear: 2026,
      variables: [],
      constraints: { maximumTax: -1 },
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.violations).toContain("maximumTax");
    expect(result.selectedCandidate).toBeUndefined();
    expect(result.selectedPlan).toBeUndefined();
    expect(result.paretoCandidates).toHaveLength(0);
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
    } else {
      expect(result.selectedPlan).toBeUndefined();
    }
  }, 60_000);

  it("selects the earliest feasible retirement age for MIN_RETIREMENT_AGE", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));

    const result = optimizeRetirementPlan({
      scenario,
      startingPortfolio: 2_000_000,
      startYear: 2026,
      objective: "MIN_RETIREMENT_AGE",
    });

    expect(result.selectedCandidate).toBeDefined();
    const selectedAge = result.selectedCandidate!.scenario.goals.retirementAge;
    // The selected plan should have the minimum retirement age among feasible candidates
    // (using the same $1000 materiality threshold as the optimizer)
    const feasibleAges = result.candidates
      .filter((c) => c.violations.length === 0 && c.metrics.maximumSpendingShortfall <= 1000 && !c.metrics.depletionDate)
      .map((c) => c.scenario.goals.retirementAge);
    if (feasibleAges.length > 0) {
      expect(selectedAge).toBe(Math.min(...feasibleAges));
    }
  }, 60_000);
});
