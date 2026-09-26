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
  const gross = 1 + Math.max(-0.99, annualReturn / 100);
  const netAnnualReturn = gross * (1 - Math.max(0, feeRate / 100)) - 1;
  return Math.max(0, balance * Math.pow(1 + netAnnualReturn, 1 / 12));
}

const RRIF_FACTORS: Record<number, number> = {
  71: 0.0528, 72: 0.0540, 73: 0.0553, 74: 0.0567, 75: 0.0582,
  76: 0.0598, 77: 0.0617, 78: 0.0636, 79: 0.0658, 80: 0.0682,
  81: 0.0708, 82: 0.0738, 83: 0.0771, 84: 0.0808, 85: 0.0851,
  86: 0.0899, 87: 0.0955, 88: 0.1021, 89: 0.1099, 90: 0.1192,
  91: 0.1306, 92: 0.1449, 93: 0.1634, 94: 0.1879,
};

export function rrifMinimumFactor(age: number): number {
  if (age < 71) return 0;
  return RRIF_FACTORS[Math.min(94, Math.floor(age))] ?? 0.20;
}

export function mandatoryRegisteredWithdrawal(type: AccountScenario["type"], age: number, balance: Money): Money {
  if (balance <= 0 || (type !== "RRIF" && type !== "LIF")) return 0;
  const factor = rrifMinimumFactor(age);
  return Math.min(balance, balance * factor / 12);
}

export function withdraw(state: AccountState, amount: Money): Money {
  const taken = Math.min(Math.max(0, amount), state.balance);
  state.balance -= taken;
  return taken;
}

export interface DeathTreatment {
  transferredToSurvivor: Money;
  taxableAtDeath: Money;
  estateValue: Money;
  notes: string[];
}

export function applyAccountDeathTreatment(
  state: AccountState,
  hasEligibleSpouse: boolean,
): DeathTreatment {
  const value = Math.max(0, state.balance);
  if (value === 0) return { transferredToSurvivor: 0, taxableAtDeath: 0, estateValue: 0, notes: [] };

  if ((state.type === "RRSP" || state.type === "RRIF") && hasEligibleSpouse) {
    return { transferredToSurvivor: value, taxableAtDeath: 0, estateValue: 0, notes: ["Modeled as spouse rollover; detailed eligibility and paperwork are outside the simulation."] };
  }
  if (state.type === "TFSA" && hasEligibleSpouse) {
    return { transferredToSurvivor: value, taxableAtDeath: 0, estateValue: 0, notes: ["Modeled as spouse successor-holder treatment where available."] };
  }
  if (state.type === "RRSP" || state.type === "RRIF") {
    return { transferredToSurvivor: 0, taxableAtDeath: value, estateValue: value, notes: ["Registered account included as taxable death value; final-return details are simplified."] };
  }
  return { transferredToSurvivor: value, taxableAtDeath: 0, estateValue: value, notes: ["Non-registered/TFSA death treatment is simplified; ACB and post-death income are not modelled here."] };
}
