import type { Money } from "../domain/types";

export interface MonthlyCashFlowInput {
  beginningPortfolio: Money;
  investmentGrowth: Money;
  contributions: Money;
  grossIncome: Money;
  withdrawals: Money;
  taxes: Money;
  spending: Money;
  debtPayments: Money;
  endingPortfolio: Money;
}

/**
 * Accounting-only reconciliation for one simulation month.
 *
 * The portfolio equation deliberately excludes income, spending, taxes and
 * debt payments because those flows are represented by gross withdrawals or
 * by assets already held in the portfolio. This keeps the asset ledger
 * independent from the household cash-need calculation.
 */
export interface MonthlyCashFlowResult {
  assetChange: Money;
  expectedEndingPortfolio: Money;
  assetReconciliation: Money;
  externalCashAvailable: Money;
  externalCashRequired: Money;
  netCashFlowBeforeUnmodeledCash: Money;
  warnings: string[];
}

const EPSILON = 1e-7;

export function reconcileMonthlyCashFlow(input: MonthlyCashFlowInput): MonthlyCashFlowResult {
  const expectedEndingPortfolio =
    input.beginningPortfolio +
    input.investmentGrowth +
    input.contributions -
    input.withdrawals;

  const assetReconciliation = input.endingPortfolio - expectedEndingPortfolio;
  const externalCashAvailable = input.grossIncome + input.withdrawals;
  const externalCashRequired = input.spending + input.debtPayments + input.taxes;
  const netCashFlowBeforeUnmodeledCash = externalCashAvailable - externalCashRequired;

  const warnings: string[] = [];
  if (Math.abs(assetReconciliation) > EPSILON) {
    warnings.push("Portfolio asset ledger does not reconcile for this month.");
  }

  return {
    assetChange: input.endingPortfolio - input.beginningPortfolio,
    expectedEndingPortfolio,
    assetReconciliation,
    externalCashAvailable,
    externalCashRequired,
    netCashFlowBeforeUnmodeledCash,
    warnings,
  };
}
