import type { RetirementScenario, SimulationResult } from "../domain/types";
import { RETIREMENT_ENGINE_VERSION, RETIREMENT_RULES_VERSION } from "./defaults";
import { runRetirementSimulation } from "../engines/SimulationCoordinator";

export type StressTestKind =
  | "BASE"
  | "LOW_RETURN"
  | "HIGH_INFLATION"
  | "POOR_SEQUENCE"
  | "LONGER_LIFE"
  | "EARLIER_RETIREMENT"
  | "SURVIVOR";

export interface StressTestDefinition {
  kind: StressTestKind;
  name: string;
  description: string;
  assumptions: Partial<RetirementScenario["assumptions"]>;
  apply: (scenario: RetirementScenario) => RetirementScenario;
}

export interface ScenarioRun {
  id: string;
  kind: StressTestKind;
  name: string;
  description: string;
  scenario: RetirementScenario;
  result: SimulationResult;
  deltas: {
    endingPortfolio: number;
    maximumSpendingShortfall: number;
    lifetimeAfterTaxCash: number;
    lifetimeTax: number;
    totalBenefits: number;
    minimumPortfolio: number;
  };
}

export interface ScenarioStressTestResult {
  base: ScenarioRun;
  scenarios: ScenarioRun[];
  warnings: string[];
  engineVersion: string;
  rulesVersion: string;
}

function cloneScenario(scenario: RetirementScenario): RetirementScenario {
  return structuredClone(scenario);
}

function withAssumptions(
  scenario: RetirementScenario,
  changes: Partial<RetirementScenario["assumptions"]>,
): RetirementScenario {
  const next = cloneScenario(scenario);
  next.assumptions = { ...next.assumptions, ...changes };
  return next;
}

function withAllPeople(
  scenario: RetirementScenario,
  transform: (person: RetirementScenario["household"]["people"][number]) => RetirementScenario["household"]["people"][number],
): RetirementScenario {
  const next = cloneScenario(scenario);
  next.household.people = next.household.people.map(transform);
  return next;
}

/**
 * Deterministic planning scenarios. These deliberately reuse Layer 1 rather
 * than implementing a second financial model. The poor-sequence case is
 * represented by a conservative return assumption because the current
 * simulation engine uses smoothed returns; true month-by-month return paths
 * belong in the future stochastic engine.
 */
export const DEFAULT_STRESS_TESTS: StressTestDefinition[] = [
  {
    kind: "LOW_RETURN",
    name: "Lower investment returns",
    description: "Models investment returns 2 percentage points below the base assumption.",
    assumptions: {},
    apply: (s) => withAssumptions(s, { investmentReturn: Math.max(-5, s.assumptions.investmentReturn - 2) }),
  },
  {
    kind: "HIGH_INFLATION",
    name: "Higher inflation",
    description: "Models inflation 2 percentage points above the base assumption.",
    assumptions: {},
    apply: (s) => withAssumptions(s, { inflationRate: s.assumptions.inflationRate + 2 }),
  },
  {
    kind: "POOR_SEQUENCE",
    name: "Poor early sequence",
    description: "Uses a lower long-run return as a deterministic proxy for sequence risk until path-based returns are supported.",
    assumptions: {},
    apply: (s) => withAssumptions(s, { investmentReturn: Math.max(-5, s.assumptions.investmentReturn - 3) }),
  },
  {
    kind: "LONGER_LIFE",
    name: "Longer life",
    description: "Extends the planning horizon by 5 years.",
    assumptions: {},
    apply: (s) => ({ ...cloneScenario(s), goals: { ...s.goals, planningAge: s.goals.planningAge + 5 } }),
  },
  {
    kind: "EARLIER_RETIREMENT",
    name: "Earlier retirement",
    description: "Moves the retirement target 3 years earlier, subject to the person's existing age inputs.",
    assumptions: {},
    apply: (s) => {
      const nextAge = Math.max(50, s.goals.retirementAge - 3);
      const next = cloneScenario(s);
      next.goals.retirementAge = nextAge;
      next.household.people = next.household.people.map((p) => ({ ...p, retirementAge: Math.max(50, p.retirementAge - 3) }));
      return next;
    },
  },
  {
    kind: "SURVIVOR",
    name: "Survivor scenario",
    description: "Uses any non-identifying death-age assumptions already present in the plan to test survivor cash flow.",
    assumptions: {},
    apply: (s) => {
      const next = cloneScenario(s);
      if (next.household.people.length < 2) return next;
      const main = next.household.people.find((p) => p.role === "MAIN_USER");
      if (!main?.deathAge) {
        const partner = next.household.people.find((p) => p.role === "PARTNER");
        if (partner) main!.deathAge = Math.max(80, s.goals.retirementAge + 15);
      }
      return next;
    },
  },
];

