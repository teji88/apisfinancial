import type {
  OptimizationCandidate,
  OptimizationResult,
  RetirementScenario,
  SimulationMetrics,
  StrategyPreferences,
} from "../domain/types";
import { runRetirementSimulation } from "../engines/SimulationCoordinator";

export interface OptimizationConstraints {
  minimumEstate?: number;
  maximumShortfall?: number;
  maximumDepletionAge?: number;
  minimumSpending?: number;
  maximumTax?: number;
}

export type OptimizationVariablePath =
  | "retirementAge"
  | "cppStartAge"
  | "oasStartAge"
  | "annualSpending"
  | "withdrawalPolicy"
  | "cashReserve";

export interface OptimizationVariable {
  path: OptimizationVariablePath;
  values: Array<number | string>;
}

export interface OptimizationProblem {
  scenario: RetirementScenario;
  startingPortfolio: number;
  portfolioByType?: Record<string, number>;
  startYear?: number;
  variables?: OptimizationVariable[];
  constraints?: OptimizationConstraints;
  objective?: StrategyPreferences["objective"];
}

const DEFAULT_POLICIES: StrategyPreferences["withdrawalPolicy"][] = [
  "TAX_TARGETED",
  "REGISTERED_FIRST",
  "NON_REGISTERED_FIRST",
  "TFSA_FIRST",
];
const MAX_CANDIDATES = 1500;

function applyVariable(
  scenario: RetirementScenario,
  variable: OptimizationVariable,
  value: number | string,
): RetirementScenario {
  const next = structuredClone(scenario);

  switch (variable.path) {
    case "retirementAge":
      if (typeof value === "number") {
        next.goals.retirementAge = value;
        next.household.people = next.household.people.map((person) => ({
          ...person,
          retirementAge: value,
        }));
      }
      break;
    case "annualSpending":
      if (typeof value === "number") next.goals.annualSpending = value;
      break;
    case "cppStartAge":
      if (typeof value === "number") {
        next.household.people = next.household.people.map((person) => ({
          ...person,
          cppStartAge: value,
        }));
      }
      break;
    case "oasStartAge":
      if (typeof value === "number") {
        next.household.people = next.household.people.map((person) => ({
          ...person,
          oasStartAge: value,
        }));
      }
      break;
    case "withdrawalPolicy":
      if (typeof value === "string") {
        next.strategy.withdrawalPolicy =
          value as StrategyPreferences["withdrawalPolicy"];
      }
      break;
    case "cashReserve":
      if (typeof value === "number") next.strategy.cashReserve = value;
      break;
  }

  return next;
}

function defaultVariables(
  scenario: RetirementScenario,
): OptimizationVariable[] {
  // Retirement ages to try: from 50 up to the user's target, in 5-year steps.
  // This enables the "earliest retirement" objective to find the minimum feasible age.
  const retirementAges: number[] = [];
  const maxAge = Math.min(65, Math.max(50, scenario.goals.retirementAge));
  for (let age = 50; age <= maxAge; age += 5) {
    retirementAges.push(age);
  }
  if (!retirementAges.includes(scenario.goals.retirementAge)) {
    retirementAges.push(scenario.goals.retirementAge);
  }
  retirementAges.sort((a, b) => a - b);

  return [
    {
      path: "annualSpending",
      values: [
        scenario.goals.annualSpending * 0.9,
        scenario.goals.annualSpending,
        scenario.goals.annualSpending * 1.1,
      ],
    },
    { path: "retirementAge", values: retirementAges },
    { path: "cppStartAge", values: [60, 65, 70] },
    { path: "oasStartAge", values: [65, 70] },
    { path: "withdrawalPolicy", values: DEFAULT_POLICIES },
  ];
}

function ageAtDate(birthYear: number, birthMonth: number, isoDate: string): number {
  const date = new Date(isoDate);
  return date.getUTCFullYear() - birthYear - (date.getUTCMonth() + 1 < birthMonth ? 1 : 0);
}

function constraintViolations(
  scenario: RetirementScenario,
  metrics: SimulationMetrics,
  constraints: OptimizationConstraints,
): string[] {
  const violations: string[] = [];
  const estate = metrics.estateValue ?? metrics.endingNetWorth;

  if (
    constraints.minimumEstate !== undefined &&
    estate < constraints.minimumEstate
  ) {
    violations.push("minimumEstate");
  }
  if (
    constraints.maximumShortfall !== undefined &&
    metrics.maximumSpendingShortfall > constraints.maximumShortfall
  ) {
    violations.push("maximumShortfall");
  }
  if (constraints.maximumDepletionAge !== undefined && metrics.depletionDate) {
    const person = scenario.household.people[0];
    if (person && ageAtDate(person.birthYear, person.birthMonth, metrics.depletionDate) < constraints.maximumDepletionAge) {
      violations.push("maximumDepletionAge");
    }
  }
  if (
    constraints.minimumSpending !== undefined &&
    metrics.lifetimeSpending < constraints.minimumSpending
  ) {
    violations.push("minimumSpending");
  }
  if (
    constraints.maximumTax !== undefined &&
    metrics.lifetimeTax > constraints.maximumTax
  ) {
    violations.push("maximumTax");
  }

  return violations;
}

