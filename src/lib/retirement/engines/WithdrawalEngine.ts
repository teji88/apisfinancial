import type { ProvinceCode, PersonRole } from "../domain/types";
import { calculateHouseholdTax, type TaxIncomeComponents } from "./TaxEngine";

export interface GrossWithdrawalSolveInput {
  netNeed: number;
  payer: TaxIncomeComponents;
  spouse?: TaxIncomeComponents;
  owner: PersonRole;
  province: ProvinceCode;
  payerAge: number;
  spouseAge?: number;
  pensionSplitPercent?: number;
  maxGross?: number;
  taxableRegistered?: boolean;
}

export interface GrossWithdrawalSolveResult {
  grossWithdrawal: number;
  incrementalTax: number;
  netCash: number;
  iterations: number;
}

export interface RegisteredWithdrawalOwnerInput {
  owner: PersonRole;
  balance: number;
  age: number;
  taxInputs: Record<PersonRole, TaxIncomeComponents>;
}

export interface RegisteredWithdrawalAllocationInput {
  netNeed: number;
  owners: RegisteredWithdrawalOwnerInput[];
  province: ProvinceCode;
  payerAge: number;
  spouseAge?: number;
  pensionSplitPercent?: number;
}

export interface RegisteredWithdrawalAllocationResult {
  owner: PersonRole;
  solved: GrossWithdrawalSolveResult;
}

/**
 * Selects the registered-account owner whose withdrawal satisfies the current
 * after-tax cash need with the least gross withdrawal. If neither owner can
 * fully satisfy the need, selects the owner producing the most after-tax cash.
 */
export function chooseRegisteredWithdrawalOwner(
  input: RegisteredWithdrawalAllocationInput,
): RegisteredWithdrawalAllocationResult | undefined {
  const candidates = input.owners
    .filter((owner) => owner.balance > 0)
    .map((owner) => {
      const spouseRole: PersonRole = owner.owner === "MAIN_USER" ? "PARTNER" : "MAIN_USER";
      const solved = solveGrossWithdrawalForNetNeed({
        netNeed: input.netNeed,
        payer: input.taxInputs.MAIN_USER,
        spouse: input.taxInputs.PARTNER,
        owner: owner.owner,
        province: input.province,
        payerAge: input.payerAge,
        spouseAge: input.spouseAge,
        pensionSplitPercent: input.pensionSplitPercent ?? 0,
        maxGross: owner.balance,
      });
      return { owner: owner.owner, solved, spouseRole };
    });

  if (candidates.length === 0) return undefined;

  return candidates.sort((a, b) => {
    const aFull = a.solved.netCash >= input.netNeed - 0.005;
    const bFull = b.solved.netCash >= input.netNeed - 0.005;
    if (aFull !== bFull) return aFull ? -1 : 1;
    if (aFull && bFull) return a.solved.grossWithdrawal - b.solved.grossWithdrawal;
    return b.solved.netCash - a.solved.netCash;
  })[0];
}

/**
 * Solves the gross withdrawal required to satisfy a desired after-tax cash need.
 *
 * Tax is calculated by comparing the household return before and after the
 * proposed withdrawal. Binary search is used because Canadian tax is
 * piecewise and the household tax model can contain credits/recovery tax.
 */
export function solveGrossWithdrawalForNetNeed(
  input: GrossWithdrawalSolveInput,
): GrossWithdrawalSolveResult {
  const target = Math.max(0, input.netNeed);
  if (target === 0) {
    return { grossWithdrawal: 0, incrementalTax: 0, netCash: 0, iterations: 0 };
  }

  const maxGross = Math.max(0, input.maxGross ?? target);
  if (maxGross === 0) {
    return { grossWithdrawal: 0, incrementalTax: 0, netCash: 0, iterations: 0 };
  }

  const taxableRegistered = input.taxableRegistered ?? true;
  const baseTax = calculateHouseholdTax({
    payer: input.payer,
    spouse: input.spouse,
    province: input.province,
    payerAge: input.payerAge,
    spouseAge: input.spouseAge,
    pensionSplitPercent: input.pensionSplitPercent ?? 0,
  }).householdTax;

  const taxAt = (gross: number) => {
    if (!taxableRegistered) return baseTax;
    const payer = input.owner === "MAIN_USER"
      ? withRegisteredWithdrawal(input.payer, gross, input.payerAge)
      : input.payer;
    const spouse = input.owner === "PARTNER"
      ? withRegisteredWithdrawal(input.spouse ?? {}, gross, input.spouseAge ?? 65)
      : input.spouse;

    return calculateHouseholdTax({
      payer,
      spouse,
      province: input.province,
      payerAge: input.payerAge,
      spouseAge: input.spouseAge,
      pensionSplitPercent: input.pensionSplitPercent ?? 0,
    }).householdTax;
  };

  const netAt = (gross: number) => {
    const incrementalTax = Math.max(0, taxAt(gross) - baseTax);
    return Math.max(0, gross - incrementalTax);
  };

  if (netAt(maxGross) < target) {
    const incrementalTax = Math.max(0, taxAt(maxGross) - baseTax);
    return {
      grossWithdrawal: maxGross,
      incrementalTax,
      netCash: netAt(maxGross),
      iterations: 0,
    };
  }

  let low = 0;
  let high = maxGross;
  let iterations = 0;
  for (; iterations < 40; iterations++) {
    const mid = (low + high) / 2;
    if (netAt(mid) >= target) high = mid;
    else low = mid;
  }

  const grossWithdrawal = high;
  const incrementalTax = Math.max(0, taxAt(grossWithdrawal) - baseTax);
  return {
    grossWithdrawal,
    incrementalTax,
    netCash: Math.max(0, grossWithdrawal - incrementalTax),
    iterations,
  };
}

function withRegisteredWithdrawal(
  components: TaxIncomeComponents,
  gross: number,
  age: number,
): TaxIncomeComponents {
  const withdrawal = Math.max(0, gross);
  return {
    ...components,
    rrspRrif: (components.rrspRrif ?? 0) + withdrawal,
    eligiblePensionIncome: age >= 65
      ? (components.eligiblePensionIncome ?? 0) + withdrawal
      : components.eligiblePensionIncome,
    age,
  };
}
