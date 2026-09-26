import type { AccountScenario, Money } from "../domain/types";

export type AccountBucket = "registered" | "tfsa" | "nonRegistered" | "cash";

export interface AccountState {
  id: string;
  owner: AccountScenario["owner"];
  type: AccountScenario["type"];
  balance: Money;
  contributionAnnual: Money;
  contributionUntilAge?: number;
  /** Beginning-of-year balance used for RRIF/LIF minimum withdrawals. */
  minimumReferenceBalance?: Money;
  minimumReferenceYear?: number;
  /** Adjusted cost base for non-registered assets. */
  nonRegisteredAcb: Money;
  /** Annual income yields applied to the account market value. */
  eligibleDividendYield: number;
  nonEligibleDividendYield: number;
  interestYield: number;
  foreignIncomeYield: number;
  foreignTaxRate: number;
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
    minimumReferenceBalance: Math.max(0, account.valuation.value ?? account.valuation.linkedValue ?? 0),
    minimumReferenceYear: undefined,
    nonRegisteredAcb: account.type === "NON_REGISTERED"
      ? Math.max(0, Math.min(account.balance, account.nonRegisteredAcb ?? account.valuation.value ?? account.valuation.linkedValue ?? 0))
      : 0,
    eligibleDividendYield: account.type === "NON_REGISTERED" ? Math.max(0, account.nonRegisteredEligibleDividendYield ?? 0) : 0,
    nonEligibleDividendYield: account.type === "NON_REGISTERED" ? Math.max(0, account.nonRegisteredNonEligibleDividendYield ?? 0) : 0,
    interestYield: account.type === "NON_REGISTERED" ? Math.max(0, account.nonRegisteredInterestYield ?? 0) : 0,
    foreignIncomeYield: account.type === "NON_REGISTERED" ? Math.max(0, account.nonRegisteredForeignIncomeYield ?? 0) : 0,
    foreignTaxRate: account.type === "NON_REGISTERED" ? Math.max(0, account.nonRegisteredForeignTaxRate ?? 0) : 0,
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

export function mandatoryRegisteredWithdrawal(
  type: AccountScenario["type"],
  age: number,
  balance: Money,
  annualReferenceBalance = balance,
): Money {
  if (balance <= 0 || (type !== "RRIF" && type !== "LIF")) return 0;
  const factor = rrifMinimumFactor(age);
  const reference = Math.max(0, annualReferenceBalance);
  return Math.min(balance, reference * factor / 12);
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
  capitalGainAtDeath: Money;
  taxableCapitalGainAtDeath: Money;
}

export function applyAccountDeathTreatment(
  state: AccountState,
  hasEligibleSpouse: boolean,
  nonRegisteredAcb = 0,
  deathTransfer: "SPOUSE" | "ESTATE" | "BENEFICIARY" = hasEligibleSpouse ? "SPOUSE" : "ESTATE",
): DeathTreatment {
  const value = Math.max(0, state.balance);
  if (value === 0) return { transferredToSurvivor: 0, taxableAtDeath: 0, estateValue: 0, notes: [], capitalGainAtDeath: 0, taxableCapitalGainAtDeath: 0 };

  if ((state.type === "RRSP" || state.type === "RRIF" || state.type === "LIRA" || state.type === "LIF") && deathTransfer === "SPOUSE") {
    return { transferredToSurvivor: value, taxableAtDeath: 0, estateValue: 0, notes: ["Modeled as spouse rollover; detailed eligibility and paperwork are outside the simulation."], capitalGainAtDeath: 0, taxableCapitalGainAtDeath: 0 };
  }
  if (state.type === "TFSA" && deathTransfer === "SPOUSE") {
    return { transferredToSurvivor: value, taxableAtDeath: 0, estateValue: 0, notes: ["Modeled as spouse successor-holder treatment where available."], capitalGainAtDeath: 0, taxableCapitalGainAtDeath: 0 };
  }
  if (state.type === "RRSP" || state.type === "RRIF" || state.type === "LIRA" || state.type === "LIF") {
    return { transferredToSurvivor: 0, taxableAtDeath: value, estateValue: value, notes: ["Registered account included as taxable death value; final-return details are simplified."], capitalGainAtDeath: 0, taxableCapitalGainAtDeath: 0 };
  }

  const acb = Math.max(0, Math.min(value, nonRegisteredAcb || value));
  const capitalGainAtDeath = Math.max(0, value - acb);
  const taxableCapitalGainAtDeath = capitalGainAtDeath * 0.5;
  if (deathTransfer === "SPOUSE") {
    return { transferredToSurvivor: value, taxableAtDeath: 0, estateValue: 0, notes: ["Non-registered spouse transfer is modeled as tax-deferred for planning purposes."], capitalGainAtDeath: 0, taxableCapitalGainAtDeath: 0 };
  }
  return { transferredToSurvivor: 0, taxableAtDeath: 0, estateValue: value, notes: ["Non-registered deemed disposition uses supplied ACB; detailed rollover eligibility is simplified."], capitalGainAtDeath, taxableCapitalGainAtDeath };
}


export interface NonRegisteredIncome {
  eligibleCanadianDividends: Money;
  nonEligibleCanadianDividends: Money;
  interest: Money;
  foreignIncome: Money;
  foreignTaxPaid: Money;
}

/** Estimates one month's non-registered investment income from current value. */
export function estimateNonRegisteredMonthlyIncome(state: AccountState): NonRegisteredIncome {
  if (state.type !== "NON_REGISTERED" || state.balance <= 0) {
    return { eligibleCanadianDividends: 0, nonEligibleCanadianDividends: 0, interest: 0, foreignIncome: 0, foreignTaxPaid: 0 };
  }
  const annualValue = Math.max(0, state.balance);
  const monthly = (yieldRate: number) => annualValue * (yieldRate / 100) / 12;
  const eligibleCanadianDividends = monthly(state.eligibleDividendYield);
  const nonEligibleCanadianDividends = monthly(state.nonEligibleDividendYield);
  const interest = monthly(state.interestYield);
  const foreignIncome = monthly(state.foreignIncomeYield);
  const foreignTaxPaid = foreignIncome * state.foreignTaxRate / 100;
  return { eligibleCanadianDividends, nonEligibleCanadianDividends, interest, foreignIncome, foreignTaxPaid };
}

/**
 * Applies a non-registered withdrawal while tracking ACB. The capital gain
 * realized is the withdrawal's proportional share of unrealized gain.
 */
export function withdrawNonRegistered(state: AccountState, amount: Money): { taken: Money; realizedCapitalGain: Money; returnOfCapital: Money } {
  const taken = withdraw(state, amount);
  if (taken <= 0) return { taken: 0, realizedCapitalGain: 0, returnOfCapital: 0 };
  const startingBalance = state.balance + taken;
  const acbRatio = startingBalance > 0 ? Math.min(1, Math.max(0, state.nonRegisteredAcb / startingBalance)) : 0;
  const returnOfCapital = Math.min(taken, taken * acbRatio);
  const realizedCapitalGain = Math.max(0, taken - returnOfCapital);
  state.nonRegisteredAcb = Math.max(0, state.nonRegisteredAcb - returnOfCapital);
  return { taken, realizedCapitalGain, returnOfCapital };
}
