import { describe, expect, it } from "vitest";
import { reconcileMonthlyCashFlow } from "./CashFlowEngine";

describe("CashFlowEngine", () => {
  it("reconciles portfolio assets from growth, contributions and withdrawals", () => {
    const result = reconcileMonthlyCashFlow({
      beginningPortfolio: 100000,
      beginningHouseholdCash: 0,
      investmentGrowth: 500,
      contributions: 1000,
      grossIncome: 2000,
      withdrawals: 3000,
      taxes: 200,
      spending: 2500,
      debtPayments: 1000,
      debtPrincipal: 800,
      debtInterest: 200,
      endingPortfolio: 98500,
      endingHouseholdCash: 1100,
    });

    expect(result.expectedEndingPortfolio).toBe(98500);
    expect(result.assetReconciliation).toBeCloseTo(0, 10);
    expect(result.assetChange).toBe(-1500);
  });

  it("flags an asset ledger mismatch instead of silently accepting it", () => {
    const result = reconcileMonthlyCashFlow({
      beginningPortfolio: 100000,
      beginningHouseholdCash: 0,
      investmentGrowth: 500,
      contributions: 0,
      grossIncome: 0,
      withdrawals: 1000,
      taxes: 0,
      spending: 1000,
      debtPayments: 0,
      endingPortfolio: 99600,
      endingHouseholdCash: 0,
    });

    expect(result.assetReconciliation).toBeCloseTo(100, 10);
    expect(result.warnings).toContain("Portfolio asset ledger does not reconcile for this month.");
  });

  it("separates asset reconciliation from household cash-need diagnostics", () => {
    const result = reconcileMonthlyCashFlow({
      beginningPortfolio: 50000,
      beginningHouseholdCash: 0,
      investmentGrowth: 0,
      contributions: 0,
      grossIncome: 1000,
      withdrawals: 2000,
      taxes: 300,
      spending: 1800,
      debtPayments: 900,
      endingPortfolio: 48000,
      endingHouseholdCash: 0,
    });

    expect(result.assetReconciliation).toBeCloseTo(0, 10);
    expect(result.externalCashAvailable).toBe(3000);
    expect(result.externalCashRequired).toBe(3000);
    expect(result.netCashFlowBeforeUnmodeledCash).toBe(0);
  });
  it("reports an unmet cash need without treating the clamped cash balance as a ledger error", () => {
    const result = reconcileMonthlyCashFlow({
      beginningPortfolio: 10000,
      beginningHouseholdCash: 0,
      investmentGrowth: 0,
      contributions: 0,
      grossIncome: 0,
      withdrawals: 0,
      taxes: 0,
      spending: 1200,
      debtPayments: 0,
      endingPortfolio: 10000,
      endingHouseholdCash: 0,
    });

    expect(result.cashShortfall).toBeCloseTo(1200, 10);
    expect(result.cashReconciliation).toBeCloseTo(0, 10);
    expect(result.warnings).not.toContain("Household cash ledger does not reconcile for this month.");
  });

});


  