import { describe, expect, it } from "vitest";
import { reconcileMonthlyFinancialLedger } from "./MonthlyFinancialLedger";

describe("MonthlyFinancialLedger", () => {
  it("reconciles assets exactly", () => {
    const ledger = reconcileMonthlyFinancialLedger({
      beginningPortfolio: 100000,
      beginningHouseholdCash: 0,
      investmentGrowth: 500,
      contributions: 1000,
      grossIncome: 2000,
      withdrawals: 1500,
      taxes: 300,
      spending: 1700,
      debtPayments: 400,
      debtPrincipal: 350,
      debtInterest: 50,
      endingPortfolio: 100000,
      endingHouseholdCash: 1100,
      beginningDebt: 0,
      endingDebt: 0,
    });
    expect(ledger.assetReconciliation).toBeCloseTo(0, 8);
  });

  it("reconciles debt from interest and principal", () => {
    const ledger = reconcileMonthlyFinancialLedger({
      beginningPortfolio: 100000,
      beginningHouseholdCash: 0,
      investmentGrowth: 0,
      contributions: 0,
      grossIncome: 0,
      withdrawals: 0,
      taxes: 0,
      spending: 0,
      debtPayments: 400,
      debtPrincipal: 350,
      debtInterest: 50,
      endingPortfolio: 100000,
      endingHouseholdCash: 0,
      beginningDebt: 20000,
      endingDebt: 19700,
    });
    expect(ledger.debtReconciliation).toBeCloseTo(0, 8);
  });

  it("treats debt principal as a transfer, not a net-worth expense", () => {
    const ledger = reconcileMonthlyFinancialLedger({
      beginningPortfolio: 100000,
      beginningHouseholdCash: 0,
      investmentGrowth: 1000,
      contributions: 0,
      grossIncome: 0,
      withdrawals: 1000,
      taxes: 0,
      spending: 0,
      debtPayments: 400,
      debtPrincipal: 350,
      debtInterest: 50,
      endingPortfolio: 100000,
      endingHouseholdCash: 600,
      beginningDebt: 20000,
      endingDebt: 19700,
    });
    expect(ledger.beginningNetWorth).toBe(80000);
    expect(ledger.endingNetWorth).toBe(80300);
    expect(ledger.netWorthReconciliation).toBeCloseTo(0, 8);
  });

  it("exposes external household cash as a diagnostic instead of hiding it", () => {
    const ledger = reconcileMonthlyFinancialLedger({
      beginningPortfolio: 100000,
      beginningHouseholdCash: 0,
      investmentGrowth: 0,
      contributions: 0,
      grossIncome: 2000,
      withdrawals: 1000,
      taxes: 300,
      spending: 2200,
      debtPayments: 400,
      debtPrincipal: 350,
      debtInterest: 50,
      endingPortfolio: 99000,
      endingHouseholdCash: 100,
      beginningDebt: 20000,
      endingDebt: 19700,
    });
    expect(ledger.externalCashChange).toBeCloseTo(100, 8);
  });
  it("reports an unmet cash need separately from reconciliation", () => {
    const ledger = reconcileMonthlyFinancialLedger({
      beginningPortfolio: 10000,
      beginningHouseholdCash: 0,
      investmentGrowth: 0,
      contributions: 0,
      grossIncome: 0,
      withdrawals: 0,
      taxes: 0,
      spending: 1200,
      debtPayments: 0,
      debtPrincipal: 0,
      debtInterest: 0,
      endingPortfolio: 10000,
      endingHouseholdCash: 0,
      beginningDebt: 0,
      endingDebt: 0,
    });

    expect(ledger.cashShortfall).toBeCloseTo(1200, 10);
    expect(ledger.cashReconciliation).toBeCloseTo(0, 10);
    expect(ledger.warnings).not.toContain("Household cash ledger does not reconcile for this month.");
  });

});
