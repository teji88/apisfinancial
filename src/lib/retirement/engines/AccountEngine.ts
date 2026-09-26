import type { AccountScenario, Money } from "../domain/types";

export type AccountBucket = "registered" | "tfsa" | "nonRegistered" | "cash";

export interface AccountState {
  id: string;
  owner: AccountScenario["owner"];
  type: AccountScenario["type"];
  balance: Money;
  contributionAnnual: Money;
  contributionUntilAge?: number;
}

export function classifyAccount(account: AccountScenario): {
  bucket: AccountBucket;
  registered: boolean;
  taxFree: boolean;
  taxableWithdrawal: boolean;
} {
  switch (account.type) {
    case "TFSA":
      return { bucket: "tfsa", registered: false, taxFree: true, taxableWithdrawal: false };
    case "RRSP":
    case "RRIF":
    case "LIRA":
    case "LIF":
      return { bucket: "registered", registered: true, taxFree: false, taxableWithdrawal: true };
    case "CASH":
      return { bucket: "cash", registered: false, taxFree: false, taxableWithdrawal: false };
    default:
      return { bucket: "nonRegistered", registered: false, taxFree: false, taxableWithdrawal: false };
  }
}

export function createAccountState(account: AccountScenario): AccountState {
  return {
    id: account.id,
    owner: account.owner,
    type: account.type,
    balance: Math.max(0, account.valuation.value ?? account.valuation.linkedValue ?? 0),
    contributionAnnual: Math.max(0, account.contribution?.annualAmount ?? 0),
    contributionUntilAge: account.contribution?.untilAge,
  };
}

export function applyMonthlyReturn(balance: Money, annualReturn: number, feeRate = 0): Money {
  const netAnnualReturn = (1 + Math.max(-0.99, annualReturn / 100)) * (1 - Math.max(0, feeRate / 100)) - 1;
  return Math.max(0, balance * Math.pow(1 + netAnnualReturn, 1 / 12));
}

export function mandatoryRegisteredWithdrawal(type: AccountScenario["type"], age: number, balance: Money): Money {
  if (balance <= 0 || (type !== "RRIF" && type !== "LIF")) return 0;
  // RRIF minimum withdrawals begin in the calendar year after conversion; this
  // approximation uses age 72 as the first minimum age for a standard RRIF.
  if (age < 72) return 0;
  const factor = age <= 94 ? 1 / (90 - age) : 0.20;
  return Math.min(balance, balance * factor / 12);
}

export function withdraw(state: AccountState, amount: Money): Money {
  const taken = Math.min(Math.max(0, amount), state.balance);
  state.balance -= taken;
  return taken;
}
