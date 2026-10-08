import type {
  OptimizationCandidate,
  OptimizationResult,
  PersonScenario,
  RetirementScenario,
  SimulationMetrics,
  StrategyPreferences,
} from "../domain/types";
import { runRetirementSimulation } from "../engines/SimulationCoordinator";
import { estimateGovernmentBenefits } from "../engines/BenefitEngine";

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
  /** Progress callback: (completed, total) */
  onProgress?: (completed: number, total: number) => void;
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
  // Retirement ages for grid search: 5-year steps. The MIN_RETIREMENT_AGE
  // objective uses binary search (35-85, 1-year precision) instead.
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

  // Specialized efficient search for earliest retirement: binary search on
  // retirement age (35-85) instead of brute-forcing every year in the grid.
  if (objective === "MIN_RETIREMENT_AGE" && !problem.variables) {
    return optimizeEarliestRetirement(problem);
  }

  const variables = problem.variables ?? defaultVariables(problem.scenario);
  const scenarios: RetirementScenario[] = [];

  enumerate(variables, 0, problem.scenario, scenarios);

  const candidates: OptimizationCandidate[] = scenarios.map((scenario) =>
    evaluateCandidate(scenario, problem, objective),
  );

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

function evaluateCandidate(
  scenario: RetirementScenario,
  problem: OptimizationProblem,
  objective: StrategyPreferences["objective"],
): OptimizationCandidate {
  const simulation = runRetirementSimulation(
    scenario,
    problem.startingPortfolio,
    problem.startYear,
    problem.portfolioByType,
  );

  const gisViolations = scenario.household.people.flatMap((person) => {
    const v = oasDeferralForfeitsGis(person, scenario.household.people.length);
    return v === null ? [] : [v];
  });

  return {
    scenario,
    metrics: simulation.metrics,
    objectiveValue: objectiveValue(simulation.metrics, objective, scenario),
    violations: [
      ...constraintViolations(
        scenario,
        simulation.metrics,
        problem.constraints ?? {},
      ),
      ...gisViolations,
    ],
  };
}

/**
 * Blocking guardrail: OAS Act ss.11(1), 11(7)(b) — GIS is only paid "to a
 * pensioner", so deferring OAS forfeits GIS for every deferred month (up to 5
 * years, often $1,000+/mo non-taxable) in exchange for a 36% boost on the OAS
 * portion only. Someone who would qualify for any GIS at 65 is therefore
 * almost certainly wrong to defer. The simulation already prices the
 * forfeiture; this violation additionally blocks the optimizer from ever
 * selecting a deferring candidate for such a person.
 *
 * The probe estimates GIS at 65 with OAS at 65 on declared other income +
 * CPP at 65 + employment income if still working (all count for GIS; OAS
 * itself is excluded by the engine). Limitations: RRIF/RRSP withdrawal
 * income is not in the probe (may overstate GIS for high-withdrawal
 * scenarios) and partner income is not modelled (single/couple threshold
 * only). Both are documented; the candidate list remains inspectable.
 */
function oasDeferralForfeitsGis(person: PersonScenario, householdSize: number): string | null {
  const startAge = person.oasStartAge;
  if (typeof startAge !== "number" || startAge <= 65) return null;

  const at65 = estimateGovernmentBenefits({ ...person, oasStartAge: 65 }, 65, 0, {
    calendarYear: 2026,
    inflationRate: 0,
    householdSize,
  });
  const employedAt65 = (person.retirementAge ?? 65) > 65;
  const employmentIncome = employedAt65
    ? (person.employmentIncome ?? 0) + (person.selfEmploymentIncome ?? 0)
    : 0;
  const probeIncome = (person.otherIncome ?? 0) + at65.cpp + employmentIncome;
  const gisProbe = estimateGovernmentBenefits({ ...person, oasStartAge: 65 }, 65, probeIncome, {
    calendarYear: 2026,
    inflationRate: 0,
    householdSize,
    previousYearEmploymentIncome: employmentIncome,
  });
  return gisProbe.gis > 0 ? "oasDeferralForfeitsGis" : null;
}

