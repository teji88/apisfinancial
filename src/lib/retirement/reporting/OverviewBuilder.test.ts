import { describe, expect, it } from "vitest";
import { createDefaultRetirementScenario } from "../scenario/defaults";
import type { SimulationResult } from "../domain/types";
import { buildRetirementOverview } from "./OverviewBuilder";

function result(overrides: Partial<SimulationResult["metrics"]> = {}): SimulationResult {
  const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
  return {
    simulationId: "sim-1",
    scenarioId: scenario.id,
    status: "COMPLETE",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2081-01-01T00:00:00.000Z",
    monthly: [],
    metrics: {
      feasible: true,
      lifetimeSpending: 3_000_000,
      lifetimeAfterTaxCash: 3_200_000,
      lifetimeTax: 400_000,
      totalBenefits: 900_000,
      endingPortfolio: 500_000,
      endingNetWorth: 500_000,
      minimumPortfolio: 100_000,
      maximumSpendingShortfall: 0,
      ...overrides,
    },
    warnings: [],
    assumptions: [],
    engineVersion: "test-engine",
    rulesVersion: "test-rules",
    scenarioHash: "hash-1",
  };
}

describe("buildRetirementOverview", () => {
  it("returns incomplete when there is no completed simulation", () => {
    expect(buildRetirementOverview(null)).toMatchObject({
      status: "INCOMPLETE",
    });
  });

  it("describes a funded plan without claiming more than the simulation supports", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
    const overview = buildRetirementOverview(result(), scenario);

    expect(overview.status).toBe("READY");
    expect(overview.headline).toContain("reaches the planning horizon");
    expect(overview.calculation?.engineVersion).toBe("test-engine");
    expect(overview.sections.map((section) => section.title)).toEqual([
      "Retirement timing",
      "Spending & cash flow",
      "Portfolio longevity",
      "Taxes & government benefits",
      "Survivor & estate",
    ]);
  });

  it("flags a spending shortfall", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
    const overview = buildRetirementOverview(
      result({ maximumSpendingShortfall: 12_500 }),
      scenario,
    );

    expect(overview.status).toBe("ATTENTION");
    expect(overview.headline).toContain("spending shortfall");
    expect(overview.metrics.find((metric) => metric.label === "Maximum spending shortfall")?.tone).toBe("warning");
  });
});