function runOne(
  scenario: RetirementScenario,
  kind: StressTestKind,
  name: string,
  description: string,
  baseMetrics?: SimulationResult["metrics"],
): ScenarioRun {
  const result = runRetirementSimulation(scenario, scenario.accounts.reduce((sum, account) => sum + (account.valuation.linkedValue ?? account.valuation.value ?? 0), 0));
  const b = baseMetrics ?? result.metrics;
  return {
    id: scenario.id,
    kind,
    name,
    description,
    scenario,
    result,
    deltas: {
      endingPortfolio: result.metrics.endingPortfolio - b.endingPortfolio,
      maximumSpendingShortfall: result.metrics.maximumSpendingShortfall - b.maximumSpendingShortfall,
      lifetimeAfterTaxCash: result.metrics.lifetimeAfterTaxCash - b.lifetimeAfterTaxCash,
      lifetimeTax: result.metrics.lifetimeTax - b.lifetimeTax,
      totalBenefits: result.metrics.totalBenefits - b.totalBenefits,
      minimumPortfolio: result.metrics.minimumPortfolio - b.minimumPortfolio,
    },
  };
}

export function runStressTests(
  scenario: RetirementScenario,
  startingPortfolio = 0,
  portfolioByType: Record<string, number> = {},
  definitions: StressTestDefinition[] = DEFAULT_STRESS_TESTS,
): ScenarioStressTestResult {
  const baseResult = runRetirementSimulation(scenario, startingPortfolio, undefined, portfolioByType);
  const base: ScenarioRun = {
    id: scenario.id,
    kind: "BASE",
    name: scenario.name || "Base plan",
    description: "The plan using the selected assumptions.",
    scenario,
    result: baseResult,
    deltas: {
      endingPortfolio: 0,
      maximumSpendingShortfall: 0,
      lifetimeAfterTaxCash: 0,
      lifetimeTax: 0,
      totalBenefits: 0,
      minimumPortfolio: 0,
    },
  };

  const scenarios = definitions.map((definition) => {
    const variant = definition.apply(scenario);
    const result = runRetirementSimulation(variant, startingPortfolio, undefined, portfolioByType);
    return {
      id: variant.id,
      kind: definition.kind,
      name: definition.name,
      description: definition.description,
      scenario: variant,
      result,
      deltas: {
        endingPortfolio: result.metrics.endingPortfolio - baseResult.metrics.endingPortfolio,
        maximumSpendingShortfall: result.metrics.maximumSpendingShortfall - baseResult.metrics.maximumSpendingShortfall,
        lifetimeAfterTaxCash: result.metrics.lifetimeAfterTaxCash - baseResult.metrics.lifetimeAfterTaxCash,
        lifetimeTax: result.metrics.lifetimeTax - baseResult.metrics.lifetimeTax,
        totalBenefits: result.metrics.totalBenefits - baseResult.metrics.totalBenefits,
        minimumPortfolio: result.metrics.minimumPortfolio - baseResult.metrics.minimumPortfolio,
      },
    };
  });

  const warnings = [
    "Stress tests are deterministic what-if scenarios, not probabilities.",
    "Poor sequence is currently a conservative-return proxy because the Layer 1 simulator uses smoothed returns rather than month-by-month market paths.",
    ...baseResult.warnings.filter((warning) => !warning.includes("sequence-of-returns")),
  ];

  return {
    base,
    scenarios,
    warnings,
    engineVersion: RETIREMENT_ENGINE_VERSION,
    rulesVersion: RETIREMENT_RULES_VERSION,
  };
}
