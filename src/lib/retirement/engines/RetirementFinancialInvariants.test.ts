import { describe, expect, it } from "vitest";
import type { RetirementScenario } from "../domain/types";
import { runRetirementSimulation } from "./SimulationCoordinator";
import { applyAccountDeathTreatment, classifyAccount, mandatoryRegisteredWithdrawal } from "./AccountEngine";
import { runStressTests } from "../scenario/ScenarioEngine";

const makeScenario = (overrides: Partial<RetirementScenario> = {}): RetirementScenario => ({
  id: "invariant-test",
  name: "Invariant test",
  household: {
    province: "AB",
    stage: "BOTH_ALIVE",
    people: [{
      role: "MAIN_USER",
      birthYear: 1960,
      birthMonth: 1,
      retirementAge: 65,
      cppAt65: 1000,
      cppStartAge: 65,
      oasStartAge: 65,
      oasResidenceYears: 40,
    }],
  },
  goals: {
    retirementAge: 65,
    annualSpending: 60000,
    spendingBasis: "TODAYS_DOLLARS",
    planningAge: 90,
  },
  accounts: [{
    id: "tfsa-1",
    owner: "MAIN_USER",
    type: "TFSA",
    valuation: { mode: "MANUAL", value: 100000 },
  }],
  assumptions: {
    inflationRate: 0,
    investmentReturn: 0,
    investmentFeeRate: 0,
    futureRulesMode: "CURRENT_LAW_PLUS_INDEXING",
  },
  strategy: {
    withdrawalPolicy: "TFSA_FIRST",
    objective: "MAX_SUSTAINABLE_SPENDING",
  },
  metadata: {
    createdAt: "2026-01-01",
    engineVersion: "test",
    rulesVersion: "test",
  },
  ...overrides,
});

