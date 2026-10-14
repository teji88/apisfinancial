import { describe, expect, it } from "vitest";
import { createDefaultRetirementScenario } from "../scenario/defaults";
import { optimizeRetirementPlan, defaultVariables } from "./RetirementOptimizer";

describe("RetirementOptimizer", () => {
  // These tests evaluate up to 360 full retirement simulations each.
  // A single simulation takes ~60ms, so the optimizer needs well beyond
  // vitest's 5s default timeout.
  it("evaluates a bounded deterministic candidate set", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));

    const result = optimizeRetirementPlan({
      scenario,
      startingPortfolio: 1_000_000,
      startYear: 2026,
    });

    // Derive the expected count from the variable grid itself — the
    // retirement-age axis gains an extra value when the scenario's
    // retirement age isn't on the 5-year grid, so a hardcoded count would
    // silently break for other ages.
    const expected = defaultVariables(scenario).reduce(
      (acc, v) => acc * v.values.length,
      1,
    );
    // Default scenario: 3 spending × 4 retirementAge × 3 CPP × 2 OAS × 4 policies = 288
    expect(expected).toBe(288);
    expect(result.candidates.length).toBe(expected);
    expect(result.feasiblePlans.length).toBeGreaterThan(0);
    expect(result.selectedCandidate).toBeDefined();
    expect(result.selectedPlan).toBeDefined();
    expect(result.paretoCandidates.length).toBeGreaterThan(0);
    expect(result.selectedCandidate?.objectiveValue).toBeTypeOf("number");
  }, 60_000);

  it("grows the candidate set when the scenario retirement age is off-grid", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
    scenario.goals.retirementAge = 70; // not on the 5-year grid → appended

    const result = optimizeRetirementPlan({
      scenario,
      startingPortfolio: 1_000_000,
      startYear: 2026,
    });

    const expected = defaultVariables(scenario).reduce(
      (acc, v) => acc * v.values.length,
      1,
    );
    // 3 spending × 5 retirementAge (50,55,60,65,70) × 3 CPP × 2 OAS × 4 policies = 360
    expect(expected).toBe(360);
    expect(result.candidates.length).toBe(expected);
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

  it("blocks OAS deferral for a GIS-eligible person (oasDeferralForfeitsGis)", () => {
    // Low-income person: no CPP, no other income → qualifies for GIS at 65.
    // Deferring OAS to 70 forfeits 5 years of GIS (OAS Act ss.11(1), 11(7)(b)).
    const base = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
    const lowIncome = {
      ...base,
      household: {
        ...base.household,
        people: base.household.people.map((p) => ({
          ...p,
          cppAt65: 0,
          otherIncome: 0,
          employmentIncome: 0,
          oasResidenceYears: 40,
        })),
      },
      goals: { ...base.goals, annualSpending: 20000 },
    };
    const result = optimizeRetirementPlan({
      scenario: lowIncome,
      startingPortfolio: 50_000,
      startYear: 2026,
      variables: [{ path: "oasStartAge", values: [65, 70] }],
    });

    const deferred = result.candidates.find(
      (c) => c.scenario.household.people[0]?.oasStartAge === 70,
    );
    expect(deferred).toBeDefined();
    expect(deferred!.violations).toContain("oasDeferralForfeitsGis");
    // The deferring candidate is infeasible, so it can never be selected.
    expect(result.feasiblePlans.every(
      (p) => p.household.people[0]?.oasStartAge === 65,
    )).toBe(true);
  }, 60_000);
});