/**
 * Find the earliest feasible retirement age using binary search.
 * Tests every integer age from 35 to 85, but only ~6 grid evaluations
 * instead of 51, by exploiting monotonicity: if you can retire at age X,
 * you can retire at any age > X (more savings, fewer years to fund).
 */
function optimizeEarliestRetirement(
  problem: OptimizationProblem,
): OptimizationResult {
  const objective = "MIN_RETIREMENT_AGE" as const;
  const baseVariables = (problem.variables ?? defaultVariables(problem.scenario)).filter(
    (v) => v.path !== "retirementAge",
  );

  const MIN_AGE = 35;
  const MAX_AGE = 85;

  const isFeasibleAtAge = (age: number): { feasible: boolean; candidates: OptimizationCandidate[] } => {
    const ageVariables: OptimizationVariable[] = [
      { path: "retirementAge", values: [age] },
      ...baseVariables,
    ];
    const scenarios: RetirementScenario[] = [];
    enumerate(ageVariables, 0, problem.scenario, scenarios);
    const candidates = scenarios.map((s) => evaluateCandidate(s, problem, objective));
    // $1,000 nominal ≈ $500-600 in today's dollars; below this is tax
    // gross-up numerical noise, not a real planning failure.
    const MATERIAL_SHORTFALL_NOMINAL = 1000;
    const feasible = candidates.some(
      (c) =>
        c.violations.length === 0 &&
        c.metrics.maximumSpendingShortfall <= MATERIAL_SHORTFALL_NOMINAL &&
        !c.metrics.depletionDate,
    );
    return { feasible, candidates };
  };

  let low = MIN_AGE;
  let high = MAX_AGE;
  let bestCandidates: OptimizationCandidate[] = [];
  const allCandidates: OptimizationCandidate[] = [];

  const ESTIMATED_STEPS = 8; // 1 max-age check + ~7 binary search iterations
  let completedSteps = 0;
  const reportProgress = () => {
    completedSteps++;
    problem.onProgress?.(completedSteps, ESTIMATED_STEPS);
  };

  const atMax = isFeasibleAtAge(MAX_AGE);
  allCandidates.push(...atMax.candidates);
  reportProgress();
  if (!atMax.feasible) {
    return buildOptimizationResult(allCandidates, problem, objective);
  }

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const { feasible, candidates } = isFeasibleAtAge(mid);
    allCandidates.push(...candidates);
    reportProgress();
    if (feasible) {
      bestCandidates = candidates;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return buildOptimizationResult(allCandidates, problem, objective, bestCandidates);
}

function buildOptimizationResult(
  candidates: OptimizationCandidate[],
  problem: OptimizationProblem,
  objective: StrategyPreferences["objective"],
  bestAgeCandidates?: OptimizationCandidate[],
): OptimizationResult {
  const feasible = candidates.filter(
    (candidate) => candidate.violations.length === 0,
  );
  const pool = feasible;

  const paretoCandidates = pool.filter(
    (candidate, index) =>
      !pool.some(
        (other, otherIndex) =>
          index !== otherIndex && dominates(other, candidate),
      ),
  );

  let selectedCandidate: OptimizationCandidate | undefined;
  if (bestAgeCandidates && bestAgeCandidates.length > 0) {
    const feasibleAtBest = bestAgeCandidates.filter(
      (c) =>
        c.violations.length === 0 &&
        c.metrics.maximumSpendingShortfall <= 1000 &&
        !c.metrics.depletionDate,
    );
    selectedCandidate = [...feasibleAtBest].sort(
      (a, b) => b.objectiveValue - a.objectiveValue,
    )[0];
  } else {
    selectedCandidate = [...pool].sort(
      (a, b) => b.objectiveValue - a.objectiveValue,
    )[0];
  }

  const result: OptimizationResult = {
    candidates,
    feasiblePlans: feasible.map((candidate) => candidate.scenario),
    paretoFrontier: paretoCandidates.map((candidate) => candidate.scenario),
    paretoCandidates,
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
  if (selectedCandidate) {
    result.selectedPlan = selectedCandidate.scenario;
    result.selectedCandidate = selectedCandidate;
  }
  return result;
}
