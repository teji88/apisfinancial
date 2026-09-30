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
  /** RRIF withdrawals can qualify as eligible pension income after age 65; RRSP withdrawals do not. */
  registeredAccountType?: "RRSP" | "RRIF" | "LIRA";
  /** Fraction of a non-registered withdrawal that is a realized capital gain (V1). */
  nonRegisteredGainFraction?: number;
}

export interface GrossWithdrawalSolveResult {
  grossWithdrawal: number;
  incrementalTax: number;
  netCash: number;
  iterations: number;
}

export type WithdrawalBucket = "CASH" | "NON_REGISTERED" | "RRSP_RRIF" | "LIRA_LIF" | "TFSA";

export interface WithdrawalSequenceInput {
  netNeed: number;
  taxInputs: Record<PersonRole, TaxIncomeComponents>;
  owners: Array<{ accountId?: string; owner: PersonRole; type: WithdrawalBucket; balance: number; age: number; gainFraction?: number; registeredAccountType?: "RRSP" | "RRIF" | "LIRA" }>;
  province: ProvinceCode;
  payerAge: number;
  spouseAge?: number;
  pensionSplitPercent?: number;
  /** Optional ordering override; defaults to a tax-aware V1 sequence. */
  priority?: WithdrawalBucket[];
}

export interface WithdrawalSequenceStep {
  bucket: WithdrawalBucket;
  owner: PersonRole;
  accountId?: string;
  grossWithdrawal: number;
  incrementalTax: number;
  netCash: number;
}

export interface WithdrawalSequenceResult {
  steps: WithdrawalSequenceStep[];
  totalGrossWithdrawal: number;
  totalTax: number;
  totalNetCash: number;
  remainingNeed: number;
  fullyFunded: boolean;
}

/**
 * V1 cash-flow sequence. Taxable registered assets are solved gross-up withdrawals;
 * TFSA is dollar-for-dollar. The default deliberately uses non-registered assets
 * before registered assets and TFSA last, while still allowing an explicit user
 * priority for future strategy variants.
 */
export function planWithdrawalSequence(input: WithdrawalSequenceInput): WithdrawalSequenceResult {
  const priority = input.priority ?? ["CASH", "NON_REGISTERED", "RRSP_RRIF", "LIRA_LIF", "TFSA"];
  let remainingNeed = Math.max(0, input.netNeed);
  const steps: WithdrawalSequenceStep[] = [];

  for (const bucket of priority) {
    if (remainingNeed <= 0) break;
    const candidates = input.owners.filter((x) => x.type === bucket && x.balance > 0);
    for (const account of candidates) {
      if (remainingNeed <= 0) break;
      const taxableRegistered = bucket === "RRSP_RRIF" || bucket === "LIRA_LIF";
      const accountType = account.registeredAccountType ?? (bucket === "RRSP_RRIF" ? "RRIF" : bucket === "LIRA_LIF" ? "LIRA" : undefined);
      const solved = solveGrossWithdrawalForNetNeed({
        netNeed: remainingNeed,
        payer: input.taxInputs.MAIN_USER ?? {},
        spouse: input.taxInputs.PARTNER ?? {},
        owner: account.owner,
        province: input.province,
        payerAge: account.owner === "MAIN_USER" ? account.age : input.payerAge,
        spouseAge: account.owner === "PARTNER" ? account.age : input.spouseAge,
        pensionSplitPercent: input.pensionSplitPercent ?? 0,
        maxGross: account.balance,
        taxableRegistered,
        registeredAccountType: accountType,
        nonRegisteredGainFraction: bucket === "NON_REGISTERED" ? account.gainFraction : undefined,
      });
      const netCash = Math.min(remainingNeed, solved.netCash);
      if (solved.grossWithdrawal <= 0 || netCash <= 0) continue;
      steps.push({ bucket, owner: account.owner, accountId: account.accountId, grossWithdrawal: solved.grossWithdrawal, incrementalTax: solved.incrementalTax, netCash });
      remainingNeed = Math.max(0, remainingNeed - netCash);
    }
  }

  return {
    steps,
    totalGrossWithdrawal: steps.reduce((sum, x) => sum + x.grossWithdrawal, 0),
    totalTax: steps.reduce((sum, x) => sum + x.incrementalTax, 0),
    totalNetCash: steps.reduce((sum, x) => sum + x.netCash, 0),
    remainingNeed,
    fullyFunded: remainingNeed <= 0.005,
  };
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
  registeredAccountType?: "RRSP" | "RRIF" | "LIRA";
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
  const taxInputs = input.taxInputs ?? {};
  const candidates = input.owners
    .filter((owner) => owner.balance > 0)
    .map((owner) => {
      const solved = solveGrossWithdrawalForNetNeed({
        netNeed: input.netNeed,
        payer: taxInputs.MAIN_USER ?? {},
        spouse: taxInputs.PARTNER ?? {},
        owner: owner.owner,
        province: input.province,
        payerAge: input.payerAge,
        spouseAge: input.spouseAge,
        pensionSplitPercent: input.pensionSplitPercent ?? 0,
        maxGross: owner.balance,
        registeredAccountType: input.registeredAccountType ?? "RRIF",
      });
      return { owner: owner.owner, solved };
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
  const registeredAccountType = input.registeredAccountType ?? "RRIF";
  const nonRegisteredGainFraction = Math.min(1, Math.max(0, input.nonRegisteredGainFraction ?? 0));
  const baseTax = calculateHouseholdTax({
    payer: input.payer,
    spouse: input.spouse,
    province: input.province,
    payerAge: input.payerAge,
    spouseAge: input.spouseAge,
    pensionSplitPercent: input.pensionSplitPercent ?? 0,
  }).householdTax;

  const taxAt = (gross: number) => {
    const payer = input.owner === "MAIN_USER"
      ? (taxableRegistered
        ? withRegisteredWithdrawal(input.payer, gross, input.payerAge, registeredAccountType)
        : withNonRegisteredWithdrawal(input.payer, gross, nonRegisteredGainFraction))
      : input.payer;
    const spouse = input.owner === "PARTNER"
      ? (taxableRegistered
        ? withRegisteredWithdrawal(input.spouse ?? {}, gross, input.spouseAge ?? 65, registeredAccountType)
        : withNonRegisteredWithdrawal(input.spouse ?? {}, gross, nonRegisteredGainFraction))
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
  accountType: "RRSP" | "RRIF" | "LIRA",
): TaxIncomeComponents {
  const withdrawal = Math.max(0, gross);
  return {
    ...components,
    rrspRrif: (components.rrspRrif ?? 0) + withdrawal,
    eligiblePensionIncome: accountType === "RRIF" && age >= 65
      ? (components.eligiblePensionIncome ?? 0) + withdrawal
      : components.eligiblePensionIncome,
    age,
  };
}


function withNonRegisteredWithdrawal(
  components: TaxIncomeComponents,
  gross: number,
  gainFraction: number,
): TaxIncomeComponents {
  const withdrawal = Math.max(0, gross);
  const realizedGain = withdrawal * Math.min(1, Math.max(0, gainFraction));
  return {
    ...components,
    capitalGains: (components.capitalGains ?? 0) + realizedGain,
    age: components.age,
  };
}
