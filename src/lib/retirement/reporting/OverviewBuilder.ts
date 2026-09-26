import type { SimulationResult } from "../domain/types";

export interface RetirementOverview {
  status: "READY" | "INCOMPLETE" | "ATTENTION";
  headline: string;
  explanation: string;
  metrics: Array<{ label: string; value: number | string; note?: string; tone?: "positive" | "neutral" | "warning" }>;
  sections: Array<{ title: string; summary: string; metrics: Array<{ label: string; value: number | string; tone?: "positive" | "neutral" | "warning" }> }>;
  warnings: string[];
}

export function buildRetirementOverview(result: SimulationResult | null, scenario?: import("../domain/types").RetirementScenario): RetirementOverview {
  if (!result || result.status !== "COMPLETE" || !scenario) return {
    status: "INCOMPLETE",
    headline: "Set up your retirement plan to see the result",
    explanation: "The Overview will translate the detailed simulation into retirement readiness, spending capacity, income, taxes, portfolio longevity, survivor planning and estate outcomes.",
    metrics: [],
    sections: [],
    warnings: result?.warnings ?? [],
  };

  const m = result.metrics;
  const ready = m.maximumSpendingShortfall === 0;
  const depletionAge = m.depletionDate && scenario.household.people[0]
    ? new Date(m.depletionDate).getUTCFullYear() - scenario.household.people[0].birthYear
    : undefined;

  return {
    status: ready ? "READY" : "ATTENTION",
    headline: ready ? "Your plan currently reaches its spending goal" : "Your plan needs adjustment",
    explanation: ready
      ? "Under the selected assumptions, the plan reaches the end of the simulation without a spending shortfall."
      : "The simulation finds at least one period where planned spending could not be fully funded.",
    metrics: [
      { label: "Planned annual spending", value: Math.round(scenario.goals.annualSpending), note: scenario.goals.spendingBasis === "TODAYS_DOLLARS" ? "Today's dollars" : "Future dollars" },
      { label: "Ending portfolio", value: Math.round(m.endingPortfolio), tone: m.endingPortfolio > 0 ? "positive" : "warning" },
      { label: "Lifetime after-tax cash", value: Math.round(m.lifetimeAfterTaxCash) },
      { label: "Government benefits", value: Math.round(m.totalBenefits) },
      { label: "Lifetime tax", value: Math.round(m.lifetimeTax) },
      { label: "Maximum shortfall", value: Math.round(m.maximumSpendingShortfall), tone: m.maximumSpendingShortfall ? "warning" : "positive" },
    ],
    sections: [
      { title: "Retirement timing", summary: `The plan targets retirement at age ${scenario.goals.retirementAge}.`, metrics: [
        { label: "Retirement age", value: scenario.goals.retirementAge },
        { label: "Planning age", value: scenario.goals.planningAge },
      ]},
      { title: "Income & spending", summary: ready ? "Modeled income covers planned spending throughout the simulation." : "Income and portfolio resources do not fully cover spending in every period.", metrics: [
        { label: "Lifetime spending", value: Math.round(m.lifetimeSpending) },
        { label: "After-tax cash", value: Math.round(m.lifetimeAfterTaxCash) },
        { label: "Benefits", value: Math.round(m.totalBenefits) },
        { label: "Shortfall", value: Math.round(m.maximumSpendingShortfall), tone: m.maximumSpendingShortfall ? "warning" : "positive" },
      ]},
      { title: "Portfolio longevity", summary: depletionAge ? `Estimated depletion occurs around age ${depletionAge}.` : "The modeled portfolio remains above zero through the planning horizon.", metrics: [
        { label: "Minimum portfolio", value: Math.round(m.minimumPortfolio) },
        { label: "Ending portfolio", value: Math.round(m.endingPortfolio) },
        { label: "Ending net worth", value: Math.round(m.endingNetWorth) },
      ]},
      { title: "Taxes & benefits", summary: "Tax and government-benefit estimates are included in monthly cash flow.", metrics: [
        { label: "Lifetime tax", value: Math.round(m.lifetimeTax) },
        { label: "Government benefits", value: Math.round(m.totalBenefits) },
      ]},
      { title: "Survivor & estate", summary: "Survivor and death transitions are included when the scenario provides those assumptions.", metrics: [
        { label: "Survivor shortfall", value: Math.round(m.survivorShortfall ?? 0), tone: (m.survivorShortfall ?? 0) ? "warning" : "neutral" },
        { label: "Estate value", value: Math.round(m.estateValue ?? m.endingPortfolio) },
      ]},
    ],
    warnings: result.warnings,
  };
}