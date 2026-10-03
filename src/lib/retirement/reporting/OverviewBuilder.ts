import type { MonthlySnapshot, RetirementScenario, SimulationResult } from "../domain/types";

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

/**
 * Build withdrawal sequence metrics: total withdrawn from each account type
 * over the plan, in today's dollars if requested.
 */
function buildWithdrawalSequenceMetrics(
  result: SimulationResult,
  inTodaysDollars: boolean,
  inflationRate: number,
): RetirementOverviewMetric[] {
  const totals = { registered: 0, tfsa: 0, nonRegistered: 0, cash: 0 };
  const startDate = new Date(result.startDate);

  for (const s of result.monthly) {
    const sources = s.withdrawalSources;
    if (!sources) continue;
    const snapshotDate = new Date(s.date);
    const yearsFromStart = Math.max(
      0,
      (snapshotDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
    );
    const discount = inTodaysDollars && inflationRate > 0
      ? Math.pow(1 + inflationRate, yearsFromStart)
      : 1;
    totals.registered += sources.registered / discount;
    totals.tfsa += sources.tfsa / discount;
    totals.nonRegistered += sources.nonRegistered / discount;
    totals.cash += sources.cash / discount;
  }

  const note = inTodaysDollars ? "Today's dollars" : undefined;
  const metrics: RetirementOverviewMetric[] = [];
  const labels: Array<[keyof typeof totals, string]> = [
    ["nonRegistered", "From non-registered"],
    ["registered", "From RRSP/RRIF"],
    ["tfsa", "From TFSA"],
    ["cash", "From cash"],
  ];
  for (const [key, label] of labels) {
    if (totals[key] > 0.5) {
      metrics.push({
        label,
        value: Math.round(totals[key]),
        ...(note ? { note } : {}),
      });
    }
  }
  if (metrics.length === 0) {
    metrics.push({ label: "Withdrawals", value: "No withdrawals modeled" });
  }
  return metrics;
}

export function buildRetirementOverview(
  result: SimulationResult | null,
  scenario?: RetirementScenario,
  options?: { inTodaysDollars?: boolean },
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
  const inTodaysDollars = options?.inTodaysDollars ?? false;
  const inflationRate = Math.max(0, scenario.assumptions.inflationRate) / 100;

  // Helper to discount a future nominal value to today's dollars.
  // yearsFromNow: number of years from simulation start to the value's date.
  const toTodaysDollars = (nominalValue: number, yearsFromNow: number): number => {
    if (!inTodaysDollars || inflationRate <= 0) return nominalValue;
    return nominalValue / Math.pow(1 + inflationRate, Math.max(0, yearsFromNow));
  };

  // For lifetime sums, compute present value by discounting each month's flow.
  // This is more accurate than discounting the total by an average factor.
  const presentValueOfMonthly = (
    getMonthlyValue: (snapshot: MonthlySnapshot) => number,
  ): number => {
    if (!inTodaysDollars || inflationRate <= 0) {
      return result!.monthly.reduce((sum, s) => sum + getMonthlyValue(s), 0);
    }
    const startDate = new Date(result!.startDate);
    return result!.monthly.reduce((sum, s) => {
      const snapshotDate = new Date(s.date);
      const yearsFromStart = (snapshotDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const discountFactor = Math.pow(1 + inflationRate, Math.max(0, yearsFromStart));
      return sum + getMonthlyValue(s) / discountFactor;
    }, 0);
  };

  // Years from simulation start to end (for point-in-time values like ending portfolio)
  const yearsToEnd = (() => {
    const start = new Date(result.startDate);
    const end = new Date(result.endDate);
    return Math.max(0, (end.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  })();

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

  // Present-value versions of lifetime sums, computed from monthly data when
  // the today's-dollars toggle is on. Falls back to the pre-aggregated metric otherwise.
  const pvLifetimeSpending = presentValueOfMonthly((s) => s.spending);
  const pvLifetimeTax = presentValueOfMonthly((s) => s.taxes);
  const pvTotalBenefits = presentValueOfMonthly((s) => s.benefits);
  const pvAfterTaxCash = presentValueOfMonthly((s) => s.grossIncome - s.taxes);

  // Maximum shortfall: discount the specific worst month for accuracy.
  const pvMaxShortfall = (() => {
    if (!inTodaysDollars || inflationRate <= 0 || result.monthly.length === 0) {
      return m.maximumSpendingShortfall;
    }
    const startDate = new Date(result.startDate);
    let worstPV = 0;
    for (const s of result.monthly) {
      if (s.shortfall > worstPV) {
        const snapshotDate = new Date(s.date);
        const yearsFromStart = Math.max(
          0,
          (snapshotDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
        );
        worstPV = s.shortfall / Math.pow(1 + inflationRate, yearsFromStart);
      }
    }
    return worstPV;
  })();

  const dollarNote = inTodaysDollars ? "Today's dollars" : undefined;

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
        value: Math.round(toTodaysDollars(m.endingPortfolio, yearsToEnd)),
        tone: m.endingPortfolio > 0 ? "positive" : "warning",
        ...(dollarNote ? { note: dollarNote } : {}),
      },
      {
        label: "Ending net worth",
        value: Math.round(toTodaysDollars(m.endingNetWorth, yearsToEnd)),
        ...(dollarNote ? { note: dollarNote } : {}),
      },
      {
        label: "Lifetime after-tax cash",
        value: Math.round(pvAfterTaxCash),
        ...(dollarNote ? { note: dollarNote } : {}),
      },
      {
        label: "Government benefits",
        value: Math.round(pvTotalBenefits),
        ...(dollarNote ? { note: dollarNote } : {}),
      },
      {
        label: "Maximum spending shortfall",
        value: Math.round(pvMaxShortfall),
        tone: m.maximumSpendingShortfall > 0 ? "warning" : "positive",
        ...(dollarNote ? { note: dollarNote } : {}),
      },
    ],
    sections: [
      {
        title: "Retirement timing",
        summary: `When you plan to stop working (${scenario.goals.retirementAge}) and how long the plan needs to last (to age ${scenario.goals.planningAge}). All dollar amounts are in today's purchasing power.`,
        metrics: [
          { label: "Retirement age", value: scenario.goals.retirementAge, format: "count" },
          { label: "Planning age", value: scenario.goals.planningAge, format: "count" },
          { label: "Household members", value: scenario.household.people.length, format: "count" },
        ],
      },
      {
        title: "Spending & cash flow",
        summary: noShortfall
          ? "Your planned spending is fully covered every year. 'Lifetime spending' is the total you'll spend (in today's dollars). 'Maximum shortfall' is $0, meaning no year runs out of money."
          : "Some years don't have enough money to cover your spending. 'Maximum shortfall' shows the worst year's gap — this is the amount you'd need to cut or find elsewhere.",
        metrics: [
          { label: "Lifetime spending", value: Math.round(pvLifetimeSpending), ...(dollarNote ? { note: dollarNote } : {}) },
          { label: "After-tax cash received", value: Math.round(pvAfterTaxCash), ...(dollarNote ? { note: dollarNote } : {}) },
          {
            label: "Maximum shortfall",
            value: Math.round(pvMaxShortfall),
            tone: m.maximumSpendingShortfall > 0 ? "warning" : "positive",
            ...(dollarNote ? { note: dollarNote } : {}),
          },
        ],
      },
      {
        title: "Portfolio longevity",
        summary: noDepletion
          ? "Your investments last the entire plan — the portfolio never hits zero. 'Ending portfolio' is what's left at the end (in today's dollars)."
          : `Your portfolio runs out around age ${depletionAge ?? "unknown"}. After that, you'd need to reduce spending or find other income. 'Minimum portfolio' shows the lowest point.`,
        metrics: [
          {
            label: "Minimum portfolio",
            value: Math.round(toTodaysDollars(m.minimumPortfolio, yearsToEnd)),
            tone: m.minimumPortfolio > 0 ? "positive" : "warning",
            ...(dollarNote ? { note: dollarNote } : {}),
          },
          {
            label: "Ending portfolio",
            value: Math.round(toTodaysDollars(m.endingPortfolio, yearsToEnd)),
            ...(dollarNote ? { note: dollarNote } : {}),
          },
          { label: "Depletion age", value: depletionAge ?? "Not reached", format: "count" },
        ],
      },
      {
        title: "Taxes & government benefits",
        summary:
          "How much tax you'll pay over your lifetime and how much CPP/OAS/GIS you'll receive. 'After-tax cash' is the total spendable money from all sources (in today's dollars). Lower lifetime tax means more money in your pocket.",
        metrics: [
          { label: "Lifetime tax", value: Math.round(pvLifetimeTax), ...(dollarNote ? { note: dollarNote } : {}) },
          { label: "Government benefits", value: Math.round(pvTotalBenefits), ...(dollarNote ? { note: dollarNote } : {}) },
          {
            label: "After-tax cash",
            value: Math.round(pvAfterTaxCash),
            ...(dollarNote ? { note: dollarNote } : {}),
          },
        ],
      },
      {
        title: "Survivor & estate",
        summary:
          scenario.household.people.length > 1
            ? "What happens financially if one partner passes away. 'Survivor shortfall' is any gap the surviving partner would face. 'Estate value' is what's left to pass on (in today's dollars)."
            : "Add a partner to see survivor analysis. 'Estate value' is what would be left to pass on (in today's dollars).",
        metrics: [
          {
            label: "Survivor shortfall",
            value: Math.round(toTodaysDollars(m.survivorShortfall ?? 0, yearsToEnd)),
            tone: (m.survivorShortfall ?? 0) > 0 ? "warning" : "neutral",
            ...(dollarNote ? { note: dollarNote } : {}),
          },
          {
            label: "Estate value",
            value: Math.round(toTodaysDollars(m.estateValue ?? m.endingNetWorth, yearsToEnd)),
            ...(dollarNote ? { note: dollarNote } : {}),
          },
        ],
      },
      {
        title: "Withdrawal sequence",
        summary:
          "Which accounts to draw from each year to minimize tax and make your money last. The engine follows your chosen withdrawal policy (e.g., non-registered first to preserve tax-sheltered growth, or registered first to reduce future mandatory withdrawals).",
        metrics: buildWithdrawalSequenceMetrics(result, inTodaysDollars, inflationRate),
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
