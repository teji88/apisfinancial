import type { RetirementScenario, OptimizationResult, StrategyPreferences } from "../domain/types";
import { runRetirementSimulation } from "../engines/SimulationCoordinator";

export interface OptimizationConstraints {
  minimumEstate?: number;
  maximumShortfall?: number;
  maximumDepletionAge?: number;
  minimumSpending?: number;
}

export interface OptimizationVariable {
  path: "retirementAge" | "cppStartAge" | "oasStartAge" | "annualSpending" | "withdrawalPolicy" | "cashReserve";
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

interface Candidate {
  scenario: RetirementScenario;
  metrics: ReturnType<typeof runRetirementSimulation>["metrics"];
  objectiveValue: number;
  violations: string[];
}

const DEFAULT_POLICIES: StrategyPreferences["withdrawalPolicy"][] = [
  "TAX_TARGETED", "REGISTERED_FIRST", "NON_REGISTERED_FIRST", "TFSA_FIRST",
];

function applyVariable(s: RetirementScenario, path: OptimizationVariable["path"], value: number | string): RetirementScenario {
  const next = structuredClone(s);
  if (path === "retirementAge" && typeof value === "number") {
    next.goals.retirementAge = value;
    next.household.people = next.household.people.map(p => ({ ...p, retirementAge: value }));
  } else if (path === "annualSpending" && typeof value === "number") next.goals.annualSpending = value;
  else if (path === "cppStartAge" && typeof value === "number") next.household.people = next.household.people.map(p => ({ ...p, cppStartAge: value }));
  else if (path === "oasStartAge" && typeof value === "number") next.household.people = next.household.people.map(p => ({ ...p, oasStartAge: value }));
  else if (path === "withdrawalPolicy" && typeof value === "string") next.strategy.withdrawalPolicy = value as StrategyPreferences["withdrawalPolicy"];
  else if (path === "cashReserve" && typeof value === "number") next.strategy.cashReserve = value;
  return next;
}

function violations(m: Candidate["metrics"], c: OptimizationConstraints): string[] {
  const out: string[] = [];
  if (c.minimumEstate !== undefined && m.endingPortfolio < c.minimumEstate) out.push("minimumEstate");
  if (c.maximumShortfall !== undefined && m.maximumSpendingShortfall > c.maximumShortfall) out.push("maximumShortfall");
  if (c.maximumDepletionAge !== undefined && m.depletionDate) {
    const depletionYear = new Date(m.depletionDate).getUTCFullYear();
    const birthYear = new Date().getUTCFullYear() - 65;
    if (depletionYear - birthYear < c.maximumDepletionAge) out.push("maximumDepletionAge");
  }
  if (c.minimumSpending !== undefined && m.lifetimeSpending < c.minimumSpending) out.push("minimumSpending");
  return out;
}

function objectiveValue(m: Candidate["metrics"], objective: StrategyPreferences["objective"]): number {
  switch (objective) {
    case "MAX_SUSTAINABLE_SPENDING": return m.maximumSpendingShortfall === 0 ? m.lifetimeSpending : -m.maximumSpendingShortfall;
    case "MAX_LIFETIME_AFTER_TAX_CASH": return m.lifetimeAfterTaxCash;
    case "MAX_ESTATE": return m.endingPortfolio;
    case "MIN_DEPLETION_RISK": return m.maximumSpendingShortfall === 0 ? m.minimumPortfolio : -m.maximumSpendingShortfall;
    case "MIN_TAX": return -m.lifetimeTax;
    default: return m.lifetimeAfterTaxCash;
  }
}

function dominates(a: Candidate, b: Candidate): boolean {
  if (a.violations.length !== 0 && b.violations.length === 0) return false;
  if (a.violations.length === 0 && b.violations.length !== 0) return true;
  return a.objectiveValue >= b.objectiveValue;
}

export function optimizeRetirementPlan(problem: OptimizationProblem): OptimizationResult {
  const objective = problem.objective ?? problem.scenario.strategy.objective;
  const variables = problem.variables ?? [
    { path: "annualSpending", values: [problem.scenario.goals.annualSpending * 0.9, problem.scenario.goals.annualSpending, problem.scenario.goals.annualSpending * 1.1] },
    { path: "cppStartAge", values: [60, 65, 70] },
    { path: "oasStartAge", values: [65, 70] },
    { path: "withdrawalPolicy", values: DEFAULT_POLICIES },
  ];
  const candidates: Candidate[] = [];
  const maxCandidates = 1500;

  const walk = (index: number, scenario: RetirementScenario) => {
    if (candidates.length >= maxCandidates) return;
    if (index === variables.length) {
      const sim = runRetirementSimulation(scenario, problem.startingPortfolio, problem.startYear, problem.portfolioByType);
      const candidate: Candidate = { scenario, metrics: sim.metrics, objectiveValue: objectiveValue(sim.metrics, objective), violations: violations(sim.metrics, problem.constraints ?? {}) };
      candidates.push(candidate);
      return;
    }
    for (const value of variables[index].values) walk(index + 1, applyVariable(scenario, variables[index].path, value));
  };
  walk(0, problem.scenario);

  const feasible = candidates.filter(c => c.violations.length === 0);
  const pool = feasible.length ? feasible : candidates;
  const pareto = pool.filter((a, i) => !pool.some((b, j) => i !== j && dominates(b, a)));
  const selected = [...pool].sort((a, b) => b.objectiveValue - a.objectiveValue)[0];

  return {
    feasiblePlans: feasible.map(c => c.scenario),
    paretoFrontier: pareto.map(c => c.scenario),
    selectedPlan: selected?.scenario,
    objective,
    constraints: [
      { name: "feasible", satisfied: feasible.length > 0, value: feasible.length, limit: 1 },
      ...(problem.constraints?.minimumEstate !== undefined ? [{ name: "minimumEstate", satisfied: feasible.some(c => !c.violations.includes("minimumEstate")), limit: problem.constraints.minimumEstate }] : []),
      ...(problem.constraints?.maximumShortfall !== undefined ? [{ name: "maximumShortfall", satisfied: feasible.some(c => !c.violations.includes("maximumShortfall")), limit: problem.constraints.maximumShortfall }] : []),
    ],
  };
}
