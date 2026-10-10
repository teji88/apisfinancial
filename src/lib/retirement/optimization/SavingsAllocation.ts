/**
 * Savings allocation suggester — deterministic waterfall:
 *   1. Capture the full employer match.
 *   2. RRSP vs TFSA by current marginal rate vs expected retirement withdrawal rate.
 *   3. Spousal RRSP where there is a meaningful income/RRSP-balance gap.
 *   4. Non-registered last.
 *
 * Accuracy over cleverness: every step carries its reason, and the result is
 * informational only — never prescriptive advice.
 */

export interface EmployerMatchTerms {
  offered: boolean;
  /** Employer match per $1 of employee contribution, as a decimal (e.g. 0.5). */
  matchRate: number;
  /** Max employee contribution eligible, as a fraction of salary (e.g. 0.06). */
  maxOfSalary: number;
}

export interface SavingsAllocatorInputs {
  /** Total annual savings available ($). */
  annualSavings: number;
  /** Gross employment income ($/yr) — sizes the match cap. */
  salary: number;
  /** Current marginal tax rate, as a decimal. */
  currentMarginalRate: number;
  /** Expected marginal rate on withdrawals in retirement, as a decimal. */
  retirementMarginalRate: number;
  employerMatch: EmployerMatchTerms;
  /** RRSP contribution room available ($). Null/undefined = assume room available. */
  rrspRoom?: number | null;
  /** TFSA contribution room available ($). Null/undefined = assume room available. */
  tfsaRoom?: number | null;
  married: boolean;
  /** Absolute income gap between spouses ($/yr). */
  incomeGap?: number;
  /** Absolute RRSP-balance gap between spouses ($). */
  rrspBalanceGap?: number;
  /** Whether projected retirement income may trigger OAS recovery tax. */
  oasClawbackExposure?: boolean;
}

export type AllocationBucket = "employer_match" | "rrsp" | "spousal_rrsp" | "tfsa" | "nonreg";

export interface AllocationStep {
  bucket: AllocationBucket;
  label: string;
  amount: number;
  /** Factual reason for this step — never a recommendation. */
  reason: string;
}

export interface SavingsAllocationResult {
  steps: AllocationStep[];
  totalAllocated: number;
  warnings: string[];
  /** The UI must display this wherever results are shown. */
  disclaimer: string;
}

/** Income or RRSP-balance gap that makes income-splitting worth considering. */
export const SPOUSAL_GAP_THRESHOLD = 10_000;

