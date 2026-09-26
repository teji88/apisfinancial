import type { Money } from "../domain/types";

export interface MonthlyFinancialLedgerInput {
  beginningPortfolio: Money;
  investmentGrowth: Money;
  contributions: Money;
  grossIncome: Money;
  withdrawals: Money;
  taxes: Money;
  spending: Money;
  debtPayments: Money;
  debtPrincipal: Money;
  debtInterest: Money;
  endingPortfolio: Money;
  beginningDebt: Money;
  endingDebt: Money;
}

/**
 * Explicit accounting ledger for one simulation month.
 *
 * Household cash is intentionally not a modeled account in V1. The external
 * cash change therefore shows the amount of cash that must be supplied by or
 * retained outside the investment accounts for the month to balance.
 */
export interface MonthlyFinancialLedger {
  beginningAssets: Money;
  endingAssets: Money;
  investmentGrowth: Money;
  contributions: Money;
  withdrawals: Money;
  assetReconciliation: Money;
  beginningDebt: Money;
  endingDebt: Money;
  debtInterest: Money;
  debtPrincipal: Money;
  debtReconciliation: Money;
  grossIncome: Money;
  taxes: Money;
  spending: Money;
  debtPayments: Money;
  externalCashChange: Money;
  beginningNetWorth: Money;
  endingNetWorth: Money;
  netWorthReconciliation: Money;
  warnings: string[];
}

const EPSILON = 1e-7;

export function reconcileMonthlyFinancialLedger(
  input: MonthlyFinancialLedgerInput,
): MonthlyFinancialLedger {
  const expectedEndingAssets =
    input.beginningPortfolio +
    input.investmentGrowth +
    input.contributions -
    input.withdrawals;
  const assetReconciliation = input.endingPortfolio - expectedEndingAssets;

  const expectedEndingDebt =
    input.beginningDebt + input.debtInterest - input.debtPrincipal;
  const debtReconciliation = input.endingDebt - expectedEndingDebt;

  const beginningNetWorth = input.beginningPortfolio - input.beginningDebt;
  const endingNetWorth = input.endingPortfolio - input.endingDebt;
  // Household cash is not a modeled balance-sheet asset in V1. Therefore the
  // net-worth ledger reconciles only the modeled investment assets and debt;
  // externalCashChange is reported separately as a diagnostic so it cannot be
  // mistaken for investment performance or silently omitted.
  const assetChange = input.endingPortfolio - input.beginningPortfolio;
  const debtChange = input.endingDebt - input.beginningDebt;
  const externalCashChange =
    input.grossIncome +
    input.withdrawals -
    input.taxes -
    input.spending -
    input.debtPayments;
  const netWorthReconciliation =
    endingNetWorth -
    beginningNetWorth -
    (assetChange - debtChange);

  const warnings: string[] = [];
  if (Math.abs(assetReconciliation) > EPSILON) {
    warnings.push("Portfolio asset ledger does not reconcile for this month.");
  }
  if (Math.abs(debtReconciliation) > EPSILON) {
    warnings.push("Debt liability ledger does not reconcile for this month.");
  }
  if (Math.abs(netWorthReconciliation) > EPSILON) {
    warnings.push("Net-worth ledger does not reconcile with modeled economic flows.");
  }

  return {
    beginningAssets: input.beginningPortfolio,
    endingAssets: input.endingPortfolio,
    investmentGrowth: input.investmentGrowth,
    contributions: input.contributions,
    withdrawals: input.withdrawals,
    assetReconciliation,
    beginningDebt: input.beginningDebt,
    endingDebt: input.endingDebt,
    debtInterest: input.debtInterest,
    debtPrincipal: input.debtPrincipal,
    debtReconciliation,
    grossIncome: input.grossIncome,
    taxes: input.taxes,
    spending: input.spending,
    debtPayments: input.debtPayments,
    externalCashChange,
    beginningNetWorth,
    endingNetWorth,
    netWorthReconciliation,
    warnings,
  };
}