describe("retirement financial invariants", () => {
  it("uses the planning age as an age, not as a calendar-year offset", () => {
    const result = runRetirementSimulation(makeScenario({ goals: { ...makeScenario().goals, annualSpending: 0, planningAge: 90 } }), 100000, 2026);
    const end = result.monthly.at(-1);
    expect(end).toBeDefined();
    expect(new Date(result.endDate).getUTCFullYear()).toBe(2050);
    expect(end?.ages.MAIN_USER).toBe(90);
  });

  it("is deterministic apart from the generated simulation id", () => {
    const first = runRetirementSimulation(makeScenario(), 100000, 2026);
    const second = runRetirementSimulation(makeScenario(), 100000, 2026);
    expect(second.scenarioHash).toBe(first.scenarioHash);
    expect(second.metrics).toEqual(first.metrics);
    expect(second.monthly).toEqual(first.monthly);
  });

  it("classifies TFSA as tax-free and registered accounts as taxable on withdrawal", () => {
    expect(classifyAccount({ id: "tfsa", owner: "MAIN_USER", type: "TFSA", valuation: { mode: "MANUAL", value: 1 } }).taxableWithdrawal).toBe(false);
    expect(classifyAccount({ id: "rrsp", owner: "MAIN_USER", type: "RRSP", valuation: { mode: "MANUAL", value: 1 } }).taxableWithdrawal).toBe(true);
  });

  it("never produces a negative portfolio or account bucket", () => {
    const result = runRetirementSimulation(makeScenario({
      goals: { ...makeScenario().goals, annualSpending: 250000, planningAge: 75 },
    }), 100000, 2026);
    for (const month of result.monthly) {
      expect(month.portfolio).toBeGreaterThanOrEqual(0);
      expect(month.registered).toBeGreaterThanOrEqual(0);
      expect(month.tfsa).toBeGreaterThanOrEqual(0);
      expect(month.nonRegistered).toBeGreaterThanOrEqual(0);
      expect(month.cash).toBeGreaterThanOrEqual(0);
    }
  });

  it("applies contributions before retirement", () => {
    const scenario = makeScenario({
      goals: { ...makeScenario().goals, annualSpending: 0, planningAge: 65 },
      accounts: [{ id: "cash", owner: "MAIN_USER", type: "CASH", valuation: { mode: "MANUAL", value: 0 }, contribution: { annualAmount: 12000 } }],
    });
    const result = runRetirementSimulation(scenario, 0, 2026);
    expect(result.monthly.at(-1)!.portfolio).toBeGreaterThan(0);
  });

  it("reconciles portfolio to its account buckets every month", () => {
    const result = runRetirementSimulation(makeScenario({
      accounts: [
        { id: "tfsa", owner: "MAIN_USER", type: "TFSA", valuation: { mode: "MANUAL", value: 50000 } },
        { id: "rrsp", owner: "MAIN_USER", type: "RRSP", valuation: { mode: "MANUAL", value: 50000 } },
        { id: "cash", owner: "MAIN_USER", type: "CASH", valuation: { mode: "MANUAL", value: 10000 } },
      ],
    }), 110000, 2026);
    for (const month of result.monthly) {
      const buckets = month.registered + month.tfsa + month.nonRegistered + month.cash;
      expect(month.portfolio).toBeCloseTo(buckets, 8);
      expect(month.netWorth).toBeCloseTo(month.portfolio, 8);
    }
  });

  it("never withdraws more than the available account balance", () => {
    const result = runRetirementSimulation(makeScenario({
      goals: { ...makeScenario().goals, annualSpending: 1000000, planningAge: 70 },
    }), 100000, 2026);
    for (const month of result.monthly) {
      expect(month.withdrawals).toBeLessThanOrEqual(100000 + 1e-8);
    }
    expect(result.metrics.maximumSpendingShortfall).toBeGreaterThan(0);
  });

  it("applies the RRIF minimum using the beginning-of-year balance", () => {
    const monthlyMinimum = mandatoryRegisteredWithdrawal("RRIF", 71, 90000, 100000);
    expect(monthlyMinimum).toBeCloseTo(100000 * 0.0528 / 12, 8);
    expect(monthlyMinimum).toBeGreaterThan(mandatoryRegisteredWithdrawal("RRIF", 71, 90000));
  });

  it("treats LIRA and LIF as registered accounts at death", () => {
    for (const type of ["LIRA", "LIF"] as const) {
      const treatment = applyAccountDeathTreatment({
        id: type,
        owner: "MAIN_USER",
        type,
        balance: 100000,
        contributionAnnual: 0,
      }, true, 0, "SPOUSE");
      expect(treatment.transferredToSurvivor).toBe(100000);
      expect(treatment.taxableAtDeath).toBe(0);
    }
  });

  it("models non-registered deemed disposition from value minus ACB", () => {
    const treatment = applyAccountDeathTreatment({ id: "nr", owner: "MAIN_USER", type: "NON_REGISTERED", balance: 150000, contributionAnnual: 0 }, false, 90000, "ESTATE");
    expect(treatment.capitalGainAtDeath).toBe(60000);
    expect(treatment.taxableCapitalGainAtDeath).toBe(30000);
    expect(treatment.estateValue).toBe(150000);
  });

  it("transfers a deceased spouse's registered assets once without creating extra value", () => {
    const scenario = makeScenario({
      household: {
        province: "AB",
        stage: "BOTH_ALIVE",
        people: [
          { role: "MAIN_USER", birthYear: 1955, birthMonth: 1, retirementAge: 65, cppAt65: 1000, cppStartAge: 65, oasStartAge: 65, oasResidenceYears: 40, deathAge: 70 },
          { role: "PARTNER", birthYear: 1960, birthMonth: 1, retirementAge: 65, cppAt65: 1000, cppStartAge: 65, oasStartAge: 65, oasResidenceYears: 40 },
        ],
      },
      goals: { ...makeScenario().goals, annualSpending: 0, planningAge: 80 },
      accounts: [{ id: "rrsp", owner: "MAIN_USER", type: "RRSP", valuation: { mode: "MANUAL", value: 100000 } }],
    });
    const result = runRetirementSimulation(scenario, 100000, 2025);
    const survivorMonths = result.monthly.filter(m => m.householdStage === "SURVIVOR");
    expect(survivorMonths.length).toBeGreaterThan(0);
    expect(Math.max(...survivorMonths.map(m => m.portfolio))).toBeLessThanOrEqual(100000 + 1e-6);
  });

  it("stops the deceased person's benefits after the survivor transition", () => {
    const scenario = makeScenario({
      household: {
        province: "AB",
        stage: "BOTH_ALIVE",
        people: [
          { role: "MAIN_USER", birthYear: 1955, birthMonth: 1, retirementAge: 60, cppAt65: 12000, cppStartAge: 60, oasStartAge: 65, oasResidenceYears: 40, deathAge: 70 },
          { role: "PARTNER", birthYear: 1960, birthMonth: 1, retirementAge: 60, cppAt65: 12000, cppStartAge: 60, oasStartAge: 65, oasResidenceYears: 40 },
        ],
      },
      goals: { ...makeScenario().goals, annualSpending: 0, planningAge: 80 },
      accounts: [],
    });
    const result = runRetirementSimulation(scenario, 0, 2025);
    const deathIndex = result.monthly.findIndex(m => m.householdStage === "SURVIVOR");
    expect(deathIndex).toBeGreaterThan(0);
    expect(result.monthly[deathIndex! - 1]!.benefits).toBeGreaterThan(0);
    expect(result.monthly[deathIndex! + 1]!.benefits).toBeGreaterThan(0);
  });

  it("runs every default stress test and keeps the base result separate", () => {
    const scenario = makeScenario();
    const stress = runStressTests(scenario, 100000, { TFSA: 100000 });
    expect(stress.base.kind).toBe("BASE");
    expect(stress.scenarios).toHaveLength(6);
    expect(stress.scenarios.every(s => s.kind !== "BASE")).toBe(true);
    expect(stress.warnings.some(w => w.includes("not probabilities"))).toBe(true);
  });
});
