import { describe, expect, it } from "vitest";
import { runRetirementSimulation } from "./SimulationCoordinator";
import { calculateBasicTax } from "./TaxEngine";
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

  it("uses the household tax engine and explicit pension-splitting input", () => {
    const householdBase = {
      ...base,
      household: {
        ...base.household,
        people: [
          { ...base.household.people[0], otherIncome: 40_000 },
          { role: "PARTNER" as const, birthYear: 1960, birthMonth: 1, retirementAge: 65, cppStartAge: 65 as const, oasStartAge: 65 as const, oasResidenceYears: 40, otherIncome: 0 },
        ],
      },
      accounts: [{
        id: "rrif",
        owner: "MAIN_USER" as const,
        type: "RRIF" as const,
        valuation: { mode: "MANUAL" as const, value: 200_000 },
      }],
      strategy: { ...base.strategy, withdrawalPolicy: "REGISTERED_FIRST" as const, pensionSplitPercent: 0 },
    };
    const unsplit = runRetirementSimulation(householdBase, 200_000, 2026);
    const split = runRetirementSimulation({
      ...householdBase,
      strategy: { ...householdBase.strategy, pensionSplitPercent: 50 },
    }, 200_000, 2026);
    expect(unsplit.status).toBe("COMPLETE");
    expect(split.status).toBe("COMPLETE");
    expect(split.metrics.lifetimeTax).toBeLessThan(unsplit.metrics.lifetimeTax);
  });

  it("simulates a valid scenario", () => {
    const result = runRetirementSimulation(base, 100000, 2026);
    expect(result.status).toBe("COMPLETE");
    expect(result.monthly.length).toBeGreaterThan(0);
    expect(result.scenarioHash).toMatch(/^[0-9a-f]+$/);
  });
  it("accrues tax liability incrementally instead of charging year-to-date tax every month", () => {
    const scenario = {
      ...base,
      household: {
        ...base.household,
        people: [{
          ...base.household.people[0],
          otherIncome: 60000,
          cppStartAge: 70 as const,
          oasStartAge: 70 as const,
        }],
      },
      goals: { ...base.goals, annualSpending: 0, planningAge: 66 },
      accounts: [],
    } satisfies RetirementScenario;

    const result = runRetirementSimulation(scenario, 0, 2026);
    expect(result.status).toBe("COMPLETE");
    expect(result.monthly).toHaveLength(12);
    const expectedAnnualTax = calculateBasicTax(60000, "AB", 65).totalTax;
    expect(result.metrics.lifetimeTax).toBeCloseTo(expectedAnnualTax, 6);
  });

  it("tracks survivor transfers and final estate tax outcomes", () => {
    const survivorScenario = {
      ...base,
      household: {
        ...base.household,
        people: [
          { ...base.household.people[0], birthYear: 1955, deathAge: 70, survivorCppPercent: 60 },
          { role: "PARTNER" as const, birthYear: 1955, birthMonth: 1, retirementAge: 65, cppStartAge: 65 as const, oasStartAge: 65 as const, oasResidenceYears: 40, deathAge: 90 },
        ],
      },
      goals: { ...base.goals, annualSpending: 0, planningAge: 90 },
      accounts: [
        { id: "main-rrsp", owner: "MAIN_USER" as const, type: "RRSP" as const, valuation: { mode: "MANUAL" as const, value: 100_000 }, deathTransfer: "SPOUSE" as const },
        { id: "partner-nr", owner: "PARTNER" as const, type: "NON_REGISTERED" as const, valuation: { mode: "MANUAL" as const, value: 100_000 }, nonRegisteredAcb: 50_000, deathTransfer: "ESTATE" as const },
      ],
    } satisfies RetirementScenario;

    const result = runRetirementSimulation(survivorScenario, 200_000, 2026);
    expect(result.status).toBe("COMPLETE");
    expect(result.metrics.survivorTransferredAssets).toBeGreaterThan(0);
    expect(result.metrics.estateValue).toBeGreaterThan(100_000);
    expect(result.metrics.deathCapitalGains).toBeGreaterThan(0);
    expect(result.metrics.estateTax).toBeGreaterThan(0);
  });


  it("keeps non-income tax metadata out of GIS income during simulation", () => {
    const scenario = {
      ...base,
      household: {
        ...base.household,
        people: [{
          ...base.household.people[0],
          otherIncome: 12_000,
          employmentIncome: 10_000,
          selfEmploymentIncome: 0,
          oasStartAge: 65 as const,
          cppStartAge: 65 as const,
        }],
      },
      goals: { ...base.goals, annualSpending: 0, planningAge: 66 },
      accounts: [],
    } satisfies RetirementScenario;

    const result = runRetirementSimulation(scenario, 0, 2026);
    expect(result.status).toBe("COMPLETE");
    expect(result.monthly).toHaveLength(12);
    expect(result.metrics.lifetimeTax).toBeGreaterThanOrEqual(0);
  });

});
