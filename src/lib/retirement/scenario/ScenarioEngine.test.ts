import { describe, expect, it } from "vitest";
import { createDefaultRetirementScenario } from "./defaults";
import { DEFAULT_STRESS_TESTS, runStressTests } from "./ScenarioEngine";

describe("ScenarioEngine", () => {
  it("provides the core retirement what-if cases", () => {
    const kinds = DEFAULT_STRESS_TESTS.map((definition) => definition.kind);
    expect(kinds).toEqual(expect.arrayContaining([
      "EARLIER_RETIREMENT",
      "LATER_RETIREMENT",
      "LOWER_SPENDING",
      "HIGHER_SPENDING",
      "CPP_60",
      "CPP_65",
      "CPP_70",
      "OAS_65",
      "OAS_70",
      "LOW_RETURN",
      "HIGH_INFLATION",
      "LONGER_LIFE",
      "SURVIVOR",
    ]));
  });

  it("changes only the requested scenario dimensions", () => {
    const base = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
    const earlier = DEFAULT_STRESS_TESTS.find((d) => d.kind === "EARLIER_RETIREMENT")!.apply(base);
    const higherSpending = DEFAULT_STRESS_TESTS.find((d) => d.kind === "HIGHER_SPENDING")!.apply(base);
    const cpp70 = DEFAULT_STRESS_TESTS.find((d) => d.kind === "CPP_70")!.apply(base);

    expect(earlier.goals.retirementAge).toBe(base.goals.retirementAge - 3);
    expect(higherSpending.goals.annualSpending).toBeCloseTo(base.goals.annualSpending * 1.1);
    expect(cpp70.household.people[0].cppStartAge).toBe(70);
    expect(base.goals.retirementAge).toBe(65);
    expect(base.goals.annualSpending).toBe(60000);
    expect(base.household.people[0].cppStartAge).toBe("OPTIMIZE");
  });

  it("returns a base result plus comparable scenario deltas", () => {
    const base = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
    const result = runStressTests(base, 500000, { TFSA: 500000 }, DEFAULT_STRESS_TESTS.slice(0, 3));

    expect(result.base.kind).toBe("BASE");
    expect(result.scenarios).toHaveLength(3);
    expect(result.scenarios.every((scenario) => typeof scenario.deltas.endingPortfolio === "number")).toBe(true);
    expect(result.engineVersion).toBeTruthy();
    expect(result.rulesVersion).toBeTruthy();
  });
});
