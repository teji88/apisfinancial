import type { RetirementScenario, SimulationResult } from "../domain/types";

export interface RetirementOverviewMetric {
  label: string;
  value: number | string;
  format?: "currency" | "count";
  note?: string;
  tone?: "positive" | "neutral" | "warning";
}

export interface RetirementOverviewSection {
  title: string;
  summary: string;
  metrics: RetirementOverviewMetric[];
}

export interface RetirementOverview {
  status: "READY" | "INCOMPLETE" | "ATTENTION";
  headline: string;
  explanation: string;
  metrics: RetirementOverviewMetric[];
  sections: RetirementOverviewSection[];
  warnings: string[];
  calculation: {
    engineVersion: string;
    rulesVersion: string;
    scenarioHash: string;
    simulationId: string;
  } | null;
}

function ageAtDate(
  date: string | undefined,
  person: RetirementScenario["household"]["people"][number] | undefined,
): number | undefined {
  if (!date || !person) return undefined;
  return new Date(date).getUTCFullYear() - person.birthYear;
}

export function buildRetirementOverview(
  result: SimulationResult | null,
  scenario?: RetirementScenario,
): RetirementOverview {
  if (!result || result.status !== "COMPLETE" || !scenario) {
    return {
      status: "INCOMPLETE",
      headline: "Set up your retirement plan to see the result",
      explanation:
        "The Overview will translate the simulation into spending, income, portfolio longevity, taxes, benefits, survivor and estate information.",
      metrics: [],
      sections: [],
      warnings: result?.warnings ?? [],
      calculation: null,
    };
  }

  const m = result.metrics;
  const primaryPerson = scenario.household.people[0];
  const depletionAge = ageAtDate(m.depletionDate, primaryPerson);
  const noShortfall = m.maximumSpendingShortfall <= 0.005;
  const noDepletion = !m.depletionDate;
  const status = noShortfall && noDepletion ? "READY" : "ATTENTION";

  const headline = noShortfall
    ? noDepletion
      ? "The selected plan reaches the planning horizon"
      : "The selected spending goal is funded, but the portfolio depletes later"
    : "The selected plan has a spending shortfall";

  const explanation = noShortfall
    ? noDepletion
      ? "Under the current assumptions, modeled resources cover the selected spending goal through the planning horizon."
      : `The selected spending goal is funded until the modeled portfolio depletion point around age ${depletionAge ?? "unknown"}.`
    : `The simulation identifies a maximum spending shortfall of approximately ${Math.round(m.maximumSpendingShortfall).toLocaleString("en-CA")} during the planning horizon.`;

  return {
    status,
    headline,
    explanation,
    metrics: [
      {
        label: "Annual spending target",
        value: Math.round(scenario.goals.annualSpending),
        note:
          scenario.goals.spendingBasis === "TODAYS_DOLLARS"
            ? "Today's dollars"
            : "Future dollars",
      },
      {
        label: "Ending portfolio",
        value: Math.round(m.endingPortfolio),
        tone: m.endingPortfolio > 0 ? "positive" : "warning",
      },
      {
        label: "Ending net worth",
        value: Math.round(m.endingNetWorth),
      },
      {
        label: "Lifetime after-tax cash",
        value: Math.round(m.lifetimeAfterTaxCash),
      },
      {
        label: "Government benefits",
        value: Math.round(m.totalBenefits),
      },
      {
        label: "Maximum spending shortfall",
        value: Math.round(m.maximumSpendingShortfall),
        tone: m.maximumSpendingShortfall > 0 ? "warning" : "positive",
      },
    ],
    sections: [
      {
        title: "Retirement timing",
        summary: `The plan targets retirement at age ${scenario.goals.retirementAge} and models through age ${scenario.goals.planningAge}.`,
        metrics: [
          { label: "Retirement age", value: scenario.goals.retirementAge, format: "count" },
          { label: "Planning age", value: scenario.goals.planningAge, format: "count" },
          { label: "Household members", value: scenario.household.people.length, format: "count" },
        ],
      },
      {
        title: "Spending & cash flow",
        summary: noShortfall
          ? "The modeled household cash flow covers the selected spending target."
          : "At least one modeled period cannot fully fund the selected spending target.",
        metrics: [
          { label: "Lifetime spending", value: Math.round(m.lifetimeSpending) },
          { label: "After-tax cash received", value: Math.round(m.lifetimeAfterTaxCash) },
          {
            label: "Maximum shortfall",
            value: Math.round(m.maximumSpendingShortfall),
            tone: m.maximumSpendingShortfall > 0 ? "warning" : "positive",
          },
        ],
      },
      {
        title: "Portfolio longevity",
        summary: noDepletion
          ? "The modeled portfolio remains above zero through the planning horizon."
          : `The modeled portfolio reaches zero around age ${depletionAge ?? "unknown"}.`,
        metrics: [
          {
            label: "Minimum portfolio",
            value: Math.round(m.minimumPortfolio),
            tone: m.minimumPortfolio > 0 ? "positive" : "warning",
          },
          { label: "Ending portfolio", value: Math.round(m.endingPortfolio) },
          { label: "Depletion age", value: depletionAge ?? "Not reached", format: "count" },
        ],
      },
      {
        title: "Taxes & government benefits",
        summary:
          "Federal/provincial tax and modeled government benefits are included in the monthly simulation.",
        metrics: [
          { label: "Lifetime tax", value: Math.round(m.lifetimeTax) },
          { label: "Government benefits", value: Math.round(m.totalBenefits) },
          {
            label: "After-tax cash",
            value: Math.round(m.lifetimeAfterTaxCash),
          },
        ],
      },
      {
        title: "Survivor & estate",
        summary:
          scenario.household.people.length > 1
            ? "The simulation includes household survivor transitions when death ages are supplied."
            : "A single-person household is modeled; survivor analysis requires a partner scenario.",
        metrics: [
          {
            label: "Survivor shortfall",
            value: Math.round(m.survivorShortfall ?? 0),
            tone: (m.survivorShortfall ?? 0) > 0 ? "warning" : "neutral",
          },
          {
            label: "Estate value",
            value: Math.round(m.estateValue ?? m.endingNetWorth),
          },
        ],
      },
    ],
    warnings: result.warnings,
    calculation: {
      engineVersion: result.engineVersion,
      rulesVersion: result.rulesVersion,
      scenarioHash: result.scenarioHash,
      simulationId: result.simulationId,
    },
  };
}
