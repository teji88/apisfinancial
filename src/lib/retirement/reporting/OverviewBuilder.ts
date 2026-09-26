import type { SimulationResult } from "../domain/types";

export interface RetirementOverview {
  status: "READY" | "INCOMPLETE";
  headline: string;
  explanation: string;
  metrics: Array<{ label: string; value: number | string; note?: string }>;
  warnings: string[];
}

export function buildRetirementOverview(result: SimulationResult | null): RetirementOverview {
  if (!result || result.status !== "COMPLETE") return {
    status: "INCOMPLETE",
    headline: "Set up your retirement plan to see the result",
    explanation: "Your Overview will summarize retirement readiness, spending, income, taxes, portfolio longevity, survivor planning and estate outcomes. The detailed calculations live behind this view.",
    metrics: [],
    warnings: result?.warnings ?? [],
  };
  const m = result.metrics;
  return {
    status: "READY",
    headline: m.feasible ? "Your current plan funds the selected retirement goal" : "Your current plan needs attention",
    explanation: m.feasible ? "The simulation reaches the planning age without a spending shortfall under the selected assumptions." : "The simulation identifies at least one period where the selected spending goal cannot be fully funded.",
    metrics: [
      { label: "Ending portfolio", value: m.endingPortfolio },
      { label: "Lifetime spending", value: m.lifetimeSpending },
      { label: "Lifetime tax", value: m.lifetimeTax },
      { label: "Government benefits", value: m.totalBenefits },
      { label: "Maximum shortfall", value: m.maximumSpendingShortfall },
      { label: "Ending net worth", value: m.endingNetWorth },
    ],
    warnings: result.warnings,
  };
}
