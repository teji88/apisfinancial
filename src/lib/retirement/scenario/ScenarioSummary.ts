import type { SimulationResult } from "../domain/types";
import type { ScenarioStressTestResult, ScenarioRun } from "./ScenarioEngine";

export interface ScenarioSummary {
  kind: ScenarioRun["kind"];
  name: string;
  description: string;
  status: "HOLDS" | "SHORTFALL" | "DEPLETES" | "INCOMPLETE";
  endingPortfolio: number;
  maximumShortfall: number;
  lifetimeAfterTaxCash: number;
  minimumPortfolio: number;
  deltaEndingPortfolio: number;
  deltaShortfall: number;
  depletionDate?: string;
}

function summarize(run: ScenarioRun): ScenarioSummary {
  const m = run.result.metrics;
  let status: ScenarioSummary["status"] = "HOLDS";
  if (run.result.status !== "COMPLETE") status = "INCOMPLETE";
  else if (m.depletionDate) status = "DEPLETES";
  else if (m.maximumSpendingShortfall > 0) status = "SHORTFALL";

  return {
    kind: run.kind,
    name: run.name,
    description: run.description,
    status,
    endingPortfolio: m.endingPortfolio,
    maximumShortfall: m.maximumSpendingShortfall,
    lifetimeAfterTaxCash: m.lifetimeAfterTaxCash,
    minimumPortfolio: m.minimumPortfolio,
    deltaEndingPortfolio: run.deltas.endingPortfolio,
    deltaShortfall: run.deltas.maximumSpendingShortfall,
    depletionDate: m.depletionDate,
  };
}

export function summarizeStressTests(result: ScenarioStressTestResult): ScenarioSummary[] {
  return [result.base, ...result.scenarios].map(summarize);
}

export function findScenarioByKind(
  result: ScenarioStressTestResult,
  kind: ScenarioRun["kind"],
): ScenarioRun | undefined {
  return kind === "BASE"
    ? result.base
    : result.scenarios.find((scenario) => scenario.kind === kind);
}

export function scenarioStatusText(summary: ScenarioSummary): string {
  if (summary.status === "INCOMPLETE") return "More information needed";
  if (summary.status === "DEPLETES") return "Portfolio reaches zero in the simulation";
  if (summary.status === "SHORTFALL") return "Spending shortfall appears in the simulation";
  return "No spending shortfall in the simulation";
}

export function scenarioMetricDelta(
  run: ScenarioRun,
  metric: keyof SimulationResult["metrics"],
): number | undefined {
  const value = run.result.metrics[metric];
  const baseValue = metric === "endingPortfolio"
    ? run.result.metrics.endingPortfolio
    : undefined;
  return typeof value === "number" && typeof baseValue === "number" ? value - baseValue : undefined;
}
