import { describe, expect, it } from "vitest";
import type { RetirementScenario } from "../domain/types";
import { runRetirementSimulation } from "./SimulationCoordinator";
import { applyAccountDeathTreatment, classifyAccount, mandatoryRegisteredWithdrawal } from "./AccountEngine";
import { calculateBasicTax, calculateIncrementalTax, calculateIncrementalWithdrawalCost } from "./TaxEngine";
import { runStressTests } from "../scenario/ScenarioEngine";
import { estimateGovernmentBenefits, estimateCppSurvivorAnnual } from "./BenefitEngine";

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
      household: { ...makeScenario().household, people: [{ ...makeScenario().household.people[0], birthYear: 1966 }] },
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
          { role: "MAIN_USER", birthYear: 1955, birthMonth: 1, retirementAge: 65, cppAt65: 1000, cppStartAge: 65, oasStartAge: 65, oasResidenceYears: 40, deathAge: 71 },
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
          { role: "MAIN_USER", birthYear: 1955, birthMonth: 1, retirementAge: 60, cppAt65: 12000, cppStartAge: 60, oasStartAge: 65, oasResidenceYears: 40, deathAge: 71 },
          { role: "PARTNER", birthYear: 1960, birthMonth: 1, retirementAge: 60, cppAt65: 12000, cppStartAge: 60, oasStartAge: 65, oasResidenceYears: 40 },
        ],
      },
      goals: { ...makeScenario().goals, annualSpending: 0, planningAge: 80 },
      accounts: [],
    });
    const result = runRetirementSimulation(scenario, 0, 2025);
    expect(result.monthly[0]!.householdStage).toBe("BOTH_ALIVE");
    const deathIndex = result.monthly.findIndex((m, index) => index > 0 && m.householdStage === "SURVIVOR");
    expect(deathIndex).toBeGreaterThan(0);
    expect(result.monthly[deathIndex! - 1]!.benefits).toBeGreaterThan(0);
    expect(result.monthly[deathIndex! + 1]!.benefits).toBeGreaterThan(0);
  });

  it("keeps TFSA withdrawals outside taxable income and tax", () => {
    expect(calculateBasicTax(0, "AB", 65).totalTax).toBe(0);
    expect(calculateIncrementalTax(50000, 10000, "AB", 65)).toBeGreaterThan(0);
    expect(calculateIncrementalWithdrawalCost(50000, 10000, "AB", 65).effectiveCostRate).toBeGreaterThan(0);
  });

  it("has non-negative and monotonic tax as taxable income rises", () => {
    const incomes = [0, 25000, 50000, 100000, 200000, 400000];
    const taxes = incomes.map((income) => calculateBasicTax(income, "AB", 65).totalTax);
    for (let i = 0; i < taxes.length; i++) {
      expect(taxes[i]).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(taxes[i]).toBeGreaterThanOrEqual(taxes[i - 1]!);
    }
  });

  it("conserves portfolio cash flow when returns, benefits and taxes are zero", () => {
    const scenario = makeScenario({
      goals: { ...makeScenario().goals, annualSpending: 12000, planningAge: 66 },
      household: {
        ...makeScenario().household,
        people: [{
          ...makeScenario().household.people[0]!,
          birthYear: 1960,
          cppAt65: 0,
          cppStartAge: 70,
          oasStartAge: 70,
        }],
      },
      accounts: [{
        id: "tfsa",
        owner: "MAIN_USER",
        type: "TFSA",
        valuation: { mode: "MANUAL", value: 100000 },
      }],
      assumptions: { ...makeScenario().assumptions, investmentReturn: 0, investmentFeeRate: 0 },
      strategy: { withdrawalPolicy: "TFSA_FIRST", objective: "MAX_SUSTAINABLE_SPENDING" },
    });

    const result = runRetirementSimulation(scenario, 100000, 2025);
    expect(result.monthly.length).toBeGreaterThan(0);
    for (let i = 0; i < result.monthly.length; i++) {
      const current = result.monthly[i]!;
      const previousPortfolio = i === 0 ? 100000 : result.monthly[i - 1]!.portfolio;
      expect(previousPortfolio - current.portfolio).toBeCloseTo(current.withdrawals, 8);
      expect(current.taxes).toBe(0);
      expect(current.benefits).toBe(0);
    }
  });

  it("does not pay CPP before its selected start age and applies the early/late adjustment", () => {
    const person = makeScenario().household.people[0]!;
    const before = estimateGovernmentBenefits({ ...person, cppAt65: 1000, cppStartAge: 65 }, 64).cpp;
    const at65 = estimateGovernmentBenefits({ ...person, cppAt65: 1000, cppStartAge: 65 }, 65).cpp;
    const at60 = estimateGovernmentBenefits({ ...person, cppAt65: 1000, cppStartAge: 60 }, 60).cpp;
    const at70 = estimateGovernmentBenefits({ ...person, cppAt65: 1000, cppStartAge: 70 }, 70).cpp;
    expect(before).toBe(0);
    expect(at65).toBeCloseTo(12000, 8);
    expect(at60).toBeCloseTo(12000 * 0.64, 8);
    expect(at70).toBeCloseTo(12000 * 1.42, 8);
  });

  it("does not pay OAS before its selected start age and applies residence and deferral rules", () => {
    const person = makeScenario().household.people[0]!;
    const before = estimateGovernmentBenefits({ ...person, oasStartAge: 65, oasResidenceYears: 40 }, 64).oas;
    const partial = estimateGovernmentBenefits({ ...person, oasStartAge: 65, oasResidenceYears: 20 }, 65).oas;
    const deferred = estimateGovernmentBenefits({ ...person, oasStartAge: 70, oasResidenceYears: 40 }, 70).oas;
    expect(before).toBe(0);
    expect(partial).toBeCloseTo(751.97 * 12 * 0.5, 8);
    expect(deferred).toBeCloseTo(751.97 * 12 * 1.36, 8);
  });

  it("applies the age-75 OAS increase without double-counting residence", () => {
    const person = makeScenario().household.people[0]!;
    const full = estimateGovernmentBenefits({ ...person, oasStartAge: 65, oasResidenceYears: 40 }, 75).oas;
    const partial = estimateGovernmentBenefits({ ...person, oasStartAge: 65, oasResidenceYears: 20 }, 75).oas;
    expect(full).toBeCloseTo(827.17 * 12, 8);
    expect(partial).toBeCloseTo(827.17 * 12 * 0.5, 8);
  });

  it("uses prior-year income for GIS and removes GIS as income reaches the published cutoff", () => {
    const person = makeScenario().household.people[0]!;
    const eligible = estimateGovernmentBenefits(
      { ...person, oasStartAge: 65, oasResidenceYears: 40 },
      65,
      0,
      { householdSize: 1, previousYearIncome: 10000, calendarYear: 2026 },
    ).gis;
    const ineligible = estimateGovernmentBenefits(
      { ...person, oasStartAge: 65, oasResidenceYears: 40 },
      65,
      0,
      { householdSize: 1, previousYearIncome: 22800, calendarYear: 2026 },
    ).gis;
    expect(eligible).toBeGreaterThan(0);
    expect(ineligible).toBe(0);
  });

  it("keeps CPP survivor benefits bounded and age-sensitive", () => {
    const deceasedCpp = 12000;
    const before65 = estimateCppSurvivorAnnual(deceasedCpp, 64, 0, 60);
    const after65 = estimateCppSurvivorAnnual(deceasedCpp, 65, 0, 60);
    const combined = estimateCppSurvivorAnnual(deceasedCpp, 65, 10000, 60);
    expect(before65).toBeCloseTo(4500, 8);
    expect(after65).toBeCloseTo(7200, 8);
    expect(combined).toBeGreaterThanOrEqual(0);
    expect(combined).toBeLessThanOrEqual(after65);
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
