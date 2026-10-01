import type { MonthlySnapshot, SimulationResult } from "../domain/types";

export interface AnnualAnalysisRow {
  year: number;
  startingPortfolio: number;
  endingPortfolio: number;
  endingNetWorth: number;
  income: number;
  benefits: number;
  cpp: number;
  oas: number;
  gis: number;
  allowance: number;
  withdrawals: number;
  taxes: number;
  spending: number;
  debtPayments: number;
  debtInterest: number;
  shortfall: number;
  registeredEnding: number;
  tfsaEnding: number;
  nonRegisteredEnding: number;
  householdStage: MonthlySnapshot["householdStage"];
}

export interface WithdrawalAnalysis {
  total: number;
  registered: number;
  tfsa: number;
  nonRegistered: number;
  otherCash: number;
}

export interface AnalysisViewModel {
  annual: AnnualAnalysisRow[];
  withdrawal: WithdrawalAnalysis;
  peakTaxYear?: { year: number; taxes: number };
  peakSpendingShortfall?: { year: number; amount: number };
  peakDebtYear?: { year: number; debt: number };
  depletionAge?: number;
  reconciliation: {
    monthsChecked: number;
    cashIssues: number;
    assetIssues: number;
    debtIssues: number;
    netWorthIssues: number;
    maxAbsoluteError: number;
  };
  survivor: {
    begins?: string;
    maximumShortfall: number;
    endingPortfolio?: number;
  };
  estate: {
    value?: number;
    endDate?: string;
  };
}

function yearOf(date: string): number {
  return new Date(date).getUTCFullYear();
}

function maxBy<T>(rows: T[], value: (row: T) => number): T | undefined {
  return rows.reduce<T | undefined>((best, row) => {
    if (!best || value(row) > value(best)) return row;
    return best;
  }, undefined);
}

export function buildRetirementAnalysis(result: SimulationResult | null): AnalysisViewModel | null {
  if (!result) return null;

  const annualMap = new Map<number, AnnualAnalysisRow>();
  let registered = 0;
  let tfsa = 0;
  let nonRegistered = 0;
  let otherCash = 0;
  let cashIssues = 0;
  let assetIssues = 0;
  let debtIssues = 0;
  let netWorthIssues = 0;
  let maxAbsoluteError = 0;
  let survivorBegins: string | undefined;
  let survivorMaximumShortfall = 0;
  let survivorEndingPortfolio: number | undefined;

  for (const month of result.monthly) {
    const year = yearOf(month.date);
    const existing = annualMap.get(year);
    const row: AnnualAnalysisRow = existing ?? {
      year,
      startingPortfolio: month.cashFlow?.beginningPortfolio ?? month.portfolio,
      endingPortfolio: month.portfolio,
      endingNetWorth: month.netWorth,
      income: 0,
      benefits: 0,
      cpp: 0,
      oas: 0,
      gis: 0,
      allowance: 0,
      withdrawals: 0,
      taxes: 0,
      spending: 0,
      debtPayments: 0,
      debtInterest: 0,
      shortfall: 0,
      registeredEnding: month.registered,
      tfsaEnding: month.tfsa,
      nonRegisteredEnding: month.nonRegistered,
      householdStage: month.householdStage,
    };

    row.endingPortfolio = month.portfolio;
    row.endingNetWorth = month.netWorth;
    row.income += month.grossIncome;
    row.benefits += month.benefits;
    row.cpp += month.benefitSources?.cpp ?? 0;
    row.oas += month.benefitSources?.oas ?? 0;
    row.gis += month.benefitSources?.gis ?? 0;
    row.allowance += month.benefitSources?.allowance ?? 0;
    row.withdrawals += month.withdrawals;
    row.taxes += month.taxes;
    row.spending += month.spending;
    row.debtPayments += month.debtPayments ?? 0;
    row.debtInterest += month.debtInterest ?? 0;
    row.shortfall = Math.max(row.shortfall, month.shortfall);
    row.registeredEnding = month.registered;
    row.tfsaEnding = month.tfsa;
    row.nonRegisteredEnding = month.nonRegistered;
    row.householdStage = month.householdStage;
    annualMap.set(year, row);

    const flow = month.cashFlow;
    if (flow) {
      const errors = [
        ["cash", flow.cashReconciliation],
        ["asset", flow.assetReconciliation],
        ["debt", flow.debtReconciliation],
        ["netWorth", flow.netWorthReconciliation],
      ] as const;
      for (const [kind, error] of errors) {
        const absolute = Math.abs(error ?? 0);
        maxAbsoluteError = Math.max(maxAbsoluteError, absolute);
        if (absolute > 0.01) {
          if (kind === "cash") cashIssues++;
          if (kind === "asset") assetIssues++;
          if (kind === "debt") debtIssues++;
          if (kind === "netWorth") netWorthIssues++;
        }
      }
    }

    if (month.householdStage === "SURVIVOR") {
      survivorBegins ??= month.date;
      survivorMaximumShortfall = Math.max(survivorMaximumShortfall, month.shortfall);
      survivorEndingPortfolio = month.portfolio;
    }

    if (month.debt > 0) {
      // Debt is already represented in the monthly snapshot; annual peak is
      // derived below from the annual ending values.
    }
  }

  const annual = [...annualMap.values()].sort((a, b) => a.year - b.year);
  const latest = result.monthly.at(-1);
  if (latest) {
    registered = latest.registered;
    tfsa = latest.tfsa;
    nonRegistered = latest.nonRegistered;
    otherCash = latest.cash + latest.householdCash;
  }

  const withdrawal = result.monthly.reduce<WithdrawalAnalysis>((sum, month) => {
    const sources = month.withdrawalSources;
    if (!sources) return sum;
    sum.registered += sources.registered;
    sum.tfsa += sources.tfsa;
    sum.nonRegistered += sources.nonRegistered;
    sum.otherCash += sources.cash;
    return sum;
  }, { total: 0, registered: 0, tfsa: 0, nonRegistered: 0, otherCash: 0 });
  withdrawal.total =
    withdrawal.registered +
    withdrawal.tfsa +
    withdrawal.nonRegistered +
    withdrawal.otherCash;

  const peakTax = maxBy(annual, (row) => row.taxes);
  const peakShortfall = maxBy(annual, (row) => row.shortfall);
  const peakDebt = maxBy(result.monthly, (month) => month.debt);
  const depletion = result.metrics.depletionDate
    ? result.monthly.find((month) => month.date === result.metrics.depletionDate)
    : undefined;

  return {
    annual,
    withdrawal,
    peakTaxYear: peakTax ? { year: peakTax.year, taxes: peakTax.taxes } : undefined,
    peakSpendingShortfall: peakShortfall && peakShortfall.shortfall > 0
      ? { year: peakShortfall.year, amount: peakShortfall.shortfall }
      : undefined,
    peakDebtYear: peakDebt ? { year: yearOf(peakDebt.date), debt: peakDebt.debt } : undefined,
    depletionAge: depletion ? Math.max(...Object.values(depletion.ages).map(Number)) : undefined,
    reconciliation: {
      monthsChecked: result.monthly.length,
      cashIssues,
      assetIssues,
      debtIssues,
      netWorthIssues,
      maxAbsoluteError,
    },
    survivor: {
      begins: survivorBegins,
      maximumShortfall: survivorMaximumShortfall,
      endingPortfolio: survivorEndingPortfolio,
    },
    estate: {
      value: result.metrics.estateValue,
      endDate: result.monthly.at(-1)?.householdStage === "ESTATE" ? result.endDate : undefined,
    },
  };
}