function objectiveValue(
  metrics: SimulationMetrics,
  objective: StrategyPreferences["objective"],
  scenario: RetirementScenario,
): number {
  const feasible = metrics.maximumSpendingShortfall === 0 && !metrics.depletionDate;
  switch (objective) {
    case "MAX_SUSTAINABLE_SPENDING":
      return metrics.maximumSpendingShortfall === 0
        ? metrics.lifetimeSpending
        : -metrics.maximumSpendingShortfall;
    case "MAX_LIFETIME_AFTER_TAX_CASH":
      return metrics.lifetimeAfterTaxCash;
    case "MAX_ESTATE":
      return metrics.estateValue ?? metrics.endingNetWorth;
    case "MIN_DEPLETION_RISK":
      return metrics.maximumSpendingShortfall === 0
        ? metrics.minimumPortfolio
        : -metrics.maximumSpendingShortfall;
    case "MIN_TAX":
      return -metrics.lifetimeTax;
    case "MIN_RETIREMENT_AGE":
      // Earliest feasible retirement age wins. Infeasible plans (shortfall or
      // depletion) are penalized below any feasible plan.
      return feasible ? -scenario.goals.retirementAge : -1000 - scenario.goals.retirementAge;
    case "CUSTOM":
    default:
      return metrics.lifetimeAfterTaxCash;
  }
}

function vector(candidate: OptimizationCandidate): number[] {
  return [
    candidate.metrics.lifetimeAfterTaxCash,
    candidate.metrics.estateValue ?? candidate.metrics.endingNetWorth,
    -candidate.metrics.lifetimeTax,
    candidate.metrics.minimumPortfolio,
    -candidate.metrics.maximumSpendingShortfall,
  ];
}

function dominates(
  a: OptimizationCandidate,
  b: OptimizationCandidate,
): boolean {
  if (a.violations.length === 0 && b.violations.length !== 0) return true;
  if (a.violations.length !== 0 && b.violations.length === 0) return false;

  const av = vector(a);
  const bv = vector(b);
  const atLeastAsGood = av.every((value, index) => value >= bv[index]);
  const strictlyBetter = av.some((value, index) => value > bv[index]);
  return atLeastAsGood && strictlyBetter;
}

function enumerate(
  variables: OptimizationVariable[],
  index: number,
  scenario: RetirementScenario,
  output: RetirementScenario[],
): void {
  if (output.length >= MAX_CANDIDATES) return;
  if (index === variables.length) {
    output.push(scenario);
    return;
  }

  const variable = variables[index];
  for (const value of variable.values) {
    if (output.length >= MAX_CANDIDATES) break;
    enumerate(
      variables,
      index + 1,
      applyVariable(scenario, variable, value),
      output,
    );
  }
}

export function optimizeRetirementPlan(
  problem: OptimizationProblem,
): OptimizationResult {
  const objective =
    problem.objective ?? problem.scenario.strategy.objective;
  const variables = problem.variables ?? defaultVariables(problem.scenario);
  const scenarios: RetirementScenario[] = [];

  enumerate(variables, 0, problem.scenario, scenarios);

  const candidates: OptimizationCandidate[] = scenarios.map((scenario) => {
    const simulation = runRetirementSimulation(
      scenario,
      problem.startingPortfolio,
      problem.startYear,
      problem.portfolioByType,
    );

    return {
      scenario,
      metrics: simulation.metrics,
      objectiveValue: objectiveValue(simulation.metrics, objective, scenario),
      violations: constraintViolations(
        scenario,
        simulation.metrics,
        problem.constraints ?? {},
      ),
    };
  });

  const feasible = candidates.filter(
    (candidate) => candidate.violations.length === 0,
  );
  // Explicit constraints are hard constraints. Never select or present an
  // infeasible candidate as the chosen plan merely because no feasible plan
  // exists. The caller can inspect all candidates/violations and adjust the
  // problem instead.
  const pool = feasible;

  const paretoCandidates = pool.filter(
    (candidate, index) =>
      !pool.some(
        (other, otherIndex) =>
          index !== otherIndex && dominates(other, candidate),
      ),
  );

  const selectedCandidate = [...pool].sort(
    (a, b) => b.objectiveValue - a.objectiveValue,
  )[0];

  return {
    candidates,
    feasiblePlans: feasible.map((candidate) => candidate.scenario),
    paretoFrontier: paretoCandidates.map((candidate) => candidate.scenario),
    paretoCandidates,
    selectedPlan: selectedCandidate?.scenario,
    selectedCandidate,
    objective,
    constraints: [
      {
        name: "feasible",
        satisfied: feasible.length > 0,
        value: feasible.length,
        limit: 1,
      },
    ],
  };
}
