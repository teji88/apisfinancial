import type { Money } from "../domain/types";

export interface MonthlyFinancialLedgerInput {
  beginningPortfolio: Money;
  beginningHouseholdCash: Money;
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
  endingHouseholdCash: Money;
  beginningDebt: Money;
  endingDebt: Money;
}

/**
 * Explicit accounting ledger for one simulation month.
 *
 * Household cash is a modeled balance-sheet asset. Portfolio withdrawals and
 * external income flow into household cash; spending, taxes and debt payments
 * flow out of it.
 */
export interface MonthlyFinancialLedger {
  beginningAssets: Money;
  endingAssets: Money;
  beginningHouseholdCash: Money;
  endingHouseholdCash: Money;
  investmentGrowth: Money;
  contributions: Money;
  withdrawals: Money;
  assetReconciliation: Money;
  cashReconciliation: Money;
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

  const beginningNetWorth = input.beginningPortfolio + input.beginningHouseholdCash - input.beginningDebt;
  const endingNetWorth = input.endingPortfolio + input.endingHouseholdCash - input.endingDebt;
  const cashReconciliation =
    input.endingHouseholdCash -
    (input.beginningHouseholdCash +
      input.grossIncome +
      input.withdrawals -
      input.taxes -
      input.spending -
      input.debtPayments);
  const assetChange =
    (input.endingPortfolio + input.endingHouseholdCash) -
    (input.beginningPortfolio + input.beginningHouseholdCash);
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
  if (Math.abs(cashReconciliation) > EPSILON) {
    warnings.push("Household cash ledger does not reconcile for this month.");
  }
  if (Math.abs(debtReconciliation) > EPSILON) {
    warnings.push("Debt liability ledger does not reconcile for this month.");
  }
  if (Math.abs(netWorthReconciliation) > EPSILON) {
    warnings.push("Net-worth ledger does not reconcile with modeled economic flows.");
  }

  return {
    beginningAssets: input.beginningPortfolio + input.beginningHouseholdCash,
    endingAssets: input.endingPortfolio + input.endingHouseholdCash,
    beginningHouseholdCash: input.beginningHouseholdCash,
    endingHouseholdCash: input.endingHouseholdCash,
    investmentGrowth: input.investmentGrowth,
    contributions: input.contributions,
    withdrawals: input.withdrawals,
    assetReconciliation,
    cashReconciliation,
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
