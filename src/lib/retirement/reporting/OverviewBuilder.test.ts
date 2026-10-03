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

  it("discounts ending portfolio to today's dollars when requested", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
    // 55-year horizon at default 2.1% inflation
    const nominal = buildRetirementOverview(result(), scenario);
    const todays = buildRetirementOverview(result(), scenario, { inTodaysDollars: true });

    const nominalEnding = nominal.metrics.find((m) => m.label === "Ending portfolio")?.value;
    const todaysEnding = todays.metrics.find((m) => m.label === "Ending portfolio")?.value;

    expect(typeof nominalEnding).toBe("number");
    expect(typeof todaysEnding).toBe("number");
    // Today's-dollar value must be strictly less than nominal for a positive horizon + inflation
    expect(todaysEnding as number).toBeLessThan(nominalEnding as number);
    // 500k discounted 55 years at 2.1% ≈ 500k / 3.14 ≈ 159k
    expect(todaysEnding as number).toBeGreaterThan(100_000);
    expect(todaysEnding as number).toBeLessThan(250_000);
  });

  it("computes present value of monthly flows for lifetime sums", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
    // Build a result with 12 months of known spending
    const base = result();
    const monthly = [];
    for (let i = 0; i < 12; i++) {
      const date = new Date(2026, i, 1).toISOString();
      monthly.push({
        date,
        ages: {},
        householdStage: "BOTH_ALIVE",
        portfolio: 0,
        registered: 0,
        tfsa: 0,
        nonRegistered: 0,
        cash: 0,
        householdCash: 0,
        debt: 0,
        netWorth: 0,
        grossIncome: 10000,
        benefits: 2000,
        withdrawals: 0,
        taxes: 1000,
        spending: 6000,
        shortfall: 0,
      });
    }
    base.monthly = monthly as never;

    const nominal = buildRetirementOverview(base, scenario);
    const todays = buildRetirementOverview(base, scenario, { inTodaysDollars: true });

    const nominalSpending = nominal.sections
      .find((s) => s.title === "Spending & cash flow")
      ?.metrics.find((m) => m.label === "Lifetime spending")?.value;
    const todaysSpending = todays.sections
      .find((s) => s.title === "Spending & cash flow")
      ?.metrics.find((m) => m.label === "Lifetime spending")?.value;

    // Nominal: 12 × 6000 = 72000
    expect(nominalSpending).toBe(72000);
    // Today's dollars: each month discounted, so strictly less but close (only 1 year)
    expect(todaysSpending as number).toBeLessThan(72000);
    expect(todaysSpending as number).toBeGreaterThan(70000);
  });

  it("leaves values unchanged when inTodaysDollars is false", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
    const overview = buildRetirementOverview(result(), scenario, { inTodaysDollars: false });
    const ending = overview.metrics.find((m) => m.label === "Ending portfolio")?.value;
    expect(ending).toBe(500000);
  });
});
