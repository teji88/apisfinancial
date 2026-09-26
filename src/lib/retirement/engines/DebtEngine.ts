import type { Money } from "../domain/types";

export type DebtType = "MORTGAGE" | "HELOC" | "LINE_OF_CREDIT" | "PERSONAL_LOAN" | "OTHER";
export type DebtPaymentFrequency = "MONTHLY" | "BIWEEKLY" | "WEEKLY";

export interface DebtScenario {
  id: string;
  name?: string;
  type: DebtType;
  startingBalance: Money;
  annualInterestRate: number;
  paymentAmount?: Money;
  paymentFrequency?: DebtPaymentFrequency;
  amortizationMonths?: number;
  startDate?: string;
  endDate?: string;
  extraPayment?: Money;
}

export interface DebtState {
  id: string;
  type: DebtType;
  balance: Money;
  annualInterestRate: number;
  scheduledMonthlyPayment: Money;
  extraMonthlyPayment: Money;
  active: boolean;
}

export interface DebtMonthResult {
  beginningBalance: Money;
  interest: Money;
  scheduledPrincipal: Money;
  extraPrincipal: Money;
  totalPayment: Money;
  endingBalance: Money;
}

export function monthlyRate(annualInterestRate: number): number {
  return Math.max(-0.99, annualInterestRate / 100 / 12);
}

export function calculateAmortizingPayment(balance: Money, annualInterestRate: number, months: number): Money {
  const principal = Math.max(0, balance);
  const n = Math.max(1, Math.floor(months));
  if (principal === 0) return 0;
  const r = monthlyRate(annualInterestRate);
  if (Math.abs(r) < 1e-12) return principal / n;
  return principal * r / (1 - Math.pow(1 + r, -n));
}

export function createDebtState(debt: DebtScenario): DebtState {
  const balance = Math.max(0, debt.startingBalance);
  const frequency = debt.paymentFrequency ?? "MONTHLY";
  const payment = debt.paymentAmount !== undefined
    ? Math.max(0, debt.paymentAmount) * (frequency === "BIWEEKLY" ? 26 / 12 : frequency === "WEEKLY" ? 52 / 12 : 1)
    : calculateAmortizingPayment(balance, debt.annualInterestRate, debt.amortizationMonths ?? 0 || 1);
  return {
    id: debt.id,
    type: debt.type,
    balance,
    annualInterestRate: Math.max(0, debt.annualInterestRate),
    scheduledMonthlyPayment: payment,
    extraMonthlyPayment: Math.max(0, debt.extraPayment ?? 0),
    active: balance > 0,
  };
}

export function accrueDebtMonth(state: DebtState): DebtMonthResult {
  const beginningBalance = Math.max(0, state.balance);
  if (beginningBalance <= 0) {
    state.active = false;
    return { beginningBalance: 0, interest: 0, scheduledPrincipal: 0, extraPrincipal: 0, totalPayment: 0, endingBalance: 0 };
  }

  const interest = beginningBalance * monthlyRate(state.annualInterestRate);
  const amountAvailable = beginningBalance + interest;
  const scheduledPayment = Math.min(amountAvailable, state.scheduledMonthlyPayment);
  const scheduledPrincipal = Math.max(0, Math.min(beginningBalance, scheduledPayment - interest));
  const remainingAfterScheduled = Math.max(0, beginningBalance - scheduledPrincipal);
  const extraPrincipal = Math.min(remainingAfterScheduled, state.extraMonthlyPayment);
  const endingBalance = Math.max(0, remainingAfterScheduled - extraPrincipal);
  const totalPayment = interest + scheduledPrincipal + extraPrincipal;

  state.balance = endingBalance;
  state.active = endingBalance > 1e-8;
  return { beginningBalance, interest, scheduledPrincipal, extraPrincipal, totalPayment, endingBalance };
}

export function requiredDebtPayment(state: DebtState): Money {
  return Math.min(Math.max(0, state.balance), Math.max(0, state.scheduledMonthlyPayment) + Math.max(0, state.extraMonthlyPayment));
}