export const SAVINGS_DISCLAIMER =
  "Ordering based on current Canadian tax rules and the rates shown. " +
  "For information only — not financial, tax, or investment advice. " +
  "Contribution room, employer plan rules, and your full financial picture " +
  "can change the right answer; consider consulting a qualified professional.";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function suggestSavingsAllocation(inputs: SavingsAllocatorInputs): SavingsAllocationResult {
  const warnings: string[] = [];
  const steps: AllocationStep[] = [];
  let remaining = Math.max(0, inputs.annualSavings);
  const rrspRoom = inputs.rrspRoom ?? Number.POSITIVE_INFINITY;
  const tfsaRoom = inputs.tfsaRoom ?? Number.POSITIVE_INFINITY;

  const take = (amount: number): number => {
    const a = round2(Math.min(amount, remaining));
    remaining = round2(remaining - a);
    return a;
  };

  // 1. Employer match — an immediate return no market can beat.
  const m = inputs.employerMatch;
  if (m.offered && m.matchRate > 0 && m.maxOfSalary > 0 && inputs.salary > 0) {
    const eligible = inputs.salary * m.maxOfSalary;
    const toMatch = take(eligible);
    if (toMatch > 0) {
      steps.push({
        bucket: "employer_match",
        label: "Employer match",
        amount: toMatch,
        reason:
          `Contributing $${toMatch.toLocaleString()} captures the full employer match ` +
          `(${(m.matchRate * 100).toFixed(0)}% on up to ${(m.maxOfSalary * 100).toFixed(1)}% of salary) — ` +
          `an immediate ${(m.matchRate * 100).toFixed(0)}% return before any market growth.`,
      });
    }
  }

  // 2 & 3. RRSP vs TFSA, with spousal RRSP where the gap is meaningful.
  const rrspFirst = inputs.retirementMarginalRate < inputs.currentMarginalRate;
  const useSpousal =
    inputs.married &&
    ((inputs.incomeGap ?? 0) >= SPOUSAL_GAP_THRESHOLD ||
      (inputs.rrspBalanceGap ?? 0) >= SPOUSAL_GAP_THRESHOLD);
  const rrspBucket: AllocationBucket = useSpousal ? "spousal_rrsp" : "rrsp";
  const rrspLabel = useSpousal ? "Spousal RRSP" : "Your RRSP";

  const rrspReason =
    (useSpousal
      ? "Contributions are deducted at the higher-income spouse's rate while withdrawals " +
        "are taxed in the lower-income spouse's hands, splitting retirement income. "
      : "") +
    (rrspFirst
      ? `Deducting at ${(inputs.currentMarginalRate * 100).toFixed(1)}% today and expecting ` +
        `withdrawals near ${(inputs.retirementMarginalRate * 100).toFixed(1)}% makes the upfront ` +
        `deduction worth more than the tax on withdrawal.`
      : `With withdrawals expected near ${(inputs.retirementMarginalRate * 100).toFixed(1)}% versus ` +
        `${(inputs.currentMarginalRate * 100).toFixed(1)}% today, the deduction is worth less than ` +
        `the tax on withdrawal — so this comes after the TFSA.`);

  const tfsaReason = rrspFirst
    ? "After the RRSP room that beats today's rate, the TFSA shelters growth with tax-free, " +
      "flexible withdrawals that don't affect income-tested benefits."
    : "Tax-free growth and withdrawals that don't affect income-tested benefits beat a " +
      "deduction worth less than the tax on withdrawal.";

  const allocateRrsp = () => {
    const amt = take(rrspRoom);
    if (amt > 0) steps.push({ bucket: rrspBucket, label: rrspLabel, amount: amt, reason: rrspReason });
  };
  const allocateTfsa = () => {
    const amt = take(tfsaRoom);
    if (amt > 0) steps.push({ bucket: "tfsa", label: "Your TFSA", amount: amt, reason: tfsaReason });
  };

  if (remaining > 0) {
    if (rrspFirst) {
      allocateRrsp();
      allocateTfsa();
    } else {
      // TFSA first when rates are equal too: flexibility with no rate advantage to the RRSP.
      allocateTfsa();
      allocateRrsp();
    }
  }

  // 4. Non-registered last — no shelter left.
  if (remaining > 0) {
    const amt = take(remaining);
    if (amt > 0) {
      steps.push({
        bucket: "nonreg",
        label: "Non-registered",
        amount: amt,
        reason:
          "Registered room is used up; remaining savings go to a taxable account where " +
          "capital gains are taxed at half the marginal rate when realized.",
      });
    }
  }

  if (useSpousal) {
    warnings.push(
      "Spousal RRSP attribution: if the lower-income spouse withdraws within three calendar " +
        "years of the last contribution, the withdrawal is taxed back to the contributor. " +
        "Keep contributions and withdrawals on separate timelines.",
    );
  }
  if (inputs.oasClawbackExposure) {
    warnings.push(
      "OAS recovery-tax exposure: projected retirement income may trigger the 15% OAS clawback, " +
        "which raises the effective tax on RRSP withdrawals. If the retirement rate above does not " +
        "include it, the RRSP-vs-TFSA comparison may favour the TFSA more than shown.",
    );
  }
  if (inputs.annualSavings <= 0) {
    warnings.push("No annual savings entered — nothing to allocate.");
  }

  const totalAllocated = round2(steps.reduce((s, st) => s + st.amount, 0));

  return { steps, totalAllocated, warnings, disclaimer: SAVINGS_DISCLAIMER };
}
