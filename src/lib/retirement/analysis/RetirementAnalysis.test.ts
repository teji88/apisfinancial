import { describe, expect, it } from "vitest";
import { buildRetirementAnalysis } from "./RetirementAnalysis";
import type { SimulationResult } from "../domain/types";

function result(): SimulationResult {
  return {
    simulationId: "sim",
    scenarioId: "scenario",
    status: "COMPLETE",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2027-01-01T00:00:00.000Z",
    monthly: [
      {
        date: "2026-01-01T00:00:00.000Z",
        ages: { MAIN_USER: 65 },
        householdStage: "BOTH_ALIVE",
        portfolio: 99000,
        registered: 60000,
        tfsa: 20000,
        nonRegistered: 19000,
        cash: 0,
        householdCash: 1000,
        debt: 10000,
        netWorth: 90000,
        grossIncome: 3000,
        benefits: 1500,
        withdrawals: 1500,
        taxes: 500,
        spending: 2500,
        shortfall: 0,
        cashFlow: {
          beginningPortfolio: 100000,
          beginningHouseholdCash: 0,
          investmentGrowth: 1000,
          contributions: 0,
          grossIncome: 1500,
          grossWithdrawals: 1500,
          taxes: 500,
          spending: 2500,
          debtPayments: 0,
          endingPortfolio: 99000,
          endingHouseholdCash: 1000,
          assetReconciliation: 0,
          cashReconciliation: 0,
          debtReconciliation: 0,
          netWorthReconciliation: 0,
        },
      },
    ],
    metrics: {
      feasible: true,
      lifetimeSpending: 2500,
      lifetimeAfterTaxCash: 2500,
      lifetimeTax: 500,
      totalBenefits: 1500,
      endingPortfolio: 99000,
      endingNetWorth: 90000,
      minimumPortfolio: 99000,
      maximumSpendingShortfall: 0,
    },
    warnings: [],
    assumptions: [],
    engineVersion: "test",
    rulesVersion: "test",
    scenarioHash: "hash",
  };
}

describe("buildRetirementAnalysis", () => {
  it("returns null before a simulation exists", () => {
    expect(buildRetirementAnalysis(null)).toBeNull();
  });

  it("aggregates annual cash flow and reconciliation diagnostics", () => {
    const analysis = buildRetirementAnalysis(result())!;
    expect(analysis.annual).toHaveLength(1);
    expect(analysis.annual[0]!.year).toBe(2026);
    expect(analysis.annual[0]!.taxes).toBe(500);
    expect(analysis.annual[0]!.benefits).toBe(1500);
    expect(analysis.reconciliation.monthsChecked).toBe(1);
    expect(analysis.reconciliation.cashIssues).toBe(0);
    expect(analysis.reconciliation.maxAbsoluteError).toBe(0);
    expect(analysis.peakTaxYear?.taxes).toBe(500);
  });
});
