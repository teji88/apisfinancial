import { describe, expect, it } from "vitest";
import { runRetirementGoldenCases, validateRetirementScenario } from "./RetirementValidation";
import type { RetirementScenario } from "../domain/types";

const scenario = {
  id: "test-scenario", name: "Test",
  household: { province: "AB" as const, stage: "BOTH_ALIVE" as const, people: [{ role: "MAIN_USER" as const, birthYear: 1960, birthMonth: 1, retirementAge: 65, cppAt65: 1000, cppStartAge: 65 as const, oasStartAge: 65 as const, oasResidenceYears: 40 }] },
  goals: { retirementAge: 65, annualSpending: 60000, spendingBasis: "TODAYS_DOLLARS" as const, planningAge: 90 },
  accounts: [],
  assumptions: { inflationRate: 2, investmentReturn: 5, investmentFeeRate: .5, futureRulesMode: "CURRENT_LAW_PLUS_INDEXING" as const },
  strategy: { withdrawalPolicy: "TFSA_FIRST" as const, objective: "MAX_SUSTAINABLE_SPENDING" as const },
  metadata: { createdAt: "2026-01-01", engineVersion: "test", rulesVersion: "test" },
} satisfies RetirementScenario;

describe("retirement validation", () => {
  it("accepts a valid baseline scenario", () => {
    expect(validateRetirementScenario(scenario).filter(x => x.severity === "ERROR")).toHaveLength(0);
  });

  it("rejects negative spending", () => {
    const issues = validateRetirementScenario({ ...scenario, goals: { ...scenario.goals, annualSpending: -1 } });
    expect(issues).toContainEqual(expect.objectContaining({ id: "negative-spending", severity: "ERROR" }));
  });

  it("rejects invalid benefit ages", () => {
    const invalid = { ...scenario, household: { ...scenario.household, people: [{ ...scenario.household.people[0], cppStartAge: 59 as const, oasStartAge: 71 as const }] } };
    const issues = validateRetirementScenario(invalid);
    expect(issues.map(x => x.id)).toEqual(expect.arrayContaining(["cpp-age-MAIN_USER", "oas-age-MAIN_USER"]));
  });
});

describe("retirement golden cases", () => {
  it("passes every golden case", () => {
    const results = runRetirementGoldenCases();
    const failed = results.filter(x => !x.passed);
    expect(failed, failed.map(x => `${x.name}: ${x.details}`).join("\n")).toHaveLength(0);
  });
});
